/**
 * generateAppMapForSession 캐시 통합 테스트
 *
 * 캐시 히트/미스, reuseAppMap 옵션, 소스 변경 무효화를 검증한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { AppMap } from "@karax/core";
import type { AppMapGenerator } from "../appmap/sessionAppMap.js";
import { generateAppMapForSession } from "../appmap/sessionAppMap.js";

const MOCK_APP_MAP: AppMap = {
  schemaVersion: "appmap/2",
  appName: "CachedApp",
  framework: "flutter",
  entryScreenId: "home",
  screens: [
    {
      id: "home",
      title: "홈",
      discovery: "route",
      isEntry: true,
      confidence: 0.9,
      elements: [],
      outgoing: [],
    },
  ],
  edges: [],
  diagnostics: [],
  overallConfidence: 0.9,
};

function makeGenerator(appMap = MOCK_APP_MAP): AppMapGenerator {
  return vi.fn().mockResolvedValue({
    appMap,
    writtenPaths: [], // generator는 outDir에 파일을 쓰지 않는 mock
  });
}

let tmpDir: string;
let projectPath: string;
let appMapDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-session-appmap-cache-test-"));
  projectPath = path.join(tmpDir, "project");
  appMapDir = path.join(tmpDir, "appmap");
  fs.mkdirSync(projectPath, { recursive: true });
  fs.mkdirSync(appMapDir, { recursive: true });

  // 소스 파일 생성 (Flutter 프로젝트 모사)
  fs.mkdirSync(path.join(projectPath, "lib"), { recursive: true });
  fs.writeFileSync(path.join(projectPath, "pubspec.yaml"), "name: test_app", "utf-8");
  fs.writeFileSync(path.join(projectPath, "lib", "main.dart"), "void main() {}", "utf-8");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateAppMapForSession 캐시 동작", () => {
  it("같은 소스 두 번 실행 시 generator를 1회만 호출한다 (캐시 히트)", async () => {
    const generator = makeGenerator();

    // 1회차
    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator,
      reuseAppMap: true,
    });

    // 2회차 (같은 소스)
    const appMapDir2 = path.join(tmpDir, "appmap2");
    fs.mkdirSync(appMapDir2, { recursive: true });
    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDir2,
      generator,
      reuseAppMap: true,
    });

    // generator는 1회만 호출 (2회차는 캐시 히트)
    expect(generator).toHaveBeenCalledTimes(1);
  });

  it("reuseAppMap=false이면 캐시를 무시하고 매번 generator를 호출한다", async () => {
    const generator = makeGenerator();

    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator,
      reuseAppMap: false,
    });

    const appMapDir2 = path.join(tmpDir, "appmap2");
    fs.mkdirSync(appMapDir2, { recursive: true });
    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDir2,
      generator,
      reuseAppMap: false,
    });

    // 캐시 미사용 → 2회 모두 호출
    expect(generator).toHaveBeenCalledTimes(2);
  });

  it("reuseAppMap 미지정 시 기본값은 캐시 미사용(false)이다 (항목 2)", async () => {
    const generator = makeGenerator();

    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator,
      // reuseAppMap 미지정
    });

    const appMapDir2 = path.join(tmpDir, "appmap2");
    fs.mkdirSync(appMapDir2, { recursive: true });
    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDir2,
      generator,
      // reuseAppMap 미지정
    });

    // 기본값이 false(캐시 미사용)이면 2회 호출
    expect(generator).toHaveBeenCalledTimes(2);
  });

  it("소스 파일 변경 시 캐시가 무효화되어 generator를 재호출한다", async () => {
    const generator = makeGenerator();

    // 1회차
    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator,
      reuseAppMap: true,
    });

    // 소스 변경 (mtime 변경)
    await new Promise((r) => setTimeout(r, 10)); // 타임스탬프 차이 보장
    fs.writeFileSync(
      path.join(projectPath, "lib", "main.dart"),
      "void main() { /* changed */ }",
      "utf-8"
    );

    const appMapDir2 = path.join(tmpDir, "appmap2");
    fs.mkdirSync(appMapDir2, { recursive: true });

    // 2회차 (소스 변경 후)
    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDir2,
      generator,
      reuseAppMap: true,
    });

    // 소스가 변경됐으므로 2회 호출
    expect(generator).toHaveBeenCalledTimes(2);
  });

  it("캐시 히트 시 반환된 SessionAppMap의 appMap이 원본과 동일하다", async () => {
    const generator = makeGenerator();

    const result1 = await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator,
      reuseAppMap: true,
    });

    const appMapDir2 = path.join(tmpDir, "appmap2");
    fs.mkdirSync(appMapDir2, { recursive: true });

    const result2 = await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDir2,
      generator,
      reuseAppMap: true,
    });

    expect(result2.appMap.appName).toBe(result1.appMap.appName);
    expect(result2.appMap.screens.length).toBe(result1.appMap.screens.length);
  });

  it("캐시 히트 시 markdownIndexPath는 현재 appMapDir 내 경로를 반환한다 (항목 1)", async () => {
    const generator = makeGenerator();

    // 1회차 — 캐시 저장
    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator,
      reuseAppMap: true,
    });

    // 2회차 — 완전히 다른 appMapDir2 (이전 디렉토리와 무관)
    const appMapDir2 = path.join(tmpDir, "appmap-session2");
    // appMapDir2를 미리 생성하지 않음 — generateAppMapForSession이 만들어야 함

    const result2 = await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDir2,
      generator,
      reuseAppMap: true,
    });

    // markdownIndexPath는 appMapDir2 안에 있어야 함 (이전 세션 경로 X)
    expect(result2.markdownIndexPath).not.toBeNull();
    expect(result2.markdownIndexPath!.startsWith(appMapDir2)).toBe(true);
    // 실제 파일이 존재해야 함
    expect(fs.existsSync(result2.markdownIndexPath!)).toBe(true);
  });

  it("캐시 히트 시 appMapJsonPath는 현재 appMapDir에 쓰인다 (항목 1)", async () => {
    const generator = makeGenerator();

    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator,
      reuseAppMap: true,
    });

    const appMapDir2 = path.join(tmpDir, "appmap-session3");

    const result2 = await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDir2,
      generator,
      reuseAppMap: true,
    });

    // appMapJsonPath도 appMapDir2 안에 있어야 함
    expect(result2.appMapJsonPath.startsWith(appMapDir2)).toBe(true);
    expect(fs.existsSync(result2.appMapJsonPath)).toBe(true);
  });

  it("android와 ios는 별도 캐시 슬롯을 사용한다", async () => {
    const androidGenerator = makeGenerator({ ...MOCK_APP_MAP, appName: "AndroidApp" });
    const iosGenerator = makeGenerator({ ...MOCK_APP_MAP, appName: "IosApp" });

    const appMapDirAndroid = path.join(tmpDir, "appmap-android");
    const appMapDirIos = path.join(tmpDir, "appmap-ios");
    fs.mkdirSync(appMapDirAndroid, { recursive: true });
    fs.mkdirSync(appMapDirIos, { recursive: true });

    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDirAndroid,
      generator: androidGenerator,
      reuseAppMap: true,
    });

    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "ios",
      appMapDir: appMapDirIos,
      generator: iosGenerator,
      reuseAppMap: true,
    });

    // 각각 1회씩 호출 (별도 슬롯)
    expect(androidGenerator).toHaveBeenCalledTimes(1);
    expect(iosGenerator).toHaveBeenCalledTimes(1);

    // 2회차
    const appMapDirAndroid2 = path.join(tmpDir, "appmap-android2");
    const appMapDirIos2 = path.join(tmpDir, "appmap-ios2");
    fs.mkdirSync(appMapDirAndroid2, { recursive: true });
    fs.mkdirSync(appMapDirIos2, { recursive: true });

    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "android",
      appMapDir: appMapDirAndroid2,
      generator: androidGenerator,
      reuseAppMap: true,
    });

    await generateAppMapForSession({
      projectPath,
      framework: "flutter",
      platform: "ios",
      appMapDir: appMapDirIos2,
      generator: iosGenerator,
      reuseAppMap: true,
    });

    // 2회차는 캐시 히트 → 추가 호출 없음
    expect(androidGenerator).toHaveBeenCalledTimes(1);
    expect(iosGenerator).toHaveBeenCalledTimes(1);
  });
});
