/**
 * widgetMapper — Kotlin/Compose 소스에서 IRNode 트리를 생성한다.
 *
 * 전략: tree-sitter 기반 AST 파싱을 1차로 시도하고,
 * 보조로 소스 텍스트 기반 패턴 매칭을 사용한다.
 *
 * 지원 Compose 위젯:
 * - Scaffold → Box (appbar/content role)
 * - TopAppBar → Box (role:appbar)
 * - Column / Row → Column / Row
 * - Box → Box (contentAlignment → Stack 여부 판단)
 * - LazyColumn / LazyRow → Scroll + List (items 3회 반복)
 * - Text → Text (stringResource 해석, MaterialTheme.typography 토큰)
 * - Image → Image (painterResource→asset, AsyncImage→network-placeholder)
 * - Icon → Icon
 * - Button / OutlinedButton / TextButton → Button
 * - TextField / OutlinedTextField → Input
 * - Spacer → Spacer
 * - Divider / HorizontalDivider → Divider
 * - Card → Box (radius+shadow)
 * - Scaffold.topBar → role:appbar
 * - CircularProgressIndicator → Icon (placeholder)
 * - 커스텀 Composable → 인라이닝 (최대 depth 6)
 * - when/if → Branch (첫 분기 + role conditions)
 * - 알 수 없는 → Unknown (confidence 0.2)
 */

import type { IRNode } from "@sfc/core";
import { NODE_CONFIDENCE } from "@sfc/core";
import type { MockProvider } from "@sfc/core";
import type { SymbolTable, ParsedFile } from "../parse/scanner.js";
import type { ResourceMap } from "../parse/resources.js";
import {
  extractFunctionBody,
  extractStringResourceKey,
  resolveThemeColor,
  parseColorLiteral,
} from "./astUtils.js";

// ── MapContext ────────────────────────────────────────────────────────────────

export interface MapContext {
  depth: number;
  maxDepth: number;
  visited: Set<string>;
  symbolTable: SymbolTable;
  projectPath: string;
  themeColors: Record<string, string>;
  mock: MockProvider;
  diagnostics: Array<{ level: string; code: string; message: string }>;
  resources: ResourceMap;
  currentFile?: string;
  argBindings?: Record<string, string>;
  /** callsite의 @Composable trailing lambda 본문 (content 파라미터 인라이닝) */
  contentLambda?: string;
}

// ── 소스 텍스트 기반 파싱 헬퍼 ───────────────────────────────────────────────

/** stringResource(R.string.xxx) → 실제 문자열 (없으면 mock) */
function resolveStringResource(
  expr: string,
  resources: ResourceMap,
  mock: MockProvider
): { value: string; mocked: boolean } {
  const key = extractStringResourceKey(expr);
  if (key) {
    const str = resources.strings.get(key);
    if (str) return { value: str, mocked: false };
  }
  // 따옴표로 감싼 리터럴
  const litMatch = /^"([^"]*)"$/.exec(expr.trim());
  if (litMatch) return { value: litMatch[1]!, mocked: false };

  return { value: mock.text(), mocked: true };
}

/** 색상 표현식 해석 */
function resolveColor(
  colorExpr: string,
  themeColors: Record<string, string>
): string | undefined {
  if (!colorExpr) return undefined;
  return resolveThemeColor(colorExpr, themeColors) ?? parseColorLiteral(colorExpr);
}

/** dp 수치 추출 (16.dp → 16) */
function parseDp(text: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\.dp/.exec(text);
  return m ? parseFloat(m[1]!) : undefined;
}

// ── Modifier 체인 해석 ─────────────────────────────────────────────────────────

interface ModifierResult {
  width?: "fill" | "wrap" | number;
  height?: "fill" | "wrap" | number;
  padding?: [number, number, number, number];
  flex?: number;
  gap?: number;
  background?: string;
  borderRadius?: number;
  fillMaxSize?: boolean;
  fillMaxWidth?: boolean;
}

function parseModifier(modifierText: string, themeColors: Record<string, string>): ModifierResult {
  const result: ModifierResult = {};

  if (modifierText.includes("fillMaxSize")) result.fillMaxSize = true;
  if (modifierText.includes("fillMaxWidth")) result.fillMaxWidth = true;
  if (modifierText.includes("fillMaxHeight")) result.height = "fill";

  // weight(N) → flex
  const weightMatch = /\.weight\((\d+(?:\.\d+)?)\)/.exec(modifierText);
  if (weightMatch) result.flex = parseFloat(weightMatch[1]!);

  // size(Ndp) → width=N, height=N
  const sizeMatch = /\.size\((\d+)\.dp\)/.exec(modifierText);
  if (sizeMatch) {
    result.width = parseFloat(sizeMatch[1]!);
    result.height = parseFloat(sizeMatch[1]!);
  }

  // width(Ndp)
  const widthMatch = /\.width\((\d+)\.dp\)/.exec(modifierText);
  if (widthMatch) result.width = parseFloat(widthMatch[1]!);

  // height(Ndp)
  const heightMatch = /\.height\((\d+)\.dp\)/.exec(modifierText);
  if (heightMatch) result.height = parseFloat(heightMatch[1]!);

  // padding(Ndp) → all sides
  const paddingAllMatch = /\.padding\((\d+)\.dp\)/.exec(modifierText);
  if (paddingAllMatch) {
    const v = parseFloat(paddingAllMatch[1]!);
    result.padding = [v, v, v, v];
  }
  // padding(horizontal = Ndp, vertical = Ndp)
  const paddingHVMatch =
    /\.padding\([^)]*horizontal\s*=\s*(\d+)\.dp[^)]*vertical\s*=\s*(\d+)\.dp[^)]*\)/.exec(
      modifierText
    );
  if (paddingHVMatch) {
    const h = parseFloat(paddingHVMatch[1]!);
    const v = parseFloat(paddingHVMatch[2]!);
    result.padding = [v, h, v, h];
  }

  // background(MaterialTheme.colorScheme.xxx 또는 Color(0x...))
  const bgMatch =
    /\.background\((MaterialTheme\.colorScheme\.\w+|Color\(0x[0-9A-Fa-f]+\))\)/.exec(
      modifierText
    );
  if (bgMatch) {
    result.background = resolveColor(bgMatch[1]!, themeColors);
  }

  // clip(RoundedCornerShape(Ndp))
  const clipMatch = /\.clip\(RoundedCornerShape\((\d+)\.dp\)\)/.exec(modifierText);
  if (clipMatch) result.borderRadius = parseFloat(clipMatch[1]!);

  return result;
}

// ── 문자열 인수 추출 ──────────────────────────────────────────────────────────

/**
 * Composable 호출 블록에서 text 파라미터 추출
 * text = "...", text = stringResource(R.string.xxx), text = variable 등
 */
function extractTextValue(
  callBlock: string,
  resources: ResourceMap,
  mock: MockProvider,
  argBindings?: Record<string, string>
): { value: string; mocked: boolean } {
  // text = stringResource(R.string.xxx)
  const srMatch = /\btext\s*=\s*(stringResource\([^)]+\))/.exec(callBlock);
  if (srMatch) {
    return resolveStringResource(srMatch[1]!, resources, mock);
  }

  // text = "..." 직접 리터럴
  const litMatch = /\btext\s*=\s*"([^"]*)"/.exec(callBlock);
  if (litMatch) return { value: litMatch[1]!, mocked: false };

  // text = variable → argBindings 조회 (직접 값 또는 __sr_<varName> stringResource 키)
  const varMatch = /\btext\s*=\s*(\w+)/.exec(callBlock);
  if (varMatch) {
    const varName = varMatch[1]!;
    if (argBindings) {
      // 직접 바인딩 (리터럴)
      if (Object.prototype.hasOwnProperty.call(argBindings, varName)) {
        return { value: argBindings[varName]!, mocked: false };
      }
      // stringResource 경로: __sr_<varName> = R.string 키
      const srKey = `__sr_${varName}`;
      if (Object.prototype.hasOwnProperty.call(argBindings, srKey)) {
        const resKey = argBindings[srKey]!;
        const str = resources.strings.get(resKey);
        if (str) return { value: str, mocked: false };
      }
    }
    return { value: mock.text(varName), mocked: true };
  }

  // 첫 번째 위치 인자 (Text("Hello"))
  const posMatch = /^\s*"([^"]*)"/.exec(callBlock.replace(/^[^(]*\(/, ""));
  if (posMatch) return { value: posMatch[1]!, mocked: false };

  return { value: mock.text(), mocked: true };
}

// ── 컬러 인수 추출 ────────────────────────────────────────────────────────────

function extractColorArg(
  callBlock: string,
  argName: string,
  themeColors: Record<string, string>
): string | undefined {
  const re = new RegExp(
    `\\b${argName}\\s*=\\s*(MaterialTheme\\.colorScheme\\.\\w+|Color\\(0x[0-9A-Fa-f]+\\))`
  );
  const m = re.exec(callBlock);
  if (!m) return undefined;
  return resolveColor(m[1]!, themeColors);
}

// ── Typography 토큰 ────────────────────────────────────────────────────────────

const TYPOGRAPHY_TOKEN_MAP: Record<string, string> = {
  headlineLarge: "heading1",
  headlineMedium: "heading2",
  headlineSmall: "heading3",
  titleLarge: "title1",
  titleMedium: "title2",
  titleSmall: "title3",
  bodyLarge: "body",
  bodyMedium: "bodyMedium",
  bodySmall: "caption",
  labelLarge: "label",
  labelMedium: "labelMedium",
  labelSmall: "labelSmall",
};

function extractTypographyToken(callBlock: string): string | undefined {
  const m = /MaterialTheme\.typography\.(\w+)/.exec(callBlock);
  if (!m) return undefined;
  return TYPOGRAPHY_TOKEN_MAP[m[1]!] ?? m[1];
}

// ── Arrangement.spacedBy 파싱 ─────────────────────────────────────────────────

function extractGap(text: string): number | undefined {
  const m = /Arrangement\.spacedBy\((\d+)\.dp\)/.exec(text);
  return m ? parseFloat(m[1]!) : undefined;
}

// ── Alignment/Arrangement 파싱 ────────────────────────────────────────────────

type MainAxis = "start" | "center" | "end" | "spaceBetween" | "spaceAround";
type CrossAxis = "start" | "center" | "end" | "stretch";

const VERTICAL_ARRANGEMENT_MAP: Record<string, MainAxis> = {
  "Arrangement.Top": "start",
  "Arrangement.Center": "center",
  "Arrangement.Bottom": "end",
  "Arrangement.SpaceBetween": "spaceBetween",
  "Arrangement.SpaceAround": "spaceAround",
};

const HORIZONTAL_ARRANGEMENT_MAP: Record<string, MainAxis> = {
  "Arrangement.Start": "start",
  "Arrangement.Center": "center",
  "Arrangement.End": "end",
  "Arrangement.SpaceBetween": "spaceBetween",
  "Arrangement.SpaceAround": "spaceAround",
};

const HORIZONTAL_ALIGNMENT_MAP: Record<string, CrossAxis> = {
  "Alignment.Start": "start",
  "Alignment.CenterHorizontally": "center",
  "Alignment.End": "end",
};

const VERTICAL_ALIGNMENT_MAP: Record<string, CrossAxis> = {
  "Alignment.Top": "start",
  "Alignment.CenterVertically": "center",
  "Alignment.Bottom": "end",
};

function parseVerticalArrangement(text: string): MainAxis | undefined {
  for (const [key, val] of Object.entries(VERTICAL_ARRANGEMENT_MAP)) {
    if (text.includes(key)) return val;
  }
  const spacedBy = /verticalArrangement\s*=\s*Arrangement\.spacedBy/.exec(text);
  if (spacedBy) return "start"; // spacedBy → start + gap
  return undefined;
}

function parseHorizontalArrangement(text: string): MainAxis | undefined {
  for (const [key, val] of Object.entries(HORIZONTAL_ARRANGEMENT_MAP)) {
    if (text.includes(key)) return val;
  }
  const spacedBy = /horizontalArrangement\s*=\s*Arrangement\.spacedBy/.exec(text);
  if (spacedBy) return "start";
  return undefined;
}

function parseHorizontalAlignment(text: string): CrossAxis | undefined {
  for (const [key, val] of Object.entries(HORIZONTAL_ALIGNMENT_MAP)) {
    if (text.includes(key)) return val;
  }
  return undefined;
}

function parseVerticalAlignment(text: string): CrossAxis | undefined {
  for (const [key, val] of Object.entries(VERTICAL_ALIGNMENT_MAP)) {
    if (text.includes(key)) return val;
  }
  return undefined;
}

// ── 소스 블록 파싱 (재귀 Composable 파서) ─────────────────────────────────────

/**
 * Composable 호출 블록 내의 직접 자식 Composable 호출들을 추출한다.
 * 중괄호 카운팅으로 정확한 범위 결정.
 */
function extractDirectChildren(block: string): string[] {
  const children: string[] = [];

  // 블록의 바깥 {} 제거
  const inner = block.startsWith("{") ? block.slice(1, -1) : block;

  let i = 0;
  while (i < inner.length) {
    // 공백/줄바꿈 건너뜀
    if (/\s/.test(inner[i]!)) { i++; continue; }

    // 주석 건너뜀
    if (inner.slice(i, i + 2) === "//") {
      while (i < inner.length && inner[i] !== "\n") i++;
      continue;
    }

    // // val/var 선언 건너뜀 (람다 파라미터나 지역 변수)
    if (inner.slice(i).match(/^(?:val|var|when|if|for|while)\s/)) {
      // 해당 문장 끝까지 건너뜀 (단순화: 줄 끝까지)
      while (i < inner.length && inner[i] !== "\n") i++;
      continue;
    }

    // 대문자로 시작하는 Composable 호출
    if (/[A-Z]/.test(inner[i]!)) {
      const callStart = i;

      // 함수명 추출
      while (i < inner.length && /[\w.]/.test(inner[i]!)) i++;
      const funcName = inner.slice(callStart, i).split(".").pop() ?? "";

      // ( 까지 진행
      while (i < inner.length && /\s/.test(inner[i]!)) i++;

      if (inner[i] !== "(") {
        // 괄호 없는 참조 — 건너뜀
        while (i < inner.length && inner[i] !== "\n") i++;
        continue;
      }

      // 괄호 내용 추출
      const parenStart = i;
      let parenDepth = 0;
      let braceDepth = 0;

      while (i < inner.length) {
        const ch = inner[i]!;
        if (ch === "(" || ch === "{") {
          if (ch === "(") parenDepth++;
          else braceDepth++;
        } else if (ch === ")") {
          parenDepth--;
          if (parenDepth === 0 && braceDepth === 0) { i++; break; }
        } else if (ch === "}") {
          braceDepth--;
          if (braceDepth < 0) { i++; break; }
        }
        i++;
      }

      // trailing lambda { ... } 처리
      let trailingLambda = "";
      let k = i;
      while (k < inner.length && /\s/.test(inner[k]!)) k++;
      if (inner[k] === "{") {
        const lambdaStart = k;
        let depth = 0;
        while (k < inner.length) {
          if (inner[k] === "{") depth++;
          else if (inner[k] === "}") {
            depth--;
            if (depth === 0) { k++; break; }
          }
          k++;
        }
        trailingLambda = inner.slice(lambdaStart, k);
        i = k;
      }

      const callText =
        funcName +
        inner.slice(parenStart, i - (trailingLambda ? 0 : 0)) +
        (trailingLambda ? " " + trailingLambda : "");

      children.push(callText);
      continue;
    }

    // 그 외 건너뜀
    i++;
  }

  return children;
}

// ── 핵심 매핑 함수 ─────────────────────────────────────────────────────────────

/**
 * Composable 호출 텍스트를 IRNode로 매핑한다.
 * 재귀 호출로 자식 Composable도 처리.
 */
export async function mapComposable(
  callText: string,
  ctx: MapContext
): Promise<IRNode | null> {
  if (!callText || !callText.trim()) return null;

  // 함수명 추출
  const nameMatch = /^(\w+)/.exec(callText.trim());
  if (!nameMatch) return null;
  const name = nameMatch[1]!;

  switch (name) {
    case "Scaffold":
      return mapScaffold(callText, ctx);
    case "Column":
      return mapColumn(callText, ctx);
    case "Row":
      return mapRow(callText, ctx);
    case "Box":
      return mapBox(callText, ctx);
    case "LazyColumn":
    case "LazyRow":
      return mapLazyList(callText, ctx, name === "LazyRow");
    case "Text":
      return mapText(callText, ctx);
    case "Image":
      return mapImage(callText, ctx);
    case "AsyncImage":
      return mapAsyncImage(callText, ctx);
    case "Icon":
      return mapIcon(callText, ctx);
    case "Button":
    case "OutlinedButton":
    case "TextButton":
    case "IconButton":
      return mapButton(callText, ctx, name);
    case "TextField":
    case "OutlinedTextField":
      return mapInput(callText, ctx);
    case "Spacer":
      return mapSpacer(callText, ctx);
    case "Divider":
    case "HorizontalDivider":
      return mapDivider(callText, ctx);
    case "Card":
      return mapCard(callText, ctx);
    case "TopAppBar":
    case "CenterAlignedTopAppBar":
      return mapTopAppBar(callText, ctx);
    case "CircularProgressIndicator":
      return mapProgressIndicator(callText, ctx);
    case "Switch":
      return mapSwitch(callText, ctx);
    // pass-through 위젯 (자식만 추출)
    case "Surface":
    case "AnimatedVisibility":
    case "CompositionLocalProvider":
      return mapPassThrough(callText, ctx);
    default:
      // 대문자 시작 → 커스텀 Composable
      if (/^[A-Z]/.test(name)) {
        return mapCustomComposable(name, callText, ctx);
      }
      return null;
  }
}

// ── 개별 위젯 매퍼 ────────────────────────────────────────────────────────────

async function mapScaffold(callText: string, ctx: MapContext): Promise<IRNode> {
  const children: IRNode[] = [];

  // topBar 파라미터 추출 (중괄호 카운팅으로 중첩 블록 처리)
  const topBarBlock = extractNamedLambdaParam(callText, "topBar");
  if (topBarBlock) {
    const appBarNodes = await parseBlock(topBarBlock, ctx);
    for (const n of appBarNodes) {
      children.push({ ...n, role: "appbar" });
    }
  }

  // bottomBar
  const bottomBarBlock = extractNamedLambdaParam(callText, "bottomBar");
  if (bottomBarBlock) {
    const nodes = await parseBlock(bottomBarBlock, ctx);
    for (const n of nodes) {
      children.push({ ...n, role: "tabbar" });
    }
  }

  // containerColor / backgroundColor
  const bgMatch = extractColorArg(callText, "containerColor", ctx.themeColors)
    ?? extractColorArg(callText, "backgroundColor", ctx.themeColors);

  // 마지막 trailing lambda가 content { innerPadding -> ... }
  // extractTrailingLambda로 정확한 마지막 {} 블록을 추출한다
  const trailingBody = extractTrailingLambda(callText);
  if (trailingBody) {
    const bodyNodes = await parseBlock(trailingBody, ctx);
    for (const n of bodyNodes) {
      // Branch 노드는 조건 메타를 보존하고 role을 덮어쓰지 않는다
      if (n.type === "Branch") {
        children.push(n);
      } else {
        children.push({ ...n, role: "content" });
      }
    }
  }

  return {
    type: "Box",
    layout: { direction: "column", width: "fill", height: "fill" },
    style: bgMatch ? { background: bgMatch } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    children,
  };
}

async function mapColumn(callText: string, ctx: MapContext): Promise<IRNode> {
  const mainAxis = parseVerticalArrangement(callText);
  const crossAxis = parseHorizontalAlignment(callText);
  const gap = extractGap(callText);
  const mod = parseModifier(callText, ctx.themeColors);

  const children = await parseChildrenBlock(callText, ctx);

  return {
    type: "Column",
    layout: {
      direction: "column",
      mainAxis: mainAxis ?? "start",
      crossAxis: crossAxis ?? "start",
      gap,
      width: mod.fillMaxWidth || mod.fillMaxSize ? "fill" : mod.width,
      height: mod.fillMaxSize ? "fill" : mod.height,
      padding: mod.padding,
    },
    style: mod.background ? { background: mod.background } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    children,
  };
}

async function mapRow(callText: string, ctx: MapContext): Promise<IRNode> {
  const mainAxis = parseHorizontalArrangement(callText);
  const crossAxis = parseVerticalAlignment(callText);
  const gap = extractGap(callText);
  const mod = parseModifier(callText, ctx.themeColors);

  const children = await parseChildrenBlock(callText, ctx);

  return {
    type: "Row",
    layout: {
      direction: "row",
      mainAxis: mainAxis ?? "start",
      crossAxis: crossAxis ?? "center",
      gap,
      width: mod.fillMaxWidth || mod.fillMaxSize ? "fill" : mod.width,
      height: mod.fillMaxSize ? "fill" : mod.height,
      padding: mod.padding,
    },
    style: mod.background ? { background: mod.background } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    children,
  };
}

async function mapBox(callText: string, ctx: MapContext): Promise<IRNode> {
  const mod = parseModifier(callText, ctx.themeColors);

  // contentAlignment가 있으면 Stack (겹침)
  const isStack = callText.includes("contentAlignment");
  const type = isStack ? "Stack" : "Box";

  const children = await parseChildrenBlock(callText, ctx);

  return {
    type,
    layout: {
      width: mod.fillMaxWidth || mod.fillMaxSize ? "fill" : mod.width,
      height: mod.fillMaxSize ? "fill" : mod.height,
      padding: mod.padding,
    },
    style: {
      background: mod.background,
      borderRadius: mod.borderRadius,
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    children: children.length > 0 ? children : undefined,
  };
}

async function mapLazyList(
  callText: string,
  ctx: MapContext,
  isRow: boolean
): Promise<IRNode> {
  const mod = parseModifier(callText, ctx.themeColors);
  const count = ctx.mock.listCount?.() ?? 3;

  // items { ... } 블록에서 대표 아이템 추출
  const itemsMatch = /\bitems\s*\([^)]*\)\s*\{([\s\S]*?)\}/.exec(callText);
  let listItems: IRNode[] = [];

  if (itemsMatch) {
    const itemBlock = itemsMatch[1]!;
    const representative = await parseBlock(itemBlock, ctx);
    if (representative.length > 0) {
      listItems = Array.from({ length: count }, () => ({ ...representative[0]! }));
    }
  }

  // 직접 children이 있는 경우 (LazyColumn { item { ... } item { ... } })
  if (listItems.length === 0) {
    const children = await parseChildrenBlock(callText, ctx);
    listItems = children;
  }

  return {
    type: "Scroll",
    layout: {
      direction: isRow ? "row" : "column",
      width: mod.fillMaxWidth || mod.fillMaxSize ? "fill" : mod.width,
      height: mod.fillMaxSize ? "fill" : mod.height,
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    children: [
      {
        type: "List",
        layout: { direction: isRow ? "row" : "column" },
        confidence: NODE_CONFIDENCE.standard,
        children: listItems,
      },
    ],
  };
}

function mapText(callText: string, ctx: MapContext): IRNode {
  const { value, mocked } = extractTextValue(
    callText,
    ctx.resources,
    ctx.mock,
    ctx.argBindings
  );

  const token = extractTypographyToken(callText);
  const color =
    extractColorArg(callText, "color", ctx.themeColors);

  const maxLinesMatch = /maxLines\s*=\s*(\d+)/.exec(callText);
  const maxLines = maxLinesMatch ? parseInt(maxLinesMatch[1]!) : undefined;

  return {
    type: "Text",
    text: {
      value,
      token,
      color,
      maxLines,
    },
    confidence: mocked ? NODE_CONFIDENCE.mocked : NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

function mapImage(callText: string, ctx: MapContext): IRNode {
  // painterResource(R.drawable.xxx) → asset://xxx
  const assetMatch = /painterResource\(\s*R\.drawable\.(\w+)\s*\)/.exec(callText)
    ?? /painterResource\(\s*(?:id\s*=\s*)?R\.drawable\.(\w+)\s*\)/.exec(callText);

  const src = assetMatch
    ? `asset://${assetMatch[1]}`
    : ctx.mock.imageUrl?.() ?? "network-placeholder";

  const mod = parseModifier(callText, ctx.themeColors);

  return {
    type: "Image",
    src,
    layout: {
      width: mod.fillMaxWidth || mod.fillMaxSize ? "fill" : mod.width,
      height: mod.fillMaxSize ? "fill" : mod.height,
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

function mapAsyncImage(callText: string, ctx: MapContext): IRNode {
  const mod = parseModifier(callText, ctx.themeColors);
  return {
    type: "Image",
    src: "network-placeholder",
    layout: {
      width: mod.fillMaxWidth || mod.fillMaxSize ? "fill" : mod.width,
      height: mod.fillMaxSize ? "fill" : mod.height,
    },
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

function mapIcon(_callText: string, ctx: MapContext): IRNode {
  return {
    type: "Icon",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

async function mapButton(
  callText: string,
  ctx: MapContext,
  buttonType: string
): Promise<IRNode> {
  // Button 내부 children (trailing lambda)
  const children = await parseChildrenBlock(callText, ctx);
  const mod = parseModifier(callText, ctx.themeColors);

  // borderRadius from shape = RoundedCornerShape(Ndp)
  const shapeMatch = /shape\s*=\s*RoundedCornerShape\((\d+)\.dp\)/.exec(callText);
  const borderRadius = shapeMatch ? parseFloat(shapeMatch[1]!) : undefined;

  // containerColor
  const bgColor = extractColorArg(callText, "containerColor", ctx.themeColors);

  return {
    type: "Button",
    layout: {
      width: mod.fillMaxWidth ? "fill" : mod.flex ? undefined : mod.width,
      flex: mod.flex,
    },
    style: {
      background: bgColor,
      borderRadius,
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    children: children.length > 0 ? children : undefined,
  };
}

function mapInput(callText: string, ctx: MapContext): IRNode {
  const { value } = extractTextValue(callText, ctx.resources, ctx.mock, ctx.argBindings);

  return {
    type: "Input",
    text: { value },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

function mapSpacer(callText: string, ctx: MapContext): IRNode {
  const heightMatch = /\.height\((\d+)\.dp\)/.exec(callText)
    ?? /height\s*=\s*(\d+)\.dp/.exec(callText);
  const widthMatch = /\.width\((\d+)\.dp\)/.exec(callText)
    ?? /width\s*=\s*(\d+)\.dp/.exec(callText);

  return {
    type: "Spacer",
    layout: {
      height: heightMatch ? parseFloat(heightMatch[1]!) : undefined,
      width: widthMatch ? parseFloat(widthMatch[1]!) : undefined,
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

function mapDivider(callText: string, ctx: MapContext): IRNode {
  const color = extractColorArg(callText, "color", ctx.themeColors);
  return {
    type: "Divider",
    style: color ? { background: color } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

async function mapCard(callText: string, ctx: MapContext): Promise<IRNode> {
  const shapeMatch = /RoundedCornerShape\((\d+)\.dp\)/.exec(callText);
  const borderRadius = shapeMatch ? parseFloat(shapeMatch[1]!) : 8;
  const bgColor = extractColorArg(callText, "containerColor", ctx.themeColors);
  const elevMatch = /defaultElevation\s*=\s*(\d+)\.dp/.exec(callText);
  const elevation = elevMatch ? parseFloat(elevMatch[1]!) : undefined;

  const children = await parseChildrenBlock(callText, ctx);
  const mod = parseModifier(callText, ctx.themeColors);

  return {
    type: "Box",
    layout: {
      width: mod.fillMaxWidth || mod.fillMaxSize ? "fill" : mod.width,
    },
    style: {
      background: bgColor,
      borderRadius,
      shadow: elevation
        ? { blur: elevation * 2, offsetY: elevation, color: "#00000020" }
        : undefined,
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    children: children.length > 0 ? children : undefined,
  };
}

async function mapTopAppBar(callText: string, ctx: MapContext): Promise<IRNode> {
  const children: IRNode[] = [];

  // title = { Text(...) } — 중괄호 카운팅으로 중첩 블록 처리
  const titleBlock = extractNamedLambdaParam(callText, "title");
  if (titleBlock) {
    const titleNodes = await parseBlock(titleBlock, ctx);
    children.push(...titleNodes);
  }

  // navigationIcon = { ... }
  const navIconBlock = extractNamedLambdaParam(callText, "navigationIcon");
  if (navIconBlock) {
    const navNodes = await parseBlock(navIconBlock, ctx);
    children.push(...navNodes);
  }

  const containerColor = extractColorArg(callText, "containerColor", ctx.themeColors);

  return {
    type: "Box",
    role: "appbar",
    layout: { direction: "row", crossAxis: "center" },
    style: containerColor ? { background: containerColor } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    children: children.length > 0 ? children : undefined,
  };
}

function mapProgressIndicator(_callText: string, ctx: MapContext): IRNode {
  return {
    type: "Icon",
    role: "loading",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

function mapSwitch(_callText: string, ctx: MapContext): IRNode {
  return {
    type: "Unknown",
    role: "component:Switch",
    confidence: NODE_CONFIDENCE.unknown,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
  };
}

async function mapPassThrough(callText: string, ctx: MapContext): Promise<IRNode | null> {
  const children = await parseChildrenBlock(callText, ctx);
  if (children.length === 1) return children[0]!;
  if (children.length > 1) {
    return {
      type: "Box",
      layout: { direction: "column" },
      confidence: NODE_CONFIDENCE.standard,
      children,
    };
  }
  return null;
}

async function mapCustomComposable(
  name: string,
  callText: string,
  ctx: MapContext
): Promise<IRNode> {
  // 깊이 제한 및 방문 집합 체크
  if (ctx.depth >= ctx.maxDepth || ctx.visited.has(name)) {
    ctx.diagnostics.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `커스텀 Composable '${name}' 인라이닝 한계 도달 — Unknown으로 처리`,
    });
    return {
      type: "Unknown",
      role: `component:${name}`,
      confidence: NODE_CONFIDENCE.unknown,
      sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    };
  }

  // 심볼 테이블에서 찾기
  const composableInfo = ctx.symbolTable.composables.get(name);
  if (!composableInfo) {
    ctx.diagnostics.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `커스텀 Composable '${name}'를 심볼 테이블에서 찾을 수 없음`,
    });
    return {
      type: "Unknown",
      role: `component:${name}`,
      confidence: NODE_CONFIDENCE.unknown,
      sourceRef: { file: ctx.currentFile ?? "unknown", line: 0 },
    };
  }

  const parsedFile = ctx.symbolTable.fileByComposable.get(name);
  if (!parsedFile) {
    return {
      type: "Unknown",
      role: `component:${name}`,
      confidence: NODE_CONFIDENCE.unknown,
    };
  }

  // call-site 인자 추출 (named arguments)
  const argBindings = extractCallSiteArgs(callText);

  // callsite trailing lambda 추출 (@Composable content 파라미터 인라이닝용)
  const trailingLambdaBody = extractTrailingLambda(callText);

  // 함수 본문 추출
  const funcBody = extractFunctionBody(parsedFile.source, name);
  if (!funcBody) {
    return {
      type: "Unknown",
      role: `component:${name}`,
      confidence: NODE_CONFIDENCE.unknown,
    };
  }

  // 재귀 방지
  const newVisited = new Set(ctx.visited);
  newVisited.add(name);

  const newCtx: MapContext = {
    ...ctx,
    depth: ctx.depth + 1,
    visited: newVisited,
    currentFile: composableInfo.file,
    argBindings: { ...ctx.argBindings, ...argBindings },
    contentLambda: trailingLambdaBody,
  };

  const nodes = await parseBlock(funcBody.slice(1, -1), newCtx);

  // callsite trailing lambda에 있는 자식 노드도 추가 (content() 호출 대체)
  // 함수 본문에서 content()가 소문자 호출로 무시됐을 경우를 보완한다
  if (trailingLambdaBody && nodes.length > 0) {
    const lambdaNodes = await parseBlock(trailingLambdaBody, {
      ...newCtx,
      argBindings: { ...ctx.argBindings },
      contentLambda: undefined,
    });
    if (lambdaNodes.length > 0) {
      // 이미 파싱된 함수 본문 결과에 trailing lambda 노드를 병합
      // (함수 본문이 content()를 직접 호출하지 않고 Column/Card 안에 배치하므로,
      //  trailing lambda 노드는 마지막 Box/Column 자식에 추가하거나 병렬로 추가)
      nodes.push(...lambdaNodes);
    }
  }

  const result = nodes.length === 1 ? nodes[0]! : {
    type: "Column" as const,
    layout: { direction: "column" as const },
    confidence: NODE_CONFIDENCE.inlined,
    children: nodes,
  };

  // confidence 하향 (인라이닝)
  return downgradeConfidence(result, NODE_CONFIDENCE.inlined);
}

// ── call-site 인자 추출 ───────────────────────────────────────────────────────

function extractCallSiteArgs(callText: string): Record<string, string> {
  const result: Record<string, string> = {};

  // named arguments: argName = "value" 또는 argName = variable
  const namedStringRe = /(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = namedStringRe.exec(callText)) !== null) {
    result[m[1]!] = m[2]!;
  }

  // named arguments: argName = stringResource(R.string.xxx) → 키만 저장
  const srRe = /(\w+)\s*=\s*stringResource\(\s*R\.string\.(\w+)\s*\)/g;
  while ((m = srRe.exec(callText)) !== null) {
    result[`__sr_${m[1]!}`] = m[2]!; // stringResource 키로 저장
  }

  return result;
}

// ── confidence 하향 ───────────────────────────────────────────────────────────

function downgradeConfidence(node: IRNode, factor: number): IRNode {
  return {
    ...node,
    confidence: Math.min(node.confidence, factor),
    children: node.children?.map((c) => downgradeConfidence(c, factor)),
  };
}

// ── 블록 파싱 (최상위 Composable 목록 추출) ────────────────────────────────────

async function parseBlock(block: string, ctx: MapContext): Promise<IRNode[]> {
  const results: IRNode[] = [];

  // 람다 파라미터 제거: "innerPadding ->" 또는 "param1, param2 ->" 같은 패턴
  // trailing lambda body에서 "params -> body" 형태의 람다 파라미터를 건너뜀
  let effectiveBlock = block;
  const lambdaParamMatch = /^\s*(?:[\w,\s]+)\s*->\s*([\s\S]*)$/m.exec(block);
  if (lambdaParamMatch) {
    // "->" 이후만 사용
    effectiveBlock = lambdaParamMatch[1]!;
  }

  // 주석 및 공백을 제거한 trimmed 버전으로 when 감지
  const trimmedEffective = effectiveBlock
    .replace(/\/\/[^\n]*/g, "") // 단행 주석 제거
    .trim();

  // when { ... } 처리 (람다 파라미터 제거 + 주석 제거 후 확인)
  if (trimmedEffective.startsWith("when")) {
    return [await parseWhenBlock(effectiveBlock, ctx)];
  }

  // 간단한 줄 기반 Composable 추출 (람다 파라미터 제거된 블록 사용)
  const lines = effectiveBlock.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();

    // 주석, 빈 줄, 변수 선언 건너뜀
    if (!line || line.startsWith("//") || line.startsWith("val ") || line.startsWith("var ")) {
      i++;
      continue;
    }

    // 대문자로 시작하는 Composable 호출 감지
    if (/^[A-Z]/.test(line)) {
      // 멀티라인 Composable 호출 수집
      const callLines: string[] = [];
      let braceDepth = 0;
      let parenDepth = 0;

      let j = i;
      while (j < lines.length) {
        const l = lines[j]!;
        callLines.push(l);

        for (const ch of l) {
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
          else if (ch === "{") braceDepth++;
          else if (ch === "}") braceDepth--;
        }

        j++;
        if (parenDepth <= 0 && braceDepth <= 0 && j > i) break;
      }

      const callText = callLines.join("\n");
      const node = await mapComposable(callText, ctx);
      if (node) results.push(node);
      i = j;
      continue;
    }

    i++;
  }

  return results;
}

async function parseChildrenBlock(callText: string, ctx: MapContext): Promise<IRNode[]> {
  // trailing lambda 추출: 마지막 { ... }
  // Composable(...) { ... } 패턴에서 trailing lambda 찾기
  const trailingMatch = extractTrailingLambda(callText);
  if (!trailingMatch) return [];

  return parseBlock(trailingMatch, ctx);
}

function extractTrailingLambda(callText: string): string | undefined {
  // 마지막 중괄호 블록 찾기
  let depth = 0;
  let lastOpen = -1;

  for (let i = callText.length - 1; i >= 0; i--) {
    if (callText[i] === "}") {
      if (depth === 0) {
        // 마지막 닫는 중괄호
        depth = 1;
      } else {
        depth++;
      }
    } else if (callText[i] === "{") {
      depth--;
      if (depth === 0) {
        lastOpen = i;
        break;
      }
    }
  }

  if (lastOpen < 0) return undefined;
  return callText.slice(lastOpen + 1, callText.lastIndexOf("}"));
}

/**
 * named lambda 파라미터 `paramName = { ... }` 에서 `{...}` 내부를 추출한다.
 * 중괄호 카운팅으로 중첩 블록을 정확히 처리한다.
 * (non-greedy `*?` 정규식은 내부 `}` 에서 잘리는 버그가 있음)
 */
function extractNamedLambdaParam(callText: string, paramName: string): string | undefined {
  const markerRe = new RegExp(`\\b${paramName}\\s*=\\s*\\{`);
  const markerMatch = markerRe.exec(callText);
  if (!markerMatch) return undefined;

  // `{` 위치
  const openIdx = markerMatch.index + markerMatch[0].length - 1;
  let depth = 0;
  let closeIdx = -1;

  for (let i = openIdx; i < callText.length; i++) {
    if (callText[i] === "{") depth++;
    else if (callText[i] === "}") {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }

  if (closeIdx < 0) return undefined;
  return callText.slice(openIdx + 1, closeIdx);
}

// ── when/if 블록 파싱 ─────────────────────────────────────────────────────────

async function parseWhenBlock(block: string, ctx: MapContext): Promise<IRNode> {
  // when (uiState) { is Loading -> { ... } is Empty -> { ... } is Data -> { ... } }
  // 첫 번째 분기를 기본으로 표시하고 Branch 노드 생성

  const branchChildren: IRNode[] = [];
  const conditions: string[] = [];

  // "is TypeName ->" 또는 "else ->" 패턴으로 분기 찾기
  const branchRegex = /(?:is\s+(\w+(?:\.\w+)?)|else)\s*->/g;
  let m: RegExpExecArray | null;

  const matches: Array<{ cond: string; start: number }> = [];
  while ((m = branchRegex.exec(block)) !== null) {
    matches.push({
      cond: m[1] ?? "else",
      start: m.index + m[0].length,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const { cond, start } = matches[i]!;
    const end = i + 1 < matches.length ? matches[i + 1]!.start - (matches[i + 1]!.cond.length + 10) : block.length;

    const branchBlock = block.slice(start, end);
    conditions.push(cond);

    const nodes = await parseBlock(branchBlock, ctx);
    const branchNode = nodes.length === 1 ? nodes[0]! : {
      type: "Column" as const,
      layout: { direction: "column" as const },
      confidence: NODE_CONFIDENCE.mocked,
      children: nodes,
    };

    branchChildren.push({ ...branchNode, role: `branch-arm:${cond}` });
  }

  if (branchChildren.length === 0) {
    return {
      type: "Unknown",
      role: "component:when",
      confidence: NODE_CONFIDENCE.unknown,
    };
  }

  if (branchChildren.length === 1) return branchChildren[0]!;

  ctx.diagnostics.push({
    level: "info",
    code: "DYNAMIC_DATA_MOCKED",
    message: `when 블록 ${branchChildren.length}개 분기 감지 — Branch 노드로 래핑`,
  });

  return {
    type: "Branch",
    role: `conditions:${conditions.join("|")}`,
    confidence: NODE_CONFIDENCE.mocked,
    children: branchChildren,
  };
}
