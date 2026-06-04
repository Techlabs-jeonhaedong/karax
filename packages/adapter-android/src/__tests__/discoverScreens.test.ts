/**
 * discoverScreens 테스트
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { androidAdapter } from "../index.js";
import type { AdapterContext } from "@sfc/adapter-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");
const FIXTURE = path.join(FIXTURES_DIR, "android-compose-basic");

const ctx: AdapterContext = {
  projectPath: FIXTURE,
  includeCandidates: true,
};

const ctxNoCandidate: AdapterContext = {
  projectPath: FIXTURE,
  includeCandidates: false,
};

describe("androidAdapter.discoverScreens — route-graph", () => {
  it("4개 route 화면을 발견한다 (HomeScreen, DetailScreen, ListScreen, SettingsScreen)", async () => {
    const screens = await androidAdapter.discoverScreens(ctx);
    const routeScreens = screens.filter((s) => s.discovery === "route");
    const ids = routeScreens.map((s) => s.id);
    expect(ids).toContain("HomeScreen");
    expect(ids).toContain("DetailScreen");
    expect(ids).toContain("ListScreen");
    expect(ids).toContain("SettingsScreen");
  });

  it("route 화면의 confidence는 1.0이다", async () => {
    const screens = await androidAdapter.discoverScreens(ctx);
    const routeScreens = screens.filter((s) => s.discovery === "route");
    for (const s of routeScreens) {
      expect(s.confidence).toBe(1.0);
    }
  });

  it("route 화면에 sourceRef가 있다", async () => {
    const screens = await androidAdapter.discoverScreens(ctx);
    const routeScreens = screens.filter((s) => s.discovery === "route");
    for (const s of routeScreens) {
      expect(s.sourceRef).toBeDefined();
      expect(s.sourceRef?.file).toMatch(/\.kt$/);
    }
  });
});

describe("androidAdapter.discoverScreens — heuristic", () => {
  it("OrphanScreen을 candidate로 발견한다", async () => {
    const screens = await androidAdapter.discoverScreens(ctx);
    const orphan = screens.find((s) => s.id === "OrphanScreen");
    expect(orphan).toBeDefined();
    expect(orphan?.discovery).toBe("candidate");
    expect(orphan?.confidence).toBe(0.6);
  });

  it("includeCandidates=false 시 OrphanScreen을 발견하지 않는다", async () => {
    const screens = await androidAdapter.discoverScreens(ctxNoCandidate);
    const orphan = screens.find((s) => s.id === "OrphanScreen");
    expect(orphan).toBeUndefined();
  });

  it("OrphanScreen은 NavHost에 등록되지 않았으므로 route가 아닌 candidate이다", async () => {
    const screens = await androidAdapter.discoverScreens(ctx);
    const orphan = screens.find((s) => s.id === "OrphanScreen");
    expect(orphan?.discovery).toBe("candidate");
  });
});

describe("androidAdapter.discoverScreens — 합성 케이스", () => {
  it("빈 프로젝트에서 빈 배열을 반환한다", async () => {
    const screens = await androidAdapter.discoverScreens({
      projectPath: "/tmp/nonexistent-sfc-android-test",
    });
    expect(screens).toEqual([]);
  });
});
