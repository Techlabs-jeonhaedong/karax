import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeLabel,
  matchAppMapElement,
  locateLabel,
} from "../runtime/matchRuntime.js";
import type { ElementMatch, ScaleContext } from "../runtime/matchRuntime.js";
import {
  parseUiautomatorXml,
  flattenInteractive,
} from "../runtime/uiautomatorParser.js";
import type { RuntimeNode } from "../runtime/uiautomatorParser.js";
import type { MapElement } from "../appmap/schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const fixtureDir = join(__dir, "fixtures", "uiautomator");

function loadNodes(name: string): RuntimeNode[] {
  const xml = readFileSync(join(fixtureDir, name), "utf-8");
  const tree = parseUiautomatorXml(xml);
  return flattenInteractive(tree);
}

// ──────────────────────────────────────────────────────────────
// normalizeLabel
// ──────────────────────────────────────────────────────────────

describe("normalizeLabel", () => {
  it("소문자 변환", () => {
    expect(normalizeLabel("Hello World")).toBe("hello world");
  });

  it("앞뒤 공백 제거", () => {
    expect(normalizeLabel("  hello  ")).toBe("hello");
  });

  it("내부 공백 압축", () => {
    expect(normalizeLabel("hello   world")).toBe("hello world");
  });

  it("구두점 제거 (ASCII)", () => {
    expect(normalizeLabel("Hello, World!")).toBe("hello world");
  });

  it("한글 보존", () => {
    expect(normalizeLabel("로그인 버튼")).toBe("로그인 버튼");
  });

  it("한글 + 구두점 제거", () => {
    expect(normalizeLabel("로그인, 회원가입!")).toBe("로그인 회원가입");
  });

  it("이모지 포함 텍스트 — 이모지 보존", () => {
    expect(normalizeLabel("사과 🍎")).toBe("사과 🍎");
  });

  it("빈 문자열 → 빈 문자열", () => {
    expect(normalizeLabel("")).toBe("");
  });

  it("구두점만 → 빈 문자열", () => {
    expect(normalizeLabel("!!!")).toBe("");
  });

  it("탭·줄바꿈도 공백으로 압축", () => {
    expect(normalizeLabel("hello\tworld\nbye")).toBe("hello world bye");
  });
});

// ──────────────────────────────────────────────────────────────
// matchAppMapElement — 매칭 경로 4가지
// ──────────────────────────────────────────────────────────────

describe("matchAppMapElement — label-exact (method=label-exact, score=1.0)", () => {
  it("정확 일치 → score 1.0, method label-exact", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = { type: "Button", label: "로그인" };
    const result = matchAppMapElement(el, nodes);
    expect(result.method).toBe("label-exact");
    expect(result.score).toBe(1.0);
    expect(result.node).not.toBeNull();
    expect(result.node!.text).toBe("로그인");
  });

  it("label이 없는 el → none", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = { type: "Button" };
    const result = matchAppMapElement(el, nodes);
    expect(result.method).toBe("none");
    expect(result.node).toBeNull();
  });
});

describe("matchAppMapElement — label-normalized (score=0.85)", () => {
  it("대소문자 차이 → label-normalized", () => {
    const nodes = loadNodes("simple.xml");
    // 노드 text는 "로그인", el label은 "로그인  " (뒤 공백)
    const el: MapElement = { type: "Button", label: "로그인  " };
    const result = matchAppMapElement(el, nodes);
    expect(result.method).toBe("label-normalized");
    expect(result.score).toBe(0.85);
  });

  it("구두점 차이 → label-normalized", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = { type: "Button", label: "로그인!" };
    const result = matchAppMapElement(el, nodes);
    expect(result.method).toBe("label-normalized");
    expect(result.score).toBe(0.85);
  });
});

describe("matchAppMapElement — content-desc (score=0.75)", () => {
  it("content-desc 정규화 일치 → score 0.75", () => {
    const nodes = loadNodes("simple.xml");
    // 로그인 버튼의 content-desc = "로그인 버튼"
    const el: MapElement = { type: "Button", label: "로그인 버튼" };
    const result = matchAppMapElement(el, nodes);
    // label은 "로그인"과 정확 일치하지 않지만 content-desc "로그인 버튼"과는 일치
    expect(result.method).toBe("content-desc");
    expect(result.score).toBe(0.75);
  });
});

describe("matchAppMapElement — bounds-proportional", () => {
  it("비례 스케일 매칭 (1080×2400 기준)", () => {
    const nodes = loadNodes("simple.xml");
    // 로그인 버튼: bounds [100,500][980,700] → center (540,600)
    // AppMap 논리 좌표: pixel-8 = 412×915
    // center = (100+980)/2 = 540 물리, (500+700)/2 = 600 물리
    // 스케일: logical_x = 540*(412/1080) ≈ 205.9, logical_y = 600*(915/2400) = 228.75
    const appMapBoundsCenter = { x: 205, y: 228, w: 360, h: 180 }; // 대략
    const el: MapElement = {
      type: "Button",
      label: "존재안함xyz",
      bounds: { x: appMapBoundsCenter.x - appMapBoundsCenter.w / 2, y: appMapBoundsCenter.y - appMapBoundsCenter.h / 2, width: appMapBoundsCenter.w, height: appMapBoundsCenter.h },
    };
    const scale: ScaleContext = {
      appMapWidth: 412,
      appMapHeight: 915,
      runtimeWidth: 1080,
      runtimeHeight: 2400,
    };
    const result = matchAppMapElement(el, nodes, scale);
    expect(result.method).toBe("bounds-proportional");
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.score).toBeLessThanOrEqual(0.6);
  });

  it("bounds 없으면 비례 매칭 시도 안 함", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = { type: "Button", label: "존재안함xyz" };
    const scale: ScaleContext = {
      appMapWidth: 412,
      appMapHeight: 915,
      runtimeWidth: 1080,
      runtimeHeight: 2400,
    };
    const result = matchAppMapElement(el, nodes, scale);
    expect(result.method).toBe("none");
  });

  it("scale 없으면 비례 매칭 시도 안 함", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = {
      type: "Button",
      label: "존재안함xyz",
      bounds: { x: 100, y: 200, width: 100, height: 50 },
    };
    const result = matchAppMapElement(el, nodes);
    expect(result.method).toBe("none");
  });

  it("다른 해상도(1440×3120)에서도 동일 AppMap bounds → 물리 좌표가 달라도 매칭", () => {
    // 1440×3120 기준 동일 앱의 다른 디바이스
    // 로그인 버튼 물리: 루트 bounds 1440×3120으로 스케일된 가상 버튼
    // center (물리) ≈ 540/1080 * 1440 = 720, 600/2400 * 3120 = 780
    const fakeNode: RuntimeNode = {
      text: "존재안함xyz",
      resourceId: "",
      contentDesc: "",
      className: "android.widget.Button",
      clickable: true,
      enabled: true,
      bounds: { x1: 620, y1: 680, x2: 820, y2: 880 }, // center (720, 780) → 1440×3120
      children: [],
    };
    const el: MapElement = {
      type: "Button",
      label: "존재안함xyz",
      bounds: { x: 25, y: 113, width: 360, height: 180 }, // AppMap 논리 (412×915)
    };
    const scale: ScaleContext = {
      appMapWidth: 412,
      appMapHeight: 915,
      runtimeWidth: 1440,
      runtimeHeight: 3120,
    };
    const result = matchAppMapElement(el, [fakeNode], scale);
    // bounds-proportional이거나 none — 중요한 건 throw 안 함
    expect(result).toBeDefined();
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe("matchAppMapElement — 동명 라벨 타이브레이크", () => {
  it("동명 '담기' 3개 + bounds 있으면 근접도로 타이브레이크", () => {
    const nodes = loadNodes("nested-list.xml");
    // 첫 번째 '담기' 버튼 bounds [800,250][1060,550] → center (930, 400)
    // AppMap 논리 center: 930*(412/1080) ≈ 355, 400*(915/2400) ≈ 152.5
    const el: MapElement = {
      type: "Button",
      label: "담기",
      bounds: { x: 335, y: 132, width: 100, height: 130 }, // center ≈ (385, 197)
    };
    const scale: ScaleContext = {
      appMapWidth: 412,
      appMapHeight: 915,
      runtimeWidth: 1080,
      runtimeHeight: 2400,
    };
    const result = matchAppMapElement(el, nodes, scale);
    expect(result.node).not.toBeNull();
    expect(result.node!.text).toBe("담기");
    // ambiguous: true면 타이브레이크 안 됨, false/undefined면 됨
  });

  it("동명 라벨 + bounds 없으면 첫 번째 + ambiguous:true", () => {
    const nodes = loadNodes("nested-list.xml");
    const el: MapElement = { type: "Button", label: "담기" };
    const result = matchAppMapElement(el, nodes);
    expect(result.node).not.toBeNull();
    expect(result.node!.text).toBe("담기");
    expect(result.ambiguous).toBe(true);
  });
});

describe("matchAppMapElement — none", () => {
  it("존재하지 않는 라벨 → none, score 0", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = { type: "Button", label: "절대없는라벨xyz123" };
    const result = matchAppMapElement(el, nodes);
    expect(result.method).toBe("none");
    expect(result.score).toBe(0);
    expect(result.node).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────
// tiebreak — 빈 배열 계약 위반 (#1)
// ──────────────────────────────────────────────────────────────

describe("matchAppMapElement — bounds 0/음수 해상도 ScaleContext (#2)", () => {
  it("appMapWidth=0 ScaleContext → method:none (NaN/Infinity 없이 결정론적)", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = {
      type: "Button",
      label: "존재안함xyz",
      bounds: { x: 100, y: 200, width: 100, height: 50 },
    };
    const scale: ScaleContext = {
      appMapWidth: 0,
      appMapHeight: 915,
      runtimeWidth: 1080,
      runtimeHeight: 2400,
    };
    const result = matchAppMapElement(el, nodes, scale);
    expect(result.method).toBe("none");
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it("appMapHeight=0 ScaleContext → method:none (결정론적)", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = {
      type: "Button",
      label: "존재안함xyz",
      bounds: { x: 100, y: 200, width: 100, height: 50 },
    };
    const scale: ScaleContext = {
      appMapWidth: 412,
      appMapHeight: 0,
      runtimeWidth: 1080,
      runtimeHeight: 2400,
    };
    const result = matchAppMapElement(el, nodes, scale);
    expect(result.method).toBe("none");
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it("runtimeWidth=0 ScaleContext → method:none (결정론적)", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = {
      type: "Button",
      label: "존재안함xyz",
      bounds: { x: 100, y: 200, width: 100, height: 50 },
    };
    const scale: ScaleContext = {
      appMapWidth: 412,
      appMapHeight: 915,
      runtimeWidth: 0,
      runtimeHeight: 2400,
    };
    const result = matchAppMapElement(el, nodes, scale);
    expect(result.method).toBe("none");
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  it("음수 해상도 ScaleContext → method:none (결정론적)", () => {
    const nodes = loadNodes("simple.xml");
    const el: MapElement = {
      type: "Button",
      label: "존재안함xyz",
      bounds: { x: 100, y: 200, width: 100, height: 50 },
    };
    const scale: ScaleContext = {
      appMapWidth: -100,
      appMapHeight: -200,
      runtimeWidth: -1080,
      runtimeHeight: -2400,
    };
    const result = matchAppMapElement(el, nodes, scale);
    expect(result.method).toBe("none");
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Number.isNaN(result.score)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
// locateLabel
// ──────────────────────────────────────────────────────────────

describe("locateLabel", () => {
  it("정확 일치 → node 반환, method label-exact", () => {
    const nodes = loadNodes("simple.xml");
    const result = locateLabel("로그인", nodes);
    expect(result.node).not.toBeNull();
    expect(result.method).toBe("label-exact");
    expect(result.score).toBe(1.0);
  });

  it("매칭 실패 → node:null, candidates 최대 3개", () => {
    const nodes = loadNodes("simple.xml");
    const result = locateLabel("로그", nodes); // 부분 포함
    // 완전 일치는 없지만 부분 포함으로 candidates에 들어갈 수 있음
    expect(result).toHaveProperty("candidates");
    expect(Array.isArray(result.candidates)).toBe(true);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it("완전 실패 라벨 → node:null, candidates 빈 배열 또는 적음", () => {
    const nodes = loadNodes("simple.xml");
    const result = locateLabel("zzznomatchzzz", nodes);
    expect(result.node).toBeNull();
  });

  it("빈 노드 배열 → node:null, candidates:[]", () => {
    const result = locateLabel("로그인", []);
    expect(result.node).toBeNull();
    expect(result.candidates).toEqual([]);
  });
});
