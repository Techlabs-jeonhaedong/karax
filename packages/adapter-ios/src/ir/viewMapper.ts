/**
 * viewMapper — SwiftUI AST 노드를 IRNode로 변환한다.
 *
 * 지원 뷰 목록:
 * - VStack → Column
 * - HStack → Row
 * - ZStack → Stack
 * - ScrollView → Scroll
 * - List / LazyVStack(ForEach) → Scroll+List (3회 반복)
 * - LazyVGrid → Grid
 * - Text → Text (리터럴, 보간은 mock)
 * - Image(systemName:) → Icon
 * - Image("asset") → Image (asset://)
 * - AsyncImage → Image (network-placeholder)
 * - Button → Button
 * - TextField / SecureField → Input
 * - Toggle → Box + role:toggle
 * - Divider → Divider
 * - Spacer → Spacer
 * - NavigationStack → Box (appbar role 생성)
 * - NavigationLink → Button (자식 투과)
 * - Form → Column
 * - Group → 자식 투과
 * - Section → Column
 * - ForEach → 3회 반복
 * - 커스텀 View struct → inliner
 * - 알 수 없는 뷰 → Unknown
 */

import type { SyntaxNode } from "@sfc/adapter-api";
import type { IRNode } from "@sfc/core";
import { NODE_CONFIDENCE } from "@sfc/core";
import type { MockProvider } from "@sfc/core";
import type { SwiftSymbolTable } from "../parse/scanner.js";
import {
  findAllNodes,
  findChild,
  filterChildren,
  extractCallName,
  extractCallArgs,
  getNamedArg,
  getPositionalArg,
  extractStringLiteral,
  extractNumber,
  extractColorFromNode,
  extractModifiers,
  extractPadding,
  extractFrame,
  extractBackgroundFromModifiers,
  extractForegroundColorFromModifiers,
  extractCornerRadius,
  extractFontToken,
  extractNavigationTitle,
  type ModifierInfo,
} from "./astUtils.js";
import { tryInlineSwiftView } from "./inliner.js";

// ── MapContext ─────────────────────────────────────────────────────────────────

export interface MapContext {
  depth: number;
  maxDepth: number;
  visited: Set<string>;
  symbolTable: SwiftSymbolTable | null;
  projectPath: string;
  designTokens: Record<string, string>;
  mockProvider?: MockProvider;
  diagnostics?: Array<{ level: string; code: string; message: string }>;
  currentFile?: string;
  argBindings?: Record<string, unknown>;
  /** 현재 매핑 중인 struct의 class_body 노드 — computed property 참조 해석에 사용 */
  currentClassBody?: SyntaxNode;
}

// ── sourceRef 헬퍼 ─────────────────────────────────────────────────────────────

function makeSourceRef(node: SyntaxNode, ctx?: MapContext): { file: string; line: number } {
  return { file: ctx?.currentFile ?? "unknown", line: node.startPosition.row + 1 };
}

// ── 뷰 이름 추출 ───────────────────────────────────────────────────────────────

/**
 * statements 내의 call_expression에서 가장 바깥쪽 뷰 이름을 추출한다.
 * 수정자 체인(.font, .padding 등)이 감싸고 있어도 올바르게 추출한다.
 */
function getTopLevelCallName(node: SyntaxNode): string {
  return extractCallName(node);
}

// ── 트레일링 클로저(자식 뷰) 파싱 ─────────────────────────────────────────────

/**
 * call_expression의 call_suffix 내 lambda_literal에서 자식 뷰 목록을 추출한다.
 */
async function parseTrailingClosure(
  callNode: SyntaxNode,
  ctx: MapContext
): Promise<IRNode[]> {
  // call_expression > call_suffix > lambda_literal > statements
  // 또는 navigation_expression > call_expression > call_suffix > lambda_literal

  function findLambda(n: SyntaxNode): SyntaxNode | undefined {
    if (n.type === "call_expression") {
      // 여기서 직접 call_suffix를 찾는다 (가장 바깥 call_expression의 lambda)
      // 수정자 체인이 있으면 가장 안쪽을 먼저 찾아야 한다
      const navExpr = findChild(n, "navigation_expression");
      if (navExpr) {
        // 수정자 체인의 가장 안쪽 call_expression에서 lambda 찾기
        return findLambdaInChain(navExpr);
      }
      const callSuffix = findChild(n, "call_suffix");
      if (callSuffix) return findChild(callSuffix, "lambda_literal");
    }
    if (n.type === "navigation_expression") {
      return findLambdaInChain(n);
    }
    return undefined;
  }

  function findLambdaInChain(nav: SyntaxNode): SyntaxNode | undefined {
    // navigation_expression 체인에서 가장 안쪽 call_expression의 lambda_literal 찾기
    let deepestLambda: SyntaxNode | undefined;

    function walk(n: SyntaxNode) {
      if (n.type === "call_expression") {
        const navInner = findChild(n, "navigation_expression");
        if (navInner) {
          walk(navInner);
          return;
        }
        const cs = findChild(n, "call_suffix");
        const lambda = cs ? findChild(cs, "lambda_literal") : undefined;
        if (lambda) deepestLambda = lambda;
      } else if (n.type === "navigation_expression") {
        const callInner = findChild(n, "call_expression");
        const navInner = findChild(n, "navigation_expression");
        const inner = callInner ?? navInner;
        if (inner) walk(inner);
      }
    }

    walk(nav);
    return deepestLambda;
  }

  const lambda = findLambda(callNode);
  if (!lambda) return [];

  const statements = findChild(lambda, "statements");
  if (!statements) return [];

  return parseStatements(statements, ctx);
}

// ── statements 파싱 ────────────────────────────────────────────────────────────

/**
 * statements 노드에서 각 뷰 표현식을 IRNode로 변환한다.
 */
async function parseStatements(
  statementsNode: SyntaxNode,
  ctx: MapContext
): Promise<IRNode[]> {
  const result: IRNode[] = [];

  for (const child of statementsNode.children) {
    if (!child) continue;
    if (child.type === "\n" || child.type === ";" || child.type === "comment") continue;

    const node = await mapView(child, ctx);
    if (node) result.push(node);
  }

  return result;
}

// ── value_arguments에서 named arg 파싱 ───────────────────────────────────────

function getArgFromValueArgs(callNode: SyntaxNode, label: string): SyntaxNode | undefined {
  const args = extractCallArgs(callNode);
  if (!args) return undefined;
  return getNamedArg(args, label);
}

// ── VStack / HStack 파싱 ──────────────────────────────────────────────────────

async function mapVStack(node: SyntaxNode, ctx: MapContext): Promise<IRNode> {
  const mods = extractModifiers(node);
  const children = await parseTrailingClosure(node, ctx);

  const args = extractCallArgs(node);
  let mainAxis: IRNode["layout"] extends undefined ? never : NonNullable<IRNode["layout"]>["mainAxis"] = "start";
  let crossAxis: NonNullable<NonNullable<IRNode["layout"]>["crossAxis"]> = "start";
  let gap: number | undefined;

  if (args) {
    const alignArg = getNamedArg(args, "alignment");
    if (alignArg?.text === ".center") crossAxis = "center";
    else if (alignArg?.text === ".trailing") crossAxis = "end";

    const spacingArg = getNamedArg(args, "spacing");
    if (spacingArg) gap = extractNumber(spacingArg);
  }

  const padding = extractPadding(mods);
  const frame = extractFrame(mods);
  const bg = extractBackgroundFromModifiers(mods, ctx.designTokens);
  const borderRadius = extractCornerRadius(mods);

  return {
    type: "Column",
    layout: {
      direction: "column",
      mainAxis,
      crossAxis,
      gap,
      padding: padding ?? undefined,
      width: frame.width,
      height: frame.height,
    },
    style: (bg || borderRadius !== undefined) ? { background: bg, borderRadius } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

async function mapHStack(node: SyntaxNode, ctx: MapContext): Promise<IRNode> {
  const mods = extractModifiers(node);
  const children = await parseTrailingClosure(node, ctx);

  const args = extractCallArgs(node);
  let mainAxis: NonNullable<NonNullable<IRNode["layout"]>["mainAxis"]> = "start";
  let crossAxis: NonNullable<NonNullable<IRNode["layout"]>["crossAxis"]> = "center";
  let gap: number | undefined;

  if (args) {
    const alignArg = getNamedArg(args, "alignment");
    if (alignArg?.text === ".top") crossAxis = "start";
    else if (alignArg?.text === ".bottom") crossAxis = "end";

    const spacingArg = getNamedArg(args, "spacing");
    if (spacingArg) gap = extractNumber(spacingArg);
  }

  const padding = extractPadding(mods);
  const frame = extractFrame(mods);
  const bg = extractBackgroundFromModifiers(mods, ctx.designTokens);
  const borderRadius = extractCornerRadius(mods);

  return {
    type: "Row",
    layout: {
      direction: "row",
      mainAxis,
      crossAxis,
      gap,
      padding: padding ?? undefined,
      width: frame.width,
      height: frame.height,
    },
    style: (bg || borderRadius !== undefined) ? { background: bg, borderRadius } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── ZStack ─────────────────────────────────────────────────────────────────────

async function mapZStack(node: SyntaxNode, ctx: MapContext): Promise<IRNode> {
  const mods = extractModifiers(node);
  const children = await parseTrailingClosure(node, ctx);
  const frame = extractFrame(mods);
  const bg = extractBackgroundFromModifiers(mods, ctx.designTokens);

  return {
    type: "Stack",
    layout: { width: frame.width, height: frame.height },
    style: bg ? { background: bg } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── ScrollView ─────────────────────────────────────────────────────────────────

async function mapScrollView(node: SyntaxNode, ctx: MapContext): Promise<IRNode> {
  const children = await parseTrailingClosure(node, ctx);

  return {
    type: "Scroll",
    layout: { direction: "column", width: "fill", height: "fill" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── List ───────────────────────────────────────────────────────────────────────

async function mapList(node: SyntaxNode, ctx: MapContext, mock: MockProvider | undefined): Promise<IRNode> {
  // List(items) { item in CatalogRow(item: item) } 패턴
  // 트레일링 클로저에서 대표 아이템 추출 후 3회 반복
  const children = await parseTrailingClosure(node, ctx);
  const count = mock?.listCount() ?? 3;
  const repeated: IRNode[] = [];
  if (children.length > 0) {
    const representative = children[0]!;
    for (let i = 0; i < count; i++) {
      repeated.push({ ...representative });
    }
  }

  return {
    type: "Scroll",
    layout: { direction: "column", width: "fill" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: [
      {
        type: "List",
        confidence: NODE_CONFIDENCE.standard,
        children: repeated.length > 0 ? repeated : undefined,
      },
    ],
  };
}

// ── LazyVGrid ──────────────────────────────────────────────────────────────────

async function mapLazyVGrid(node: SyntaxNode, ctx: MapContext): Promise<IRNode> {
  const children = await parseTrailingClosure(node, ctx);

  // columns 인자에서 GridItem 개수 추출
  const args = extractCallArgs(node);
  let columns = 2;
  if (args) {
    const colsArg = getNamedArg(args, "columns");
    if (colsArg) {
      const gridItems = findAllNodes(colsArg, "simple_identifier").filter(n => n.text === "GridItem");
      if (gridItems.length > 0) columns = gridItems.length;
    }
  }

  return {
    type: "Grid",
    layout: { width: "fill" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── Text ───────────────────────────────────────────────────────────────────────

function mapText(node: SyntaxNode, ctx: MapContext, mock: MockProvider | undefined): IRNode {
  const args = extractCallArgs(node);
  const mods = extractModifiers(node);

  let textValue: string | undefined;
  let wasMocked = false;

  if (args) {
    const positional = getPositionalArg(args);
    if (positional) {
      textValue = extractStringLiteral(positional);
      if (!textValue) {
        // 동적 값: argBindings에서 literal 값 조회 (인라이닝 시 생성자 인자 바인딩)
        const refName = positional.type === "simple_identifier" ? positional.text : undefined;
        if (refName && ctx.argBindings && typeof ctx.argBindings[refName] === "string") {
          textValue = ctx.argBindings[refName] as string;
        } else {
          // 보간 또는 resolve 불가 동적 값 → mock
          textValue = mock?.text() ?? "";
          wasMocked = true;
        }
      }
    }
  }

  if (!textValue) {
    textValue = mock?.text() ?? "";
    wasMocked = true;
  }

  const fontToken = extractFontToken(mods);
  const color = extractForegroundColorFromModifiers(mods, ctx.designTokens);
  const padding = extractPadding(mods);
  const frame = extractFrame(mods);

  if (wasMocked) {
    ctx.diagnostics?.push({
      level: "info",
      code: "DYNAMIC_DATA_MOCKED",
      message: `Text의 동적 값을 mock 데이터로 대체했습니다`,
    });
  }

  return {
    type: "Text",
    text: {
      value: textValue,
      token: fontToken,
      color,
    },
    layout: {
      padding: padding ?? undefined,
      width: frame.width,
      height: frame.height,
    },
    confidence: wasMocked ? NODE_CONFIDENCE.mocked : NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Image ──────────────────────────────────────────────────────────────────────

function mapImage(node: SyntaxNode, ctx: MapContext, mock: MockProvider | undefined): IRNode {
  const args = extractCallArgs(node);
  const mods = extractModifiers(node);
  const frame = extractFrame(mods);
  const borderRadius = extractCornerRadius(mods);

  if (args) {
    const sysNameArg = getNamedArg(args, "systemName");
    if (sysNameArg) {
      // systemName → Icon
      const iconName = extractStringLiteral(sysNameArg) ?? "";
      const color = extractForegroundColorFromModifiers(mods, ctx.designTokens);
      return {
        type: "Icon",
        text: { value: iconName, color },
        layout: { width: frame.width, height: frame.height },
        style: borderRadius !== undefined ? { borderRadius } : undefined,
        confidence: NODE_CONFIDENCE.standard,
        sourceRef: makeSourceRef(node, ctx),
      };
    }

    // Image("asset-name") → asset://
    const positional = getPositionalArg(args);
    if (positional) {
      const assetName = extractStringLiteral(positional);
      const src = assetName ? `asset://${assetName}` : (mock?.imageUrl() ?? "network-placeholder");
      return {
        type: "Image",
        src,
        layout: { width: frame.width, height: frame.height },
        style: borderRadius !== undefined ? { borderRadius } : undefined,
        confidence: NODE_CONFIDENCE.standard,
        sourceRef: makeSourceRef(node, ctx),
      };
    }
  }

  return {
    type: "Image",
    src: mock?.imageUrl() ?? "network-placeholder",
    layout: { width: frame.width, height: frame.height },
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── AsyncImage ─────────────────────────────────────────────────────────────────

function mapAsyncImage(node: SyntaxNode, ctx: MapContext, mock: MockProvider | undefined): IRNode {
  const mods = extractModifiers(node);
  const frame = extractFrame(mods);
  const borderRadius = extractCornerRadius(mods);

  ctx.diagnostics?.push({
    level: "info",
    code: "DYNAMIC_DATA_MOCKED",
    message: "AsyncImage는 네트워크 placeholder로 대체됩니다",
  });

  return {
    type: "Image",
    src: mock?.imageUrl() ?? "network-placeholder",
    layout: { width: frame.width, height: frame.height },
    style: borderRadius !== undefined ? { borderRadius } : undefined,
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Button ─────────────────────────────────────────────────────────────────────

async function mapButton(node: SyntaxNode, ctx: MapContext): Promise<IRNode> {
  const mods = extractModifiers(node);
  const children = await parseTrailingClosure(node, ctx);
  const bg = extractBackgroundFromModifiers(mods, ctx.designTokens);
  const borderRadius = extractCornerRadius(mods);
  const frame = extractFrame(mods);

  return {
    type: "Button",
    layout: { width: frame.width, height: frame.height },
    style: (bg || borderRadius !== undefined) ? { background: bg, borderRadius } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── NavigationLink ─────────────────────────────────────────────────────────────

async function mapNavigationLink(node: SyntaxNode, ctx: MapContext): Promise<IRNode | null> {
  // label 클로저를 자식으로 매핑
  const children = await parseTrailingClosure(node, ctx);

  return {
    type: "Button",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── TextField / SecureField ────────────────────────────────────────────────────

function mapInput(node: SyntaxNode, ctx: MapContext, mock: MockProvider | undefined): IRNode {
  const args = extractCallArgs(node);
  let placeholder = "";
  if (args) {
    const positional = getPositionalArg(args);
    if (positional) placeholder = extractStringLiteral(positional) ?? "";
  }

  return {
    type: "Input",
    text: { value: placeholder },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Toggle ─────────────────────────────────────────────────────────────────────

async function mapToggle(node: SyntaxNode, ctx: MapContext): Promise<IRNode> {
  // Toggle(isOn: $binding) { Label(...) }
  const children = await parseTrailingClosure(node, ctx);

  return {
    type: "Box",
    role: "toggle",
    layout: { direction: "row", crossAxis: "center" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── Divider ────────────────────────────────────────────────────────────────────

function mapDivider(node: SyntaxNode, ctx: MapContext): IRNode {
  return {
    type: "Divider",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Spacer ─────────────────────────────────────────────────────────────────────

function mapSpacer(node: SyntaxNode, ctx: MapContext): IRNode {
  return {
    type: "Spacer",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── NavigationStack ────────────────────────────────────────────────────────────

async function mapNavigationStack(node: SyntaxNode, ctx: MapContext, mods: ModifierInfo[]): Promise<IRNode> {
  const children = await parseTrailingClosure(node, ctx);

  const navTitle = extractNavigationTitle(mods);
  const wrapperChildren: IRNode[] = [];

  // navigationTitle 수정자 → appbar role Box
  if (navTitle) {
    wrapperChildren.push({
      type: "Box",
      role: "appbar",
      layout: { direction: "row", crossAxis: "center" },
      confidence: NODE_CONFIDENCE.standard,
      children: [
        {
          type: "Text",
          text: { value: navTitle, token: "headline" },
          confidence: NODE_CONFIDENCE.standard,
        },
      ],
    });
  }

  wrapperChildren.push(...children);

  return {
    type: "Box",
    layout: { direction: "column", width: "fill", height: "fill" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: wrapperChildren.length > 0 ? wrapperChildren : undefined,
  };
}

// ── ForEach ────────────────────────────────────────────────────────────────────

async function mapForEach(
  node: SyntaxNode,
  ctx: MapContext,
  mock: MockProvider | undefined
): Promise<IRNode | null> {
  // ForEach(items) { item in ViewBody() }
  const children = await parseTrailingClosure(node, ctx);
  const count = mock?.listCount() ?? 3;

  if (children.length === 0) return null;

  const representative = children[0]!;
  const repeated: IRNode[] = Array.from({ length: count }, () => ({ ...representative }));

  return {
    type: "List",
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: makeSourceRef(node, ctx),
    children: repeated,
  };
}

// ── Group / Section ────────────────────────────────────────────────────────────

async function mapGroup(node: SyntaxNode, ctx: MapContext): Promise<IRNode | null> {
  const children = await parseTrailingClosure(node, ctx);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;

  return {
    type: "Column",
    layout: { direction: "column" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children,
  };
}

// ── Form ───────────────────────────────────────────────────────────────────────

async function mapForm(node: SyntaxNode, ctx: MapContext): Promise<IRNode> {
  const mods = extractModifiers(node);
  const children = await parseTrailingClosure(node, ctx);

  return {
    type: "Scroll",
    layout: { direction: "column", width: "fill" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── Label ──────────────────────────────────────────────────────────────────────

function mapLabel(node: SyntaxNode, ctx: MapContext, mock: MockProvider | undefined): IRNode {
  const args = extractCallArgs(node);
  let textValue = "";

  if (args) {
    const positional = getPositionalArg(args);
    if (positional) textValue = extractStringLiteral(positional) ?? (mock?.text() ?? "");
  }

  const mods = extractModifiers(node);
  const color = extractForegroundColorFromModifiers(mods, ctx.designTokens);

  return {
    type: "Row",
    layout: { direction: "row", crossAxis: "center", gap: 8 },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: [
      { type: "Icon", text: { color }, confidence: NODE_CONFIDENCE.standard },
      { type: "Text", text: { value: textValue, color }, confidence: NODE_CONFIDENCE.standard },
    ],
  };
}

// ── computed property 참조 해석 ────────────────────────────────────────────────

/**
 * `simple_identifier` 형태로 참조된 computed property (e.g. loadingView, emptyView)를
 * 현재 struct의 class_body에서 찾아 그 body를 mapView로 재귀 처리한다.
 *
 * 처리 흐름:
 * 1. ctx.currentClassBody에서 해당 이름의 property_declaration 탐색
 * 2. computed_property > statements의 첫 view 노드를 mapView로 매핑
 * 3. 못 찾으면 null 반환 (Branch 생성이 빈 분기로 처리됨)
 */
async function resolveComputedPropertyRef(
  name: string,
  ctx: MapContext
): Promise<IRNode | null> {
  if (!ctx.currentClassBody) return null;

  // class_body 안의 모든 property_declaration에서 name 일치 항목 탐색
  const propDecls = findAllNodes(ctx.currentClassBody, "property_declaration");
  for (const propDecl of propDecls) {
    const pattern = findChild(propDecl, "pattern");
    const simpleId = pattern ? findChild(pattern, "simple_identifier") : undefined;
    if (simpleId?.text !== name) continue;

    // computed_property (var loadingView: some View { ... }) 형태
    const computedProp = findChild(propDecl, "computed_property");
    if (computedProp) {
      const stmts = findChild(computedProp, "statements");
      if (stmts) {
        const results = await parseStatements(stmts, ctx);
        if (results.length === 1) return results[0]!;
        if (results.length > 1) return {
          type: "Column",
          layout: { direction: "column" },
          confidence: NODE_CONFIDENCE.standard,
          children: results,
        };
      }
    }
  }

  return null;
}

// ── switch 조건부 렌더링 ───────────────────────────────────────────────────────

async function mapSwitchStatement(
  node: SyntaxNode,
  ctx: MapContext
): Promise<IRNode | null> {
  // switch_statement > switch_entry (여러 개)
  // 첫 번째 case를 기본 분기로, 나머지는 Branch 메타데이터로 보존
  const entries = findAllNodes(node, "switch_entry");
  if (entries.length === 0) return null;

  const branchNodes: IRNode[] = [];

  for (const entry of entries) {
    const stmts = findChild(entry, "statements");
    if (!stmts) continue;
    const children = await parseStatements(stmts, ctx);
    if (children.length === 0) continue;

    const child = children.length === 1 ? children[0]! : {
      type: "Column" as const,
      layout: { direction: "column" as const },
      confidence: NODE_CONFIDENCE.standard,
      children,
    };
    branchNodes.push(child);
  }

  if (branchNodes.length === 0) return null;

  if (branchNodes.length === 1) return branchNodes[0]!;

  ctx.diagnostics?.push({
    level: "info",
    code: "DYNAMIC_DATA_MOCKED",
    message: `switch 조건부 렌더링 ${branchNodes.length}개 분기 — Branch 노드로 래핑 (첫 분기 기본 표시)`,
  });

  return {
    type: "Branch",
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: makeSourceRef(node, ctx),
    children: branchNodes,
  };
}

// ── if 조건부 ──────────────────────────────────────────────────────────────────

async function mapIfStatement(
  node: SyntaxNode,
  ctx: MapContext
): Promise<IRNode | null> {
  // if 조건 분기: 첫 분기만 채택
  const stmts = findChild(node, "statements");
  if (stmts) {
    const children = await parseStatements(stmts, ctx);
    if (children.length === 1) return children[0]!;
    if (children.length > 1) return {
      type: "Column",
      layout: { direction: "column" },
      confidence: NODE_CONFIDENCE.mocked,
      children,
    };
  }

  // if let 패턴 — code_block 내 statements 탐색
  const blocks = findAllNodes(node, "statements");
  for (const block of blocks) {
    const children = await parseStatements(block, ctx);
    if (children.length > 0) {
      return children.length === 1 ? children[0]! : {
        type: "Column",
        layout: { direction: "column" },
        confidence: NODE_CONFIDENCE.mocked,
        children,
      };
    }
  }

  return null;
}

// ── 공개 API: mapView ──────────────────────────────────────────────────────────

export async function mapView(
  node: SyntaxNode,
  ctx: MapContext
): Promise<IRNode | null> {
  if (!node) return null;

  const mock = ctx.mockProvider;

  // switch 조건부
  if (node.type === "switch_statement") {
    return mapSwitchStatement(node, ctx);
  }

  // if 조건부
  if (node.type === "if_statement") {
    return mapIfStatement(node, ctx);
  }

  // call_expression 또는 navigation_expression
  if (node.type !== "call_expression" && node.type !== "navigation_expression") {
    // 직접 simple_identifier만 있는 경우 (변수로 정의된 뷰 — loadingView 등)
    if (node.type === "simple_identifier") {
      return resolveComputedPropertyRef(node.text, ctx);
    }
    return null;
  }

  const name = getTopLevelCallName(node);
  const mods = extractModifiers(node);

  switch (name) {
    case "VStack": return mapVStack(node, ctx);
    case "HStack": return mapHStack(node, ctx);
    case "ZStack": return mapZStack(node, ctx);
    case "ScrollView": return mapScrollView(node, ctx);
    case "List": return mapList(node, ctx, mock);
    case "LazyVStack":
    case "LazyHStack": return mapVStack(node, ctx); // LazyVStack → Column
    case "LazyVGrid": return mapLazyVGrid(node, ctx);
    case "Text": return mapText(node, ctx, mock);
    case "Image": return mapImage(node, ctx, mock);
    case "AsyncImage": return mapAsyncImage(node, ctx, mock);
    case "Button": return mapButton(node, ctx);
    case "NavigationLink": return mapNavigationLink(node, ctx);
    case "TextField": return mapInput(node, ctx, mock);
    case "SecureField": return mapInput(node, ctx, mock);
    case "Toggle": return mapToggle(node, ctx);
    case "Divider": return mapDivider(node, ctx);
    case "Spacer": return mapSpacer(node, ctx);
    case "NavigationStack":
    case "NavigationView": return mapNavigationStack(node, ctx, mods);
    case "Group": return mapGroup(node, ctx);
    case "Form": return mapForm(node, ctx);
    case "Section": return mapGroup(node, ctx);
    case "ForEach": return mapForEach(node, ctx, mock);
    case "Label": return mapLabel(node, ctx, mock);
    case "Link": return mapButton(node, ctx);
    case "Menu": return mapButton(node, ctx);
    // 투과 뷰들
    case "GeometryReader":
    case "SafeArea":
    case "overlay":
    case "ContentUnavailableView": {
      const children = await parseTrailingClosure(node, ctx);
      if (children.length === 1) return children[0]!;
      if (children.length > 1) return {
        type: "Box",
        layout: { direction: "column" },
        confidence: NODE_CONFIDENCE.standard,
        children,
      };
      return null;
    }
    default: {
      if (!name) return null;

      // 대문자로 시작하는 커스텀 View struct
      if (/^[A-Z]/.test(name)) {
        if (ctx.symbolTable && ctx.depth < ctx.maxDepth && !ctx.visited.has(name)) {
          // 체인 바인딩: 현재 스코프의 argBindings를 전달해 simple_identifier 전달 패턴을 처리
          const callArgs = extractCallArgsMap(node, ctx.argBindings);
          const inlined = await tryInlineSwiftView(name, ctx.symbolTable, ctx.projectPath, {
            ...ctx,
            argBindings: callArgs,
          });
          return inlined;
        }

        ctx.diagnostics?.push({
          level: "warn",
          code: "UNRESOLVED_COMPONENT",
          message: `알 수 없는 SwiftUI 뷰 '${name}' — Unknown 노드로 처리됨`,
        });
        return {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          sourceRef: makeSourceRef(node, ctx),
          role: `component:${name}`,
        };
      }

      return null;
    }
  }
}

// ── call-site named args 추출 ─────────────────────────────────────────────────

/**
 * call_expression에서 named 인자의 리터럴 값을 추출한다.
 *
 * 지원:
 * - 문자열 리터럴: title: "Hello"
 * - 숫자 리터럴: originalPrice: 299.99
 * - Bool 리터럴: isEnabled: true
 * - nil: badge: nil
 * - 체인 바인딩: 현재 스코프 argBindings의 simple_identifier 전달
 *   (Flutter extractCallSiteArgs 패턴 — 상위→하위 리터럴 체인)
 *
 * 동적 표현식(member_access, navigation_expression)은 추출 불가 → 제외.
 */
function extractCallArgsMap(
  node: SyntaxNode,
  currentArgBindings?: Record<string, unknown>
): Record<string, unknown> {
  const args = extractCallArgs(node);
  if (!args) return {};

  const result: Record<string, unknown> = {};
  const valueArgs = findAllNodes(args, "value_argument");

  for (const va of valueArgs) {
    const label = findChild(va, "value_argument_label")?.text;
    if (!label) continue;

    const valueNode = va.children.find(c => c !== null && c.type !== "value_argument_label" && c.type !== ":");
    if (!valueNode) continue;

    // 문자열 리터럴
    const str = extractStringLiteral(valueNode);
    if (str !== undefined) { result[label] = str; continue; }

    // 숫자 리터럴
    const num = extractNumber(valueNode);
    if (num !== undefined) { result[label] = num; continue; }

    // Bool/nil 리터럴
    if (valueNode.text === "true") { result[label] = true; continue; }
    if (valueNode.text === "false") { result[label] = false; continue; }
    if (valueNode.text === "nil") { result[label] = null; continue; }

    // simple_identifier 체인 바인딩: 상위 argBindings에서 값 조회
    // ProductCard(originalPrice: originalPrice) 처럼 파라미터를 그대로 전달하는 패턴
    if (valueNode.type === "simple_identifier" && currentArgBindings) {
      const varName = valueNode.text;
      if (Object.prototype.hasOwnProperty.call(currentArgBindings, varName)) {
        result[label] = currentArgBindings[varName];
        continue;
      }
    }
  }

  return result;
}
