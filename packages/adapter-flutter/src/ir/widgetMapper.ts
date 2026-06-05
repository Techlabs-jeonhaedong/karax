/**
 * widgetMapper — Dart AST 노드를 IRNode로 변환한다.
 *
 * 지원 위젯 목록:
 * - Scaffold → Box (role:appbar/content/tabbar)
 * - AppBar → Box (role:appbar)
 * - Column / Row → Column / Row
 * - Container → Box
 * - SizedBox → Box
 * - Padding → Box (layout.padding)
 * - Center / Align → Box (crossAxis:center)
 * - Expanded / Flexible → Box (flex)
 * - Spacer → Spacer
 * - Text → Text
 * - Image.asset / Image.network → Image
 * - Icon → Icon
 * - ElevatedButton / TextButton / OutlinedButton / IconButton → Button
 * - TextField / TextFormField → Input
 * - Divider → Divider
 * - ListView / ListView.builder / ListView.separated → Scroll + List
 * - GridView → Grid
 * - SingleChildScrollView → Scroll
 * - Stack → Stack
 * - Card → Box (borderRadius+shadow)
 * - CircleAvatar → Box (원형)
 * - SafeArea → 자식 투과
 * - ClipRRect → Box (borderRadius)
 * - 알 수 없는 위젯 → Unknown (confidence 0.2)
 */

import type { SyntaxNode } from "@karax/adapter-api";
import type { IRNode, NodeType } from "@karax/core";
import { NODE_CONFIDENCE } from "@karax/core";
import type { MockProvider } from "@karax/core";
import type { SymbolTable } from "../parse/scanner.js";
import {
  findAllNodes,
  findChild,
  filterChildren,
  getDirectNamedArg,
  extractStringLiteral,
  extractNumber,
  getFirstStringValue,
  getFirstNumberValue,
  extractColorFromExpr,
  parseEdgeInsets,
  parseBorderRadius,
} from "./astUtils.js";
import { tryInlineWidget } from "./inliner.js";

// ── 컨텍스트 ──────────────────────────────────────────────────────────────────

export interface MapContext {
  depth: number;
  maxDepth: number;
  visited: Set<string>;
  symbolTable: SymbolTable | null;
  projectPath: string;
  themeTokens: Record<string, string>;
  mockProvider?: MockProvider;
  diagnostics?: Array<{ level: string; code: string; message: string }>;
  /** 현재 처리 중인 파일의 AST root — private 메서드 호출 인라이닝에 사용 */
  currentFileRoot?: SyntaxNode;
  /** 현재 처리 중인 파일의 프로젝트 루트 기준 상대 경로 (sourceRef.file에 사용) */
  currentFile?: string;
  /** 인라이닝 시 call-site에서 바인딩된 named 인자 값 (변수 참조 → 리터럴 치환용) */
  argBindings?: Record<string, unknown>;
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

/**
 * arguments 노드에서 named_argument를 직접 자식에서 찾는다.
 */
function getArg(args: SyntaxNode, label: string): SyntaxNode | undefined {
  return getDirectNamedArg(args, label);
}

/**
 * 노드의 텍스트에서 위젯 이름(호출하는 생성자명)을 추출한다.
 */
function getWidgetName(node: SyntaxNode): string {
  if (node.type === "identifier" || node.type === "type_identifier") return node.text;
  if (node.type === "const_object_expression") {
    const typeId = findChild(node, "type_identifier");
    return typeId?.text ?? "";
  }
  // 첫 번째 identifier 자식
  const id = findChild(node, "identifier");
  if (id) return id.text;
  // type_identifier 자식
  const typeId = findChild(node, "type_identifier");
  if (typeId) return typeId.text;
  return "";
}

/**
 * 식별자 노드의 첫 번째 arguments를 가져온다.
 */
function getCallArgs(node: SyntaxNode): SyntaxNode | undefined {
  // const_object_expression
  if (node.type === "const_object_expression") {
    return findChild(node, "arguments");
  }
  // identifier: parent에서 arguments 찾기
  const parent = node.parent;
  if (!parent) return undefined;

  // parent가 function_invocation이면 arguments 직접 자식
  const directArgs = findChild(parent, "arguments");
  if (directArgs) return directArgs;

  // selector 체인
  const selectors = filterChildren(parent, "selector");
  for (const sel of selectors) {
    const ap = findChild(sel, "argument_part");
    if (ap) return findChild(ap, "arguments");
  }

  return undefined;
}

// ── arguments 가져오기 ─────────────────────────────────────────────────────────

/**
 * 위젯 AST 노드에서 arguments 노드를 안정적으로 가져온다.
 * 지원 패턴:
 * - const_object_expression → arguments 직접 자식
 * - identifier (foo(...)) → 형제 selector → argument_part → arguments
 * - Image.asset / ListView.builder 등 selector 체인
 */
function extractArgs(node: SyntaxNode): SyntaxNode | undefined {
  if (node.type === "const_object_expression") {
    return findChild(node, "arguments");
  }

  // function_invocation / method_invocation 계열: 직접 자식에 arguments
  const direct = findChild(node, "arguments");
  if (direct) return direct;

  // identifier → 바로 다음 형제 selector → argument_part → arguments
  // 패턴: parent = [..., identifier, selector, ...] (list_literal 또는 block 등)
  const parent = node.type === "identifier" ? node.parent : null;
  if (parent) {
    // 1. 현재 identifier 바로 다음에 오는 selector 탐색 (startPosition 기준)
    const parentChildren = parent.children.filter((c): c is SyntaxNode => c !== null);
    const nodeIdx = parentChildren.findIndex(
      c => c.type === node.type &&
        c.startPosition.row === node.startPosition.row &&
        c.startPosition.column === node.startPosition.column
    );
    if (nodeIdx >= 0) {
      // nodeIdx 이후의 selector를 순서대로 탐색 (selector 체인 전체 순회)
      for (let i = nodeIdx + 1; i < parentChildren.length; i++) {
        const sib = parentChildren[i]!;
        if (sib.type === "selector") {
          const ap = findChild(sib, "argument_part");
          if (ap) {
            const args = findChild(ap, "arguments");
            if (args) return args;
          }
          // argument_part 없는 selector (.methodName 등)는 건너뛰고 계속 탐색
          continue;
        }
        // 쉼표 등 다른 토큰은 중단
        if (sib.type !== ",") break;
      }
    }
    // 2. fallback: parent의 직접 arguments
    const pa = findChild(parent, "arguments");
    if (pa) return pa;
  }

  // 직접 자식에서 selector → argument_part → arguments 탐색
  const sels = filterChildren(node, "selector");
  for (const sel of sels) {
    const ap = findChild(sel, "argument_part");
    if (ap) {
      const args = findChild(ap, "arguments");
      if (args) return args;
    }
  }

  return undefined;
}

// ── children: [...] 리스트 파싱 ────────────────────────────────────────────────

/**
 * children: [...] 인자에서 위젯 노드 목록을 추출한다.
 * const_object_expression, identifier, function_invocation 형태를 지원.
 */
async function parseChildrenArg(
  args: SyntaxNode,
  ctx: MapContext
): Promise<IRNode[]> {
  const childrenArg = getArg(args, "children");
  if (!childrenArg) return [];

  // list_literal 안의 모든 위젯 표현식
  const listLiteral = findChild(childrenArg, "list_literal") ?? childrenArg;
  return await parseListLiteral(listLiteral, ctx);
}

async function parseListLiteral(
  listNode: SyntaxNode,
  ctx: MapContext
): Promise<IRNode[]> {
  const mock = ctx.mockProvider;
  const children: IRNode[] = [];
  for (const child of listNode.children) {
    if (!child) continue;
    if (child.type === "[" || child.type === "]" || child.type === ",") continue;

    // spread_element 최상위: ...items 형태 — 변수 스프레드이므로 생략
    // 단, if_element 안의 spread는 아래에서 별도 처리
    if (child.type === "spread_element") continue;

    // if 조건부: 첫 분기 채택 (spread-if 패턴 포함)
    if (child.type === "if_element") {
      // true branch는 if_element의 자식 중 keyword/괄호/조건식을 제외한 첫 번째 위젯 노드
      // tree-sitter Dart에서 if_element: if ( <cond> ) <true> [else <false>]
      // condition은 여러 타입이 될 수 있으므로, 명시적으로 알려진 타입을 제외
      const SKIP_TYPES = new Set(["if", "else", "(", ")", ","]);
      let parens = 0;
      let pastCondition = false;
      let trueBranch: SyntaxNode | undefined;

      for (const c of child.children) {
        if (!c) continue;
        if (SKIP_TYPES.has(c.type)) {
          if (c.type === "(") { parens++; pastCondition = false; }
          if (c.type === ")") {
            parens--;
            if (parens === 0) pastCondition = true;
          }
          continue;
        }
        if (!pastCondition) continue; // 조건식 자체는 건너뜀
        // 조건 이후 첫 번째 non-keyword 노드가 true branch
        trueBranch = c;
        break;
      }

      if (trueBranch) {
        // spread_element: ...[a, b, c] → list_literal을 펼침
        if (trueBranch.type === "spread_element") {
          const listLit = findChild(trueBranch, "list_literal");
          if (listLit) {
            const spreadNodes = await parseListLiteral(listLit, ctx);
            children.push(...spreadNodes);
          }
          // list_literal이 없는 spread는 생략 (변수 스프레드)
        } else {
          const node = await mapWidget(trueBranch, mock, ctx);
          if (node) children.push(node);
        }
      }
      continue;
    }

    const node = await mapWidget(child, mock, ctx);
    if (node) children.push(node);
  }
  return children;
}

// ── 단일 child 파싱 ────────────────────────────────────────────────────────────

async function parseSingleChild(
  args: SyntaxNode,
  argName: string,
  ctx: MapContext
): Promise<IRNode | undefined> {
  const childArg = getArg(args, argName);
  if (!childArg) return undefined;
  const result = await mapWidget(childArg, ctx.mockProvider, ctx);
  return result ?? undefined;
}

// ── 인터폴레이션 부분 평가 ────────────────────────────────────────────────────

/**
 * Dart 문자열 인터폴레이션을 argBindings 기반으로 best-effort 부분 평가한다.
 * 지원 패턴:
 * - $varName → argBindings[varName] (없으면 빈 문자열)
 * - ${varName} → argBindings[varName] (없으면 빈 문자열)
 * - ${varName.toStringAsFixed(n)} → argBindings[varName] 숫자를 소수 n자리 포맷
 * 최소 1개 이상의 인터폴레이션 조각이 바인딩된 경우 평가된 문자열 반환.
 * 모든 인터폴레이션이 미바인딩이면 null 반환 (mock fallback).
 */
function tryEvaluateInterpolation(
  raw: string,
  bindings: Record<string, unknown>
): string | null {
  // 따옴표 제거
  const inner = raw.replace(/^['"]|['"]$/g, "");

  // 인터폴레이션 토큰 분해: $varName 또는 ${...}
  const parts: string[] = [];
  let i = 0;
  let boundCount = 0; // 실제로 바인딩된 조각 수

  while (i < inner.length) {
    if (inner[i] === "$") {
      if (inner[i + 1] === "{") {
        // ${...} 형식
        const end = inner.indexOf("}", i + 2);
        if (end < 0) return null; // 문법 오류
        const expr = inner.slice(i + 2, end).trim();
        const evaluated = evaluateExpr(expr, bindings);
        if (evaluated !== null) {
          parts.push(evaluated);
          boundCount++;
        } else {
          // 평가 불가 조각 → 빈 문자열로 대체 (best-effort)
          parts.push("");
        }
        i = end + 1;
      } else {
        // $varName 형식 (alphanumeric + underscore)
        const match = inner.slice(i + 1).match(/^[A-Za-z_]\w*/);
        if (!match) return null; // 문법 오류
        const varName = match[0]!;
        if (Object.prototype.hasOwnProperty.call(bindings, varName)) {
          parts.push(String(bindings[varName] ?? ""));
          boundCount++;
        } else {
          // 바인딩 없음 → 빈 문자열 (best-effort)
          parts.push("");
        }
        i += 1 + varName.length;
      }
    } else {
      // 일반 문자
      const next = inner.indexOf("$", i);
      if (next < 0) {
        parts.push(inner.slice(i));
        break;
      }
      parts.push(inner.slice(i, next));
      i = next;
    }
  }

  // 최소 1개 이상 바인딩된 경우에만 평가 결과 반환
  return boundCount > 0 ? parts.join("") : null;
}

/**
 * 단순 표현식 평가: varName 또는 varName.toStringAsFixed(n) 등.
 */
function evaluateExpr(expr: string, bindings: Record<string, unknown>): string | null {
  // varName!.toStringAsFixed(n) 또는 varName.toStringAsFixed(n) (null-check ! 포함 대응)
  const fixedMatch = expr.match(/^([A-Za-z_]\w*)!?\.toStringAsFixed\((\d+)\)$/);
  if (fixedMatch) {
    const varName = fixedMatch[1]!;
    const digits = parseInt(fixedMatch[2]!, 10);
    if (!Object.prototype.hasOwnProperty.call(bindings, varName)) return null;
    const val = bindings[varName];
    if (typeof val !== "number") return null;
    return val.toFixed(digits);
  }
  // 단순 varName 또는 varName! (null-check unwrap)
  const simpleMatch = expr.match(/^([A-Za-z_]\w*)!?$/);
  if (simpleMatch) {
    const varName = simpleMatch[1]!;
    if (!Object.prototype.hasOwnProperty.call(bindings, varName)) return null;
    return String(bindings[varName] ?? "");
  }
  return null;
}

// ── Text 파싱 ─────────────────────────────────────────────────────────────────

interface TextParseResult {
  value: string;
  wasMocked: boolean;
  mockReason?: string;
}

function parseTextValue(
  args: SyntaxNode,
  mock: MockProvider | undefined,
  argBindings?: Record<string, unknown>
): TextParseResult {
  // 첫 번째 positional argument (문자열 리터럴)
  for (const child of args.children) {
    if (!child || child.type === "(" || child.type === ")" || child.type === ",") continue;
    if (child.type === "named_argument") continue;

    // 직접 문자열: 인터폴레이션 포함 여부 확인
    if (child.type === "string_literal") {
      const raw = child.text;
      // 인터폴레이션 패턴($, ${...}) 이 있으면 바인딩 기반 부분 평가 시도
      if (raw.includes("$")) {
        if (argBindings) {
          const evaluated = tryEvaluateInterpolation(raw, argBindings);
          if (evaluated !== null) {
            return { value: evaluated, wasMocked: false };
          }
        }
        return {
          value: mock ? mock.text() : "",
          wasMocked: true,
          mockReason: `Dart 문자열 인터폴레이션: ${raw.slice(0, 40)}`,
        };
      }
      return { value: extractStringLiteral(child) ?? "", wasMocked: false };
    }

    // 조건 표현식 (ternary: a ? b : c) → mock
    if (child.type === "conditional_expression" || child.type === "ternary_expression") {
      return {
        value: mock ? mock.text() : "",
        wasMocked: true,
        mockReason: `Dart 조건 표현식: ${child.text.slice(0, 40)}`,
      };
    }

    // 인터폴레이션이나 변수 → 바인딩 기반 부분 평가 시도, 실패 시 mock
    const strNode = findChild(child, "string_literal");
    if (strNode) {
      const raw = strNode.text;
      if (raw.includes("$")) {
        if (argBindings) {
          const evaluated = tryEvaluateInterpolation(raw, argBindings);
          if (evaluated !== null) {
            return { value: evaluated, wasMocked: false };
          }
        }
        return {
          value: mock ? mock.text() : "",
          wasMocked: true,
          mockReason: `Dart 문자열 인터폴레이션 (중첩)`,
        };
      }
      return { value: extractStringLiteral(strNode) ?? "", wasMocked: false };
    }

    // 변수 참조: argBindings에서 바인딩된 값 조회 (인라이닝 시 call-site 인자)
    // child가 identifier이거나, argument 노드 안에 identifier만 있는 경우
    // postfix_expression(badge! 등)도 처리: "!" 를 벗겨서 identifier로 해석
    const unwrapPostfix = (n: SyntaxNode): SyntaxNode | null => {
      if (n.type === "identifier") return n;
      if (n.type === "postfix_expression" || n.type === "null_check_expression") {
        const inner = n.children.find(c => c && c.type === "identifier") ?? null;
        return inner;
      }
      return null;
    };
    // argument 노드에서 identifier를 추출하는 헬퍼:
    // "badge!" → argument[identifier('badge'), selector('!')] 패턴에서도 identifier 반환
    const extractIdentifierFromArgument = (n: SyntaxNode): SyntaxNode | null => {
      if (n.type !== "argument") return null;
      const meaningful = n.children.filter(c => c && c.type !== "," && c.type !== "(" && c.type !== ")");
      // 자식이 identifier 하나 (또는 identifier + selector('!') 패턴)
      const idNode = meaningful.find(c => c && c.type === "identifier") ?? null;
      if (!idNode) return null;
      // selector 자식이 있더라도 '!' 뿐이면 null-check unwrap으로 처리
      const nonIdChildren = meaningful.filter(c => c && c.type !== "identifier");
      const isOnlyBang = nonIdChildren.every(c => c && c.type === "selector" && c.text === "!");
      return isOnlyBang ? idNode : null;
    };
    const identifierNode = unwrapPostfix(child)
      ?? extractIdentifierFromArgument(child)
      ?? ((child.type === "argument" && child.children.filter(c => c && c.type !== "," && c.type !== "(" && c.type !== ")").length === 1)
        ? (() => {
            const inner = child.children.find(c => c && (c.type === "identifier" || c.type === "postfix_expression" || c.type === "null_check_expression")) ?? null;
            return inner ? unwrapPostfix(inner) : null;
          })()
        : null);
    if (identifierNode && identifierNode.type === "identifier") {
      const varName = identifierNode.text;
      if (argBindings && Object.prototype.hasOwnProperty.call(argBindings, varName)) {
        const bound = argBindings[varName];
        if (bound !== null && bound !== undefined) {
          return { value: String(bound), wasMocked: false };
        }
      }
      if (mock) {
        return {
          value: mock.text(varName),
          wasMocked: true,
          mockReason: `변수 참조: ${varName}`,
        };
      }
    }

    // 문자열 리터럴 재귀 탐색 — 인터폴레이션 체크 포함
    const firstStr = findAllNodes(child, "string_literal")[0];
    if (firstStr) {
      const raw = firstStr.text;
      if (raw.includes("$")) {
        if (argBindings) {
          const evaluated = tryEvaluateInterpolation(raw, argBindings);
          if (evaluated !== null) {
            return { value: evaluated, wasMocked: false };
          }
        }
        return {
          value: mock ? mock.text() : "",
          wasMocked: true,
          mockReason: `Dart 문자열 인터폴레이션 (재귀)`,
        };
      }
      const val = extractStringLiteral(firstStr);
      if (val !== undefined) return { value: val, wasMocked: false };
    }

    // 그 외 동적 표현식 → mock
    return {
      value: mock ? mock.text() : "",
      wasMocked: true,
      mockReason: `동적 표현식: ${child.text.slice(0, 40)}`,
    };
  }
  return {
    value: mock ? mock.text() : "",
    wasMocked: mock !== undefined,
    mockReason: mock ? "인자 없음 — mock 생성" : undefined,
  };
}

function parseTextStyle(styleNode: SyntaxNode | undefined, ctx: MapContext, styleFullText?: string): {
  fontSize?: number;
  color?: string;
  fontWeight?: string;
} {
  if (!styleNode) return {};
  const args = extractArgs(styleNode);

  const result: { fontSize?: number; color?: string; fontWeight?: string } = {};

  if (args) {
    const fontSizeArg = getArg(args, "fontSize");
    if (fontSizeArg) result.fontSize = getFirstNumberValue(fontSizeArg);

    const colorArg = getArg(args, "color");
    if (colorArg) result.color = extractColorFromExpr(colorArg, ctx.themeTokens);
  }

  // fallback: 전체 표현식 텍스트(styleFullText 또는 parent 체인 포함 text)에서 color 패턴 추출
  // textTheme.xxx?.copyWith(color: colorScheme.yyy, ...) 또는 TextStyle(color: ...)
  if (!result.color) {
    // styleFullText: named_argument 에서 label 이후 모든 노드 텍스트 합산한 것
    const text = styleFullText ?? styleNode.text;
    const colorMatch = text.match(/color:\s*(colorScheme\.\w+|Color\(0x[0-9A-Fa-f]+\)|Colors\.\w+)/);
    if (colorMatch) {
      const fakeNode = { text: colorMatch[1], type: "identifier", children: [], startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 } } as unknown as SyntaxNode;
      result.color = extractColorFromExpr(fakeNode, ctx.themeTokens);
    }
  }

  return result;
}

// ── Color 추출 ─────────────────────────────────────────────────────────────────

/**
 * named_argument의 value 노드에서 전체 표현식 텍스트를 구성한다.
 * `colorScheme.surface` 같은 selector 체인을 올바르게 처리하기 위해
 * label 이후 모든 형제 노드의 텍스트를 합친다.
 */
function namedArgFullText(argsNode: SyntaxNode, label: string): string | undefined {
  for (const child of argsNode.children) {
    if (!child || child.type !== "named_argument") continue;
    const labelNode = findChild(child, "label");
    const id = labelNode ? findChild(labelNode, "identifier") : undefined;
    if (id?.text !== label) continue;

    // label 이후의 모든 자식 텍스트를 합쳐 전체 표현식 구성
    const parts = child.children
      .filter((c): c is SyntaxNode => c !== null && c.type !== "label" && c.type !== ",")
      .map(c => c.text);
    return parts.join("");
  }
  return undefined;
}

/**
 * 전체 표현식 텍스트에서 색상을 추출하는 헬퍼.
 * colorArg가 단순 identifier일 때 parent 체인을 포함한 full text도 검토.
 */
function extractColorFromFullText(fullText: string, themeTokens: Record<string, string>): string | undefined {
  const fakeNode = {
    text: fullText,
    type: "identifier",
    children: [],
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
  } as unknown as SyntaxNode;
  return extractColorFromExpr(fakeNode, themeTokens);
}

function extractBackground(args: SyntaxNode, ctx: MapContext): string | undefined {
  // 먼저 전체 표현식 텍스트로 시도 (colorScheme.xxx 체인 처리)
  for (const key of ["color", "backgroundColor", "background"]) {
    const fullText = namedArgFullText(args, key);
    if (fullText) {
      const color = extractColorFromFullText(fullText, ctx.themeTokens);
      if (color) return color;
    }
  }
  // fallback: 단순 node 방식
  const colorArg = getArg(args, "color") ?? getArg(args, "backgroundColor") ?? getArg(args, "background");
  if (colorArg) return extractColorFromExpr(colorArg, ctx.themeTokens);
  return undefined;
}

// ── mainAxisAlignment 파싱 ────────────────────────────────────────────────────

type MainAxis = "start" | "center" | "end" | "spaceBetween" | "spaceAround";
type CrossAxis = "start" | "center" | "end" | "stretch";

const MAIN_AXIS_MAP: Record<string, MainAxis> = {
  "MainAxisAlignment.start": "start",
  "MainAxisAlignment.center": "center",
  "MainAxisAlignment.end": "end",
  "MainAxisAlignment.spaceBetween": "spaceBetween",
  "MainAxisAlignment.spaceAround": "spaceAround",
};

const CROSS_AXIS_MAP: Record<string, CrossAxis> = {
  "CrossAxisAlignment.start": "start",
  "CrossAxisAlignment.center": "center",
  "CrossAxisAlignment.end": "end",
  "CrossAxisAlignment.stretch": "stretch",
};

function parseMainAxis(args: SyntaxNode): MainAxis | undefined {
  const arg = getArg(args, "mainAxisAlignment");
  if (!arg) return undefined;
  return MAIN_AXIS_MAP[arg.text];
}

function parseCrossAxis(args: SyntaxNode): CrossAxis | undefined {
  const arg = getArg(args, "crossAxisAlignment");
  if (!arg) return undefined;
  return CROSS_AXIS_MAP[arg.text];
}

// ── ListView builder 파싱 ────────────────────────────────────────────────────

/**
 * function_expression 또는 block 에서 return하는 위젯 노드를 추출한다.
 * (context, index) => Widget  또는  (context, index) { return Widget; }
 */
function extractFunctionExpressionReturn(node: SyntaxNode): SyntaxNode | undefined {
  if (node.type === "function_expression") {
    const children = node.children.filter((c): c is SyntaxNode => c !== null);

    // arrow function 패턴: formal_parameter_list, function_expression_body(=> expr)
    // 또는 function_expression_body({ ... })
    const body = children.find(c => c.type === "function_expression_body");
    if (body) {
      return extractFunctionExpressionReturn(body);
    }

    // 구형 패턴: => 가 직접 자식인 경우
    const arrowIdx = children.findIndex(c => c.type === "=>");
    if (arrowIdx >= 0 && arrowIdx + 1 < children.length) {
      return children[arrowIdx + 1];
    }

    return undefined;
  }

  if (node.type === "function_expression_body") {
    const children = node.children.filter((c): c is SyntaxNode => c !== null);

    // arrow body: => 다음 표현식
    const arrowIdx = children.findIndex(c => c.type === "=>");
    if (arrowIdx >= 0 && arrowIdx + 1 < children.length) {
      const expr = children[arrowIdx + 1];
      // const_object_expression 등에서 식별자 추출
      return expr;
    }

    // block body: function_expression_body → block → return_statement
    const block = findChild(node, "block");
    if (block) {
      const retStmts = findAllNodes(block, "return_statement");
      if (retStmts.length > 0) {
        const ret = retStmts[retStmts.length - 1]!;
        for (const child of ret.children) {
          if (!child || child.type === "return" || child.type === ";") continue;
          return child;
        }
      }
    }

    return undefined;
  }

  // block 직접 처리
  if (node.type === "block") {
    const retStmts = findAllNodes(node, "return_statement");
    if (retStmts.length > 0) {
      const ret = retStmts[retStmts.length - 1]!;
      for (const child of ret.children) {
        if (!child || child.type === "return" || child.type === ";") continue;
        return child;
      }
    }
  }

  return undefined;
}

async function parseListViewBuilder(args: SyntaxNode, ctx: MapContext, mock: MockProvider | undefined): Promise<IRNode[]> {
  // itemBuilder: (context, index) => Widget
  const itemBuilderArg = getArg(args, "itemBuilder");
  if (!itemBuilderArg) return [];

  // function_expression에서 return 위젯 추출
  let widgetNode: SyntaxNode | undefined;
  if (itemBuilderArg.type === "function_expression") {
    widgetNode = extractFunctionExpressionReturn(itemBuilderArg);
  } else {
    // 직접 위젯 노드일 수도 있음
    widgetNode = itemBuilderArg;
  }

  if (!widgetNode) return [];

  // builder 본문에서 대표 아이템을 1개 추출하고 listCount()=3회 반복
  const representativeNode = await mapWidget(widgetNode, mock, ctx);
  if (!representativeNode) return [];

  const count = mock?.listCount() ?? 3;
  return Array.from({ length: count }, () => ({ ...representativeNode }));
}

// ── Image.asset / Image.network 처리 ─────────────────────────────────────────

function parseImageSrc(node: SyntaxNode, mock: MockProvider | undefined): string {
  // node가 identifier "Image"일 때는 selector 체인이 node 외부에 있으므로
  // 부모(또는 부모의 부모) 전체 텍스트로 Image.asset / Image.network 판별
  const fullText = (() => {
    // 1. node 자체 텍스트가 이미 "Image.asset"을 포함하는 경우 (완전한 표현식 노드)
    if (node.text.includes("Image.asset") || node.text.includes("Image.network")) {
      return node.text;
    }
    // 2. identifier "Image" → selector 체인은 형제 노드에 있음. parent 전체 텍스트를 참조
    const parent = node.parent;
    if (parent && (parent.text.includes("Image.asset") || parent.text.includes("Image.network"))) {
      return parent.text;
    }
    // 3. parent의 parent 시도 (list_literal 등으로 한 단계 더 감싸진 경우)
    const grandParent = parent?.parent;
    if (grandParent && (grandParent.text.includes("Image.asset") || grandParent.text.includes("Image.network"))) {
      return grandParent.text;
    }
    return node.text;
  })();

  if (fullText.includes("Image.asset")) {
    // 첫 번째 string_literal에서 경로 추출 (node 자체 또는 부모에서 탐색)
    const searchRoot = fullText === node.text ? node : (node.parent ?? node);
    const strNode = findAllNodes(searchRoot, "string_literal")[0];
    const assetPath = strNode ? extractStringLiteral(strNode) : undefined;
    return assetPath ? `asset://${assetPath}` : "asset://unknown";
  }
  if (fullText.includes("Image.network")) {
    // 네트워크 이미지는 mock placeholder
    return mock ? mock.imageUrl() : "network-placeholder";
  }
  return mock ? mock.imageUrl() : "network-placeholder";
}

// ── sourceRef 헬퍼 ────────────────────────────────────────────────────────────

function makeSourceRef(node: SyntaxNode, ctx?: MapContext): { file: string; line: number } {
  return { file: ctx?.currentFile ?? "unknown", line: node.startPosition.row + 1 };
}

// ── call-site 인자 추출 ───────────────────────────────────────────────────────

/**
 * 커스텀 위젯 생성자 call-site에서 named 인자의 리터럴 값을 추출한다.
 * Text('Wireless Headphones') / price: 79.99 / badge: 'SALE' 등의 리터럴만 추출.
 * 동적 표현식(변수, 계산식)은 제외한다.
 * currentArgBindings: 현재 스코프의 argBindings — identifier 전달 시 체인 바인딩에 사용.
 */
function extractCallSiteArgs(
  node: SyntaxNode,
  currentArgBindings?: Record<string, unknown>
): Record<string, unknown> {
  const args = extractArgs(node);
  if (!args) return {};

  const result: Record<string, unknown> = {};

  for (const child of args.children) {
    if (!child || child.type !== "named_argument") continue;
    const labelNode = findChild(child, "label");
    const id = labelNode ? findChild(labelNode, "identifier") : undefined;
    if (!id) continue;

    const paramName = id.text;
    // label 이후 첫 번째 값 노드
    const valueNode = child.children.find(
      (c): c is SyntaxNode => c !== null && c.type !== "label" && c.type !== ","
    );
    if (!valueNode) continue;

    // 문자열 리터럴
    if (valueNode.type === "string_literal") {
      const strVal = extractStringLiteral(valueNode);
      if (strVal !== undefined && !strVal.includes("$")) {
        result[paramName] = strVal;
      }
      continue;
    }
    // 숫자 리터럴
    const numVal = extractNumber(valueNode);
    if (numVal !== undefined) {
      result[paramName] = numVal;
      continue;
    }
    // bool 리터럴
    if (valueNode.text === "true") { result[paramName] = true; continue; }
    if (valueNode.text === "false") { result[paramName] = false; continue; }
    // null
    if (valueNode.text === "null") { result[paramName] = null; continue; }
    // identifier 전달: 현재 스코프 argBindings에서 체인 바인딩
    if (valueNode.type === "identifier" && currentArgBindings) {
      const varName = valueNode.text;
      if (Object.prototype.hasOwnProperty.call(currentArgBindings, varName)) {
        result[paramName] = currentArgBindings[varName];
        continue;
      }
    }
    // URL 문자열 (string_literal이 아닌 경우 fallback)
    const firstStr = findAllNodes(valueNode, "string_literal")[0];
    if (firstStr) {
      const strVal = extractStringLiteral(firstStr);
      if (strVal !== undefined && !strVal.includes("$")) {
        result[paramName] = strVal;
      }
    }
  }

  return result;
}

// ── 공개 API: mapWidget ───────────────────────────────────────────────────────

/**
 * AST 노드를 IRNode로 변환한다.
 * 알 수 없는 위젯은 Unknown 노드로 변환한다.
 */
export async function mapWidget(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  if (!node) return null;

  const name = getWidgetName(node);

  switch (name) {
    case "Scaffold": return mapScaffold(node, mock, ctx);
    case "AppBar": return mapAppBar(node, mock, ctx);
    case "Column": return mapColumn(node, mock, ctx);
    case "Row": return mapRow(node, mock, ctx);
    case "Container": return mapContainer(node, mock, ctx);
    case "SizedBox": return mapSizedBox(node, mock, ctx);
    case "Padding": return mapPadding(node, mock, ctx);
    case "Center": return mapCenter(node, mock, ctx);
    case "Align": return mapAlign(node, mock, ctx);
    case "Expanded": return mapExpanded(node, mock, ctx);
    case "Flexible": return mapFlexible(node, mock, ctx);
    case "Spacer": return mapSpacer(node, mock, ctx);
    case "Text": return mapText(node, mock, ctx);
    case "Image": return mapImage(node, mock, ctx);
    case "Icon": return mapIcon(node, mock, ctx);
    case "ElevatedButton": return mapButton(node, mock, ctx);
    case "TextButton": return mapButton(node, mock, ctx);
    case "OutlinedButton": return mapButton(node, mock, ctx);
    case "IconButton": return mapButton(node, mock, ctx);
    case "TextField": return mapInput(node, mock, ctx);
    case "TextFormField": return mapInput(node, mock, ctx);
    case "Divider": return mapDivider(node, mock, ctx);
    case "ListView": return mapListView(node, mock, ctx);
    case "GridView": return mapGridView(node, mock, ctx);
    case "SingleChildScrollView": return mapScroll(node, mock, ctx);
    case "Stack": return mapStack(node, mock, ctx);
    case "Positioned": return mapPositioned(node, mock, ctx);
    case "Card": return mapCard(node, mock, ctx);
    case "CircleAvatar": return mapCircleAvatar(node, mock, ctx);
    case "SafeArea": return mapSafeArea(node, mock, ctx);
    case "ClipRRect": return mapClipRRect(node, mock, ctx);
    case "ListTile": return mapListTile(node, mock, ctx);
    case "InkWell": return mapPassThrough(node, mock, ctx);
    case "GestureDetector": return mapPassThrough(node, mock, ctx);
    case "Material": return mapPassThrough(node, mock, ctx);
    case "AnimatedBuilder": return mapPassThrough(node, mock, ctx);
    case "PreferredSize": return mapPreferredSize(node, mock, ctx);
    default:
      // null이거나 빈 이름이면 자식 처리 시도
      if (!name) return null;
      // _로 시작하는 private 이름
      if (name.startsWith("_")) {
        // 심볼 테이블에 클래스로 등록된 경우 → 커스텀 위젯 인라이닝
        if (ctx.symbolTable?.classes.has(name) && ctx.depth < ctx.maxDepth && !ctx.visited.has(name)) {
          const callArgs = extractCallSiteArgs(node, ctx.argBindings);
          const ctxWithArgs: MapContext = { ...ctx, argBindings: callArgs };
          const inlined = await tryInlineWidget(name, ctx.symbolTable, ctx.projectPath, ctxWithArgs);
          return inlined;
        }
        // 현재 파일 AST에서 private 메서드로 탐색
        if (ctx.currentFileRoot) {
          const result = await tryInlinePrivateMethod(name, node, ctx);
          if (result) return result;
        }
        return null;
      }
      // 대문자로 시작하면 커스텀 위젯 → symbolTable이 있으면 인라이닝 시도
      if (/^[A-Z]/.test(name)) {
        if (ctx.symbolTable && ctx.depth < ctx.maxDepth && !ctx.visited.has(name)) {
          const callArgs = extractCallSiteArgs(node, ctx.argBindings);
          const ctxWithArgs: MapContext = { ...ctx, argBindings: callArgs };
          const inlined = await tryInlineWidget(name, ctx.symbolTable, ctx.projectPath, ctxWithArgs);
          return inlined;
        }
        ctx.diagnostics?.push({
          level: "warn",
          code: "UNRESOLVED_COMPONENT",
          message: `알 수 없는 위젯 '${name}' — Unknown 노드로 처리됨`,
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

// ── Private 메서드 인라이닝 ───────────────────────────────────────────────────

/**
 * `_buildBody()` 같은 private 메서드 호출을 현재 파일 AST에서 찾아 인라이닝한다.
 * currentFileRoot 전체에서 메서드 이름으로 탐색하여 첫 번째 return 값을 매핑한다.
 */
async function tryInlinePrivateMethod(
  methodName: string,
  callNode: SyntaxNode,
  ctx: MapContext
): Promise<IRNode | null> {
  const fileRoot = ctx.currentFileRoot;
  if (!fileRoot) return null;

  // 파일 전체에서 해당 이름의 메서드 찾기 (method_signature + function_body 또는 method_declaration)
  const allMethodSigs = findAllNodes(fileRoot, "method_signature");
  let methodBody: SyntaxNode | undefined;

  for (const sig of allMethodSigs) {
    const ids = findAllNodes(sig, "identifier");
    if (ids.some(n => n.text === methodName)) {
      // 다음 형제 function_body 탐색
      const parent = sig.parent;
      if (!parent) continue;
      const siblings = parent.children.filter(c => c !== null);
      // tree-sitter 노드는 === 비교가 실패할 수 있으므로 startPosition으로 탐색
      const sigIdx = siblings.findIndex(s =>
        s.type === sig.type &&
        s.startPosition.row === sig.startPosition.row &&
        s.startPosition.column === sig.startPosition.column
      );
      if (sigIdx >= 0 && sigIdx + 1 < siblings.length) {
        const next = siblings[sigIdx + 1];
        if (next && next.type === "function_body") {
          methodBody = next;
          break;
        }
      }
      methodBody = sig;
      break;
    }
  }

  // method_declaration 패턴도 시도
  if (!methodBody) {
    const allMethodDecls = findAllNodes(fileRoot, "method_declaration");
    for (const decl of allMethodDecls) {
      const ids = findAllNodes(decl, "identifier");
      if (ids.some(n => n.text === methodName)) {
        methodBody = decl;
        break;
      }
    }
  }

  if (!methodBody) return null;

  // 메서드 body에서 return_statement 추출
  const returnStmts = findAllNodes(methodBody, "return_statement");
  if (returnStmts.length === 0) return null;

  // 분기가 1개인 경우: 직접 매핑
  if (returnStmts.length === 1) {
    const ret = returnStmts[0]!;
    let returnNode: SyntaxNode | undefined;
    for (const child of ret.children) {
      if (!child || child.type === "return" || child.type === ";") continue;
      returnNode = child;
      break;
    }
    if (!returnNode) return null;
    return await mapWidget(returnNode, ctx.mockProvider, ctx);
  }

  // 분기가 여러 개인 경우: Branch 노드 생성
  // PLAN.md §4: 조건부 렌더링 → 기본 첫 분기 표시 + Branch 메타데이터 보존
  // if-else 체인에서 조건식 텍스트를 추출해 라벨로 보존
  const ifStatements = findAllNodes(methodBody, "if_statement");
  const conditionLabels: string[] = [];
  for (const ifStmt of ifStatements) {
    // tree-sitter Dart의 if_statement는 [if, (, <expr>, ), block] 구조:
    // parenthesized_expression/condition 노드가 없으므로 ( 와 ) 사이의 표현식 노드를 직접 추출
    const ifChildren = ifStmt.children.filter((c): c is SyntaxNode => c !== null);
    const openParenIdx = ifChildren.findIndex(c => c.type === "(");
    const closeParenIdx = ifChildren.findIndex(c => c.type === ")");
    let condText: string | undefined;
    if (openParenIdx >= 0 && closeParenIdx > openParenIdx) {
      // ( 와 ) 사이의 표현식 노드들을 합쳐서 조건 텍스트 생성
      const exprNodes = ifChildren.slice(openParenIdx + 1, closeParenIdx);
      condText = exprNodes.map(n => n.text).join("").trim().slice(0, 60);
    } else {
      // fallback: parenthesized_expression 또는 condition 노드 (다른 tree-sitter 버전 대응)
      const condition = findChild(ifStmt, "parenthesized_expression") ?? findChild(ifStmt, "condition");
      condText = condition?.text.replace(/^\(|\)$/g, "").trim().slice(0, 60);
    }
    if (condText) {
      conditionLabels.push(condText);
    }
  }
  // else 분기는 "else" 라벨 추가
  const hasElse = methodBody.text.includes("else {") || methodBody.text.includes("else\n");
  if (hasElse && conditionLabels.length < returnStmts.length) {
    conditionLabels.push("else");
  }

  const branchChildren: IRNode[] = [];
  for (let i = 0; i < returnStmts.length; i++) {
    const ret = returnStmts[i]!;
    let returnNode: SyntaxNode | undefined;
    for (const child of ret.children) {
      if (!child || child.type === "return" || child.type === ";") continue;
      returnNode = child;
      break;
    }
    if (!returnNode) continue;
    const mapped = await mapWidget(returnNode, ctx.mockProvider, ctx);
    if (mapped) {
      // 분기 라벨을 role에 추가
      const label = conditionLabels[i];
      branchChildren.push(label ? { ...mapped, role: `branch-arm:${label}` } : mapped);
    }
  }

  if (branchChildren.length === 0) return null;

  // 분기가 하나만 성공하면 그대로 반환
  if (branchChildren.length === 1) return branchChildren[0]!;

  // Branch 노드: 첫 분기가 defaultChild, 전체가 children
  ctx.diagnostics?.push({
    level: "info",
    code: "DYNAMIC_DATA_MOCKED",
    message: `${methodName}(): ${branchChildren.length}개 조건 분기 감지 — Branch 노드로 래핑 (첫 분기 기본 표시)`,
  });

  // Branch 노드에 조건 라벨 목록을 role로 보존
  const conditionSummary = conditionLabels.join("|");
  const branchNode: IRNode = {
    type: "Branch",
    role: conditionSummary ? `conditions:${conditionSummary}` : undefined,
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: { file: ctx.currentFile ?? "unknown", line: methodBody.startPosition.row + 1 },
    children: branchChildren,
  };

  return branchNode;
}

// ── Scaffold ──────────────────────────────────────────────────────────────────

async function mapScaffold(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const children: IRNode[] = [];

  if (args) {
    // backgroundColor
    const bgArg = getArg(args, "backgroundColor");
    const bg = bgArg ? extractColorFromExpr(bgArg, ctx.themeTokens) : undefined;

    // appBar
    const appBarArg = getArg(args, "appBar");
    if (appBarArg) {
      const appBarNode = await mapWidget(appBarArg, mock, ctx);
      if (appBarNode) {
        children.push({ ...appBarNode, role: "appbar" });
      }
    }

    // body
    const bodyArg = getArg(args, "body");
    if (bodyArg) {
      const bodyNode = await mapWidget(bodyArg, mock, ctx);
      if (bodyNode) {
        if (bodyNode.type === "Branch") {
          // Branch의 role(conditions:...)을 보존하고 content role은 감싸는 Box에 부여
          children.push({
            type: "Box",
            role: "content",
            layout: { direction: "column", width: "fill", height: "fill" },
            confidence: bodyNode.confidence,
            sourceRef: bodyNode.sourceRef,
            children: [bodyNode],
          });
        } else {
          children.push({ ...bodyNode, role: "content" });
        }
      }
    }

    // bottomNavigationBar
    const tabBarArg = getArg(args, "bottomNavigationBar");
    if (tabBarArg) {
      const tabBarNode = await mapWidget(tabBarArg, mock, ctx);
      if (tabBarNode) {
        children.push({ ...tabBarNode, role: "tabbar" });
      }
    }

    return {
      type: "Box",
      layout: { direction: "column", width: "fill", height: "fill" },
      style: bg ? { background: bg } : undefined,
      confidence: NODE_CONFIDENCE.standard,
      sourceRef: makeSourceRef(node, ctx),
      children,
    };
  }

  return {
    type: "Box",
    layout: { direction: "column", width: "fill", height: "fill" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children,
  };
}

// ── AppBar ────────────────────────────────────────────────────────────────────

async function mapAppBar(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const children: IRNode[] = [];

  if (args) {
    const bg = extractBackground(args, ctx);

    const titleArg = getArg(args, "title");
    if (titleArg) {
      const titleNode = await mapWidget(titleArg, mock, ctx);
      if (titleNode) children.push(titleNode);
    }

    const actionsArg = getArg(args, "actions");
    if (actionsArg) {
      const actionNodes = await parseListLiteral(actionsArg, ctx);
      children.push(...actionNodes);
    }

    return {
      type: "Box",
      role: "appbar",
      layout: { direction: "row", crossAxis: "center" },
      style: bg ? { background: bg } : undefined,
      confidence: NODE_CONFIDENCE.standard,
      sourceRef: makeSourceRef(node, ctx),
      children,
    };
  }

  return {
    type: "Box",
    role: "appbar",
    layout: { direction: "row", crossAxis: "center" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children,
  };
}

// ── Column / Row ──────────────────────────────────────────────────────────────

async function mapColumn(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  if (!args) return { type: "Column", layout: { direction: "column" }, confidence: NODE_CONFIDENCE.standard, sourceRef: makeSourceRef(node) };

  const mainAxis = parseMainAxis(args);
  const crossAxis = parseCrossAxis(args);
  const children = await parseChildrenArg(args, ctx);

  return {
    type: "Column",
    layout: {
      direction: "column",
      mainAxis: mainAxis ?? "start",
      crossAxis: crossAxis ?? "start",
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children,
  };
}

async function mapRow(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  if (!args) return { type: "Row", layout: { direction: "row" }, confidence: NODE_CONFIDENCE.standard, sourceRef: makeSourceRef(node) };

  const mainAxis = parseMainAxis(args);
  const crossAxis = parseCrossAxis(args);
  const children = await parseChildrenArg(args, ctx);

  return {
    type: "Row",
    layout: {
      direction: "row",
      mainAxis: mainAxis ?? "start",
      crossAxis: crossAxis ?? "center",
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children,
  };
}

// ── Container ─────────────────────────────────────────────────────────────────

async function mapContainer(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  if (!args) return { type: "Box", confidence: NODE_CONFIDENCE.standard, sourceRef: makeSourceRef(node) };

  const widthArg = getArg(args, "width");
  const heightArg = getArg(args, "height");
  const width = widthArg ? getFirstNumberValue(widthArg) : undefined;
  const height = heightArg ? getFirstNumberValue(heightArg) : undefined;

  const marginArg = getArg(args, "margin");
  const margin = marginArg ? parseEdgeInsets(marginArg) : undefined;

  const paddingArg = getArg(args, "padding");
  const padding = paddingArg ? parseEdgeInsets(paddingArg) : undefined;

  const bg = extractBackground(args, ctx);

  // decoration: BoxDecoration(...)
  const decorationArg = getArg(args, "decoration");
  let borderRadius: number | undefined;
  let shadowBlur: number | undefined;
  let shadowOffsetY: number | undefined;
  let decorBg: string | undefined;

  if (decorationArg) {
    const brText = decorationArg.text;
    const brMatch = brText.match(/BorderRadius\.circular\(([0-9.]+)\)/);
    if (brMatch) borderRadius = parseFloat(brMatch[1]);

    // boxShadow / BoxShadow
    if (decorationArg.text.includes("BoxShadow")) {
      const blurMatch = decorationArg.text.match(/blurRadius:\s*([0-9.]+)/);
      const offsetYMatch = decorationArg.text.match(/offset:\s*Offset\([^,]+,\s*([0-9.-]+)\)/);
      shadowBlur = blurMatch ? parseFloat(blurMatch[1]) : 4;
      shadowOffsetY = offsetYMatch ? parseFloat(offsetYMatch[1]) : 2;
    }

    // decoration의 color — Color(0x...), Colors.xxx, colorScheme.xxx 모두 처리
    const decorColorMatch = decorationArg.text.match(/color:\s*(Color\(0x[0-9A-Fa-f]+\)|Colors\.\w+|colorScheme\.\w+)/);
    if (decorColorMatch) {
      const fakeNode = { text: decorColorMatch[1], type: "identifier", children: [], startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 } } as unknown as SyntaxNode;
      decorBg = extractColorFromExpr(fakeNode, ctx.themeTokens);
    }
  }

  // width: double.infinity → "fill"
  const widthVal: "fill" | "wrap" | number | undefined =
    widthArg?.text === "double.infinity" ? "fill" : width;

  const child = await parseSingleChild(args, "child", ctx);

  const styleBg = bg ?? decorBg;
  const styleObj: NonNullable<IRNode["style"]> = {};
  if (styleBg) styleObj.background = styleBg;
  if (borderRadius !== undefined) styleObj.borderRadius = borderRadius;
  if (shadowBlur !== undefined) {
    styleObj.shadow = { blur: shadowBlur, offsetY: shadowOffsetY ?? 2, color: "#00000020" };
  }

  return {
    type: "Box",
    layout: {
      width: widthVal,
      height,
      padding,
      margin,
    },
    style: Object.keys(styleObj).length > 0 ? styleObj : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

// ── SizedBox ──────────────────────────────────────────────────────────────────

async function mapSizedBox(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  if (!args) return { type: "Box", confidence: NODE_CONFIDENCE.standard, sourceRef: makeSourceRef(node) };

  const widthArg = getArg(args, "width");
  const heightArg = getArg(args, "height");

  const width = widthArg ? getFirstNumberValue(widthArg) : undefined;
  const height = heightArg ? getFirstNumberValue(heightArg) : undefined;

  const child = await parseSingleChild(args, "child", ctx);

  return {
    type: "Box",
    layout: { width, height },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

// ── Padding ───────────────────────────────────────────────────────────────────

async function mapPadding(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  if (!args) return { type: "Box", confidence: NODE_CONFIDENCE.standard, sourceRef: makeSourceRef(node) };

  const paddingArg = getArg(args, "padding");
  const padding = paddingArg ? parseEdgeInsets(paddingArg) : undefined;
  const child = await parseSingleChild(args, "child", ctx);

  return {
    type: "Box",
    layout: { padding },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

// ── Center / Align ────────────────────────────────────────────────────────────

async function mapCenter(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;
  return {
    type: "Box",
    layout: { mainAxis: "center", crossAxis: "center" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

async function mapAlign(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;
  return {
    type: "Box",
    layout: { mainAxis: "center", crossAxis: "center" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

// ── Expanded / Flexible ───────────────────────────────────────────────────────

async function mapExpanded(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const flexArg = args ? getArg(args, "flex") : undefined;
  const flex = flexArg ? getFirstNumberValue(flexArg) ?? 1 : 1;
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;
  return {
    type: "Box",
    layout: { flex },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

async function mapFlexible(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  return mapExpanded(node, mock, ctx);
}

// ── Spacer ────────────────────────────────────────────────────────────────────

function mapSpacer(node: SyntaxNode, _mock?: MockProvider, ctx?: MapContext): IRNode {
  return {
    type: "Spacer",
    layout: { flex: 1 },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Text ──────────────────────────────────────────────────────────────────────

function mapText(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): IRNode {
  const args = extractArgs(node);
  if (!args) {
    return {
      type: "Text",
      text: { value: mock ? mock.text() : "Text" },
      confidence: NODE_CONFIDENCE.standard,
      sourceRef: makeSourceRef(node, ctx),
    };
  }

  const parsed = parseTextValue(args, mock, ctx.argBindings);
  if (parsed.wasMocked && parsed.mockReason) {
    ctx.diagnostics?.push({
      level: "info",
      code: "DYNAMIC_DATA_MOCKED",
      message: `Text 노드 mock 처리: ${parsed.mockReason}`,
    });
  }

  const styleArg = getArg(args, "style");
  // style의 전체 표현식 텍스트(selector 체인 포함)를 구성하여 color 추출 정확도 향상
  const styleFullText = namedArgFullText(args, "style");
  const textStyle = styleArg ? parseTextStyle(styleArg, ctx, styleFullText) : {};

  const maxLinesArg = getArg(args, "maxLines");
  const maxLines = maxLinesArg ? getFirstNumberValue(maxLinesArg) : undefined;

  return {
    type: "Text",
    text: {
      value: parsed.value,
      color: textStyle.color,
      maxLines: maxLines ? Math.round(maxLines) : undefined,
    },
    confidence: parsed.wasMocked ? NODE_CONFIDENCE.mocked : NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Image ─────────────────────────────────────────────────────────────────────

function mapImage(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): IRNode {
  const src = parseImageSrc(node, mock);
  const args = extractArgs(node);
  const widthArg = args ? getArg(args, "width") : undefined;
  const heightArg = args ? getArg(args, "height") : undefined;

  const width: "fill" | "wrap" | number | undefined =
    widthArg?.text === "double.infinity" ? "fill"
    : widthArg ? getFirstNumberValue(widthArg)
    : undefined;
  const height = heightArg ? getFirstNumberValue(heightArg) : undefined;

  return {
    type: "Image",
    src,
    layout: { width, height },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Icon ──────────────────────────────────────────────────────────────────────

function mapIcon(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): IRNode {
  const args = extractArgs(node);
  const sizeArg = args ? getArg(args, "size") : undefined;
  const size = sizeArg ? getFirstNumberValue(sizeArg) : undefined;
  const colorArg = args ? getArg(args, "color") : undefined;
  const color = colorArg ? extractColorFromExpr(colorArg, ctx.themeTokens) : undefined;

  // Icon(Icons.xxx) → 첫 번째 positional arg에서 이름 추출
  // tree-sitter Dart: Icons.bookmark_outline 은 identifier + selector 체인으로 분리됨
  let iconName = "";
  if (args) {
    const argChildren = args.children.filter((c): c is SyntaxNode => c !== null &&
      c.type !== "(" && c.type !== ")" && c.type !== ",");

    for (let i = 0; i < argChildren.length; i++) {
      const child = argChildren[i]!;
      if (child.type === "named_argument") continue;

      // tree-sitter Dart: 'argument' 노드의 경우 전체 텍스트(Icons.bookmark_outline 포함)를 사용
      // 자식 노드로 쪼개면 identifier + selector로 분리되므로 .text 전체가 정확함
      const argText = child.type === "argument" ? child.text : child.text;

      // argument 내에 conditional_expression이 있는지 자식에서 확인
      const condChild = child.children?.find((c): c is SyntaxNode =>
        c !== null && (c.type === "conditional_expression" || c.type === "ternary_expression")
      );

      // ternary: "a ? b : c" → false branch (기본값)만 추출하여 동적 표현식 노출 방지
      if (condChild) {
        // 전체 텍스트에서 마지막 ': ' 이후 부분 추출 (false branch)
        const fullText = condChild.text;
        const colonIdx = fullText.lastIndexOf(": ");
        iconName = colonIdx >= 0 ? fullText.slice(colonIdx + 2).trim() : fullText;
        ctx.diagnostics?.push({
          level: "info",
          code: "DYNAMIC_DATA_MOCKED",
          message: `Icon 조건부 표현식: 기본값(${iconName}) 사용`,
        });
      } else {
        iconName = argText;
      }
      break;
    }
  }

  return {
    type: "Icon",
    text: { value: iconName, color },
    layout: { width: size, height: size },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Button ────────────────────────────────────────────────────────────────────

async function mapButton(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;

  // styleFrom 인자에서 배경색/패딩 추출
  let bgColor: string | undefined;
  let padding: [number, number, number, number] | undefined;
  const styleArg = args ? getArg(args, "style") : undefined;
  if (styleArg) {
    // getArg는 named_argument의 첫 번째 value 노드만 반환한다.
    // ElevatedButton.styleFrom(...) 같이 selector 체인으로 이어지는 경우
    // named_argument 전체 텍스트(parent.text)를 사용해야 styleFrom 내부 인자에 접근 가능.
    const styleText = styleArg.parent?.type === "named_argument"
      ? styleArg.parent.text
      : styleArg.text;
    // backgroundColor 추출 (const 키워드 허용: const Color(0xFF...))
    const bgMatch = styleText.match(/backgroundColor:\s*(?:const\s+)?(Color\(0x[0-9A-Fa-f]+\)|Colors\.\w+|colorScheme\.\w+)/);
    if (bgMatch) {
      const fakeNode = { text: bgMatch[1], type: "identifier", children: [], startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 } } as unknown as SyntaxNode;
      bgColor = extractColorFromExpr(fakeNode, ctx.themeTokens);
    }
    // padding 추출 (const 키워드 허용: const EdgeInsets.symmetric(...))
    // EdgeInsets.methodName(...) 형식 전체 캡처 (괄호 포함)
    const paddingMatch = styleText.match(/padding:\s*(?:const\s+)?(EdgeInsets\.\w+\([^)]*\))/);
    if (paddingMatch) {
      const fakePadNode = { text: paddingMatch[1], type: "identifier", children: [], parent: null, startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 } } as unknown as SyntaxNode;
      padding = parseEdgeInsets(fakePadNode);
    }
  }

  return {
    type: "Button",
    style: bgColor ? { background: bgColor } : undefined,
    layout: padding ? { padding } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

// ── Input ─────────────────────────────────────────────────────────────────────

function mapInput(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): IRNode {
  const args = extractArgs(node);
  const decorArg = args ? getArg(args, "decoration") : undefined;

  let placeholder: string | undefined;
  if (decorArg) {
    const hintArgs = extractArgs(decorArg);
    if (hintArgs) {
      const hintArg = getArg(hintArgs, "hintText");
      if (hintArg) placeholder = getFirstStringValue(hintArg);
    }
  }

  return {
    type: "Input",
    text: { value: placeholder ?? (mock ? mock.text("placeholder") : "Enter text") },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Divider ───────────────────────────────────────────────────────────────────

function mapDivider(node: SyntaxNode, _mock?: MockProvider, ctx?: MapContext): IRNode {
  return {
    type: "Divider",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── ListView ──────────────────────────────────────────────────────────────────

async function mapListView(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  // node가 identifier("ListView")일 때 parent의 전체 텍스트로 builder 패턴 감지
  const fullText = node.parent?.text ?? node.text;
  const args = extractArgs(node);
  if (!args) return { type: "Scroll", confidence: NODE_CONFIDENCE.standard, sourceRef: makeSourceRef(node) };

  const paddingArg = getArg(args, "padding");
  const padding = paddingArg ? parseEdgeInsets(paddingArg) : undefined;

  let listChildren: IRNode[] = [];

  // builder/separated 패턴: itemBuilder 인자 존재 여부로도 감지
  const hasItemBuilder = getArg(args, "itemBuilder") !== undefined;
  if (fullText.includes("ListView.builder") || fullText.includes("ListView.separated") || hasItemBuilder) {
    listChildren = await parseListViewBuilder(args, ctx, mock);
  } else {
    // 일반 ListView(children: [...])
    listChildren = await parseChildrenArg(args, ctx);
  }

  const listNode: IRNode = {
    type: "List",
    layout: { direction: "column" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: listChildren,
  };

  return {
    type: "Scroll",
    layout: { direction: "column", padding },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: [listNode],
  };
}

// ── GridView ──────────────────────────────────────────────────────────────────

async function mapGridView(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const paddingArg = args ? getArg(args, "padding") : undefined;
  const padding = paddingArg ? parseEdgeInsets(paddingArg) : undefined;

  return {
    type: "Grid",
    layout: { padding },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── SingleChildScrollView ─────────────────────────────────────────────────────

async function mapScroll(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const paddingArg = args ? getArg(args, "padding") : undefined;
  const padding = paddingArg ? parseEdgeInsets(paddingArg) : undefined;
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;

  return {
    type: "Scroll",
    layout: { direction: "column", padding },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

// ── Stack / Positioned ────────────────────────────────────────────────────────

async function mapStack(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const children = args ? await parseChildrenArg(args, ctx) : [];

  return {
    type: "Stack",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children,
  };
}

async function mapPositioned(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;
  return child ?? {
    type: "Box",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Card ──────────────────────────────────────────────────────────────────────

async function mapCard(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;
  const elevationArg = args ? getArg(args, "elevation") : undefined;
  const elevation = elevationArg ? getFirstNumberValue(elevationArg) : 1;

  return {
    type: "Box",
    style: {
      background: "#FFFFFF",
      borderRadius: 4,
      shadow: { blur: elevation ? elevation * 2 : 2, offsetY: 1, color: "#00000020" },
    },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: child ? [child] : undefined,
  };
}

// ── CircleAvatar ──────────────────────────────────────────────────────────────

async function mapCircleAvatar(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const radiusArg = args ? getArg(args, "radius") : undefined;
  const radius = radiusArg ? getFirstNumberValue(radiusArg) ?? 20 : 20;
  const size = radius * 2;

  return {
    type: "Box",
    layout: { width: size, height: size },
    style: { borderRadius: radius },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── SafeArea ──────────────────────────────────────────────────────────────────

async function mapSafeArea(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  // 투과: 자식만 반환
  const args = extractArgs(node);
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;
  return child ?? {
    type: "Box",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── ClipRRect ─────────────────────────────────────────────────────────────────

async function mapClipRRect(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const borderRadiusArg = args ? getArg(args, "borderRadius") : undefined;
  const borderRadius = borderRadiusArg ? parseBorderRadius(borderRadiusArg) : undefined;
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;

  // borderRadius를 자식에게 적용하거나 Box로 감싼다
  if (child) {
    return {
      ...child,
      style: {
        ...child.style,
        borderRadius: borderRadius ?? child.style?.borderRadius,
      },
    };
  }

  return {
    type: "Box",
    style: borderRadius ? { borderRadius } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── ListTile ──────────────────────────────────────────────────────────────────

async function mapListTile(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  if (!args) return { type: "Box", layout: { direction: "row" }, confidence: NODE_CONFIDENCE.standard, sourceRef: makeSourceRef(node) };

  const children: IRNode[] = [];

  const leadingArg = getArg(args, "leading");
  if (leadingArg) {
    const leading = await mapWidget(leadingArg, mock, ctx);
    if (leading) children.push(leading);
  }

  const titleArg = getArg(args, "title");
  const subtitleArg = getArg(args, "subtitle");

  if (titleArg || subtitleArg) {
    const textCol: IRNode[] = [];
    if (titleArg) {
      const title = await mapWidget(titleArg, mock, ctx);
      if (title) textCol.push(title);
    }
    if (subtitleArg) {
      const subtitle = await mapWidget(subtitleArg, mock, ctx);
      if (subtitle) textCol.push(subtitle);
    }
    children.push({
      type: "Column",
      layout: { direction: "column", flex: 1 },
      confidence: NODE_CONFIDENCE.standard,
      sourceRef: makeSourceRef(node, ctx),
      children: textCol,
    });
  }

  const trailingArg = getArg(args, "trailing");
  if (trailingArg) {
    const trailing = await mapWidget(trailingArg, mock, ctx);
    if (trailing) children.push(trailing);
  }

  return {
    type: "Row",
    layout: { direction: "row", crossAxis: "center" },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children,
  };
}

// ── 통과 위젯 (child 그대로 반환) ─────────────────────────────────────────────

async function mapPassThrough(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;
  return child ?? {
    type: "Box",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── PreferredSize ─────────────────────────────────────────────────────────────

async function mapPreferredSize(node: SyntaxNode, mock: MockProvider | undefined, ctx: MapContext): Promise<IRNode> {
  const args = extractArgs(node);
  const child = args ? await parseSingleChild(args, "child", ctx) : undefined;
  return child ?? {
    type: "Box",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}
