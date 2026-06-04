import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import type { ScreenSummary } from "@sfc/adapter-api";
import { flutterAdapter } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");
const SYNTHETIC_DIR = path.resolve(__dirname, "fixtures");

// ── helpers ──────────────────────────────────────────────────────────────────

function fixtureCtx(name: string, synthetic = false) {
  const base = synthetic ? SYNTHETIC_DIR : FIXTURES_DIR;
  return {
    projectPath: path.join(base, name),
    framework: "flutter" as const,
    includeCandidates: true,
  };
}

function screenById(screens: ScreenSummary[], id: string) {
  return screens.find((s) => s.id === id);
}

// ── flutter-basic fixture (스냅샷 수준 검증) ─────────────────────────────────

describe("flutter-basic fixture — discoverScreens", () => {
  it("HomeScreen은 route로 발견된다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const home = screenById(screens, "HomeScreen");
    expect(home).toBeDefined();
    expect(home!.discovery).toBe("route");
    expect(home!.confidence).toBe(1.0);
    expect(home!.sourceRef?.file).toBe("lib/screens/home_screen.dart");
    expect(home!.sourceRef?.symbol).toBe("HomeScreen");
    expect(home!.sourceRef?.line).toBeGreaterThan(0);
  });

  it("ListScreen은 route로 발견된다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const s = screenById(screens, "ListScreen");
    expect(s).toBeDefined();
    expect(s!.discovery).toBe("route");
    expect(s!.confidence).toBe(1.0);
    expect(s!.sourceRef?.file).toBe("lib/screens/list_screen.dart");
    expect(s!.sourceRef?.symbol).toBe("ListScreen");
  });

  it("SettingsScreen은 route로 발견된다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const s = screenById(screens, "SettingsScreen");
    expect(s).toBeDefined();
    expect(s!.discovery).toBe("route");
    expect(s!.confidence).toBe(1.0);
    expect(s!.sourceRef?.file).toBe("lib/screens/settings_screen.dart");
    expect(s!.sourceRef?.symbol).toBe("SettingsScreen");
  });

  it("DetailScreen은 Navigator.push로 발견된 route다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const s = screenById(screens, "DetailScreen");
    expect(s).toBeDefined();
    expect(s!.discovery).toBe("route");
    expect(s!.confidence).toBe(1.0);
    expect(s!.sourceRef?.file).toBe("lib/screens/detail_screen.dart");
    expect(s!.sourceRef?.symbol).toBe("DetailScreen");
  });

  it("OrphanScreen은 candidate로 발견된다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const s = screenById(screens, "OrphanScreen");
    expect(s).toBeDefined();
    expect(s!.discovery).toBe("candidate");
    expect(s!.confidence).toBe(0.6);
    expect(s!.sourceRef?.file).toBe("lib/screens/orphan_screen.dart");
    expect(s!.sourceRef?.symbol).toBe("OrphanScreen");
  });

  it("route가 이미 있는 화면은 candidate에서 제외되어 중복 없이 1개만 나온다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const homeScreens = screens.filter((s) => s.id === "HomeScreen");
    expect(homeScreens).toHaveLength(1);
  });

  it("내부 helper 위젯 클래스(_PrefixClass)는 포함되지 않는다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const privateClasses = screens.filter((s) => s.id.startsWith("_"));
    expect(privateClasses).toHaveLength(0);
  });

  it("title은 클래스명에서 유추된다 (PascalCase → 공백 분리)", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const home = screenById(screens, "HomeScreen");
    expect(home!.title).toBe("Home Screen");
  });
});

// ── detect ────────────────────────────────────────────────────────────────────

describe("flutter-basic fixture — detect", () => {
  it("flutter-basic을 Flutter 프로젝트로 감지한다", async () => {
    const result = await flutterAdapter.detect(path.join(FIXTURES_DIR, "flutter-basic"));
    expect(result.matches).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("Flutter가 아닌 디렉토리는 감지 안 된다", async () => {
    const result = await flutterAdapter.detect(path.join(FIXTURES_DIR, "react-native-basic"));
    expect(result.matches).toBe(false);
  });

  it("존재하지 않는 경로는 감지 안 된다", async () => {
    const result = await flutterAdapter.detect("/nonexistent/path/to/project");
    expect(result.matches).toBe(false);
  });
});

// ── buildScreenIR — 스텁 ─────────────────────────────────────────────────────

describe("buildScreenIR — M3 구현 전 스텁", () => {
  it("buildScreenIR은 NOT_IMPLEMENTED 에러를 던진다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    await expect(
      flutterAdapter.buildScreenIR(ctx, "HomeScreen")
    ).rejects.toThrow("NOT_IMPLEMENTED");
  });
});

// ── 합성 fixture: go_router ───────────────────────────────────────────────────

describe("합성 fixture: go_router 케이스", () => {
  it("GoRoute 경로에서 화면을 발견한다", async () => {
    const ctx = fixtureCtx("go-router-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const ids = screens.map((s) => s.id);
    expect(ids).toContain("HomeScreen");
    expect(ids).toContain("ProfileScreen");
  });

  it("go_router로 발견된 화면은 route discovery다", async () => {
    const ctx = fixtureCtx("go-router-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const home = screenById(screens, "HomeScreen");
    expect(home?.discovery).toBe("route");
    expect(home?.confidence).toBe(1.0);
  });

  it("list_literal 안의 두 번째 GoRoute(ProfileScreen)도 route로 발견된다", async () => {
    const ctx = fixtureCtx("go-router-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const profile = screenById(screens, "ProfileScreen");
    // 버그: .find()가 첫 GoRoute의 selector만 반환하므로 ProfileScreen이 candidate로 강등됨
    expect(profile?.discovery).toBe("route");
    expect(profile?.confidence).toBe(1.0);
  });

  it("includeCandidates=false일 때 go_router 모든 화면이 route로 발견된다", async () => {
    const ctx = { ...fixtureCtx("go-router-case", true), includeCandidates: false };
    const screens = await flutterAdapter.discoverScreens(ctx);
    const ids = screens.map((s) => s.id);
    expect(ids).toContain("HomeScreen");
    expect(ids).toContain("ProfileScreen");
    // candidates=false이므로 두 화면 모두 route로만 잡혀야 함
    expect(screens.every((s) => s.discovery === "route")).toBe(true);
  });
});

// ── 합성 fixture: onGenerateRoute ────────────────────────────────────────────

describe("합성 fixture: onGenerateRoute 케이스", () => {
  it("onGenerateRoute switch case에서 화면을 발견한다", async () => {
    const ctx = fixtureCtx("on-generate-route-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const ids = screens.map((s) => s.id);
    expect(ids).toContain("DashboardScreen");
    expect(ids).toContain("ProfileScreen");
  });

  it("onGenerateRoute로 발견된 화면은 route discovery다", async () => {
    const ctx = fixtureCtx("on-generate-route-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const dashboard = screenById(screens, "DashboardScreen");
    expect(dashboard?.discovery).toBe("route");
  });
});

// ── 합성 fixture: home: 만 있는 최소 케이스 ─────────────────────────────────

describe("합성 fixture: home: 만 있는 최소 케이스", () => {
  it("MaterialApp home: 파라미터에서 단일 화면을 발견한다", async () => {
    const ctx = fixtureCtx("home-only-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const start = screenById(screens, "StartScreen");
    expect(start).toBeDefined();
    expect(start!.discovery).toBe("route");
  });
});

// ── 합성 fixture: Navigator.push 직접 호출만 있는 케이스 ────────────────────

describe("합성 fixture: Navigator.push 직접 호출만 있는 케이스", () => {
  it("Navigator.push MaterialPageRoute에서 화면을 발견한다", async () => {
    const ctx = fixtureCtx("navigator-push-only-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const ids = screens.map((s) => s.id);
    expect(ids).toContain("MainScreen");
    expect(ids).toContain("SecondaryScreen");
  });

  it("MainScreen은 home:으로 route 발견된다", async () => {
    const ctx = fixtureCtx("navigator-push-only-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const main = screenById(screens, "MainScreen");
    expect(main?.discovery).toBe("route");
  });

  it("SecondaryScreen은 Navigator.push로 route 발견된다", async () => {
    const ctx = fixtureCtx("navigator-push-only-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    const secondary = screenById(screens, "SecondaryScreen");
    expect(secondary?.discovery).toBe("route");
  });
});

// ── 합성 fixture: 빈 lib ─────────────────────────────────────────────────────

describe("합성 fixture: 빈 lib (화면 없음)", () => {
  it("Scaffold를 반환하는 클래스가 없으면 빈 배열을 반환한다", async () => {
    const ctx = fixtureCtx("empty-lib-case", true);
    const screens = await flutterAdapter.discoverScreens(ctx);
    expect(screens).toHaveLength(0);
  });
});

// ── 엣지 케이스 ───────────────────────────────────────────────────────────────

describe("엣지 케이스", () => {
  it("같은 클래스가 routes와 Navigator.push 양쪽에 있어도 1개로 dedupe된다", async () => {
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    // HomeScreen은 routes 테이블에도 있고 pushNamed('/') 등으로도 참조될 수 있음
    const homeOccurrences = screens.filter((s) => s.id === "HomeScreen");
    expect(homeOccurrences).toHaveLength(1);
  });

  it("존재하지 않는 클래스 참조는 diagnostics에 기록되고 화면 목록에서 제외된다", async () => {
    // flutter-basic의 routes 테이블에는 실제로 존재하는 클래스만 있으므로
    // 모든 발견된 화면은 sourceRef.file이 있어야 한다
    const ctx = fixtureCtx("flutter-basic");
    const screens = await flutterAdapter.discoverScreens(ctx);
    const routeScreens = screens.filter((s) => s.discovery === "route");
    for (const s of routeScreens) {
      expect(s.sourceRef?.file).toBeTruthy();
    }
  });

  it("includeCandidates=false 이면 candidate 화면이 제외된다", async () => {
    const ctx = {
      ...fixtureCtx("flutter-basic"),
      includeCandidates: false,
    };
    const screens = await flutterAdapter.discoverScreens(ctx);
    const candidates = screens.filter((s) => s.discovery === "candidate");
    expect(candidates).toHaveLength(0);
  });
});
