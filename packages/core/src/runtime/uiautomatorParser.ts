/**
 * uiautomatorParser.ts
 *
 * uiautomator dump XML → RuntimeUITree (순수 함수, I/O 없음)
 * - 외부 의존 0 (정규식 + 스택 토크나이저)
 * - 4MB 초과 입력은 빈 트리 반환 (방어)
 * - 깨진 XML은 throw 없이 graceful 처리
 */

export interface RuntimeBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RuntimeNode {
  text: string;
  resourceId: string;
  contentDesc: string;
  className: string;
  clickable: boolean;
  enabled: boolean;
  bounds: RuntimeBounds;
  children: RuntimeNode[];
}

export interface RuntimeUITree {
  root: RuntimeNode | null;
  deviceWidth: number;
  deviceHeight: number;
}

// ─────────────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────────────

const MAX_BYTES = 4 * 1024 * 1024; // 4MB

const BOUNDS_RE = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/;

// XML 엔티티 테이블
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

// ─────────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s.replace(/&([^;]+);/g, (match: string, name: string) => {
    if (name in ENTITIES) return ENTITIES[name];
    // 숫자 엔티티 — NaN이면 원문 그대로 반환 (NUL 변질 방지)
    if (name.startsWith("#x")) {
      const code = parseInt(name.slice(2), 16);
      return Number.isNaN(code) ? match : String.fromCharCode(code);
    }
    if (name.startsWith("#")) {
      const code = parseInt(name.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCharCode(code);
    }
    return match;
  });
}

function parseBounds(raw: string): RuntimeBounds {
  const m = BOUNDS_RE.exec(raw);
  if (!m) return { x1: 0, y1: 0, x2: 0, y2: 0 };
  return {
    x1: parseInt(m[1], 10),
    y1: parseInt(m[2], 10),
    x2: parseInt(m[3], 10),
    y2: parseInt(m[4], 10),
  };
}

/** XML 속성 파싱: attr="value" 형태를 추출 */
function parseAttr(tag: string, attr: string): string {
  // 속성명 뒤 ="..." 또는 ='...' 형태 지원
  const re = new RegExp(`\\s${attr}=(?:"([^"]*)"|'([^']*)')`);
  const m = re.exec(tag);
  if (!m) return "";
  return decodeEntities(m[1] !== undefined ? m[1] : m[2] ?? "");
}

function buildNode(tag: string): RuntimeNode {
  const boundsRaw = parseAttr(tag, "bounds");
  return {
    text: parseAttr(tag, "text"),
    resourceId: parseAttr(tag, "resource-id"),
    contentDesc: parseAttr(tag, "content-desc"),
    className: parseAttr(tag, "class"),
    clickable: parseAttr(tag, "clickable") === "true",
    enabled: parseAttr(tag, "enabled") !== "false",
    bounds: parseBounds(boundsRaw),
    children: [],
  };
}

// ─────────────────────────────────────────────────────────────────
// 토크나이저 — 정규식 기반 스택 파서
// ─────────────────────────────────────────────────────────────────

/**
 * XML 토큰 분류:
 *   open   — <node ...>
 *   self   — <node ... />
 *   close  — </node>
 *   other  — 그 외 (hierarchy, ?xml 등)
 */
type TokenKind = "open" | "self" | "close" | "other";
interface Token { kind: TokenKind; raw: string; }

// <...> 토큰 추출 (내부 > 고려해서 간단히 greedy 회피)
const TAG_RE = /<[^>]+>/g;

function classify(raw: string): TokenKind {
  if (raw.endsWith("/>")) return "self";
  if (raw.startsWith("</")) return "close";
  const name = raw.slice(1).match(/^[\w:-]+/)?.[0] ?? "";
  if (name === "node") return "open";
  return "other";
}

function tokenize(xml: string): Token[] {
  const tokens: Token[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(xml)) !== null) {
    tokens.push({ kind: classify(m[0]), raw: m[0] });
  }
  return tokens;
}

// ─────────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────────

export function parseUiautomatorXml(xml: string): RuntimeUITree {
  const empty: RuntimeUITree = { root: null, deviceWidth: 0, deviceHeight: 0 };

  // 4MB 상한
  if (xml.length > MAX_BYTES) return empty;

  // 기본 입력 방어
  if (!xml || !xml.includes("<")) return empty;

  try {
    const tokens = tokenize(xml);
    const stack: RuntimeNode[] = [];
    let root: RuntimeNode | null = null;

    for (const tok of tokens) {
      if (tok.kind === "self") {
        const node = buildNode(tok.raw);
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(node);
        } else if (root === null) {
          root = node;
        }
      } else if (tok.kind === "open") {
        const node = buildNode(tok.raw);
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(node);
        }
        stack.push(node);
      } else if (tok.kind === "close") {
        if (stack.length > 0) {
          const closed = stack.pop()!;
          if (stack.length === 0) {
            // 최상위 node 팝 → root로 설정
            if (root === null) root = closed;
          }
        }
      }
    }

    // 스택에 아직 남은 노드 처리 (깨진 XML graceful)
    while (stack.length > 1) {
      const orphan = stack.pop()!;
      stack[stack.length - 1].children.push(orphan);
    }
    if (stack.length === 1 && root === null) {
      root = stack[0];
    }

    if (root === null) return empty;

    const dw = root.bounds.x2;
    const dh = root.bounds.y2;

    return { root, deviceWidth: dw, deviceHeight: dh };
  } catch {
    return empty;
  }
}

/**
 * flattenInteractive
 *
 * DFS 순서로 트리를 순회하며 "인터랙티브" 노드를 평탄화한다.
 * 조건: clickable=true OR text 비어있지 않음 OR contentDesc 비어있지 않음
 */
export function flattenInteractive(tree: RuntimeUITree): RuntimeNode[] {
  if (tree.root === null) return [];

  const result: RuntimeNode[] = [];

  function dfs(node: RuntimeNode): void {
    if (node.clickable || node.text !== "" || node.contentDesc !== "") {
      result.push(node);
    }
    for (const child of node.children) {
      dfs(child);
    }
  }

  dfs(tree.root);
  return result;
}
