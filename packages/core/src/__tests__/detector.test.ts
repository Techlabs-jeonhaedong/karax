import { describe, expect, it, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectFramework } from "../detect/detector.js";
import type { DetectResult } from "../detect/detector.js";

// ── 유틸 ───────────────────────────────────────────────────────────

/**
 * 임시 디렉토리를 만들고 파일 구조를 생성한다.
 * paths는 { 'path/to/file': 'content' } 형태.
 */
function makeTmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  return dir;
}

const tmpDirs: string[] = [];

function makeTmpTracked(files: Record<string, string>): string {
  const dir = makeTmp(files);
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── fixtures 경로 ──────────────────────────────────────────────────

const FIXTURES_ROOT = new URL("../../../../fixtures", import.meta.url)
  .pathname;

// ── 타입 단언 헬퍼 ────────────────────────────────────────────────

function topFramework(result: DetectResult) {
  return result.frameworks[0];
}

// ═══════════════════════════════════════════════════════════════════
// 1. 테이블 테스트: 4개 fixture → 기대 프레임워크
// ═══════════════════════════════════════════════════════════════════

describe("detectFramework — 4개 fixture 테이블 테스트", () => {
  it("flutter-basic: 최상위 후보가 flutter, confidence >= 0.9", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "flutter-basic")
    );
    const top = topFramework(result);
    expect(top.id).toBe("flutter");
    expect(top.confidence).toBeGreaterThanOrEqual(0.9);
    expect(top.evidence.length).toBeGreaterThan(0);
  });

  it("flutter-basic: evidence에 pubspec.yaml 포함", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "flutter-basic")
    );
    const top = topFramework(result);
    expect(top.evidence.some((e) => e.includes("pubspec.yaml"))).toBe(true);
  });

  it("react-native-basic: 최상위 후보가 react-native, confidence >= 0.9", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "react-native-basic")
    );
    const top = topFramework(result);
    expect(top.id).toBe("react-native");
    expect(top.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("react-native-basic: evidence에 package.json 포함", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "react-native-basic")
    );
    const top = topFramework(result);
    expect(top.evidence.some((e) => e.includes("package.json"))).toBe(true);
  });

  it("ios-swiftui-basic: 최상위 후보가 ios, confidence >= 0.9", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "ios-swiftui-basic")
    );
    const top = topFramework(result);
    expect(top.id).toBe("ios");
    expect(top.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("ios-swiftui-basic: evidence에 .xcodeproj 포함", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "ios-swiftui-basic")
    );
    const top = topFramework(result);
    expect(top.evidence.some((e) => e.includes(".xcodeproj"))).toBe(true);
  });

  it("android-compose-basic: 최상위 후보가 android, confidence >= 0.9", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "android-compose-basic")
    );
    const top = topFramework(result);
    expect(top.id).toBe("android");
    expect(top.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("android-compose-basic: evidence에 settings.gradle 또는 AndroidManifest.xml 포함", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "android-compose-basic")
    );
    const top = topFramework(result);
    expect(
      top.evidence.some(
        (e) => e.includes("settings.gradle") || e.includes("AndroidManifest.xml")
      )
    ).toBe(true);
  });

  it("frameworks 배열이 confidence 내림차순으로 정렬됨", async () => {
    for (const fixture of [
      "flutter-basic",
      "react-native-basic",
      "ios-swiftui-basic",
      "android-compose-basic",
    ]) {
      const result = await detectFramework(
        path.join(FIXTURES_ROOT, fixture)
      );
      for (let i = 0; i < result.frameworks.length - 1; i++) {
        expect(result.frameworks[i].confidence).toBeGreaterThanOrEqual(
          result.frameworks[i + 1].confidence
        );
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. 합성 혼합 케이스
// ═══════════════════════════════════════════════════════════════════

describe("detectFramework — 합성 혼합 케이스", () => {
  // (a) Flutter 루트 + ios/ + android/ 서브디렉토리
  it("(a) flutter 루트 + ios/ + android/ 내장: 최상위는 flutter, ios/android는 낮은 confidence(<0.3)이거나 없음", async () => {
    const dir = makeTmpTracked({
      "pubspec.yaml":
        "name: my_flutter_app\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n  flutter: '>=3.10.0'\n",
      "lib/main.dart": "void main() {}",
      "ios/Runner.xcodeproj/project.pbxproj": "// pbxproj",
      "ios/Runner/AppDelegate.swift": "import UIKit",
      "android/app/src/main/AndroidManifest.xml":
        '<manifest package="com.example" />',
      "android/settings.gradle": "rootProject.name = 'android'",
    });

    const result = await detectFramework(dir);
    const top = topFramework(result);
    expect(top.id).toBe("flutter");
    expect(top.confidence).toBeGreaterThanOrEqual(0.9);

    // ios/android 후보가 있다면 confidence < 0.3 이거나 evidence에 "embedded" 포함
    const embedded = result.frameworks.filter(
      (f) => f.id === "ios" || f.id === "android"
    );
    for (const f of embedded) {
      const isLowConfidence = f.confidence < 0.3;
      const isEmbedded = f.evidence.some((e) => e.includes("embedded"));
      expect(isLowConfidence || isEmbedded).toBe(true);
    }
  });

  // (b) 시그니처 전무 — 후보 0개
  it("(b) 빈 프로젝트: frameworks 배열이 비어 있음", async () => {
    const dir = makeTmpTracked({
      "README.md": "# Empty project",
      "src/index.ts": "// placeholder",
    });

    const result = await detectFramework(dir);
    expect(result.frameworks).toHaveLength(0);
  });

  // (c) 모노레포: apps/mobile-flutter + apps/mobile-rn 동시 (depth <= 3)
  it("(c) 모노레포: apps/mobile-flutter + apps/mobile-rn 동시에 발견", async () => {
    const dir = makeTmpTracked({
      "package.json": '{"name":"monorepo","workspaces":["apps/*"]}',
      "apps/mobile-flutter/pubspec.yaml":
        "name: mobile_flutter\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n  flutter: '>=3.10.0'\n",
      "apps/mobile-flutter/lib/main.dart": "void main() {}",
      "apps/mobile-rn/package.json":
        '{"name":"mobile-rn","dependencies":{"react-native":"0.73.0","react":"18.2.0"}}',
      "apps/mobile-rn/index.js": "// entry",
    });

    const result = await detectFramework(dir);
    const ids = result.frameworks.map((f) => f.id);
    expect(ids).toContain("flutter");
    expect(ids).toContain("react-native");
  });

  // (c) 모노레포 depth 제한: depth > 3이면 발견 안 됨
  it("(c) depth > 3인 프로젝트는 발견하지 않음", async () => {
    const dir = makeTmpTracked({
      "a/b/c/d/pubspec.yaml":
        "name: deep_flutter\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
      "a/b/c/d/lib/main.dart": "void main() {}",
    });

    const result = await detectFramework(dir);
    const flutterFramework = result.frameworks.find((f) => f.id === "flutter");
    // depth=4 이므로 발견되지 않아야 함
    expect(flutterFramework).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. 반환 타입 계약
// ═══════════════════════════════════════════════════════════════════

describe("detectFramework — 반환 타입 계약", () => {
  it("DetectResult는 frameworks 배열을 가짐", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "flutter-basic")
    );
    expect(Array.isArray(result.frameworks)).toBe(true);
  });

  it("각 후보는 id, confidence, evidence를 가짐", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "flutter-basic")
    );
    for (const f of result.frameworks) {
      expect(typeof f.id).toBe("string");
      expect(typeof f.confidence).toBe("number");
      expect(Array.isArray(f.evidence)).toBe(true);
    }
  });

  it("confidence는 0~1 범위", async () => {
    const result = await detectFramework(
      path.join(FIXTURES_ROOT, "flutter-basic")
    );
    for (const f of result.frameworks) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("존재하지 않는 경로: frameworks 배열이 비어 있음 (에러 throw 금지)", async () => {
    const result = await detectFramework("/nonexistent/path/to/project");
    expect(Array.isArray(result.frameworks)).toBe(true);
    expect(result.frameworks).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. 엣지 케이스
// ═══════════════════════════════════════════════════════════════════

describe("detectFramework — 엣지 케이스", () => {
  it("package.json에 react-native 없으면 react-native 후보 없음", async () => {
    const dir = makeTmpTracked({
      "package.json":
        '{"name":"plain-node","dependencies":{"express":"4.0.0"}}',
    });
    const result = await detectFramework(dir);
    const rn = result.frameworks.find((f) => f.id === "react-native");
    expect(rn).toBeUndefined();
  });

  it("package.json에 react-native가 있으면 react-native 후보 생성", async () => {
    const dir = makeTmpTracked({
      "package.json":
        '{"name":"rn-app","dependencies":{"react-native":"0.73.0","react":"18.2.0"}}',
      "index.js": "// entry",
    });
    const result = await detectFramework(dir);
    const rn = result.frameworks.find((f) => f.id === "react-native");
    expect(rn).toBeDefined();
    expect(rn!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("Package.swift만 있는 경우 ios 후보 생성", async () => {
    const dir = makeTmpTracked({
      "Package.swift": "// swift-tools-version: 5.9",
      "Sources/main.swift": "// main",
    });
    const result = await detectFramework(dir);
    const ios = result.frameworks.find((f) => f.id === "ios");
    expect(ios).toBeDefined();
  });

  it("AndroidManifest.xml + settings.gradle이 있으면 android 후보 생성", async () => {
    const dir = makeTmpTracked({
      "app/src/main/AndroidManifest.xml":
        '<manifest package="com.example" />',
      "settings.gradle": "rootProject.name = 'MyApp'",
    });
    const result = await detectFramework(dir);
    const android = result.frameworks.find((f) => f.id === "android");
    expect(android).toBeDefined();
  });

  it("AndroidManifest.xml + settings.gradle.kts가 있으면 android 후보 생성", async () => {
    const dir = makeTmpTracked({
      "app/src/main/AndroidManifest.xml":
        '<manifest package="com.example" />',
      "settings.gradle.kts": 'rootProject.name = "MyApp"',
    });
    const result = await detectFramework(dir);
    const android = result.frameworks.find((f) => f.id === "android");
    expect(android).toBeDefined();
  });
});
