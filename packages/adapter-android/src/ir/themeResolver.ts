/**
 * ThemeResolver — Android Compose 테마 파싱
 *
 * 지원:
 * - ui/theme/Theme.kt의 lightColorScheme(...) 파싱
 * - res/values/colors.xml 파싱
 * - 실패 시 Material3 기본 토큰 + THEME_DEFAULTED diagnostic
 */

import path from "path";
import type { ResourceMap } from "../parse/resources.js";
import { loadResources } from "../parse/resources.js";
import { collectKotlinFiles, parseKotlinFile } from "../parse/scanner.js";

// ── Material3 light 기본 토큰 ─────────────────────────────────────────────────

export const MATERIAL3_LIGHT_DEFAULTS: Record<string, string> = {
  primary: "#6750A4",
  onPrimary: "#FFFFFF",
  primaryContainer: "#EADDFF",
  onPrimaryContainer: "#21005D",
  secondary: "#625B71",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#E8DEF8",
  onSecondaryContainer: "#1D192B",
  tertiary: "#7D5260",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#FFD8E4",
  onTertiaryContainer: "#31111D",
  error: "#B3261E",
  onError: "#FFFFFF",
  errorContainer: "#F9DEDC",
  onErrorContainer: "#410E0B",
  surface: "#FFFBFE",
  onSurface: "#1C1B1F",
  surfaceVariant: "#E7E0EC",
  onSurfaceVariant: "#49454F",
  surfaceContainerHighest: "#E6E1E5",
  outline: "#79747E",
  outlineVariant: "#CAC4D0",
  background: "#FFFBFE",
  onBackground: "#1C1B1F",
  scrim: "#000000",
};

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface ThemeDiagnostic {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
}

export interface ThemeResult {
  colors: Record<string, string>;
  diagnostics: ThemeDiagnostic[];
}

// ── 색상 리터럴 파싱 ──────────────────────────────────────────────────────────

/**
 * Kotlin Color(0xFFRRGGBB) 또는 Color(0xRRGGBB) → #RRGGBB
 */
function parseKotlinColor(expr: string): string | undefined {
  // Color(0xFF6200EE) 또는 Color(0x6200EE)
  const hexMatch = /Color\(\s*0x([0-9A-Fa-f]{6,8})\s*\)/.exec(expr);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    return hex.length === 8 ? `#${hex.slice(2).toUpperCase()}` : `#${hex.toUpperCase()}`;
  }
  // 직접 #RRGGBB
  const directHex = /^#([0-9A-Fa-f]{6})$/.exec(expr.trim());
  if (directHex) return `#${directHex[1]!.toUpperCase()}`;

  return undefined;
}

/**
 * Kotlin Color 변수 참조 맵을 빌드한다.
 * private val BrandPrimary = Color(0xFF6200EE) 형태 파싱
 */
function buildColorVariableMap(source: string): Map<string, string> {
  const map = new Map<string, string>();
  // private val XXX = Color(0x...)
  const re = /(?:private\s+)?val\s+(\w+)\s*=\s*(Color\(0x[0-9A-Fa-f]+\))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const varName = m[1]!;
    const colorExpr = m[2]!;
    const hex = parseKotlinColor(colorExpr);
    if (hex) map.set(varName, hex);
  }
  return map;
}

/**
 * 소스에서 lightColorScheme( ... ) 블록 전체를 괄호 카운팅으로 추출한다.
 * 정규식은 중첩 괄호(Color(0xFF...))를 충분히 처리하지 못해 잘릴 수 있으므로
 * 문자 단위 카운팅 방식을 사용한다.
 */
function extractLightColorSchemeBlock(source: string): string | undefined {
  // "lightColorScheme" 키워드 위치 탐색
  const keyword = "lightColorScheme";
  let idx = source.indexOf(keyword);
  while (idx !== -1) {
    // 키워드 이후 공백을 건너뛰어 '(' 찾기
    let i = idx + keyword.length;
    while (i < source.length && /\s/.test(source[i]!)) i++;
    if (source[i] !== "(") {
      idx = source.indexOf(keyword, idx + 1);
      continue;
    }
    // 괄호 카운팅으로 전체 블록 추출
    let depth = 0;
    let start = i + 1; // '(' 다음부터
    let end = -1;
    for (let j = i; j < source.length; j++) {
      if (source[j] === "(") depth++;
      else if (source[j] === ")") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end !== -1) {
      return source.slice(start, end);
    }
    idx = source.indexOf(keyword, idx + 1);
  }
  return undefined;
}

/**
 * lightColorScheme(...) 블록에서 color scheme 파라미터를 파싱한다.
 * primary = BrandPrimary 또는 primary = Color(0xFF...) 형태
 * 부분 파싱 결과와 누락 토큰 목록을 함께 반환한다.
 */
function parseLightColorScheme(
  source: string,
  colorVarMap: Map<string, string>
): { colors: Record<string, string>; defaultedKeys: string[] } | undefined {
  const block = extractLightColorSchemeBlock(source);
  if (!block) return undefined;

  const colors: Record<string, string> = { ...MATERIAL3_LIGHT_DEFAULTS };
  const resolvedKeys = new Set<string>();

  // 각 파라미터 파싱: primary = BrandPrimary 또는 primary = Color(0xFF...)
  const paramRegex = /(\w+)\s*=\s*(Color\(0x[0-9A-Fa-f]+\)|[\w.]+)/g;
  let pm: RegExpExecArray | null;

  while ((pm = paramRegex.exec(block)) !== null) {
    const key = pm[1]!;
    const value = pm[2]!;

    // Color(0x...) 직접
    const directColor = parseKotlinColor(value);
    if (directColor) {
      colors[key] = directColor;
      resolvedKeys.add(key);
      continue;
    }

    // 변수 참조
    const varColor = colorVarMap.get(value);
    if (varColor) {
      colors[key] = varColor;
      resolvedKeys.add(key);
      continue;
    }
  }

  // 블록에서 명시적으로 지정됐지만 해석 실패한 키 = defaulted (기본값 유지)
  // 블록에서 아예 미언급된 키는 기본값 사용 (정상)
  // 여기서 defaultedKeys는 블록에서 명시됐으나 resolvedKeys에 없는 키들
  const mentionedKeys = new Set<string>();
  const mentionedRe = /(\w+)\s*=/g;
  let mm: RegExpExecArray | null;
  while ((mm = mentionedRe.exec(block)) !== null) {
    mentionedKeys.add(mm[1]!);
  }
  const defaultedKeys = [...mentionedKeys].filter((k) => !resolvedKeys.has(k));

  return { colors, defaultedKeys };
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * MaterialTheme.colorScheme.xxx → token:xxx 변환
 */
export function colorSchemeRefToToken(ref: string): string {
  const match = /MaterialTheme\.colorScheme\.(\w+)/.exec(ref);
  if (match) return `token:${match[1]}`;
  return ref;
}

/**
 * MaterialTheme.colorScheme.xxx 표현식에서 token:xxx를 추출한다.
 * colors 맵이 있으면 실제 색상값으로 해석한다.
 */
export function resolveColorRef(
  ref: string,
  colors: Record<string, string>
): string | undefined {
  // MaterialTheme.colorScheme.primary → #6200EE
  const tokenMatch = /MaterialTheme\.colorScheme\.(\w+)/.exec(ref);
  if (tokenMatch) {
    const key = tokenMatch[1]!;
    return colors[key] ? colors[key] : `token:${key}`;
  }

  // Color(0xFF...) 직접
  const directColor = parseKotlinColor(ref);
  if (directColor) return directColor;

  return undefined;
}

/**
 * 프로젝트의 Theme.kt를 파싱해 색상 토큰을 반환한다.
 */
export async function resolveTheme(projectPath: string): Promise<ThemeResult> {
  try {
    // Theme.kt 파일 찾기
    const kotlinFiles = await collectKotlinFiles(projectPath);
    const themeFile = kotlinFiles.find((f) => f.endsWith("Theme.kt"));

    if (!themeFile) {
      return {
        colors: { ...MATERIAL3_LIGHT_DEFAULTS },
        diagnostics: [
          {
            level: "warn",
            code: "THEME_DEFAULTED",
            message: "Theme.kt를 찾을 수 없어 Material3 기본 테마 토큰을 사용합니다",
          },
        ],
      };
    }

    const parsed = await parseKotlinFile(themeFile, projectPath);
    const source = parsed.source;
    // ParsedFile의 root(SyntaxNode)는 themeResolver에서 사용하지 않으므로 즉시 해제
    parsed.disposeTree();

    // 색상 변수 맵 빌드
    const colorVarMap = buildColorVariableMap(source);

    // colors.xml도 로드
    const resources = await loadResources(projectPath);
    for (const [name, hex] of resources.colors) {
      // camelCase 변환 (brand_primary → brandPrimary)
      const camel = name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      colorVarMap.set(camel, hex);
      colorVarMap.set(name, hex);
    }

    // lightColorScheme 파싱
    const result = parseLightColorScheme(source, colorVarMap);

    if (result) {
      const diagnostics: ThemeDiagnostic[] = [];
      // 명시된 키가 있지만 해석 실패한 경우 THEME_DEFAULTED 진단 추가
      if (result.defaultedKeys.length > 0) {
        diagnostics.push({
          level: "warn",
          code: "THEME_DEFAULTED",
          message: `lightColorScheme에서 일부 토큰(${result.defaultedKeys.join(", ")})을 해석하지 못해 Material3 기본값을 사용합니다`,
        });
      }
      return { colors: result.colors, diagnostics };
    }

    return {
      colors: { ...MATERIAL3_LIGHT_DEFAULTS },
      diagnostics: [
        {
          level: "info",
          code: "THEME_DEFAULTED",
          message:
            "Theme.kt에서 lightColorScheme를 파싱하지 못해 기본 테마를 사용합니다",
        },
      ],
    };
  } catch {
    return {
      colors: { ...MATERIAL3_LIGHT_DEFAULTS },
      diagnostics: [
        {
          level: "warn",
          code: "THEME_DEFAULTED",
          message: "테마 파싱 중 오류 발생, Material3 기본 토큰을 사용합니다",
        },
      ],
    };
  }
}
