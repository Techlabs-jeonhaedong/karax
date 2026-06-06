/**
 * appmap/sessionAppMap.ts 단위 테스트
 *
 * sdk 의존 없이 AppMapGenerator를 직접 주입(DI)해
 * appmap.json 기록·디렉토리 구조·실패 전파를 검증한다.
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
  appName: "MockApp",
  framework: "flutter",
  entryScreenId: "home",
  screens: [
    {
      id: "home",
      title: "홈",
      discovery: "route",
      isEntry: true,
      confidence: 0.9,
      elements: [{ type: "Button", label: "시작" }],
      outgoing: [],
    },
  ],
  edges: [],
  diagnostics: [],
  overallConfidence: 0.9,
};

function makeGenerator(
  override?: Partial<{ appMap: AppMap; writtenPaths: string[] }>
): AppMapGenerator {
  return vi.fn().mockResolvedValue({
    appMap: MOCK_APP_MAP,
    writtenPaths: ["/mock/appmap/mockapp_map_1.md"],
    ...override,
  });
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-session-appmap-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateAppMapForSession", () => {
  it("appmap.json을 appMapDir에 저장한다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator: makeGenerator(),
    });

    expect(result.appMapJsonPath).toContain("appmap.json");
    expect(fs.existsSync(result.appMapJsonPath)).toBe(true);
  });

  it("appmap.json 내용이 유효한 JSON이다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator: makeGenerator(),
    });

    const content = fs.readFileSync(result.appMapJsonPath, "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();

    const parsed = JSON.parse(content) as { schemaVersion: string; appName: string };
    expect(parsed.schemaVersion).toBe("appmap/2");
    expect(parsed.appName).toBe("MockApp");
  });

  it("AppMap 객체를 반환한다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator: makeGenerator(),
    });

    expect(result.appMap).toBeDefined();
    expect(result.appMap.appName).toBe("MockApp");
  });

  it("android 플랫폼은 pixel-8 deviceProfileId를 사용한다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator: makeGenerator(),
    });

    expect(result.deviceProfileId).toBe("pixel-8");
  });

  it("ios 플랫폼은 iphone-15 deviceProfileId를 사용한다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "ios",
      platform: "ios",
      appMapDir,
      generator: makeGenerator(),
    });

    expect(result.deviceProfileId).toBe("iphone-15");
  });

  it("markdownIndexPath가 첫 번째 마크다운 파일 절대경로를 반환한다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator: makeGenerator({ writtenPaths: ["/mock/appmap/mockapp_map_1.md"] }),
    });

    expect(result.markdownIndexPath).toBe("/mock/appmap/mockapp_map_1.md");
  });

  it("generator가 마크다운을 쓰지 않으면 markdownIndexPath는 null", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator: makeGenerator({ writtenPaths: [] }),
    });

    expect(result.markdownIndexPath).toBeNull();
  });

  it("generator 실패 시 throw한다 (호출부에서 catch해야 함)", async () => {
    const failingGenerator: AppMapGenerator = vi.fn().mockRejectedValue(new Error("Generator 실패"));

    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    await expect(
      generateAppMapForSession({
        projectPath: tmpDir,
        framework: "flutter",
        platform: "android",
        appMapDir,
        generator: failingGenerator,
      })
    ).rejects.toThrow("Generator 실패");
  });

  it("appMapDir이 없어도 디렉토리를 생성한다", async () => {
    const appMapDir = path.join(tmpDir, "new", "appmap");
    // 디렉토리를 미리 만들지 않음

    await expect(
      generateAppMapForSession({
        projectPath: tmpDir,
        framework: "flutter",
        platform: "android",
        appMapDir,
        generator: makeGenerator(),
      })
    ).resolves.toBeDefined();

    expect(fs.existsSync(appMapDir)).toBe(true);
  });

  it("generator에 올바른 인자(projectPath, framework, device, outDir)가 전달된다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });
    const generator = makeGenerator();

    await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "react-native",
      platform: "ios",
      appMapDir,
      generator,
    });

    expect(generator).toHaveBeenCalledWith({
      projectPath: tmpDir,
      framework: "react-native",
      device: "iphone-15",
      outDir: appMapDir,
    });
  });
});
