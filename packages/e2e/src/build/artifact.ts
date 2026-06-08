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
  const absProjectPath = path.resolve(projectPath);
  const priorityPaths = [
    path.join(absProjectPath, appModule, "build", "outputs", "apk", "debug"),
    path.join(absProjectPath, "build", "outputs", "apk", "debug"),
  ];

  for (const dir of priorityPaths) {
    if (fs.existsSync(dir)) {
      const apk = findFirstApk(dir);
      if (apk) return apk;
    }
  }

  // fallback: 전체 build 재귀 탐색 (최신 mtime)
  const buildDir = path.join(absProjectPath, appModule, "build");
  if (fs.existsSync(buildDir)) {
    return findNewestByExtension(buildDir, ".apk");
  }

  return null;
}

/**
 * flutter/android APK 경로.
 *
 * 탐색 우선순위:
 * 1. build/app/outputs/flutter-apk/app-debug.apk (기본 경로 — 최우선)
 * 2. build/app/outputs/flutter-apk/*.apk (플레이버 빌드: app-dev-debug.apk 등)
 * 3. build/app/outputs 아래 최신 mtime APK (최종 fallback)
 */
export function findFlutterApk(projectPath: string): string | null {
  const absProjectPath = path.resolve(projectPath);
  const flutterApkDir = path.join(absProjectPath, "build", "app", "outputs", "flutter-apk");

  // 1. 기본 경로 우선
  const defaultApk = path.join(flutterApkDir, "app-debug.apk");
  if (fs.existsSync(defaultApk)) return defaultApk;

  // 2. flutter-apk 디렉토리 내 최신 mtime *.apk (플레이버 빌드 지원, 비결정론 방지)
  if (fs.existsSync(flutterApkDir)) {
    const apk = findNewestByExtension(flutterApkDir, ".apk");
    if (apk) return apk;
  }

  // 3. fallback: build/app/outputs 아래 최신 mtime APK
  return findNewestByExtension(path.join(absProjectPath, "build", "app", "outputs"), ".apk");
}

/**
 * flutter/ios .app 경로 — 최신 mtime 기준.
 */
export function findFlutterIosApp(projectPath: string): string | null {
  const dir = path.join(path.resolve(projectPath), "build", "ios", "iphonesimulator");
  if (!fs.existsSync(dir)) return null;
  return findNewestByExtension(dir, ".app");
}

/**
 * derivedData 산하 .app 경로 탐색 — 최신 mtime 기준.
 */
export function findDerivedDataApp(derivedDataPath: string): string | null {
  const buildDir = path.join(path.resolve(derivedDataPath), "Build", "Products");
  if (!fs.existsSync(buildDir)) return null;
  return findNewestByExtension(buildDir, ".app");
}

/**
 * iOS 네이티브 표준 빌드 출력 경로에서 .app을 탐색한다.
 * buildCommand 사용 시 derivedDataPath에 산출물이 없을 때 fallback으로 사용.
 *
 * 탐색 경로 (우선순위 순):
 * 1. build/ios/iphonesimulator (Flutter 표준 — FlutterIosBuilder와 공유 가능)
 * 2. ios/build/Build/Products (Xcode/RN iOS 표준 derivedData 위치)
 */
export function findIosStandardApp(projectPath: string): string | null {
  const absProjectPath = path.resolve(projectPath);
  const candidates = [
    path.join(absProjectPath, "build", "ios", "iphonesimulator"),
    path.join(absProjectPath, "ios", "build", "Build", "Products"),
  ];

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const app = findNewestByExtension(dir, ".app");
    if (app) return app;
  }

  return null;
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
 *
 * 설계 의도: .app도 .apk와 동일하게 최신 mtime 선택 (계획 §80: *.apk/*.app 모두
 * 최신 mtime 재귀 fallback). 이전의 첫 매칭 방식(findFirstApk)은 readdir 순서에
 * 의존해 비결정론적이었음 — 동일 디렉토리에 복수 빌드 결과물이 있을 때
 * 실행마다 다른 파일을 선택할 수 있었다.
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
