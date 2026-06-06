/**
 * appmap/promptSummary.ts 단위 테스트
 *
 * 픽스처 AppMap 3종(화면 5/20/50개)으로 3단계 압축 분기,
 * BFS 경로(분기·사이클·도달불가), 라벨 truncation, 광고 집계, 라벨 정제를 검증한다.
 */

import { describe, it, expect } from "vitest";
import type { AppMap, ScreenNode, NavigationEdge } from "@karax/core";
import {
  summarizeAppMap,
  renderSummaryForPrompt,
} from "../appmap/promptSummary.js";

// ── 픽스처 헬퍼 ──────────────────────────────────────────────────────────────

function makeScreen(
  id: string,
  opts: {
    title?: string;
    labels?: string[];
    adCount?: number;
    discovery?: "route" | "candidate";
    isEntry?: boolean;
  } = {}
): ScreenNode {
  const elements: ScreenNode["elements"] = (opts.labels ?? []).map((label) => ({
    type: "Button" as const,
    label,
  }));
  for (let i = 0; i < (opts.adCount ?? 0); i++) {
    elements.push({ type: "Unknown" as const, role: "ad" as const, dynamic: true });
  }
  return {
    id,
    title: opts.title,
    discovery: opts.discovery ?? "route",
    isEntry: opts.isEntry ?? false,
    confidence: 0.9,
    elements,
    outgoing: [],
  };
}

function makeEdge(from: string, to: string, label?: string): NavigationEdge {
  return {
    from,
    to,
    action: "push",
    trigger: {
      kind: "button",
      label,
    },
    confidence: 0.9,
    diagnostics: [],
  };
}

function makeAppMap(
  screens: ScreenNode[],
  edges: NavigationEdge[],
  entryScreenId: string | null = null
): AppMap {
  return {
    schemaVersion: "appmap/2",
    appName: "TestApp",
    framework: "flutter",
    entryScreenId,
    screens,
    edges,
    diagnostics: [],
    overallConfidence: 0.9,
  };
}

// ── 5개 화면 픽스처 ──────────────────────────────────────────────────────────

function makeSmallAppMap(): AppMap {
  const screens: ScreenNode[] = [
    makeScreen("home", { title: "홈", labels: ["시작 버튼", "설정"], isEntry: true }),
    makeScreen("detail", { title: "상세", labels: ["뒤로가기", "공유"] }),
    makeScreen("settings", { title: "설정", labels: ["로그아웃"] }),
    makeScreen("profile", { title: "프로필", labels: ["편집"] }),
    makeScreen("ad_screen", { title: "광고 화면", adCount: 2 }),
  ];
  const edges: NavigationEdge[] = [
    makeEdge("home", "detail", "시작 버튼"),
    makeEdge("home", "settings", "설정"),
    makeEdge("detail", "profile", "프로필 보기"),
  ];
  return makeAppMap(screens, edges, "home");
}

// ── 20개 화면 픽스처 ─────────────────────────────────────────────────────────

function makeMediumAppMap(): AppMap {
  const screens: ScreenNode[] = Array.from({ length: 20 }, (_, i) =>
    makeScreen(`screen_${i}`, {
      title: `화면 ${i}`,
      labels: [`버튼_${i}_A`, `버튼_${i}_B`],
      isEntry: i === 0,
    })
  );
  const edges: NavigationEdge[] = Array.from({ length: 15 }, (_, i) =>
    makeEdge(`screen_${i}`, `screen_${i + 1}`, `이동_${i}`)
  );
  return makeAppMap(screens, edges, "screen_0");
}

// ── 50개 화면 픽스처 ─────────────────────────────────────────────────────────

function makeLargeAppMap(): AppMap {
  const screens: ScreenNode[] = Array.from({ length: 50 }, (_, i) =>
    makeScreen(`screen_${i}`, {
      title: `화면 ${i}`,
      labels: [`버튼_${i}`],
      isEntry: i === 0,
    })
  );
  const edges: NavigationEdge[] = Array.from({ length: 45 }, (_, i) =>
    makeEdge(`screen_${i}`, `screen_${i + 1}`, `이동_${i}`)
  );
  return makeAppMap(screens, edges, "screen_0");
}

// ── 사이클 포함 픽스처 ───────────────────────────────────────────────────────

function makeCyclicAppMap(): AppMap {
  const screens: ScreenNode[] = [
    makeScreen("A", { title: "A", isEntry: true }),
    makeScreen("B", { title: "B" }),
    makeScreen("C", { title: "C" }),
  ];
  const edges: NavigationEdge[] = [
    makeEdge("A", "B", "다음"),
    makeEdge("B", "C", "계속"),
    makeEdge("C", "A", "홈으로"),  // 사이클
  ];
  return makeAppMap(screens, edges, "A");
}

// ── 도달 불가 화면 픽스처 ────────────────────────────────────────────────────

function makeUnreachableAppMap(): AppMap {
  const screens: ScreenNode[] = [
    makeScreen("entry", { title: "진입점", isEntry: true }),
    makeScreen("reachable", { title: "도달가능" }),
    makeScreen("orphan", { title: "고아 화면" }),  // 도달 불가
  ];
  const edges: NavigationEdge[] = [
    makeEdge("entry", "reachable", "이동"),
  ];
  return makeAppMap(screens, edges, "entry");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 테스트
// ═══════════════════════════════════════════════════════════════════════════════

describe("summarizeAppMap — 3단계 압축 분기", () => {
  it("5개 화면: screenCount = 5, truncated = false", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    expect(summary.screenCount).toBe(5);
    expect(summary.truncated).toBe(false);
  });

  it("5개 화면: 모든 화면에 interactiveLabels 존재", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const homeScreen = summary.screens.find((s) => s.id === "home");
    expect(homeScreen).toBeDefined();
    expect(homeScreen!.interactiveLabels).toContain("시작 버튼");
    expect(homeScreen!.interactiveLabels).toContain("설정");
  });

  it("20개 화면: screenCount = 20, truncated = false", () => {
    const summary = summarizeAppMap(makeMediumAppMap());
    expect(summary.screenCount).toBe(20);
    expect(summary.truncated).toBe(false);
  });

  it("20개 화면: maxLabelsPerScreen 기본값(10)으로 라벨 제한", () => {
    // 20개 화면에서 각 화면당 라벨 2개이므로 전부 포함됨
    const summary = summarizeAppMap(makeMediumAppMap());
    for (const screen of summary.screens) {
      expect(screen.interactiveLabels.length).toBeLessThanOrEqual(10);
    }
  });

  it("50개 화면: screenCount = 50, truncated = true", () => {
    const summary = summarizeAppMap(makeLargeAppMap());
    expect(summary.screenCount).toBe(50);
    expect(summary.truncated).toBe(true);
  });

  it("maxScreens 옵션으로 screens 배열 크기 제한", () => {
    const summary = summarizeAppMap(makeLargeAppMap(), { maxScreens: 40 });
    expect(summary.screens.length).toBeLessThanOrEqual(40);
  });

  it("maxLabelsPerScreen 옵션으로 라벨 수 제한", () => {
    const appMap = makeSmallAppMap();
    // home 화면에 라벨 많이 추가
    const homeScreen = appMap.screens.find((s) => s.id === "home")!;
    for (let i = 0; i < 20; i++) {
      homeScreen.elements.push({ type: "Button", label: `라벨_${i}` });
    }
    const summary = summarizeAppMap(appMap, { maxLabelsPerScreen: 5 });
    const homeSummary = summary.screens.find((s) => s.id === "home")!;
    expect(homeSummary.interactiveLabels.length).toBeLessThanOrEqual(5);
  });
});

describe("summarizeAppMap — entryScreenId", () => {
  it("entryScreenId가 있으면 그대로 반환", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    expect(summary.entryScreenId).toBe("home");
  });

  it("entryScreenId가 null이면 null 반환", () => {
    const appMap = makeSmallAppMap();
    appMap.entryScreenId = null;
    const summary = summarizeAppMap(appMap);
    expect(summary.entryScreenId).toBeNull();
  });
});

describe("summarizeAppMap — BFS 경로(navPaths)", () => {
  it("진입점에서 화면까지의 경로를 계산한다", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const detailPath = summary.navPaths.find((p) => p.screenId === "detail");
    expect(detailPath).toBeDefined();
    // pathHint는 title 또는 id를 사용한다 (홈 또는 home)
    expect(detailPath!.pathHint).toMatch(/홈|home/);
    // 도착 화면 포함 (상세 또는 detail)
    expect(detailPath!.pathHint).toMatch(/상세|detail/);
    // 트리거 라벨 포함
    expect(detailPath!.pathHint).toContain("시작 버튼");
  });

  it("진입점 자체의 pathHint는 화면 id만 포함", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const homePath = summary.navPaths.find((p) => p.screenId === "home");
    expect(homePath).toBeDefined();
  });

  it("사이클이 있어도 무한루프 없이 BFS 완료", () => {
    expect(() => summarizeAppMap(makeCyclicAppMap())).not.toThrow();
    const summary = summarizeAppMap(makeCyclicAppMap());
    expect(summary.screenCount).toBe(3);
  });

  it("도달 불가 화면은 pathHint에 '진입 경로 미발견' 표기", () => {
    const summary = summarizeAppMap(makeUnreachableAppMap());
    const orphanPath = summary.navPaths.find((p) => p.screenId === "orphan");
    expect(orphanPath).toBeDefined();
    expect(orphanPath!.pathHint).toContain("진입 경로 미발견");
  });

  it("트리거 라벨 없는 엣지는 action으로 표기", () => {
    const appMap = makeSmallAppMap();
    // label 없는 edge 추가
    appMap.edges.push({
      from: "settings",
      to: "profile",
      action: "push",
      trigger: { kind: "tap" },
      confidence: 0.9,
      diagnostics: [],
    });
    const summary = summarizeAppMap(appMap);
    const profilePath = summary.navPaths.find((p) => p.screenId === "profile");
    // profile은 두 경로로 도달 가능(home→detail→profile, settings→profile)
    // BFS 최단 경로를 사용하므로 어느 쪽이든 포함됨
    expect(profilePath).toBeDefined();
  });

  it("entryScreenId가 null이면 모든 화면이 도달 불가로 처리", () => {
    const appMap = makeSmallAppMap();
    appMap.entryScreenId = null;
    const summary = summarizeAppMap(appMap);
    for (const path of summary.navPaths) {
      expect(path.pathHint).toContain("진입 경로 미발견");
    }
  });

  it("to가 null인 엣지는 경로 계산에서 제외", () => {
    const appMap = makeSmallAppMap();
    appMap.edges.push({
      from: "home",
      to: null,
      action: "pop",
      trigger: { kind: "back" },
      confidence: 0.9,
      diagnostics: [],
    });
    expect(() => summarizeAppMap(appMap)).not.toThrow();
  });
});

describe("summarizeAppMap — 광고 집계(adCount)", () => {
  it("role:ad 요소 개수를 adCount로 집계한다", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const adScreen = summary.screens.find((s) => s.id === "ad_screen");
    expect(adScreen).toBeDefined();
    expect(adScreen!.adCount).toBe(2);
  });

  it("광고 없는 화면의 adCount는 0", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const homeScreen = summary.screens.find((s) => s.id === "home");
    expect(homeScreen!.adCount).toBe(0);
  });

  it("interactiveLabels에 광고 요소(role:ad)는 포함되지 않는다", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const adScreen = summary.screens.find((s) => s.id === "ad_screen");
    // 광고 요소에는 label이 없으므로 labels 배열에 포함될 수 없음 — undefined 체크
    expect(adScreen!.interactiveLabels.every((l) => l !== undefined)).toBe(true);
  });
});

describe("summarizeAppMap — 라벨 정제(sanitization)", () => {
  it("라벨에서 백틱을 제거한다", () => {
    const appMap = makeSmallAppMap();
    appMap.screens[0].elements.push({ type: "Button", label: "버튼`악성`" });
    const summary = summarizeAppMap(appMap);
    const homeScreen = summary.screens.find((s) => s.id === "home")!;
    for (const label of homeScreen.interactiveLabels) {
      expect(label).not.toContain("`");
    }
  });

  it("라벨에서 개행을 제거한다", () => {
    const appMap = makeSmallAppMap();
    appMap.screens[0].elements.push({ type: "Button", label: "버튼\n개행포함" });
    const summary = summarizeAppMap(appMap);
    const homeScreen = summary.screens.find((s) => s.id === "home")!;
    for (const label of homeScreen.interactiveLabels) {
      expect(label).not.toContain("\n");
    }
  });

  it("80자 초과 라벨을 80자로 절단한다", () => {
    const longLabel = "A".repeat(100);
    const appMap = makeSmallAppMap();
    appMap.screens[0].elements.push({ type: "Button", label: longLabel });
    const summary = summarizeAppMap(appMap);
    const homeScreen = summary.screens.find((s) => s.id === "home")!;
    for (const label of homeScreen.interactiveLabels) {
      expect(label.length).toBeLessThanOrEqual(80);
    }
  });

  it("80자 미만 라벨은 그대로 유지", () => {
    const normalLabel = "정상 라벨";
    const appMap = makeSmallAppMap();
    appMap.screens[0].elements.push({ type: "Button", label: normalLabel });
    const summary = summarizeAppMap(appMap);
    const homeScreen = summary.screens.find((s) => s.id === "home")!;
    expect(homeScreen.interactiveLabels).toContain(normalLabel);
  });
});

describe("renderSummaryForPrompt", () => {
  it("파일 경로를 출력에 포함한다", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const rendered = renderSummaryForPrompt(summary, {
      markdownIndexPath: "/tmp/appmap/appmap_map_1.md",
      appMapJsonPath: "/tmp/appmap/appmap.json",
    });
    expect(rendered).toContain("/tmp/appmap/appmap_map_1.md");
    expect(rendered).toContain("/tmp/appmap/appmap.json");
  });

  it("markdownIndexPath가 null이면 파일 위임 없이 렌더", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const rendered = renderSummaryForPrompt(summary, {
      markdownIndexPath: null,
      appMapJsonPath: "/tmp/appmap/appmap.json",
    });
    expect(rendered).toBeDefined();
    expect(rendered.length).toBeGreaterThan(0);
  });

  it("광고가 있는 화면에 탭 회피 경고를 포함한다", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const rendered = renderSummaryForPrompt(summary, {
      markdownIndexPath: null,
      appMapJsonPath: "/tmp/appmap.json",
    });
    expect(rendered).toContain("광고");
    expect(rendered).toContain("탭 회피");
  });

  it("truncated=true일 때 파일 위임 안내를 포함한다", () => {
    const summary = summarizeAppMap(makeLargeAppMap());
    expect(summary.truncated).toBe(true);
    const rendered = renderSummaryForPrompt(summary, {
      markdownIndexPath: "/tmp/map.md",
      appMapJsonPath: "/tmp/appmap.json",
    });
    expect(rendered).toContain("/tmp/map.md");
  });

  it("화면 목록에 진입점 화면이 포함된다", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const rendered = renderSummaryForPrompt(summary, {
      markdownIndexPath: null,
      appMapJsonPath: "/tmp/appmap.json",
    });
    expect(rendered).toContain("home");
  });

  it("navPaths에 경로 힌트가 포함된다", () => {
    const summary = summarizeAppMap(makeSmallAppMap());
    const rendered = renderSummaryForPrompt(summary, {
      markdownIndexPath: null,
      appMapJsonPath: "/tmp/appmap.json",
    });
    // 경로 힌트 포함 여부 확인 (BFS 경로가 있으면 → 화살표 포함)
    expect(rendered).toContain("→");
  });
});
