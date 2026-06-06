/**
 * appmap/sessionAppMap.ts 단위 테스트
 *
 * sdk 동적 import를 vi.mock으로 대체해,
 * appmap.json 기록·디렉토리 구조·실패 전파를 검증한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { AppMap } from "@karax/core";

// sdk 동적 import mock
vi.mock("@karax/sdk", () => {
  const mockAppMap: AppMap = {
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

  return {
    generateAppMap: vi.fn().mockResolvedValue({
      appMap: mockAppMap,
      documents: [
        {
          fileName: "mockapp_map_1.md",
          content: "# MockApp\n## 홈\n",
        },
      ],
      writtenPaths: ["/mock/appmap/mockapp_map_1.md"],
    }),
  };
});

import { generateAppMapForSession } from "../appmap/sessionAppMap.js";

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
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
    });

    // mock에서 writtenPaths[0] = "/mock/appmap/mockapp_map_1.md"
    expect(result.markdownIndexPath).toBe("/mock/appmap/mockapp_map_1.md");
  });

  it("sdk generateAppMap이 마크다운을 쓰지 않으면 markdownIndexPath는 null", async () => {
    const { generateAppMap } = await import("@karax/sdk");
    const mockFn = vi.mocked(generateAppMap);
    mockFn.mockResolvedValueOnce({
      appMap: {
        schemaVersion: "appmap/2",
        appName: "NoMd",
        framework: "flutter",
        entryScreenId: null,
        screens: [],
        edges: [],
        diagnostics: [],
        overallConfidence: 0.0,
      },
      documents: [],
      writtenPaths: [],  // 마크다운 없음
    });

    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    const result = await generateAppMapForSession({
      projectPath: tmpDir,
      framework: "flutter",
      platform: "android",
      appMapDir,
    });

    expect(result.markdownIndexPath).toBeNull();
  });

  it("sdk 실패 시 throw한다 (호출부에서 catch해야 함)", async () => {
    const { generateAppMap } = await import("@karax/sdk");
    const mockFn = vi.mocked(generateAppMap);
    mockFn.mockRejectedValueOnce(new Error("SDK 실패"));

    const appMapDir = path.join(tmpDir, "appmap");
    fs.mkdirSync(appMapDir, { recursive: true });

    await expect(
      generateAppMapForSession({
        projectPath: tmpDir,
        framework: "flutter",
        platform: "android",
        appMapDir,
      })
    ).rejects.toThrow("SDK 실패");
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
      })
    ).resolves.toBeDefined();

    expect(fs.existsSync(appMapDir)).toBe(true);
  });
});
