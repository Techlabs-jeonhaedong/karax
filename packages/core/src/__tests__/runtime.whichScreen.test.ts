import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyScreen } from "../runtime/whichScreen.js";
import type { ScreenIdentification } from "../runtime/whichScreen.js";
import {
  parseUiautomatorXml,
  flattenInteractive,
} from "../runtime/uiautomatorParser.js";
import type { RuntimeNode } from "../runtime/uiautomatorParser.js";
import type { AppMap, ScreenNode, MapElement } from "../appmap/schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const fixtureDir = join(__dir, "fixtures", "uiautomator");

function loadNodes(name: string): RuntimeNode[] {
  const xml = readFileSync(join(fixtureDir, name), "utf-8");
  const tree = parseUiautomatorXml(xml);
  return flattenInteractive(tree);
}

/** 최소 AppMap 팩토리 */
function makeAppMap(screens: ScreenNode[]): AppMap {
  return {
    schemaVersion: "appmap/2",
    appName: "TestApp",
    framework: "android",
    entryScreenId: screens[0]?.id ?? null,
    screens,
    edges: [],
    diagnostics: [],
    overallConfidence: 1.0,
  };
}

function makeScreen(id: string, elements: MapElement[]): ScreenNode {
  return {
    id,
    discovery: "route",
    isEntry: false,
    confidence: 1.0,
    elements,
    outgoing: [],
  };
}

// ──────────────────────────────────────────────────────────────
// 정확 식별
// ──────────────────────────────────────────────────────────────

describe("identifyScreen — 정확 식별", () => {
  it("로그인 화면 라벨과 런타임 노드가 일치하면 높은 confidence", () => {
    const loginScreen = makeScreen("LoginScreen", [
      { type: "Button", label: "로그인" },
      { type: "Button", label: "회원가입" },
    ]);
    const shopScreen = makeScreen("ShopScreen", [
      { type: "Text", label: "쇼핑몰 & 스토어" },
    ]);
    const appMap = makeAppMap([loginScreen, shopScreen]);
    const nodes = loadNodes("simple.xml");
    const result = identifyScreen(appMap, nodes);
    expect(result.screenId).toBe("LoginScreen");
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("쇼핑 화면 라벨과 런타임 노드 일치", () => {
    const shopScreen = makeScreen("ShopScreen", [
      { type: "Text", label: "쇼핑몰 & 스토어" },
      { type: "Button", label: "담기" },
    ]);
    const loginScreen = makeScreen("LoginScreen", [
      { type: "Button", label: "로그인" },
    ]);
    const appMap = makeAppMap([shopScreen, loginScreen]);
    const nodes = loadNodes("nested-list.xml");
    const result = identifyScreen(appMap, nodes);
    expect(result.screenId).toBe("ShopScreen");
  });
});

// ──────────────────────────────────────────────────────────────
// 광고 라벨 노이즈 내성
// ──────────────────────────────────────────────────────────────

describe("identifyScreen — 광고/동적 요소 제외", () => {
  it("dynamic:true 요소는 화면 라벨 집합에서 제외", () => {
    const screen = makeScreen("LoginScreen", [
      { type: "Button", label: "로그인" },
      { type: "Unknown", label: "광고배너XYZ", dynamic: true, role: "ad" },
    ]);
    const appMap = makeAppMap([screen]);
    // 런타임에 "로그인"은 있지만 "광고배너XYZ"는 없음
    const nodes = loadNodes("simple.xml");
    const result = identifyScreen(appMap, nodes);
    // 광고 제외 후 로그인만으로 식별해야 함
    expect(result.screenId).toBe("LoginScreen");
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it("role:ad 요소는 화면 라벨 집합에서 제외", () => {
    const screen = makeScreen("ShopScreen", [
      { type: "Button", label: "담기" },
      { type: "Unknown", label: "AdBannerSpecial999", role: "ad" },
    ]);
    const appMap = makeAppMap([screen]);
    const nodes = loadNodes("nested-list.xml");
    const result = identifyScreen(appMap, nodes);
    expect(result.screenId).toBe("ShopScreen");
  });

  it("런타임에 광고 텍스트가 섞여도 화면 식별에 영향 없음", () => {
    // AppMap에는 광고 없음 — 런타임 노드에 광고 텍스트가 있어도 식별은 됨
    const screen = makeScreen("LoginScreen", [
      { type: "Button", label: "로그인" },
      { type: "Button", label: "회원가입" },
    ]);
    const appMap = makeAppMap([screen]);
    const nodesWithAd: RuntimeNode[] = [
      ...loadNodes("simple.xml"),
      {
        text: "광고: 지금 바로 클릭!",
        resourceId: "ad.sdk:id/banner",
        contentDesc: "",
        className: "com.ads.AdView",
        clickable: true,
        enabled: true,
        bounds: { x1: 0, y1: 2000, x2: 1080, y2: 2200 },
        children: [],
      },
    ];
    const result = identifyScreen(appMap, nodesWithAd);
    expect(result.screenId).toBe("LoginScreen");
  });
});

// ──────────────────────────────────────────────────────────────
// 모호 케이스 → confidence 하락
// ──────────────────────────────────────────────────────────────

describe("identifyScreen — 모호 케이스", () => {
  it("두 화면이 비슷할 때 confidence가 낮아짐", () => {
    const screenA = makeScreen("ScreenA", [
      { type: "Button", label: "로그인" },
    ]);
    const screenB = makeScreen("ScreenB", [
      { type: "Button", label: "로그인" }, // 동일 라벨
      { type: "Button", label: "회원가입" },
    ]);
    const appMap = makeAppMap([screenA, screenB]);
    const nodes = loadNodes("simple.xml");
    const result = identifyScreen(appMap, nodes);
    // ScreenB가 더 높겠지만 confidence는 단독일 때보다 낮아야 함
    expect(result.confidence).toBeLessThan(1.0);
  });
});

// ──────────────────────────────────────────────────────────────
// 임계 미달 → screenId: null
// ──────────────────────────────────────────────────────────────

describe("identifyScreen — 임계 미달", () => {
  it("일치하는 라벨이 없으면 screenId: null", () => {
    const screen = makeScreen("UnknownScreen", [
      { type: "Text", label: "완전다른라벨ABC" },
      { type: "Button", label: "또다른라벨XYZ" },
    ]);
    const appMap = makeAppMap([screen]);
    const nodes = loadNodes("simple.xml");
    const result = identifyScreen(appMap, nodes);
    expect(result.screenId).toBeNull();
  });

  it("similarity < 0.3이면 screenId: null", () => {
    const screen = makeScreen("RandomScreen", [
      { type: "Text", label: "aaaa" },
      { type: "Text", label: "bbbb" },
      { type: "Text", label: "cccc" },
    ]);
    const appMap = makeAppMap([screen]);
    const nodes = loadNodes("simple.xml"); // simple.xml에 aaaa/bbbb/cccc 없음
    const result = identifyScreen(appMap, nodes);
    expect(result.screenId).toBeNull();
    expect(result.confidence).toBeLessThan(0.3);
  });
});

// ──────────────────────────────────────────────────────────────
// 빈 화면 / 빈 런타임
// ──────────────────────────────────────────────────────────────

describe("identifyScreen — 빈 케이스", () => {
  it("빈 런타임 노드 → screenId: null", () => {
    const screen = makeScreen("LoginScreen", [
      { type: "Button", label: "로그인" },
    ]);
    const appMap = makeAppMap([screen]);
    const result = identifyScreen(appMap, []);
    expect(result.screenId).toBeNull();
  });

  it("AppMap에 화면 없음 → screenId: null", () => {
    const appMap = makeAppMap([]);
    const nodes = loadNodes("simple.xml");
    const result = identifyScreen(appMap, nodes);
    expect(result.screenId).toBeNull();
  });

  it("모든 화면이 라벨 없음 → ranked가 비어 있고 screenId: null", () => {
    const screen = makeScreen("EmptyScreen", [
      { type: "Box" }, // label 없음
      { type: "Image" }, // label 없음
    ]);
    const appMap = makeAppMap([screen]);
    const nodes = loadNodes("simple.xml");
    const result = identifyScreen(appMap, nodes);
    expect(result.screenId).toBeNull();
    expect(result.ranked).toHaveLength(0);
  });

  it("ranked는 내림차순", () => {
    const screenA = makeScreen("LoginScreen", [
      { type: "Button", label: "로그인" },
      { type: "Button", label: "회원가입" },
    ]);
    const screenB = makeScreen("ShopScreen", [
      { type: "Text", label: "담기" },
    ]);
    const appMap = makeAppMap([screenA, screenB]);
    const nodes = loadNodes("simple.xml");
    const result = identifyScreen(appMap, nodes);
    if (result.ranked.length >= 2) {
      expect(result.ranked[0].similarity).toBeGreaterThanOrEqual(
        result.ranked[1].similarity
      );
    }
  });
});
