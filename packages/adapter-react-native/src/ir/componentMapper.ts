/**
 * componentMapper — React Native JSX AST 노드를 IRNode로 변환한다.
 *
 * 지원 컴포넌트:
 * - View (style flexDirection row→Row, 기본 Column)
 * - Text
 * - Image (require(...)→asset://, {uri:...}→network placeholder)
 * - TouchableOpacity / Pressable / Button → Button
 * - TextInput → Input
 * - FlatList / SectionList (renderItem 3회 mock 반복 → Scroll+List)
 * - ScrollView → Scroll
 * - SafeAreaView → 투과 (children 직접 반환)
 * - ActivityIndicator → Icon(spinner)
 * - StyleSheet.create 해석: styles.xxx 참조 → 정의 객체
 * - 인라인 style 배열 병합([styles.a, {color}])
 * - 커스텀 컴포넌트 인라이닝 (깊이 6, 방문 집합)
 * - 조건부 {c ? A : B} / {c && A} → Branch
 * - .map() → 3회 반복
 */

import type { SyntaxNode } from "@sfc/adapter-api";
import type { IRNode } from "@sfc/core";
import { NODE_CONFIDENCE } from "@sfc/core";
import type { MockProvider } from "@sfc/core";
import type { SymbolTable } from "../parse/scanner.js";
import { findNodes, findChild, filterChildren } from "../parse/scanner.js";
import { tryInlineComponent } from "./inliner.js";

// ── 매핑 컨텍스트 ─────────────────────────────────────────────────────────────

export interface MapContext {
  depth: number;
  maxDepth: number;
  visited: Set<string>;
  symbolTable: SymbolTable | null;
  projectPath: string;
  themeColors: Record<string, string>;
  styleSheet: Record<string, Record<string, unknown>>;
  mockProvider?: MockProvider;
  diagnostics?: Array<{ level: string; code: string; message: string }>;
  currentFile?: string;
  /** call-site 인자 바인딩 (인라이닝 시) */
  argBindings?: Record<string, unknown>;
}

// ── StyleSheet 파싱 ───────────────────────────────────────────────────────────

/**
 * StyleSheet.create({...}) 호출에서 스타일 맵을 추출한다.
 * 결과: { safeArea: { flex: 1, backgroundColor: '#FFF', ... }, ... }
 */
export function parseStyleSheet(root: SyntaxNode): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  // const styles = StyleSheet.create({...})
  const varDeclarators = findNodes(root, "variable_declarator");
  for (const decl of varDeclarators) {
    const nameId = findChild(decl, "identifier");
    if (!nameId) continue;

    // call_expression 찾기
    const callExpr = findNodes(decl, "call_expression")[0];
    if (!callExpr) continue;

    // StyleSheet.create 확인
    const callText = callExpr.text;
    if (!callText.includes("StyleSheet.create")) continue;

    // 인자 객체 파싱
    const args = findChild(callExpr, "arguments");
    if (!args) continue;
    const objExpr = findNodes(args, "object")[0];
    if (!objExpr) continue;

    const varName = nameId.text;
    result[varName] = {};

    const pairs = findNodes(objExpr, "pair");
    // 직접 자식 pair만 (중첩 pair 제외 - 최상위 스타일 이름)
    const topLevelPairs = pairs.filter(p => {
      // pair의 부모가 objExpr이면 최상위
      return p.parent?.id === objExpr.id;
    });

    // fallback: parent id 비교가 안 될 경우 모든 pair의 depth로 판별
    const pairsToUse = topLevelPairs.length > 0 ? topLevelPairs : pairs;

    for (const pair of pairsToUse) {
      const keyNode = pair.children.find(
        (c): c is SyntaxNode => c !== null && (c.type === "property_identifier" || c.type === "string")
      );
      if (!keyNode) continue;
      const key = keyNode.text.replace(/^['"]|['"]$/g, "");

      // 값: object (중첩 스타일 객체)
      const nestedObj = findNodes(pair, "object")[0];
      if (nestedObj) {
        result[varName]![key] = parseStyleObject(nestedObj);
      }
    }
  }

  return result;
}

/**
 * 스타일 객체 { flex: 1, backgroundColor: '#FFF', ... }를 파싱한다.
 */
function parseStyleObject(objNode: SyntaxNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // findNodes는 재귀 탐색이라 중첩 객체의 pair도 포함됨.
  // 직접 자식 pair만 처리해야 shadowOffset.width가 width로 잘못 올라오는 것을 막는다.
  const directPairs = objNode.children.filter(
    (c): c is SyntaxNode => c !== null && c.type === "pair"
  );

  for (const pair of directPairs) {
    const keyNode = pair.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (!keyNode) continue;

    const valueNode = pair.children.find(
      (c): c is SyntaxNode => c !== null && c !== keyNode && c.type !== ":"
    );
    if (!valueNode) continue;

    result[keyNode.text] = extractStyleValue(valueNode);
  }

  return result;
}

/**
 * JavaScript 문자열 이스케이프 시퀀스를 실제 문자로 디코딩한다.
 * 예: "\\n" → "\n", "\\t" → "\t"
 */
function decodeJsStringEscapes(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * 표현식 노드를 argBindings를 참조해서 문자열로 변환한다.
 * - identifier: argBindings에서 직접 참조
 * - member_expression: obj.prop → argBindings[obj][prop]
 * - call_expression: obj.method(args) → argBindings[obj]에서 method 호출 시도 (toFixed 등)
 * - 변환 불가 시 null 반환
 */
function resolveExpressionToString(
  node: SyntaxNode,
  bindings?: Record<string, unknown>
): string | null {
  if (!bindings) return null;

  // 단순 identifier
  if (node.type === "identifier") {
    const val = bindings[node.text];
    if (val !== undefined) return String(val);
    return null;
  }

  // member_expression: currency, product.name
  if (node.type === "member_expression") {
    const children = node.children.filter((c): c is SyntaxNode => c !== null && c.text !== ".");
    if (children.length >= 2) {
      const objName = children[0]!.text;
      const propName = children[children.length - 1]!.text;
      const obj = bindings[objName];
      if (obj !== undefined) {
        if (typeof obj === "object" && obj !== null) {
          const val = (obj as Record<string, unknown>)[propName];
          if (val !== undefined) return String(val);
        }
      }
    }
    return null;
  }

  // call_expression: price.toFixed(2), currency (identifier), 'USD'.concat(...)
  if (node.type === "call_expression") {
    const funcNode = node.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "member_expression"
    );
    if (funcNode) {
      const children = funcNode.children.filter(
        (c): c is SyntaxNode => c !== null && c.text !== "."
      );
      if (children.length >= 2) {
        const objName = children[0]!.text;
        const methodName = children[children.length - 1]!.text;
        const obj = bindings[objName];

        if (obj !== undefined && typeof obj === "number" && methodName === "toFixed") {
          // args 파싱: toFixed(2)
          const argsNode = findChild(node, "arguments");
          const decimalsNode = argsNode?.children.find(
            (c): c is SyntaxNode => c !== null && c.type === "number"
          );
          const decimals = decimalsNode ? parseInt(decimalsNode.text, 10) : 2;
          return (obj as number).toFixed(decimals);
        }
      }
    }
    return null;
  }

  return null;
}

function extractStyleValue(node: SyntaxNode): unknown {
  if (node.type === "number") return parseFloat(node.text);
  if (node.type === "string") {
    const frag = findNodes(node, "string_fragment")[0];
    return frag?.text ?? node.text.replace(/^['"]|['"]$/g, "");
  }
  if (node.type === "true") return true;
  if (node.type === "false") return false;
  if (node.type === "null") return null;
  if (node.type === "object") return parseStyleObject(node);
  // unary_expression (음수: -4)
  if (node.type === "unary_expression" && node.text.startsWith("-")) {
    return -parseFloat(node.text.slice(1));
  }
  return node.text;
}

// ── 스타일 참조 해석 ─────────────────────────────────────────────────────────

/**
 * styles.xxx 또는 [styles.a, { color }] 형태의 style prop을 해석한다.
 */
function resolveStyleRef(
  styleNode: SyntaxNode | undefined,
  styleSheet: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  if (!styleNode) return {};

  // 배열: [styles.a, { color }, styles.b, ...]
  if (styleNode.type === "array") {
    const merged: Record<string, unknown> = {};
    for (const child of styleNode.children) {
      if (!child || child.type === "[" || child.type === "]" || child.type === ",") continue;
      const resolved = resolveStyleRef(child, styleSheet);
      Object.assign(merged, resolved);
    }
    return merged;
  }

  // member_expression: styles.xxx
  if (styleNode.type === "member_expression") {
    const objId = findChild(styleNode, "identifier");
    const propId = findChild(styleNode, "property_identifier");
    if (objId && propId) {
      const sheetName = objId.text;
      const propName = propId.text;
      const sheet = styleSheet[sheetName];
      if (sheet) {
        const val = sheet[propName];
        if (val && typeof val === "object") {
          return val as Record<string, unknown>;
        }
      }
    }
    return {};
  }

  // 인라인 객체: { color: '#FFF', ... }
  if (styleNode.type === "object") {
    return parseStyleObject(styleNode);
  }

  // jsx_expression 벗기기
  if (styleNode.type === "jsx_expression") {
    const inner = styleNode.children.find(
      (c): c is SyntaxNode => c !== null && c.type !== "{" && c.type !== "}"
    );
    if (inner) return resolveStyleRef(inner, styleSheet);
  }

  return {};
}

// ── style 속성에서 IR layout/style 추출 ──────────────────────────────────────

interface ResolvedStyle {
  direction?: "row" | "column";
  flex?: number;
  width?: "fill" | "wrap" | number;
  height?: "fill" | "wrap" | number;
  padding?: [number, number, number, number];
  margin?: [number, number, number, number];
  gap?: number;
  background?: string;
  borderRadius?: number;
  mainAxis?: "start" | "center" | "end" | "spaceBetween" | "spaceAround";
  crossAxis?: "start" | "center" | "end" | "stretch";
  fontSize?: number;
  color?: string;
  fontWeight?: string;
}

const JUSTIFY_CONTENT_MAP: Record<string, ResolvedStyle["mainAxis"]> = {
  "flex-start": "start",
  "flex-end": "end",
  center: "center",
  "space-between": "spaceBetween",
  "space-around": "spaceAround",
};

const ALIGN_ITEMS_MAP: Record<string, ResolvedStyle["crossAxis"]> = {
  "flex-start": "start",
  "flex-end": "end",
  center: "center",
  stretch: "stretch",
};

function colorFromToken(value: string, themeColors: Record<string, string>): string {
  // colors.primary 형태
  const match = value.match(/^colors\.(\w+)$/);
  if (match) {
    const tokenName = match[1]!;
    return themeColors[tokenName] ?? value;
  }
  // #RRGGBB 또는 rgba(...) 직접 값
  if (value.startsWith("#") || value.startsWith("rgba") || value.startsWith("rgb")) {
    return value;
  }
  return value;
}

function parseEdgeValue(
  styles: Record<string, unknown>,
  single: string,
  h: string,
  v: string,
  top: string,
  right: string,
  bottom: string,
  left: string
): [number, number, number, number] | undefined {
  const get = (k: string): number | undefined =>
    typeof styles[k] === "number" ? (styles[k] as number) : undefined;

  const s = get(single);
  const hv = get(h);
  const vv = get(v);
  const t = get(top) ?? get(v) ?? get(vv !== undefined ? v : single) ?? 0;
  const r = get(right) ?? get(h) ?? get(hv !== undefined ? h : single) ?? 0;
  const b = get(bottom) ?? get(v) ?? get(vv !== undefined ? v : single) ?? 0;
  const l = get(left) ?? get(h) ?? get(hv !== undefined ? h : single) ?? 0;

  if (s !== undefined) return [s, s, s, s];
  if (hv !== undefined && vv !== undefined) return [vv, hv, vv, hv];
  if (hv !== undefined) return [0, hv, 0, hv];
  if (vv !== undefined) return [vv, 0, vv, 0];

  const hasAny = [top, right, bottom, left].some(k => get(k) !== undefined);
  if (hasAny) {
    return [
      get(top) ?? 0,
      get(right) ?? 0,
      get(bottom) ?? 0,
      get(left) ?? 0,
    ];
  }

  return undefined;
}

function extractIRStyle(
  styles: Record<string, unknown>,
  themeColors: Record<string, string>
): ResolvedStyle {
  const result: ResolvedStyle = {};

  // direction
  const flexDir = styles["flexDirection"];
  if (flexDir === "row") result.direction = "row";
  else if (flexDir === "column" || !flexDir) result.direction = "column";

  // flex
  if (typeof styles["flex"] === "number") result.flex = styles["flex"] as number;

  // width / height
  const w = styles["width"];
  if (w === "100%") result.width = "fill";
  else if (typeof w === "number") result.width = w;

  const h = styles["height"];
  if (typeof h === "number") result.height = h;

  // padding
  const padding = parseEdgeValue(
    styles, "padding", "paddingHorizontal", "paddingVertical",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft"
  );
  if (padding) result.padding = padding;

  // margin
  const margin = parseEdgeValue(
    styles, "margin", "marginHorizontal", "marginVertical",
    "marginTop", "marginRight", "marginBottom", "marginLeft"
  );
  if (margin) result.margin = margin;

  // gap
  if (typeof styles["gap"] === "number") result.gap = styles["gap"] as number;

  // backgroundColor
  const bg = styles["backgroundColor"];
  if (typeof bg === "string") result.background = colorFromToken(bg, themeColors);

  // borderRadius
  if (typeof styles["borderRadius"] === "number") result.borderRadius = styles["borderRadius"] as number;

  // justifyContent → mainAxis
  const jc = styles["justifyContent"];
  if (typeof jc === "string") result.mainAxis = JUSTIFY_CONTENT_MAP[jc];

  // alignItems → crossAxis
  const ai = styles["alignItems"];
  if (typeof ai === "string") result.crossAxis = ALIGN_ITEMS_MAP[ai];

  // color (text)
  const color = styles["color"];
  if (typeof color === "string") result.color = colorFromToken(color, themeColors);

  // fontSize
  if (typeof styles["fontSize"] === "number") result.fontSize = styles["fontSize"] as number;

  // fontWeight
  const fw = styles["fontWeight"];
  if (typeof fw === "string") result.fontWeight = fw;

  return result;
}

// ── JSX prop 추출 유틸 ────────────────────────────────────────────────────────

/**
 * JSX 요소(element 또는 self_closing_element)에서 특정 prop의 값 노드를 찾는다.
 */
function getJsxPropNode(element: SyntaxNode, propName: string): SyntaxNode | undefined {
  const attrs = findNodes(element, "jsx_attribute");
  for (const attr of attrs) {
    const propId = attr.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (!propId || propId.text !== propName) continue;

    // = 이후의 값 노드
    const valueNode = attr.children.find(
      (c): c is SyntaxNode =>
        c !== null &&
        c.type !== "property_identifier" &&
        c.type !== "="
    );
    return valueNode;
  }
  return undefined;
}

/**
 * prop 값을 string으로 추출한다.
 * - string literal: "foo" → foo
 * - jsx_expression → 안의 string
 */
function getJsxPropString(element: SyntaxNode, propName: string): string | undefined {
  const valueNode = getJsxPropNode(element, propName);
  if (!valueNode) return undefined;

  if (valueNode.type === "string" || valueNode.type === "jsx_string") {
    return valueNode.text.replace(/^['"]|['"]$/g, "");
  }
  if (valueNode.type === "jsx_expression") {
    const inner = valueNode.children.find(
      (c): c is SyntaxNode => c !== null && c.type !== "{" && c.type !== "}"
    );
    if (inner?.type === "string") return inner.text.replace(/^['"]|['"]$/g, "");
    const strFrag = findNodes(valueNode, "string_fragment")[0];
    if (strFrag) return strFrag.text;
  }
  return undefined;
}

// ── 태그명 추출 ──────────────────────────────────────────────────────────────

function getTagName(element: SyntaxNode): string {
  // jsx_self_closing_element: 직접 자식에 identifier / member_expression
  // jsx_element: jsx_opening_element → identifier
  if (element.type === "jsx_self_closing_element") {
    const nameNode = element.children.find(
      (c): c is SyntaxNode => c !== null && (c.type === "identifier" || c.type === "member_expression")
    );
    return nameNode?.text ?? "";
  }
  if (element.type === "jsx_element") {
    const openTag = element.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "jsx_opening_element"
    );
    if (!openTag) return "";
    const nameNode = openTag.children.find(
      (c): c is SyntaxNode => c !== null && (c.type === "identifier" || c.type === "member_expression")
    );
    return nameNode?.text ?? "";
  }
  return "";
}

// ── JSX 자식 노드 추출 ────────────────────────────────────────────────────────

/**
 * jsx_element의 직접 자식 콘텐츠 노드(jsx_element, jsx_self_closing_element, jsx_expression)를 추출한다.
 */
function getJsxChildren(element: SyntaxNode): SyntaxNode[] {
  if (element.type === "jsx_self_closing_element") return [];

  const children: SyntaxNode[] = [];
  for (const child of element.children) {
    if (!child) continue;
    if (child.type === "jsx_opening_element" || child.type === "jsx_closing_element") continue;
    if (child.type === "jsx_element" || child.type === "jsx_self_closing_element" || child.type === "jsx_expression") {
      children.push(child);
    }
    // jsx_text는 콘텐츠가 있으면 Text 노드로 처리
    if (child.type === "jsx_text") {
      const trimmed = child.text.trim();
      if (trimmed) children.push(child);
    }
  }
  return children;
}

// ── style prop 해석 ───────────────────────────────────────────────────────────

function resolveElementStyle(
  element: SyntaxNode,
  ctx: MapContext
): ResolvedStyle {
  const styleProp = getJsxPropNode(element, "style");
  if (!styleProp) return {};

  const styleData = resolveStyleRef(styleProp, ctx.styleSheet);
  return extractIRStyle(styleData, ctx.themeColors);
}

// ── sourceRef 헬퍼 ────────────────────────────────────────────────────────────

function makeSourceRef(node: SyntaxNode, ctx?: MapContext): { file: string; line: number } {
  return { file: ctx?.currentFile ?? "unknown", line: node.startPosition.row + 1 };
}

// ── 공개 API: mapComponent ───────────────────────────────────────────────────

/**
 * JSX AST 노드를 IRNode로 변환한다.
 */
export async function mapComponent(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  if (!node) return null;

  // jsx_text → Text 노드
  if (node.type === "jsx_text") {
    const content = node.text.trim();
    if (!content) return null;
    return {
      type: "Text",
      text: { value: content },
      confidence: NODE_CONFIDENCE.standard,
      sourceRef: makeSourceRef(node, ctx),
    };
  }

  // jsx_expression 처리: {expression}
  if (node.type === "jsx_expression") {
    return mapJsxExpression(node, mock, ctx);
  }

  const tagName = getTagName(node);
  if (!tagName) return null;

  switch (tagName) {
    case "View": return mapView(node, mock, ctx);
    case "SafeAreaView": return mapSafeAreaView(node, mock, ctx);
    case "ScrollView": return mapScrollView(node, mock, ctx);
    case "FlatList": return mapFlatList(node, mock, ctx);
    case "SectionList": return mapFlatList(node, mock, ctx); // 동일하게 처리
    case "Text": return mapText(node, mock, ctx);
    case "Image": return mapImage(node, mock, ctx);
    case "TouchableOpacity": return mapButton(node, mock, ctx);
    case "TouchableHighlight": return mapButton(node, mock, ctx);
    case "Pressable": return mapButton(node, mock, ctx);
    case "Button": return mapRNButton(node, mock, ctx);
    case "TextInput": return mapInput(node, mock, ctx);
    case "ActivityIndicator": return mapActivityIndicator(node, mock, ctx);
    case "StatusBar": return null; // 무시
    case "Switch": return mapSwitch(node, mock, ctx);
    default:
      return mapCustomOrUnknown(tagName, node, mock, ctx);
  }
}

// ── jsx_expression 처리 ───────────────────────────────────────────────────────

async function mapJsxExpression(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  const inner = node.children.find(
    (c): c is SyntaxNode => c !== null && c.type !== "{" && c.type !== "}"
  );
  if (!inner) return null;

  // 조건부: ternary_expression (c ? A : B)
  if (inner.type === "ternary_expression") {
    return mapTernary(inner, mock, ctx);
  }

  // 조건부: logical_expression (c && A)
  if (inner.type === "binary_expression" || inner.type === "logical_expression") {
    return mapLogicalAnd(inner, mock, ctx);
  }

  // .map() 호출
  if (inner.type === "call_expression") {
    const callText = inner.text;
    if (callText.includes(".map(")) {
      return mapArrayMap(inner, mock, ctx);
    }
  }

  // 문자열 리터럴 → Text
  if (inner.type === "string" || inner.type === "template_string") {
    const strFrag = findNodes(inner, "string_fragment")[0];
    const value = strFrag?.text ?? inner.text.replace(/^['"`]|['"`]$/g, "");
    return {
      type: "Text",
      text: { value },
      confidence: NODE_CONFIDENCE.standard,
      sourceRef: makeSourceRef(node, ctx),
    };
  }

  // 단순 JSX 요소 참조
  if (inner.type === "jsx_element" || inner.type === "jsx_self_closing_element") {
    return mapComponent(inner, mock, ctx);
  }

  // call_expression이 JSX 반환: NOTICES.map(...) 처럼 함수 호출이 JSX 배열 반환
  if (inner.type === "call_expression") {
    return mapCallExpression(inner, mock, ctx);
  }

  return null;
}

// ── 삼항 연산자 ────────────────────────────────────────────────────────────────

async function mapTernary(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  // ternary: condition ? consequent : alternate
  const children = node.children.filter((c): c is SyntaxNode => c !== null);
  // true 분기: ? 다음 노드
  const qIdx = children.findIndex(c => c.type === "?");
  const colonIdx = children.findIndex(c => c.type === ":");

  if (qIdx < 0 || colonIdx < 0) return null;

  const trueBranchNode = children[qIdx + 1];
  const falseBranchNode = children[colonIdx + 1];

  const trueIR = trueBranchNode ? await mapComponent(trueBranchNode, mock, ctx) : null;
  const falseIR = falseBranchNode ? await mapComponent(falseBranchNode, mock, ctx) : null;

  const branchChildren: IRNode[] = [];
  if (trueIR) branchChildren.push({ ...trueIR, role: "branch-arm:true" });
  if (falseIR) branchChildren.push({ ...falseIR, role: "branch-arm:false" });

  if (branchChildren.length === 0) return null;
  if (branchChildren.length === 1) return branchChildren[0]!;

  ctx.diagnostics?.push({
    level: "info",
    code: "DYNAMIC_DATA_MOCKED",
    message: "삼항 조건 표현식 — Branch 노드로 래핑 (첫 분기 기본 표시)",
  });

  return {
    type: "Branch",
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: makeSourceRef(node, ctx),
    children: branchChildren,
  };
}

// ── 논리 AND (c && A) ─────────────────────────────────────────────────────────

/**
 * parenthesized_expression 래핑을 재귀적으로 벗긴다.
 * `(<FlatList .../>)` → jsx_element
 */
function unwrapParenthesized(node: SyntaxNode): SyntaxNode {
  if (node.type !== "parenthesized_expression") return node;
  const inner = node.children.find(
    (c): c is SyntaxNode => c !== null && c.type !== "(" && c.type !== ")"
  );
  return inner ? unwrapParenthesized(inner) : node;
}

async function mapLogicalAnd(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  // 오른쪽 피연산자만 채택
  const children = node.children.filter((c): c is SyntaxNode => c !== null);
  const ampIdx = children.findIndex(c => c.text === "&&");
  if (ampIdx < 0) {
    // || 연산자: 왼쪽 채택
    return null;
  }
  let rightNode = children[ampIdx + 1];
  if (!rightNode) return null;

  // parenthesized_expression 래핑 벗기기: `loadState === 'data' && (<FlatList .../>)`
  rightNode = unwrapParenthesized(rightNode);

  ctx.diagnostics?.push({
    level: "info",
    code: "DYNAMIC_DATA_MOCKED",
    message: "조건부 렌더링 (&&) — 오른쪽 분기 표시",
  });

  return mapComponent(rightNode, mock, ctx);
}

// ── .map() 반복 ───────────────────────────────────────────────────────────────

/**
 * array_expression의 모든 object 리터럴을 파싱하여 Record 배열로 반환한다.
 * SAMPLE_PRODUCTS 같은 상수 배열의 전체 요소를 추출하는 데 사용한다.
 */
function parseArrayAllObjects(
  root: SyntaxNode,
  arrayName: string
): Record<string, unknown>[] {
  const varDeclarators = findNodes(root, "variable_declarator");
  for (const decl of varDeclarators) {
    const nameId = findChild(decl, "identifier");
    if (nameId?.text !== arrayName) continue;

    const arrExpr = findNodes(decl, "array")[0];
    if (!arrExpr) continue;

    const objects = arrExpr.children.filter(
      (c): c is SyntaxNode => c !== null && c.type === "object"
    );
    if (objects.length === 0) continue;

    return objects.map(obj => parseStyleObject(obj) as Record<string, unknown>);
  }
  return [];
}

/**
 * arrow_function 또는 function_expression에서 첫 번째 파라미터 이름을 추출한다.
 * (item) => ..., ({item}) => ... 둘 다 지원.
 * tree-sitter TSX: 파라미터는 required_parameter / optional_parameter 또는 identifier로 래핑될 수 있음.
 */
function extractCallbackParamName(callback: SyntaxNode): string | null {
  const formalParams = findChild(callback, "formal_parameters");
  if (!formalParams) return null;

  for (const child of formalParams.children) {
    if (!child || child.type === "(" || child.type === ")" || child.type === ",") continue;

    // 단순 identifier: (item)
    if (child.type === "identifier") return child.text;

    // required_parameter / optional_parameter: { pattern: identifier | object_pattern }
    if (child.type === "required_parameter" || child.type === "optional_parameter") {
      // 첫 번째 자식이 identifier
      const innerIdent = child.children.find(
        (c): c is SyntaxNode => c !== null && c.type === "identifier"
      );
      if (innerIdent) return innerIdent.text;

      // 구조분해: ({ item })
      const innerObj = child.children.find(
        (c): c is SyntaxNode => c !== null && c.type === "object_pattern"
      );
      if (innerObj) {
        const firstProp = innerObj.children.find(
          (c): c is SyntaxNode =>
            c !== null && (c.type === "shorthand_property_identifier_pattern" || c.type === "identifier")
        );
        return firstProp?.text ?? null;
      }
    }

    // 객체 구조분해: ({ item }) 직접
    if (child.type === "object_pattern") {
      const firstProp = child.children.find(
        (c): c is SyntaxNode =>
          c !== null && (c.type === "shorthand_property_identifier_pattern" || c.type === "identifier")
      );
      return firstProp?.text ?? null;
    }
  }

  return null;
}

async function mapArrayMap(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  // ITEMS.map((item) => <View>...</View>)
  // call_expression → member_expression(.map) + arguments(callback)
  const args = findChild(node, "arguments");
  if (!args) return null;

  // callback: arrow_function 또는 function_expression
  const callback = args.children.find(
    (c): c is SyntaxNode => c !== null && (c.type === "arrow_function" || c.type === "function_expression")
  );
  if (!callback) return null;

  // 배열 소스 이름 추출: SAMPLE_PRODUCTS.map(...) → "SAMPLE_PRODUCTS"
  const memberExpr = node.children.find(
    (c): c is SyntaxNode => c !== null && c.type === "member_expression"
  );
  const arraySourceName = memberExpr
    ? memberExpr.children.find((c): c is SyntaxNode => c !== null && c.type === "identifier")?.text
    : null;

  // 콜백 파라미터명 추출: (product) => ... → "product"
  const paramName = extractCallbackParamName(callback);

  // callback body에서 JSX 반환 추출
  const returnNode = extractArrowReturn(callback);
  if (!returnNode) return null;

  // 파일 AST에서 배열 전체 요소를 파싱하여 각 반복마다 개별 bindings 적용
  let allElemBindings: Array<Record<string, unknown>> = [];
  if (arraySourceName && paramName && ctx.symbolTable) {
    const parsedFile = ctx.currentFile
      ? (ctx.symbolTable.files.get(ctx.currentFile) ??
         Array.from(ctx.symbolTable.fileByComponent.values()).find(
           f => f.filePath === ctx.currentFile
         ))
      : null;
    if (parsedFile) {
      const elems = parseArrayAllObjects(parsedFile.root, arraySourceName);
      if (elems.length > 0) {
        allElemBindings = elems.map(elem => ({ [paramName]: elem, ...ctx.argBindings }));
      }
    }
  }

  const count = mock?.listCount() ?? 3;

  // 각 아이템마다 해당 요소의 bindings로 개별 렌더링
  const items: IRNode[] = [];
  if (allElemBindings.length > 0) {
    // 실제 배열 요소 수와 count 중 min 사용, 부족하면 마지막 요소 반복
    for (let i = 0; i < count; i++) {
      const elemIdx = Math.min(i, allElemBindings.length - 1);
      const elemCtx: MapContext = { ...ctx, argBindings: allElemBindings[elemIdx] };
      const ir = await mapComponent(returnNode, mock, elemCtx);
      if (ir) items.push(ir);
    }
  } else {
    // 배열 소스를 찾지 못한 경우 mock ctx로 대표 아이템 1개를 복제
    const representative = await mapComponent(returnNode, mock, ctx);
    if (representative) {
      for (let i = 0; i < count; i++) items.push({ ...representative });
    }
  }

  if (items.length === 0) return null;

  ctx.diagnostics?.push({
    level: "info",
    code: "DYNAMIC_DATA_MOCKED",
    message: `.map() 반복 — ${count}개 아이템으로 렌더링 (소스 배열 ${allElemBindings.length > 0 ? "파싱됨" : "미확인"})`,
  });

  return {
    type: "List",
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: makeSourceRef(node, ctx),
    children: items,
  };
}

function extractArrowReturn(node: SyntaxNode): SyntaxNode | undefined {
  // arrow_function: params, =>, body
  const children = node.children.filter((c): c is SyntaxNode => c !== null);
  const arrowIdx = children.findIndex(c => c.type === "=>");
  if (arrowIdx >= 0 && arrowIdx + 1 < children.length) {
    const body = children[arrowIdx + 1];
    if (body) {
      // 직접 JSX
      if (body.type === "jsx_element" || body.type === "jsx_self_closing_element") return body;
      // 괄호 그룹
      if (body.type === "parenthesized_expression") {
        const inner = body.children.find(
          (c): c is SyntaxNode => c !== null && (c.type === "jsx_element" || c.type === "jsx_self_closing_element")
        );
        if (inner) return inner;
      }
      // statement_block: { return <JSX />; }
      if (body.type === "statement_block") {
        const retStmts = findNodes(body, "return_statement");
        if (retStmts.length > 0) {
          const ret = retStmts[0]!;
          for (const c of ret.children) {
            if (!c || c.type === "return" || c.type === ";") continue;
            return c;
          }
        }
      }
    }
  }
  // function_expression body
  const stmtBlock = findChild(node, "statement_block");
  if (stmtBlock) {
    const retStmts = findNodes(stmtBlock, "return_statement");
    if (retStmts.length > 0) {
      const ret = retStmts[0]!;
      for (const c of ret.children) {
        if (!c || c.type === "return" || c.type === ";") continue;
        return c;
      }
    }
  }
  return undefined;
}

// ── call_expression → JSX (함수 컴포넌트 호출) ───────────────────────────────

async function mapCallExpression(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  // 함수명 추출
  const funcNode = node.children.find(
    (c): c is SyntaxNode => c !== null && (c.type === "identifier" || c.type === "member_expression")
  );
  const funcName = funcNode?.type === "identifier" ? funcNode.text :
    funcNode?.type === "member_expression" ? funcNode.text.split(".").pop() ?? "" : "";

  // 대문자 시작 → 커스텀 컴포넌트
  if (/^[A-Z]/.test(funcName) && ctx.symbolTable && ctx.depth < ctx.maxDepth && !ctx.visited.has(funcName)) {
    const inlined = await tryInlineComponent(funcName, ctx.symbolTable, ctx.projectPath, {
      ...ctx,
      depth: ctx.depth + 1,
      visited: new Set([...ctx.visited, funcName]),
    });
    return inlined;
  }

  return null;
}

// ── View ──────────────────────────────────────────────────────────────────────

async function mapView(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  const style = resolveElementStyle(node, ctx);
  const children = await parseJsxChildren(node, mock, ctx);

  const irType = style.direction === "row" ? "Row" : "Column";

  return {
    type: irType,
    layout: {
      direction: style.direction ?? "column",
      mainAxis: style.mainAxis,
      crossAxis: style.crossAxis,
      flex: style.flex,
      width: style.width,
      height: style.height,
      padding: style.padding,
      margin: style.margin,
      gap: style.gap,
    },
    style: (style.background || style.borderRadius !== undefined)
      ? { background: style.background, borderRadius: style.borderRadius }
      : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── SafeAreaView → 자식 투과 ──────────────────────────────────────────────────

async function mapSafeAreaView(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  const style = resolveElementStyle(node, ctx);
  const children = await parseJsxChildren(node, mock, ctx);

  // SafeAreaView는 Box(Column)로 처리, 자식을 그대로 전달
  return {
    type: "Column",
    layout: {
      direction: "column",
      flex: style.flex ?? 1,
      width: "fill",
      height: "fill",
      padding: style.padding,
    },
    style: style.background ? { background: style.background } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── ScrollView ────────────────────────────────────────────────────────────────

async function mapScrollView(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  const children = await parseJsxChildren(node, mock, ctx);

  return {
    type: "Scroll",
    layout: { direction: "column", width: "fill", flex: 1 },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 0 ? children : undefined,
  };
}

// ── FlatList / SectionList ────────────────────────────────────────────────────

async function mapFlatList(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  // renderItem prop 파싱
  const renderItemProp = getJsxPropNode(node, "renderItem");
  const count = mock?.listCount() ?? 3;
  let listItems: IRNode[] = [];

  if (renderItemProp) {
    const itemIR = await extractRenderItemIR(renderItemProp, mock, ctx);
    if (itemIR) {
      listItems = Array.from({ length: count }, () => ({ ...itemIR }));
      ctx.diagnostics?.push({
        level: "info",
        code: "DYNAMIC_DATA_MOCKED",
        message: `FlatList renderItem — ${count}개 mock 반복`,
      });
    }
  }

  return {
    type: "Scroll",
    layout: { direction: "column", width: "fill", flex: 1 },
    confidence: NODE_CONFIDENCE.mocked,
    sourceRef: makeSourceRef(node, ctx),
    children: listItems.length > 0
      ? [{
          type: "List",
          confidence: NODE_CONFIDENCE.mocked,
          children: listItems,
        }]
      : undefined,
  };
}

async function extractRenderItemIR(
  renderItemNode: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  // jsx_expression 벗기기
  let node = renderItemNode;
  if (node.type === "jsx_expression") {
    const inner = node.children.find(
      (c): c is SyntaxNode => c !== null && c.type !== "{" && c.type !== "}"
    );
    if (inner) node = inner;
  }

  // identifier 참조 (renderItem={renderItem})
  if (node.type === "identifier") {
    const funcName = node.text;
    // 해당 함수 심볼 탐색
    if (ctx.symbolTable) {
      for (const [, parsedFile] of ctx.symbolTable.files) {
        const returnNode = findFunctionReturn(parsedFile.root, funcName);
        if (returnNode) {
          return mapComponent(returnNode, mock, {
            ...ctx,
            currentFile: parsedFile.filePath,
          });
        }
      }
    }
  }

  // arrow_function 또는 function_expression
  if (node.type === "arrow_function" || node.type === "function_expression") {
    const returnNode = extractArrowReturn(node);
    if (returnNode) return mapComponent(returnNode, mock, ctx);
  }

  return null;
}

function findFunctionReturn(root: SyntaxNode, funcName: string): SyntaxNode | undefined {
  // function_declaration 또는 variable_declarator(const func = ...)
  const funcDecls = findNodes(root, "function_declaration");
  for (const decl of funcDecls) {
    const nameId = findChild(decl, "identifier");
    if (nameId?.text !== funcName) continue;
    const body = findChild(decl, "statement_block");
    if (!body) continue;
    const retStmts = findNodes(body, "return_statement");
    if (retStmts.length === 0) continue;
    const ret = retStmts[0]!;
    for (const c of ret.children) {
      if (!c || c.type === "return" || c.type === ";") continue;
      return c;
    }
  }
  return undefined;
}

// ── Text ──────────────────────────────────────────────────────────────────────

async function mapText(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  const style = resolveElementStyle(node, ctx);
  const textContent = extractTextContent(node, mock, ctx);

  return {
    type: "Text",
    text: {
      value: textContent,
      color: style.color,
    },
    layout: style.margin ? { margin: style.margin } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

function extractTextContent(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): string {
  // jsx 자식에서 텍스트 추출
  const children = getJsxChildren(node);
  const parts: string[] = [];

  for (const child of children) {
    if (child.type === "jsx_text") {
      const trimmed = child.text.trim();
      if (trimmed) parts.push(trimmed);
    } else if (child.type === "jsx_expression") {
      // {item.title} 같은 동적 텍스트
      const inner = child.children.find(
        (c): c is SyntaxNode => c !== null && c.type !== "{" && c.type !== "}"
      );
      if (inner?.type === "string") {
        const frag = findNodes(inner, "string_fragment")[0];
        const raw = frag?.text ?? inner.text.replace(/^['"]|['"]$/g, "");
        // JS 이스케이프 시퀀스(\n, \t 등)를 실제 문자로 디코딩
        parts.push(decodeJsStringEscapes(raw));
      } else if (inner) {
        // 동적 값: argBindings에서 찾거나 mock
        const resolved = resolveExpressionToString(inner, ctx.argBindings);
        if (resolved !== null) {
          parts.push(resolved);
        } else {
          const mockText = mock?.text() ?? "";
          if (mockText) parts.push(mockText);
        }
      }
    }
  }

  return parts.join("") || (mock?.text() ?? "");
}

// ── Image ─────────────────────────────────────────────────────────────────────

async function mapImage(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  const src = extractImageSrc(node, mock);

  return {
    type: "Image",
    src,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

function extractImageSrc(node: SyntaxNode, mock: MockProvider | undefined): string {
  const sourceProp = getJsxPropNode(node, "source");
  if (!sourceProp) return mock?.imageUrl() ?? "network-placeholder";

  // jsx_expression 벗기기
  let sourceNode = sourceProp;
  if (sourceNode.type === "jsx_expression") {
    const inner = sourceNode.children.find(
      (c): c is SyntaxNode => c !== null && c.type !== "{" && c.type !== "}"
    );
    if (inner) sourceNode = inner;
  }

  // require(...) → asset://
  if (sourceNode.type === "call_expression") {
    const callText = sourceNode.text;
    if (callText.startsWith("require(")) {
      const strFrag = findNodes(sourceNode, "string_fragment")[0];
      const assetPath = strFrag?.text ?? "unknown";
      return `asset://${assetPath}`;
    }
  }

  // { uri: '...' } 객체
  if (sourceNode.type === "object") {
    const uriPair = findNodes(sourceNode, "pair").find(p => {
      const key = p.children.find(
        (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
      );
      return key?.text === "uri";
    });
    if (uriPair) {
      const valNode = uriPair.children.find(
        (c): c is SyntaxNode => c !== null && c.type === "string"
      );
      if (valNode) {
        const frag = findNodes(valNode, "string_fragment")[0];
        return frag?.text ? `network-placeholder` : "network-placeholder";
      }
    }
    return "network-placeholder";
  }

  return mock?.imageUrl() ?? "network-placeholder";
}

// ── Button (TouchableOpacity / Pressable) ───────────────────────────────────

async function mapButton(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  const style = resolveElementStyle(node, ctx);
  const children = await parseJsxChildren(node, mock, ctx);

  // 레이블 추출: 첫 번째 Text 자식의 텍스트
  const firstText = children.find(c => c.type === "Text");
  const label = firstText?.text?.value ?? mock?.text("button") ?? "Button";

  return {
    type: "Button",
    text: { value: label },
    layout: {
      padding: style.padding,
      margin: style.margin,
      width: style.width,
    },
    style: (style.background || style.borderRadius !== undefined)
      ? { background: style.background, borderRadius: style.borderRadius }
      : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
    children: children.length > 1 ? children : undefined,
  };
}

// ── RN Button 컴포넌트 (title prop) ──────────────────────────────────────────

async function mapRNButton(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  const title = getJsxPropString(node, "title") ?? mock?.text("button") ?? "Button";

  return {
    type: "Button",
    text: { value: title },
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── TextInput ─────────────────────────────────────────────────────────────────

async function mapInput(
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  const placeholder = getJsxPropString(node, "placeholder") ?? "";
  const style = resolveElementStyle(node, ctx);

  return {
    type: "Input",
    text: placeholder ? { value: placeholder } : undefined,
    layout: {
      width: style.width,
      padding: style.padding,
      margin: style.margin,
    },
    style: style.background ? { background: style.background, borderRadius: style.borderRadius } : undefined,
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── ActivityIndicator ─────────────────────────────────────────────────────────

async function mapActivityIndicator(
  node: SyntaxNode,
  _mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  return {
    type: "Icon",
    role: "spinner",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── Switch ────────────────────────────────────────────────────────────────────

async function mapSwitch(
  node: SyntaxNode,
  _mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode> {
  return {
    type: "Icon",
    role: "toggle",
    confidence: NODE_CONFIDENCE.standard,
    sourceRef: makeSourceRef(node, ctx),
  };
}

// ── 커스텀 / 알 수 없는 컴포넌트 ─────────────────────────────────────────────

async function mapCustomOrUnknown(
  tagName: string,
  node: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode | null> {
  // 소문자 시작 → 내장 HTML 태그 등 → null
  if (!tagName || !/^[A-Z]/.test(tagName)) return null;

  // 커스텀 컴포넌트 인라이닝
  if (ctx.symbolTable && ctx.depth < ctx.maxDepth && !ctx.visited.has(tagName)) {
    // call-site 인자 추출
    const callArgs = extractJsxProps(node, ctx.argBindings);
    const inlined = await tryInlineComponent(tagName, ctx.symbolTable, ctx.projectPath, {
      ...ctx,
      depth: ctx.depth + 1,
      visited: new Set([...ctx.visited, tagName]),
      argBindings: callArgs,
    });
    if (inlined) return inlined;
  }

  // Unknown
  ctx.diagnostics?.push({
    level: "warn",
    code: "UNRESOLVED_COMPONENT",
    message: `알 수 없는 컴포넌트 '${tagName}' — Unknown 노드로 처리됨`,
  });

  return {
    type: "Unknown",
    confidence: NODE_CONFIDENCE.unknown,
    sourceRef: makeSourceRef(node, ctx),
    role: `component:${tagName}`,
  };
}

// ── JSX props 리터럴 추출 (call-site 바인딩) ──────────────────────────────────

function extractJsxProps(
  node: SyntaxNode,
  currentBindings?: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const attrs = findNodes(node, "jsx_attribute");

  for (const attr of attrs) {
    const propId = attr.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
    );
    if (!propId) continue;

    const valueNode = attr.children.find(
      (c): c is SyntaxNode =>
        c !== null &&
        c.type !== "property_identifier" &&
        c.type !== "="
    );
    if (!valueNode) continue;

    const propName = propId.text;

    // string literal
    if (valueNode.type === "string" || valueNode.type === "jsx_string") {
      result[propName] = valueNode.text.replace(/^['"]|['"]$/g, "");
      continue;
    }

    // jsx_expression
    if (valueNode.type === "jsx_expression") {
      const inner = valueNode.children.find(
        (c): c is SyntaxNode => c !== null && c.type !== "{" && c.type !== "}"
      );
      if (!inner) continue;
      if (inner.type === "number") { result[propName] = parseFloat(inner.text); continue; }
      if (inner.type === "string") {
        const frag = findNodes(inner, "string_fragment")[0];
        result[propName] = frag?.text ?? inner.text.replace(/^['"]|['"]$/g, "");
        continue;
      }
      if (inner.type === "true") { result[propName] = true; continue; }
      if (inner.type === "false") { result[propName] = false; continue; }
      // identifier → 체인 바인딩
      if (inner.type === "identifier" && currentBindings) {
        const varName = inner.text;
        if (Object.prototype.hasOwnProperty.call(currentBindings, varName)) {
          result[propName] = currentBindings[varName];
          continue;
        }
      }
      // member_expression: product.price, product.name 등
      // currentBindings에서 객체를 찾아 property 값을 전달
      if (inner.type === "member_expression" && currentBindings) {
        const memberChildren = inner.children.filter((c): c is SyntaxNode => c !== null);
        const objNode = memberChildren[0];
        const propNode = memberChildren[memberChildren.length - 1];
        if (objNode && propNode && objNode.type !== ".") {
          const objName = objNode.text;
          const propKey = propNode.text;
          const boundObj = currentBindings[objName];
          if (boundObj && typeof boundObj === "object" && !Array.isArray(boundObj)) {
            const propValue = (boundObj as Record<string, unknown>)[propKey];
            if (propValue !== undefined) {
              result[propName] = propValue;
              continue;
            }
          }
        }
      }
    }
  }

  return result;
}

// ── JSX 자식들을 IR로 변환 ────────────────────────────────────────────────────

/**
 * jsx_expression 내부 노드가 logical_and (&&) 표현식인지 판별한다.
 */
function isLogicalAndExpression(child: SyntaxNode): boolean {
  if (child.type !== "jsx_expression") return false;
  const inner = child.children.find(
    (c): c is SyntaxNode => c !== null && c.type !== "{" && c.type !== "}"
  );
  return inner?.type === "binary_expression" || inner?.type === "logical_expression";
}

async function parseJsxChildren(
  element: SyntaxNode,
  mock: MockProvider | undefined,
  ctx: MapContext
): Promise<IRNode[]> {
  const children = getJsxChildren(element);
  const results: IRNode[] = [];

  let i = 0;
  while (i < children.length) {
    const child = children[i]!;

    // 형제 &&-표현식 그룹 감지: 현재 및 다음 노드가 &&이면 모아서 Branch로 묶음
    if (isLogicalAndExpression(child)) {
      const andGroup: SyntaxNode[] = [child];
      let j = i + 1;
      while (j < children.length && isLogicalAndExpression(children[j]!)) {
        andGroup.push(children[j]!);
        j++;
      }

      if (andGroup.length >= 2) {
        // 그룹 전체를 Branch로 묶음
        const arms: IRNode[] = [];
        for (const andNode of andGroup) {
          const ir = await mapComponent(andNode, mock, ctx);
          if (ir) {
            // 각 arm에서 Branch 래핑을 벗기고 실제 노드를 arm으로 사용
            const arm = ir.type === "Branch" ? (ir.children?.[0] ?? ir) : ir;
            arms.push({ ...arm, role: "branch-arm:true" });
          }
        }
        if (arms.length > 0) {
          ctx.diagnostics?.push({
            level: "info",
            code: "DYNAMIC_DATA_MOCKED",
            message: `형제 &&-조건 ${arms.length}개 — Branch 노드로 묶음 (첫 분기 기본 표시)`,
          });
          results.push({
            type: "Branch",
            confidence: NODE_CONFIDENCE.mocked,
            sourceRef: { file: ctx.currentFile ?? "unknown", line: child.startPosition.row + 1 },
            children: arms,
          });
        }
        i = j;
        continue;
      }
    }

    const ir = await mapComponent(child, mock, ctx);
    if (ir) results.push(ir);
    i++;
  }

  return results;
}
