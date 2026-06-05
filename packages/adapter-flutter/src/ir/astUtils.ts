/**
 * Dart AST 유틸리티 — widgetMapper/themeResolver/inliner에서 공통으로 사용
 */

import type { SyntaxNode } from "@karax/adapter-api";

// ── 기본 탐색 ─────────────────────────────────────────────────────────────────

export function findFirstNode(node: SyntaxNode, type: string): SyntaxNode | undefined {
  if (node.type === type) return node;
  for (const child of node.children) {
    if (child) {
      const found = findFirstNode(child, type);
      if (found) return found;
    }
  }
  return undefined;
}

export function findAllNodes(node: SyntaxNode, type: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type) results.push(node);
  for (const child of node.children) {
    if (child) findAllNodes(child, type, results);
  }
  return results;
}

export function findChild(node: SyntaxNode, type: string): SyntaxNode | undefined {
  return node.children.find((c): c is SyntaxNode => c !== null && c.type === type) ?? undefined;
}

export function filterChildren(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.children.filter((c): c is SyntaxNode => c !== null && c.type === type);
}

export function findByText(node: SyntaxNode, type: string, text: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type && node.text === text) results.push(node);
  for (const child of node.children) {
    if (child) findByText(child, type, text, results);
  }
  return results;
}

// ── named_argument 파싱 ───────────────────────────────────────────────────────

/**
 * arguments 노드에서 named_argument의 값 노드를 이름으로 찾는다.
 * label 구조: label → identifier
 */
export function getNamedArg(argsNode: SyntaxNode, label: string): SyntaxNode | undefined {
  const namedArgs = findAllNodes(argsNode, "named_argument");
  for (const na of namedArgs) {
    // named_argument의 직접 자식만 보기 (중첩 named_argument 제외)
    const directNamedArgs = na.parent?.children.filter(
      (c): c is SyntaxNode => c !== null && c.type === "named_argument"
    );
    if (directNamedArgs && !directNamedArgs.includes(na)) continue;

    const labelNode = findChild(na, "label");
    const id = labelNode ? findChild(labelNode, "identifier") : undefined;
    if (id?.text === label) {
      // label 노드 이후 첫 번째 값 노드
      return na.children.find(
        (c): c is SyntaxNode => c !== null && c.type !== "label" && c.type !== ","
      ) ?? undefined;
    }
  }
  return undefined;
}

/**
 * arguments 노드에서 named_argument를 직접 자식 레벨에서만 탐색한다.
 * (중첩 named_argument를 잘못 잡지 않도록)
 */
export function getDirectNamedArg(argsNode: SyntaxNode, label: string): SyntaxNode | undefined {
  for (const child of argsNode.children) {
    if (!child || child.type !== "named_argument") continue;
    const labelNode = findChild(child, "label");
    const id = labelNode ? findChild(labelNode, "identifier") : undefined;
    if (id?.text === label) {
      return child.children.find(
        (c): c is SyntaxNode => c !== null && c.type !== "label" && c.type !== ","
      ) ?? undefined;
    }
  }
  return undefined;
}

// ── 문자열 리터럴 추출 ─────────────────────────────────────────────────────────

/**
 * string_literal 노드에서 순수 문자열 값을 추출한다.
 * 'foo' → foo, "bar" → bar
 * Dart 인접 문자열 연결 ('a' 'b'  → ab) 처리
 */
export function extractStringLiteral(node: SyntaxNode): string | undefined {
  if (node.type === "string_literal") {
    const raw = node.text;

    // Dart 인접 문자열 패턴: raw 텍스트 안에 '...' '...' 또는 "..." "..." 형태
    // 단순 단일 문자열 먼저 시도
    const singleQ = raw.match(/^'((?:[^'\\]|\\.)*)'$/s);
    if (singleQ) return singleQ[1];
    const doubleQ = raw.match(/^"((?:[^"\\]|\\.)*)"$/s);
    if (doubleQ) return doubleQ[1];

    // 인접 문자열 분해: 따옴표로 구분된 조각들을 추출
    // 패턴: 따옴표 타입 유지해서 반복 추출
    const adjacentParts: string[] = [];
    const adjacentRe = /'((?:[^'\\]|\\.)*?)'|"((?:[^"\\]|\\.)*?)"/gs;
    let m: RegExpExecArray | null;
    while ((m = adjacentRe.exec(raw)) !== null) {
      adjacentParts.push(m[1] ?? m[2] ?? "");
    }
    if (adjacentParts.length > 0) return adjacentParts.join("").trim();

    // fallback: raw에서 앞뒤 따옴표 제거
    return raw.replace(/^['"]|['"]$/g, "");
  }
  if (node.type === "string_literal_single_line" || node.type === "string_content") {
    const t = node.text;
    const m1 = t.match(/^'((?:[^'\\]|\\.)*)'$/s);
    if (m1) return m1[1];
    const m2 = t.match(/^"((?:[^"\\]|\\.)*)"$/s);
    if (m2) return m2[1];
    return t.replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

/**
 * 노드 또는 그 직계 자식에서 첫 번째 문자열 리터럴 값을 추출한다.
 */
export function getFirstStringValue(node: SyntaxNode): string | undefined {
  if (node.type === "string_literal") return extractStringLiteral(node);
  for (const child of node.children) {
    if (child && child.type === "string_literal") return extractStringLiteral(child);
  }
  // 더 깊이 탐색
  const strNode = findFirstNode(node, "string_literal");
  return strNode ? extractStringLiteral(strNode) : undefined;
}

// ── 숫자 리터럴 추출 ───────────────────────────────────────────────────────────

export function extractNumber(node: SyntaxNode): number | undefined {
  if (node.type === "decimal_integer_literal" || node.type === "integer_literal") {
    const n = parseInt(node.text, 10);
    return isNaN(n) ? undefined : n;
  }
  if (node.type === "decimal_floating_point_literal" || node.type === "real_literal") {
    const n = parseFloat(node.text);
    return isNaN(n) ? undefined : n;
  }
  if (node.type === "number_literal") {
    const n = parseFloat(node.text);
    return isNaN(n) ? undefined : n;
  }
  // unary minus: - number
  if (node.type === "unary_expression") {
    const op = node.children[0];
    const operand = node.children[1];
    if (op?.text === "-" && operand) {
      const n = extractNumber(operand);
      return n !== undefined ? -n : undefined;
    }
  }
  return undefined;
}

export function getFirstNumberValue(node: SyntaxNode): number | undefined {
  const n = extractNumber(node);
  if (n !== undefined) return n;
  for (const child of node.children) {
    if (child) {
      const found = getFirstNumberValue(child);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

// ── Color 파싱 ────────────────────────────────────────────────────────────────

/**
 * Color(0xFFRRGGBB) → #RRGGBB 형식으로 변환한다.
 */
export function parseColorNode(node: SyntaxNode): string | undefined {
  // const_object_expression: Color(0xFF...)
  const text = node.text;
  const hex8 = text.match(/Color\(0x([0-9A-Fa-f]{8})\)/);
  if (hex8) {
    const rgba = hex8[1];
    return `#${rgba.slice(2)}`; // skip alpha, take RRGGBB
  }
  const hex6 = text.match(/Color\(0x([0-9A-Fa-f]{6})\)/);
  if (hex6) {
    return `#${hex6[1]}`;
  }
  // Colors.white / Colors.black 등 명시적 색상 이름
  if (text === "Colors.white" || text === "Colors.white.withOpacity(1)") return "#FFFFFF";
  if (text === "Colors.black") return "#000000";
  if (text === "Colors.transparent") return "transparent";
  return undefined;
}

/**
 * 표현식 노드에서 색상 문자열을 추출한다.
 * Color(0xFF...) / Colors.xxx / colorScheme.primary 참조 처리
 */
export function extractColorFromExpr(node: SyntaxNode, themeTokens: Record<string, string>): string | undefined {
  const text = node.text;

  // colorScheme.xxx → token:xxx
  const schemeMatch = text.match(/colorScheme\.(\w+)/);
  if (schemeMatch) {
    return `token:${schemeMatch[1]}`;
  }

  // Theme.of(context).colorScheme.xxx → token:xxx
  const themeMatch = text.match(/Theme\.of\([^)]*\)\.colorScheme\.(\w+)/);
  if (themeMatch) {
    return `token:${themeMatch[1]}`;
  }

  // 직접 Color(0x...) 파싱
  const hex8 = text.match(/Color\(0x([0-9A-Fa-f]{8})\)/);
  if (hex8) {
    return `#${hex8[1].slice(2)}`;
  }

  // Colors.white/black
  if (text === "Colors.white") return "#FFFFFF";
  if (text === "Colors.black") return "#000000";
  if (text === "Colors.transparent") return "transparent";

  // 이미 token: 형식
  if (text.startsWith("token:")) return text;

  return undefined;
}

// ── EdgeInsets 파싱 ───────────────────────────────────────────────────────────

/**
 * EdgeInsets 노드를 [top, right, bottom, left] 배열로 변환한다.
 * named_argument 구조에서 value는 identifier("EdgeInsets") 단독이고
 * .all / (args) 는 형제 selector로 나뉜다. 따라서 parent.text 우선 사용.
 */
export function parseEdgeInsets(node: SyntaxNode): [number, number, number, number] | undefined {
  // named_argument 구조: label + identifier("EdgeInsets") + selector(".all") + selector("(16)")
  // node.text = "EdgeInsets", node.parent.text = "padding: EdgeInsets.all(16)"
  // 전체 표현식 text를 부모에서 재합성
  const text = (() => {
    if (node.type === "identifier" && node.parent) {
      // named_argument 의 value 부분만 (label 제외) 합산
      const siblings = node.parent.children.filter(c => c !== null && c.type !== "label" && c.type !== ",");
      if (siblings.length > 1) {
        return siblings.map(c => c!.text).join("");
      }
    }
    return node.text;
  })();

  // EdgeInsets.all(n)
  const allMatch = text.match(/EdgeInsets\.all\(([0-9.]+)\)/);
  if (allMatch) {
    const v = parseFloat(allMatch[1]);
    return [v, v, v, v];
  }

  // EdgeInsets.symmetric(horizontal: h, vertical: v) 또는 순서 반대
  const symMatch = text.match(/EdgeInsets\.symmetric\(([^)]+)\)/);
  if (symMatch) {
    const args = symMatch[1];
    const hMatch = args.match(/horizontal:\s*([0-9.]+)/);
    const vMatch = args.match(/vertical:\s*([0-9.]+)/);
    const h = hMatch ? parseFloat(hMatch[1]) : 0;
    const v = vMatch ? parseFloat(vMatch[1]) : 0;
    return [v, h, v, h];
  }

  // EdgeInsets.only(top: t, right: r, bottom: b, left: l)
  const onlyMatch = text.match(/EdgeInsets\.only\(([^)]+)\)/);
  if (onlyMatch) {
    const args = onlyMatch[1];
    const t = parseFloat(args.match(/top:\s*([0-9.]+)/)?.[1] ?? "0");
    const r = parseFloat(args.match(/right:\s*([0-9.]+)/)?.[1] ?? "0");
    const b = parseFloat(args.match(/bottom:\s*([0-9.]+)/)?.[1] ?? "0");
    const l = parseFloat(args.match(/left:\s*([0-9.]+)/)?.[1] ?? "0");
    return [t, r, b, l];
  }

  // EdgeInsets.fromLTRB(l, t, r, b)
  const ltrbMatch = text.match(/EdgeInsets\.fromLTRB\(([^)]+)\)/);
  if (ltrbMatch) {
    const parts = ltrbMatch[1].split(",").map(s => parseFloat(s.trim()));
    if (parts.length === 4) {
      const [l, t, r, b] = parts as [number, number, number, number];
      return [t, r, b, l];
    }
  }

  return undefined;
}

// ── BorderRadius 파싱 ─────────────────────────────────────────────────────────

export function parseBorderRadius(node: SyntaxNode): number | undefined {
  const text = node.text;
  const circMatch = text.match(/BorderRadius\.circular\(([0-9.]+)\)/);
  if (circMatch) return parseFloat(circMatch[1]);
  const allMatch = text.match(/BorderRadius\.all\(Radius\.circular\(([0-9.]+)\)\)/);
  if (allMatch) return parseFloat(allMatch[1]);
  return undefined;
}

// ── 식별자 이름 추출 ──────────────────────────────────────────────────────────

/**
 * 위젯 호출에서 클래스 이름을 추출한다.
 * 노드 타입: identifier, type_identifier, const_object_expression 등
 */
export function extractWidgetName(node: SyntaxNode): string | undefined {
  if (node.type === "identifier" || node.type === "type_identifier") {
    return node.text;
  }
  if (node.type === "const_object_expression") {
    const typeId = findChild(node, "type_identifier");
    return typeId?.text;
  }
  // method_invocation / function_invocation: 첫 identifier
  const id = findChild(node, "identifier");
  return id?.text;
}

// ── 위젯 호출 인수 노드 찾기 ──────────────────────────────────────────────────

/**
 * 위젯 생성자 호출에서 arguments 노드를 찾는다.
 * 여러 표현식 타입(const_object_expression, function_invocation 등)을 처리.
 */
export function getArguments(node: SyntaxNode): SyntaxNode | undefined {
  // const_object_expression → arguments가 직접 자식
  if (node.type === "const_object_expression") {
    return findChild(node, "arguments");
  }
  // identifier + selector 체인 → selector 내 argument_part → arguments
  if (node.type === "identifier") {
    const parent = node.parent;
    if (!parent) return undefined;
    // parent가 function_invocation이면 arguments가 형제
    const argsNode = findChild(parent, "arguments");
    return argsNode;
  }
  // 직접 arguments를 자식으로 가짐
  const direct = findChild(node, "arguments");
  if (direct) return direct;
  // selector 체인에서 arguments 찾기
  const selectors = filterChildren(node, "selector");
  for (const sel of selectors) {
    const ap = findChild(sel, "argument_part");
    if (ap) return findChild(ap, "arguments");
  }
  return undefined;
}
