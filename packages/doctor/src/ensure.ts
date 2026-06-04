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
  const path = await getChromiumPath();

  if (path) {
    return { installed: false, alreadyPresent: true };
  }

  // 설치 시도
  await execa("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });

  return { installed: true, alreadyPresent: false };
}

async function getChromiumPath(): Promise<string | null> {
  try {
    const { stdout } = await execa("npx", ["playwright", "chromium-path"]);
    const path = stdout.trim();
    return path || null;
  } catch {
    return null;
  }
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
