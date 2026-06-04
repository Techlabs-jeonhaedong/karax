import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { reactNativeAdapter } from "../index.js";

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
