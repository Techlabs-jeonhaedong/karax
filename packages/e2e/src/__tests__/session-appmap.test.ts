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
import { AppMapReadSchema } from "@karax/core";
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
    writtenPaths: [],    // generator는 outDir에 파일을 쓰지 않는 mock
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

  it("writtenPaths=[]이면 renderAppMapMarkdown으로 appMapDir에 마크다운을 직접 생성한다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    // writtenPaths=[] → writeMarkdownToDir가 appMapDir에 마크다운 생성
    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator: makeGenerator({ writtenPaths: [] }),
    });

    // MOCK_APP_MAP에 screens가 있으므로 renderAppMapMarkdown이 문서를 생성해야 함
    expect(result.markdownIndexPath).not.toBeNull();
    expect(result.markdownIndexPath!.startsWith(appMapDir)).toBe(true);
    expect(fs.existsSync(result.markdownIndexPath!)).toBe(true);
  });

  it("generator가 writtenPaths에 경로를 반환하면 그 경로를 markdownIndexPath로 사용한다", async () => {
    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    // generator가 appMapDir 내 실제 파일 경로를 반환하는 경우
    const mdPath = path.join(appMapDir, "custom_map.md");
    fs.writeFileSync(mdPath, "# AppMap", "utf-8");

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
      generator: makeGenerator({ writtenPaths: [mdPath] }),
    });

    expect(result.markdownIndexPath).toBe(mdPath);
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

  it("기록된 appmap.json이 AppMapReadSchema로 재파싱 가능하다 (round-trip)", async () => {
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
    const json = JSON.parse(content) as unknown;
    // round-trip: AppMapReadSchema.parse가 throw하지 않아야 한다
    expect(() => AppMapReadSchema.parse(json)).not.toThrow();
    const parsed = AppMapReadSchema.parse(json);
    expect(parsed.schemaVersion).toBe("appmap/2");
    expect(parsed.appName).toBe("MockApp");
  });
});
