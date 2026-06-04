// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface KotlinParam {
  name: string;
  type: string;
  isRequired: boolean;
}

// ── 생성자 파라미터 파싱 ────────────────────────────────────────────────────────

/**
 * Kotlin Composable 함수 소스에서 생성자 파라미터를 파싱한다.
 * tree-sitter 없이 동작하는 커스텀 파서.
 */
export function parseKotlinConstructorParams(
  screenName: string,
  source: string
): KotlinParam[] {
  // "@Composable\nfun <ScreenName>(" 위치를 찾는다
  const markerPattern = new RegExp(
    `@Composable[\\s\\S]*?fun\\s+${escapeRegex(screenName)}\\s*\\(`,
  );
  const markerMatch = markerPattern.exec(source);
  if (!markerMatch) return [];

  // markerMatch.index + 매치 길이 = 여는 괄호 다음 위치
  const start = markerMatch.index + markerMatch[0].length;

  // 괄호 깊이 추적으로 파라미터 블록 끝 위치 탐색
  const paramsBlock = extractBalancedParens(source, start);
  if (!paramsBlock) return [];

  const trimmed = paramsBlock.trim();
  if (!trimmed) return [];

  return parseParamsBlock(trimmed);
}

/**
 * 파라미터 블록 문자열을 파싱한다.
 * 예: "onClick: () -> Unit, title: String, modifier: Modifier = Modifier"
 */
function parseParamsBlock(block: string): KotlinParam[] {
  const params: KotlinParam[] = [];

  // 각 파라미터를 콤마로 분리 (단, 제네릭/람다 내부 콤마는 제외)
  const lines = splitParams(block);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // "name: Type = default" 또는 "name: Type"
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const name = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    // = 기호로 기본값 분리
    const eqIdx = findDefaultEquals(rest);
    const hasDefault = eqIdx !== -1;
    const type = hasDefault ? rest.slice(0, eqIdx).trim() : rest.trim();

    params.push({
      name,
      type,
      isRequired: !hasDefault,
    });
  }

  return params;
}

/**
 * 파라미터 블록을 최상위 콤마 기준으로 분리.
 * 각 파라미터가 "name: type" 형태로 줄바꿈 구분되어 있으므로
 * 줄바꿈 + 앞뒤 공백을 기준으로 먼저 분리하고 타입 내 괄호를 추적한다.
 *
 * 핵심 규칙: 콤마 뒤에 "공백+이름+:" 패턴이 이어지면 최상위 콤마로 판단.
 */
function splitParams(block: string): string[] {
  const result: string[] = [];
  // 줄 단위로 그룹핑하는 방식: 각 "name: type" 항목이 줄바꿈으로 시작
  // 더 안전한 방법: depth 기반으로 (), <>, {} 모두 추적하되 depth < 0 이면 클램핑
  let depth = 0;
  let start = 0;

  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (ch === "(" || ch === "<" || ch === "{") depth++;
    else if (ch === ")" || ch === ">" || ch === "}") {
      if (depth > 0) depth--;
      // depth 음수 방지 (파라미터 블록 내에서 최상위 괄호는 이미 소비됨)
    } else if (ch === "," && depth === 0) {
      result.push(block.slice(start, i));
      start = i + 1;
    }
  }
  result.push(block.slice(start));
  return result;
}

/**
 * 타입 문자열에서 기본값 = 위치를 찾는다.
 * 제네릭/람다/생성자 내부의 = 는 무시.
 */
function findDefaultEquals(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(" || ch === "<") depth++;
    else if (ch === ")" || ch === ">") depth--;
    else if (ch === "=" && depth === 0) return i;
  }
  return -1;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * source[start:] 에서 괄호 쌍이 맞는 내용을 추출한다.
 * start는 여는 괄호 바로 다음 위치 (이미 '(' 소비된 상태).
 */
function extractBalancedParens(source: string, start: number): string | null {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    i++;
  }
  if (depth !== 0) return null;
  return source.slice(start, i - 1);
}

// ── Mock 값 생성 ───────────────────────────────────────────────────────────────

// seed 기반 결정론적 의사 랜덤
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

const SAMPLE_STRINGS = [
  "Sample Title",
  "Hello World",
  "Lorem Ipsum",
  "Test Item",
  "Mock Data",
  "Example Text",
];

/**
 * KotlinParam 타입에 맞는 Kotlin 리터럴 코드 문자열을 반환한다.
 */
export function generateKotlinMockArg(param: KotlinParam, seed: number): string {
  const rand = seededRandom(seed + hashStr(param.name));
  return generateValue(param.type.trim(), rand);
}

function generateValue(type: string, rand: () => number): string {
  // 람다 타입: () -> X 또는 (A, B) -> X
  if (type.includes("->")) return "{}";

  // nullable 타입
  if (type.endsWith("?")) return "null";

  const base = type.replace(/<.*>/, "").trim();

  switch (base) {
    case "String":
      return `"${SAMPLE_STRINGS[Math.floor(rand() * SAMPLE_STRINGS.length)]}"`;
    case "Int":
    case "Long":
      return String(Math.floor(rand() * 100));
    case "Float":
    case "Double":
      return (rand() * 100).toFixed(1) + "f";
    case "Boolean":
      return rand() > 0.5 ? "true" : "false";
    case "Unit":
      return "Unit";
    case "Modifier":
      return "Modifier";
    case "Color":
      return "Color.Black";
    case "Dp":
      return `${Math.floor(rand() * 32)}.dp`;
    case "Sp":
      return `${Math.floor(rand() * 20)}.sp`;
    default:
      break;
  }

  // List/MutableList
  if (type.startsWith("List<") || type.startsWith("MutableList<")) {
    const inner = extractGenericArg(type);
    const items = Array.from({ length: 3 }, () => generateValue(inner, rand)).join(", ");
    return `listOf(${items})`;
  }

  // Map
  if (type.startsWith("Map<")) {
    return "mapOf()";
  }

  // 알 수 없는 타입 → TODO() 또는 {} 폴백
  // Composable 컨텍스트에서는 {} 람다를 넣어도 타입 에러가 날 수 있으므로 TODO()
  return "TODO()";
}

function extractGenericArg(type: string): string {
  const open = type.indexOf("<");
  const close = type.lastIndexOf(">");
  if (open === -1 || close === -1) return "String";
  return type.slice(open + 1, close).trim();
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
