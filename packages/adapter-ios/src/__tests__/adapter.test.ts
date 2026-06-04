/**
 * iosAdapter 통합 테스트 — detect, discoverScreens, buildScreenIR 전체 흐름
 */

import path from "path";
import { describe, it, expect } from "vitest";
import { iosAdapter } from "../index.js";
import type { AdapterContext } from "@sfc/adapter-api";

const FIXTURE = path.resolve("../../fixtures/ios-swiftui-basic");

function makeCtx(overrides?: Partial<AdapterContext>): AdapterContext {
  return {
    projectPath: FIXTURE,
    mockSeed: 42,
    maxInlineDepth: 6,
    ...overrides,
  };
}

describe("iosAdapter.detect", () => {
  it("ios-swiftui-basic 픽스처를 ios로 감지한다", async () => {
    const result = await iosAdapter.detect(FIXTURE);
    expect(result.matches).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("flutter 프로젝트를 감지하지 못한다", async () => {
    const result = await iosAdapter.detect(path.resolve("../../fixtures/flutter-basic"));
    expect(result.matches).toBe(false);
  });

  it("evidence에 xcodeproj 또는 swift 관련 파일이 포함된다", async () => {
    const result = await iosAdapter.detect(FIXTURE);
    const descs = result.evidence.map((e) => e.description.toLowerCase());
    expect(descs.some((d) => d.includes("xcodeproj") || d.includes("swift"))).toBe(true);
  });
});

describe("iosAdapter.discoverScreens", () => {
  it("5개 화면을 발견한다 (HomeScreen, ListScreen, DetailScreen, SettingsScreen, OrphanScreen)", async () => {
    const screens = await iosAdapter.discoverScreens(makeCtx({ includeCandidates: true }));
    const ids = screens.map((s) => s.id);
    expect(ids).toContain("HomeScreen");
    expect(ids).toContain("ListScreen");
    expect(ids).toContain("DetailScreen");
    expect(ids).toContain("SettingsScreen");
    expect(ids).toContain("OrphanScreen");
  });

  it("route 화면들의 discovery가 route이다", async () => {
    const screens = await iosAdapter.discoverScreens(makeCtx({ includeCandidates: true }));
    const home = screens.find((s) => s.id === "HomeScreen");
    expect(home?.discovery).toBe("route");
  });

  it("OrphanScreen의 discovery가 candidate이다", async () => {
    const screens = await iosAdapter.discoverScreens(makeCtx({ includeCandidates: true }));
    const orphan = screens.find((s) => s.id === "OrphanScreen");
    expect(orphan?.discovery).toBe("candidate");
  });

  it("includeCandidates=false일 때 OrphanScreen이 제외된다", async () => {
    const screens = await iosAdapter.discoverScreens(makeCtx({ includeCandidates: false }));
    const ids = screens.map((s) => s.id);
    expect(ids).not.toContain("OrphanScreen");
  });

  it("각 화면에 sourceRef가 있다", async () => {
    const screens = await iosAdapter.discoverScreens(makeCtx({ includeCandidates: true }));
    for (const s of screens) {
      expect(s.sourceRef).toBeDefined();
      expect(s.sourceRef?.file).toBeTruthy();
    }
  });
});

describe("iosAdapter.buildScreenIR", () => {
  it("HomeScreen IR이 zod 스키마를 통과한다", async () => {
    const doc = await iosAdapter.buildScreenIR(makeCtx(), "HomeScreen");
    expect(doc.schemaVersion).toBe("0.1");
    expect(doc.screen.id).toBe("HomeScreen");
  });

  it("존재하지 않는 화면에서 UNRESOLVED_COMPONENT diagnostic을 반환한다", async () => {
    const doc = await iosAdapter.buildScreenIR(makeCtx(), "GhostScreen");
    expect(doc.diagnostics?.some((d) => d.code === "UNRESOLVED_COMPONENT")).toBe(true);
  });
});

describe("iosAdapter id", () => {
  it("id가 ios이다", () => {
    expect(iosAdapter.id).toBe("ios");
  });
});
