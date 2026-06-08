import { describe, expect, it, vi } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { reactNativeAdapter } from "../index.js";
import type { DebugEvent } from "@karax/adapter-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../..", "fixtures/react-native-basic");

describe("reactNativeAdapter.detect()", () => {
  it("react-native-basic fixture를 감지한다", async () => {
    const result = await reactNativeAdapter.detect(FIXTURE_PATH);
    expect(result.matches).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("react-native 의존성이 없는 경우 matches=false", async () => {
    const noRnPath = path.resolve(__dirname, "fixtures/empty-src");
    const result = await reactNativeAdapter.detect(noRnPath);
    expect(result.matches).toBe(false);
  });
});

describe("reactNativeAdapter.discoverScreens()", () => {
  it("5개 화면을 발견한다 (4 route + 1 candidate)", async () => {
    const screens = await reactNativeAdapter.discoverScreens({
      projectPath: FIXTURE_PATH,
      includeCandidates: true,
    });
    expect(screens.length).toBe(5);

    const routes = screens.filter(s => s.discovery === "route");
    const candidates = screens.filter(s => s.discovery === "candidate");
    expect(routes).toHaveLength(4);
    expect(candidates).toHaveLength(1);
  });

  it("route 화면의 confidence가 candidate보다 높다", async () => {
    const screens = await reactNativeAdapter.discoverScreens({
      projectPath: FIXTURE_PATH,
      includeCandidates: true,
    });
    const routeConf = screens.filter(s => s.discovery === "route").map(s => s.confidence);
    const candidateConf = screens.filter(s => s.discovery === "candidate").map(s => s.confidence);
    expect(Math.min(...routeConf)).toBeGreaterThan(Math.max(...candidateConf));
  });

  it("includeCandidates=false 시 route 화면만 반환", async () => {
    const screens = await reactNativeAdapter.discoverScreens({
      projectPath: FIXTURE_PATH,
      includeCandidates: false,
    });
    expect(screens.every(s => s.discovery === "route")).toBe(true);
    expect(screens).toHaveLength(4);
  });

  it("OrphanScreen이 candidate로 발견된다", async () => {
    const screens = await reactNativeAdapter.discoverScreens({
      projectPath: FIXTURE_PATH,
      includeCandidates: true,
    });
    const orphan = screens.find(s => s.id === "OrphanScreen");
    expect(orphan).toBeDefined();
    expect(orphan?.discovery).toBe("candidate");
  });

  it("sourceRef가 올바르게 설정된다", async () => {
    const screens = await reactNativeAdapter.discoverScreens({
      projectPath: FIXTURE_PATH,
      includeCandidates: true,
    });
    const home = screens.find(s => s.id === "HomeScreen");
    expect(home?.sourceRef?.file).toContain("HomeScreen");
    expect(home?.sourceRef?.line).toBeGreaterThan(0);
  });
});

// ── onDebug 콜백 관측 테스트 ─────────────────────────────────────────────────

describe("reactNativeAdapter — onDebug 콜백", () => {
  it("onDebug 없이도 discoverScreens가 정상 동작해야 한다 (하위호환)", async () => {
    await expect(reactNativeAdapter.discoverScreens({
      projectPath: FIXTURE_PATH,
      includeCandidates: true,
    })).resolves.toBeDefined();
  });

  it("onDebug를 전달하면 이벤트를 수신할 수 있다", async () => {
    const events: DebugEvent[] = [];
    const onDebug = vi.fn((e: DebugEvent) => events.push(e));

    await expect(reactNativeAdapter.discoverScreens({
      projectPath: FIXTURE_PATH,
      includeCandidates: true,
      onDebug,
    })).resolves.toBeDefined();

    // 이벤트가 발생하면 올바른 구조를 가져야 한다
    for (const event of events) {
      expect(event.tag).toBeDefined();
      expect(event.message).toBeDefined();
    }
  });
});
