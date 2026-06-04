/**
 * Dart 생성자 파라미터 파싱 및 mock 값 코드 생성
 *
 * tree-sitter 의존 없이 정규식 기반으로 처리한다.
 * (compile-flutter 패키지는 @sfc/adapter-api 전체가 아닌 가벼운 파싱만 필요)
 */

// ── 타입 ───────────────────────────────────────────────────────────────────────

export interface ConstructorParam {
  name: string;
  type: string;
  isRequired: boolean;
  isNamed: boolean;
}

// ── 에러 클래스 ────────────────────────────────────────────────────────────────

export class HarnessError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(`[HarnessError:${code}] ${message}`);
    this.name = "HarnessError";
  }
}

// ── 주입 불가능 타입 목록 ────────────────────────────────────────────────────────

const UNINJECTABLE_TYPES = new Set([
  "Function",
  "VoidCallback",
  "Widget",
  "BuildContext",
  "Key",
  "GlobalKey",
  "State",
  "AnimationController",
  "Animation",
  "Listenable",
  "ChangeNotifier",
  "ValueNotifier",
  "Stream",
  "Future",
  "Completer",
  "NavigatorState",
  "ScrollController",
  "FocusNode",
  "TextEditingController",
]);

/** 타입이 주입 불가능한지 판단 */
function isUninjectable(type: string): boolean {
  // Function() 패턴
  if (type.includes("Function")) return true;
  // Callback 접미사
  if (type.endsWith("Callback")) return true;
  // 알려진 불가 타입
  const baseType = type.replace(/<.*>/, "").trim();
  if (UNINJECTABLE_TYPES.has(baseType)) return true;
  // Widget 서브클래스 접미사 패턴
  if (/Widget$/.test(baseType)) return true;
  return false;
}

// ── seeded pseudo-random ──────────────────────────────────────────────────────

/** 결정론적 난수 생성 (LCG, 0~1 범위) */
function seededRandom(seed: number, index: number): number {
  let s = (seed * 9301 + index * 49297 + 233420) % 233280;
  if (s < 0) s += 233280;
  return s / 233280;
}

// 샘플 문자열 목록
const SAMPLE_STRINGS = [
  "Hello",
  "World",
  "Flutter",
  "Sample",
  "Test",
  "Demo",
  "Example",
  "Mock",
  "Item",
  "Value",
  "Label",
  "Title",
  "Content",
  "Description",
  "Widget",
];

// ── mock 값 생성 ───────────────────────────────────────────────────────────────

/**
 * 주어진 타입과 파라미터 이름에 대해 Dart 리터럴 코드를 생성한다.
 * seed로 결정론적 결과를 보장한다.
 * 주입 불가능한 타입이면 HarnessError("UNINJECTABLE_PARAM")를 throw한다.
 */
export function generateMockValue(type: string, paramName: string, seed: number): string {
  const trimmedType = type.trim().replace(/\?$/, ""); // nullable 제거

  if (isUninjectable(trimmedType)) {
    throw new HarnessError(
      "UNINJECTABLE_PARAM",
      `파라미터 '${paramName}' 타입 '${type}'은 자동 주입 불가능합니다.`
    );
  }

  // 파라미터 이름 기반 인덱스로 결정론적 값 선택
  const nameHash = paramName.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const r = seededRandom(seed, nameHash);

  switch (trimmedType) {
    case "String": {
      const idx = Math.floor(r * SAMPLE_STRINGS.length);
      return `'${SAMPLE_STRINGS[idx]}'`;
    }

    case "int": {
      const val = Math.floor(r * 100) + 1; // 1~100
      return String(val);
    }

    case "double": {
      const val = Math.floor(r * 100) * 0.99 + 0.99; // 0.99~99.99
      return val.toFixed(2);
    }

    case "num": {
      const val = Math.floor(r * 100) + 1;
      return String(val);
    }

    case "bool": {
      return "false"; // 항상 false — 안전한 기본값
    }

    default: {
      // List<X> 형태
      if (trimmedType.startsWith("List<")) {
        const innerType = trimmedType.slice(5, -1).trim();
        if (!isUninjectable(innerType)) {
          try {
            const items = [0, 1, 2].map((i) => generateMockValue(innerType, `${paramName}_${i}`, seed + i));
            return `[${items.join(", ")}]`;
          } catch {
            // 아이템 생성 실패 시 빈 리스트
            return "[]";
          }
        }
        return "[]";
      }

      // Map<K, V> 형태
      if (trimmedType.startsWith("Map<")) {
        return "{}";
      }

      // 알 수 없는 타입은 주입 불가
      throw new HarnessError(
        "UNINJECTABLE_PARAM",
        `파라미터 '${paramName}' 타입 '${type}'에 대한 mock 생성 방법을 알 수 없습니다.`
      );
    }
  }
}

// ── 생성자 파라미터 파싱 (정규식 기반) ──────────────────────────────────────────

/**
 * Dart 소스에서 특정 클래스의 생성자 파라미터를 파싱한다.
 *
 * 지원 패턴:
 * - const MyClass({super.key, required this.title, this.badge})
 * - MyClass({required this.name, required this.price, String? label})
 */
export function parseConstructorParams(
  className: string,
  source: string
): ConstructorParam[] {
  // 클래스 생성자 찾기: ClassName({...}) 또는 const ClassName({...})
  // 중첩 괄호를 다루기 위해 소스에서 직접 추출
  const constructorPattern = new RegExp(
    `(?:const\\s+)?${className}\\s*\\(([^)]*(?:\\([^)]*\\)[^)]*)*)\\)`
  );

  const match = source.match(constructorPattern);
  if (!match || !match[1]) {
    // 두 번째 시도: 여러 줄 생성자
    return parseMultilineConstructor(className, source);
  }

  const paramBlock = match[1];
  return parseParamBlock(paramBlock, source);
}

/** 여러 줄 생성자 파싱 */
function parseMultilineConstructor(className: string, source: string): ConstructorParam[] {
  // 클래스 생성자 위치 찾기
  const classIdx = source.indexOf(`class ${className}`);
  if (classIdx === -1) return [];

  // 생성자 시작 찾기: ClassName(
  const ctorStart = source.indexOf(`${className}(`, classIdx);
  if (ctorStart === -1) {
    // const ClassName({
    const constCtorStart = source.indexOf(`const ${className}(`, classIdx);
    if (constCtorStart === -1) return [];
    return extractFromPosition(source, source.indexOf("(", constCtorStart));
  }

  const openParen = source.indexOf("(", ctorStart);
  return extractFromPosition(source, openParen);
}

/** 괄호 위치에서 파라미터 블록 추출 */
function extractFromPosition(source: string, openParen: number): ConstructorParam[] {
  if (openParen === -1) return [];

  let depth = 0;
  let i = openParen;
  let closeParen = -1;

  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }

  if (closeParen === -1) return [];

  const paramBlock = source.slice(openParen + 1, closeParen);
  return parseParamBlock(paramBlock, source);
}

/** 파라미터 블록 문자열을 ConstructorParam 배열로 변환 */
function parseParamBlock(block: string, fullSource: string): ConstructorParam[] {
  // 중괄호 처리: named parameters block
  const namedMatch = block.match(/\{([^}]*)\}/s);
  const namedBlock = namedMatch ? namedMatch[1] : "";
  const positionalBlock = namedMatch ? block.slice(0, block.indexOf("{")) : block;

  const params: ConstructorParam[] = [];

  // positional 파라미터 파싱
  if (positionalBlock.trim()) {
    const posParams = splitParams(positionalBlock.trim());
    for (const p of posParams) {
      const parsed = parseParam(p.trim(), false, fullSource);
      if (parsed) params.push(parsed);
    }
  }

  // named 파라미터 파싱
  if (namedBlock.trim()) {
    const namedParams = splitParams(namedBlock.trim());
    for (const p of namedParams) {
      const parsed = parseParam(p.trim(), true, fullSource);
      if (parsed) params.push(parsed);
    }
  }

  return params;
}

/** 쉼표로 분리 (제네릭 타입 내 쉼표는 무시) */
function splitParams(block: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of block) {
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** 단일 파라미터 문자열 파싱 */
function parseParam(
  param: string,
  isNamed: boolean,
  fullSource: string
): ConstructorParam | null {
  if (!param || param === "") return null;

  // super.key, Key? key, {Key? key} — 건너뜀
  if (/^(?:super\.key|Key\??\s+key)$/.test(param.trim())) return null;

  // required 여부
  const isRequired = /^required\s/.test(param);
  const paramNoRequired = isRequired ? param.slice("required".length).trim() : param;

  // this.xxx 패턴: 타입은 필드 선언에서 추론
  const thisMatch = paramNoRequired.match(/^this\.(\w+)$/);
  if (thisMatch) {
    const name = thisMatch[1];
    // 필드 선언에서 타입 추론
    const type = inferTypeFromField(name, fullSource);
    return { name, type, isRequired, isNamed };
  }

  // 명시적 타입: Type name 또는 Type? name
  const typedMatch = paramNoRequired.match(/^([\w<>,\s?]+?)\s+(\w+)$/);
  if (typedMatch) {
    const type = typedMatch[1].trim();
    const name = typedMatch[2].trim();
    if (name === "key") return null;
    return { name, type, isRequired, isNamed };
  }

  // 이름만 있는 경우 (타입 추론 필요)
  const nameOnlyMatch = paramNoRequired.match(/^(\w+)$/);
  if (nameOnlyMatch) {
    const name = nameOnlyMatch[1];
    if (name === "key") return null;
    return { name, type: "dynamic", isRequired, isNamed };
  }

  return null;
}

/** 클래스 필드 선언에서 타입 추론 */
function inferTypeFromField(fieldName: string, source: string): string {
  // final Type? fieldName; 또는 final Type fieldName;
  const fieldPattern = new RegExp(
    `final\\s+(\\w(?:[\\w<>,\\s?]*?)?)\\??\\s+${fieldName}\\s*;`
  );
  const match = source.match(fieldPattern);
  if (match && match[1]) {
    return match[1].trim();
  }
  return "String"; // 추론 실패 시 기본값
}
