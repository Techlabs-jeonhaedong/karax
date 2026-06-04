import { execa } from "execa";

export interface EnsureChromiumResult {
  installed: boolean;
  alreadyPresent: boolean;
}

/**
 * Playwright Chromium 자동 설치.
 * - 이미 있으면: { installed: false, alreadyPresent: true }
 * - 없으면 npx playwright install chromium 실행 → { installed: true, alreadyPresent: false }
 * - 설치 실패 시 throw
 */
export async function ensureChromium(): Promise<EnsureChromiumResult> {
  const chromiumPath = await getChromiumPath();

  if (chromiumPath) {
    return { installed: false, alreadyPresent: true };
  }

  // 설치 시도
  await execa("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });

  return { installed: true, alreadyPresent: false };
}

/**
 * Playwright Node API를 사용해 Chromium 실행 파일 경로를 반환한다.
 * CLI(npx playwright chromium-path)에 의존하지 않으므로 CLI 미설치 환경에서도 정상 동작한다.
 *
 * 탐지 순서:
 * 1. Playwright Node API — doctor 컨텍스트에서 playwright 모듈이 해석되는 경우
 * 2. ms-playwright 캐시 직접 탐색 — pnpm 격리로 모듈 해석이 실패해도 캐시를 직접 읽음
 * 3. npx playwright chromium-path — CLI fallback
 */
export async function getChromiumPath(): Promise<string | null> {
  // 1. Playwright Node API 우선
  try {
    const { createRequire } = await import("module");
    const req = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw: any = req("playwright");
    const execPath: string | undefined = pw.chromium?.executablePath?.();
    if (execPath) {
      const { existsSync } = await import("fs");
      if (existsSync(execPath)) {
        return execPath;
      }
    }
  } catch {
    // playwright 모듈 로드 실패 — 다음 탐지 방법으로 이어짐
  }

  // 2. ms-playwright 캐시 직접 탐색
  // pnpm 엄격한 격리로 playwright 모듈이 doctor 컨텍스트에서 해석 안 될 때를 대비
  const chromiumPath = await findChromiumInCache();
  if (chromiumPath) {
    return chromiumPath;
  }

  // 3. CLI fallback
  try {
    const { stdout } = await execa("npx", ["playwright", "chromium-path"]);
    const p = stdout.trim();
    return p || null;
  } catch {
    return null;
  }
}

/**
 * ms-playwright 캐시 디렉토리에서 Chromium 실행 파일을 직접 탐색한다.
 * Playwright 모듈 로드 없이 파일시스템만으로 탐지 가능.
 */
async function findChromiumInCache(): Promise<string | null> {
  const { existsSync, readdirSync } = await import("fs");
  const { join } = await import("path");
  const { homedir } = await import("os");

  // Playwright의 표준 캐시 위치 (macOS/Linux)
  const cacheDirs = [
    join(homedir(), "Library", "Caches", "ms-playwright"), // macOS
    join(homedir(), ".cache", "ms-playwright"),            // Linux
    join(process.env.LOCALAPPDATA ?? "", "ms-playwright"), // Windows
  ];

  for (const cacheDir of cacheDirs) {
    if (!existsSync(cacheDir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(cacheDir);
    } catch {
      continue;
    }

    // chromium-NNNN 디렉토리만 대상 (chromium_headless_shell 제외)
    const chromiumDirs = entries
      .filter((e) => /^chromium-\d+$/.test(e))
      .sort()
      .reverse(); // 최신 버전 우선

    for (const dir of chromiumDirs) {
      // 플랫폼별 실행 파일 후보
      const candidates = [
        join(cacheDir, dir, "chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        join(cacheDir, dir, "chrome-mac-x64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
        join(cacheDir, dir, "chrome-linux", "chrome"),
        join(cacheDir, dir, "chrome-win", "chrome.exe"),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

/**
 * 대형 툴체인(flutter, xcode, android SDK)은 hint만 반환.
 * 에러를 throw하지 않아 Tier 2로 자동 degrade됨.
 */
export function getManualInstallHints(missingIds: string[]): string[] {
  const hints: Record<string, string> = {
    flutter:
      "Flutter SDK: https://docs.flutter.dev/get-started/install (또는 puro/fvm으로 자동 설치 가능)",
    dart: "Dart SDK는 Flutter에 포함됩니다: https://dart.dev/get-dart",
    java: "JDK >= 11: https://adoptium.net 또는 `brew install openjdk@17`",
    gradle: "Gradle: https://gradle.org/install 또는 `brew install gradle`",
    xcodebuild: "Xcode: App Store에서 설치. macOS 전용입니다.",
    cocoapods: "CocoaPods: `sudo gem install cocoapods` 또는 `brew install cocoapods`",
  };

  return missingIds
    .map((id) => hints[id])
    .filter((h): h is string => Boolean(h));
}
