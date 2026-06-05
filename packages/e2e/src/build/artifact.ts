/**
 * build/artifact.ts — 순수 함수: APK/.app 경로 해석 + appId/bundleId 추출
 */

import fs from "fs";
import path from "path";

// ── Android appId 추출 ──────────────────────────────────────────────────

/**
 * build.gradle / build.gradle.kts 내용에서 applicationId를 추출한다.
 */
export function extractAndroidAppId(buildGradleContent: string): string | null {
  // Groovy: applicationId "com.example.app" / applicationId 'com.example.app'
  // Kotlin DSL: applicationId = "com.example.app"
  const patterns = [
    /applicationId\s*=?\s*["']([^"']+)["']/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(buildGradleContent);
    if (match) return match[1]!;
  }

  return null;
}

// ── iOS bundleId 추출 ───────────────────────────────────────────────────

/**
 * Info.plist 내용에서 CFBundleIdentifier를 추출한다.
 */
export function extractIosBundleId(plistContent: string): string | null {
  // XML plist 형식: <key>CFBundleIdentifier</key>\n<string>...</string>
  const match = /CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plistContent);
  if (match) return match[1]!;

  return null;
}

// ── APK 탐색 ────────────────────────────────────────────────────────────

/**
 * 우선순위 경로를 순서대로 탐색, 없으면 재귀 fallback.
 */
export function findApk(projectPath: string, appModule: string = "app"): string | null {
  const priorityPaths = [
    path.join(projectPath, appModule, "build", "outputs", "apk", "debug"),
    path.join(projectPath, "build", "outputs", "apk", "debug"),
  ];

  for (const dir of priorityPaths) {
    if (fs.existsSync(dir)) {
      const apk = findFirstApk(dir);
      if (apk) return apk;
    }
  }

  // fallback: 전체 build 재귀 탐색 (최신 mtime)
  const buildDir = path.join(projectPath, appModule, "build");
  if (fs.existsSync(buildDir)) {
    return findNewestByExtension(buildDir, ".apk");
  }

  return null;
}

/**
 * flutter/android APK 경로.
 */
export function findFlutterApk(projectPath: string): string | null {
  const expected = path.join(
    projectPath,
    "build",
    "app",
    "outputs",
    "flutter-apk",
    "app-debug.apk"
  );
  if (fs.existsSync(expected)) return expected;

  // fallback: build/app/outputs 아래 최신 mtime APK
  return findNewestByExtension(path.join(projectPath, "build", "app", "outputs"), ".apk");
}

/**
 * flutter/ios .app 경로 — 최신 mtime 기준.
 */
export function findFlutterIosApp(projectPath: string): string | null {
  const dir = path.join(projectPath, "build", "ios", "iphonesimulator");
  if (!fs.existsSync(dir)) return null;
  return findNewestByExtension(dir, ".app");
}

/**
 * derivedData 산하 .app 경로 탐색 — 최신 mtime 기준.
 */
export function findDerivedDataApp(derivedDataPath: string): string | null {
  const buildDir = path.join(derivedDataPath, "Build", "Products");
  if (!fs.existsSync(buildDir)) return null;
  return findNewestByExtension(buildDir, ".app");
}

// ── 내부 유틸 ────────────────────────────────────────────────────────────

function findFirstApk(dir: string): string | null {
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith(".apk")) return path.join(dir, entry);
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 디렉토리를 재귀 탐색해 특정 확장자 파일/디렉토리 중 최신 mtime 항목을 반환한다.
 * .app은 디렉토리이므로 isDirectory 케이스도 처리한다.
 */
function findNewestByExtension(dir: string, ext: string): string | null {
  let newestPath: string | null = null;
  let newestMtime = 0;

  function recurse(d: string): void {
    try {
      for (const entry of fs.readdirSync(d)) {
        const full = path.join(d, entry);
        try {
          const stat = fs.statSync(full);
          if (entry.endsWith(ext) && stat.mtimeMs > newestMtime) {
            newestMtime = stat.mtimeMs;
            newestPath = full;
          } else if (stat.isDirectory() && !entry.endsWith(ext)) {
            recurse(full);
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  recurse(dir);
  return newestPath;
}
