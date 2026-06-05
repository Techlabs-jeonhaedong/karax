/**
 * build/detect.ts — 순수 함수: gradle 앱 모듈 탐지, xcodebuild 스킴 선택
 */

// ── Gradle 앱 모듈 탐지 ─────────────────────────────────────────────────

/**
 * settings.gradle / settings.gradle.kts 내용에서 앱 모듈명을 결정한다.
 * 우선순위: ':app' 포함 여부 → application 플러그인 힌트 → 첫 번째 include → 'app'
 */
export function detectGradleAppModule(
  settingsContent: string,
  buildGradleContent: string | null
): string {
  const modules = extractGradleIncludes(settingsContent);

  if (modules.length === 0) return "app";

  // ':app' 우선
  if (modules.includes("app")) return "app";

  // application 플러그인을 포함하는 힌트 있으면 첫 번째 모듈 (소비자가 보통 app 모듈)
  if (buildGradleContent?.includes("com.android.application")) {
    return modules[0]!;
  }

  return modules[0]!;
}

function extractGradleIncludes(content: string): string[] {
  const results: string[] = [];

  // Groovy: include ':app', ':lib'
  // Kotlin: include(":app")
  const patterns = [
    /include\s*['"]:([^'"]+)['"]/g,
    /include\(['"]:([\w-]+)['"]\)/g,
  ];

  const seen = new Set<string>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1]!;
      if (!seen.has(name)) {
        seen.add(name);
        results.push(name);
      }
    }
  }

  return results;
}

// ── xcodebuild -list -json 파싱 ─────────────────────────────────────────

export interface XcodebuildListResult {
  schemes: string[];
}

/**
 * `xcodebuild -list -json` 출력을 파싱한다.
 */
export function parseXcodebuildListJson(jsonStr: string): XcodebuildListResult {
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const container = (parsed["project"] ?? parsed["workspace"]) as
      | Record<string, unknown>
      | undefined;

    if (!container) return { schemes: [] };

    const schemes = container["schemes"];
    if (!Array.isArray(schemes)) return { schemes: [] };

    return { schemes: schemes.filter((s): s is string => typeof s === "string") };
  } catch {
    return { schemes: [] };
  }
}

// ── 스킴 선택 ────────────────────────────────────────────────────────────

const EXCLUDED_SUFFIXES = ["Tests", "UITests", "Widget", "Extension", "Watch", "Notification"];

/**
 * xcodebuild 스킴 목록에서 앱 본체 스킴을 선택한다.
 * Tests/Widget/Extension 접미사를 제외하고 첫 번째를 반환.
 */
export function selectXcodeScheme(schemes: string[]): string | null {
  if (schemes.length === 0) return null;

  const filtered = schemes.filter(
    (s) => !EXCLUDED_SUFFIXES.some((suffix) => s.endsWith(suffix))
  );

  return filtered[0] ?? schemes[0] ?? null;
}
