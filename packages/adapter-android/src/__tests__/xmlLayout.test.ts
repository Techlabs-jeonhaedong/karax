/**
 * XML layout 레거시 경로 테스트 (M9b)
 *
 * 테스트 대상:
 * - parseXmlLayout: res/layout/*.xml → IRNode 트리
 * - discoverXmlLayouts: Manifest + Activity 소스 연결 → ScreenSummary[]
 * - buildXmlScreenIR: XML layout → IRDocument
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseXmlLayout,
  discoverXmlLayouts,
  buildXmlScreenIR,
} from "../xml/xmlLayoutAdapter.js";
import type { IRNode } from "@sfc/core";
import { safeParseIRDocument } from "@sfc/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(
  __dirname,
  "fixtures/xml-layout-case"
);

// ── parseXmlLayout ──────────────────────────────────────────────────────────

describe("parseXmlLayout — activity_main.xml", () => {
  it("LinearLayout(vertical) → Column 루트 노드를 반환한다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const strings = new Map([
      ["app_name", "XML Fixture App"],
      ["btn_primary", "Get Started"],
      ["btn_secondary", "Learn More"],
      ["search_hint", "Search…"],
    ]);
    const colors = new Map([
      ["background", "#FFFFFF"],
      ["text_primary", "#212121"],
    ]);

    const node = await parseXmlLayout(layoutPath, strings, colors);

    expect(node).toBeDefined();
    expect(node.type).toBe("Column");
  });

  it("layout_width=match_parent → width='fill'이다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    expect(node.layout?.width).toBe("fill");
  });

  it("layout_height=match_parent → height='fill'이다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    expect(node.layout?.height).toBe("fill");
  });

  it("children에 TextView→Text, ImageView→Image, EditText→Input, ListView→Scroll이 포함된다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());

    const allNodes = collectAllNodes(node);
    const types = allNodes.map((n) => n.type);

    expect(types).toContain("Text");
    expect(types).toContain("Image");
    expect(types).toContain("Input");
    expect(types).toContain("Scroll");
  });

  it("@string/app_name → 실제 문자열로 해석된다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const strings = new Map([["app_name", "XML Fixture App"]]);
    const node = await parseXmlLayout(layoutPath, strings, new Map());

    const allNodes = collectAllNodes(node);
    const texts = allNodes
      .filter((n) => n.type === "Text")
      .map((n) => n.text?.value);

    expect(texts).toContain("XML Fixture App");
  });

  it("@color/background → style.background에 색상 hex가 설정된다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const colors = new Map([["background", "#FFFFFF"]]);
    const node = await parseXmlLayout(layoutPath, new Map(), colors);

    expect(node.style?.background).toBe("#FFFFFF");
  });

  it("내부 LinearLayout(horizontal) → Row 노드를 생성한다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());

    const allNodes = collectAllNodes(node);
    const rowNodes = allNodes.filter((n) => n.type === "Row");
    expect(rowNodes.length).toBeGreaterThan(0);
  });

  it("Button 노드를 포함한다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());

    const allNodes = collectAllNodes(node);
    const buttons = allNodes.filter((n) => n.type === "Button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("padding 속성이 layout에 반영된다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    // android:padding="16dp" → [16, 16, 16, 16]
    expect(node.layout?.padding).toEqual([16, 16, 16, 16]);
  });
});

describe("parseXmlLayout — activity_detail.xml", () => {
  it("RelativeLayout → Stack 루트 노드를 반환한다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_detail.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    expect(node.type).toBe("Stack");
  });

  it("ScrollView → Scroll 노드를 포함한다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_detail.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());

    const allNodes = collectAllNodes(node);
    expect(allNodes.some((n) => n.type === "Scroll")).toBe(true);
  });

  it("@string 참조가 text.value로 해석된다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_detail.xml"
    );
    const strings = new Map([
      ["detail_title", "Detail Screen"],
      ["detail_body", "This is the detail description body text."],
      ["btn_action", "Confirm"],
    ]);
    const node = await parseXmlLayout(layoutPath, strings, new Map());

    const allNodes = collectAllNodes(node);
    const textValues = allNodes
      .filter((n) => n.type === "Text")
      .map((n) => n.text?.value);

    expect(textValues).toContain("Detail Screen");
  });
});

describe("parseXmlLayout — layout_orphan.xml (FrameLayout)", () => {
  it("FrameLayout → Stack 루트 노드를 반환한다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/layout_orphan.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    expect(node.type).toBe("Stack");
  });

  it("내부 TextView → Text 노드를 포함한다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/layout_orphan.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    const allNodes = collectAllNodes(node);
    expect(allNodes.some((n) => n.type === "Text")).toBe(true);
  });
});

// ── discoverXmlLayouts ──────────────────────────────────────────────────────

describe("discoverXmlLayouts", () => {
  it("2개 Activity(setContentView)에서 2개 route 화면을 발견한다", async () => {
    const screens = await discoverXmlLayouts(FIXTURE);
    const routes = screens.filter((s) => s.discovery === "route");
    expect(routes.length).toBe(2);
  });

  it("MainActivity → activity_main 레이아웃을 route로 발견한다", async () => {
    const screens = await discoverXmlLayouts(FIXTURE);
    const main = screens.find(
      (s) => s.id === "activity_main" && s.discovery === "route"
    );
    expect(main).toBeDefined();
    expect(main?.sourceRef?.file).toMatch(/activity_main\.xml/);
  });

  it("DetailActivity → activity_detail 레이아웃을 route로 발견한다", async () => {
    const screens = await discoverXmlLayouts(FIXTURE);
    const detail = screens.find(
      (s) => s.id === "activity_detail" && s.discovery === "route"
    );
    expect(detail).toBeDefined();
  });

  it("미참조 layout_orphan.xml → candidate로 발견된다", async () => {
    const screens = await discoverXmlLayouts(FIXTURE);
    const orphan = screens.find(
      (s) => s.id === "layout_orphan" && s.discovery === "candidate"
    );
    expect(orphan).toBeDefined();
  });

  it("route 화면의 confidence는 1.0이다", async () => {
    const screens = await discoverXmlLayouts(FIXTURE);
    const routes = screens.filter((s) => s.discovery === "route");
    for (const s of routes) {
      expect(s.confidence).toBe(1.0);
    }
  });

  it("candidate 화면의 confidence는 0.6이다", async () => {
    const screens = await discoverXmlLayouts(FIXTURE);
    const candidates = screens.filter((s) => s.discovery === "candidate");
    for (const s of candidates) {
      expect(s.confidence).toBe(0.6);
    }
  });

  it("존재하지 않는 프로젝트 경로 → 빈 배열을 반환한다", async () => {
    const screens = await discoverXmlLayouts("/tmp/nonexistent-xml-fixture-test");
    expect(screens).toEqual([]);
  });
});

// ── buildXmlScreenIR ────────────────────────────────────────────────────────

describe("buildXmlScreenIR — activity_main", () => {
  it("IRDocument zod 스키마를 통과한다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    const result = safeParseIRDocument(doc);
    expect(result.success).toBe(true);
  });

  it("schemaVersion이 0.1이다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    expect(doc.schemaVersion).toBe("0.1");
  });

  it("screen.id가 'activity_main'이다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    expect(doc.screen.id).toBe("activity_main");
  });

  it("discovery='route'이다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    expect(doc.screen.discovery).toBe("route");
  });

  it("confidence > 0이다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    expect(doc.screen.confidence).toBeGreaterThan(0);
  });

  it("root 노드 타입이 Column이다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    expect(doc.screen.root.type).toBe("Column");
  });

  it("designTokens.colors에 background 색이 있다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    expect(doc.designTokens?.colors?.background).toBeDefined();
  });

  it("sourceRef.file이 activity_main.xml을 가리킨다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    expect(doc.screen.sourceRef?.file).toMatch(/activity_main\.xml/);
  });
});

describe("buildXmlScreenIR — layout_orphan (candidate)", () => {
  it("IRDocument를 반환하며 discovery='candidate'이다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "layout_orphan", 42);
    expect(doc.screen.discovery).toBe("candidate");
  });
});

describe("buildXmlScreenIR — 존재하지 않는 screenId", () => {
  it("Unknown root 노드를 반환하며 confidence=0이다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "nonexistent_layout", 42);
    expect(doc.screen.root.type).toBe("Unknown");
    expect(doc.screen.confidence).toBe(0);
  });
});

// ── 엣지 케이스 ─────────────────────────────────────────────────────────────

describe("parseXmlLayout — 엣지 케이스", () => {
  it("@string 참조가 없는(미해석) 텍스트는 리터럴로 반환된다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/layout_orphan.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    const allNodes = collectAllNodes(node);
    const textNodes = allNodes.filter((n) => n.type === "Text");
    // 'Orphan Layout' 리터럴 텍스트가 그대로 존재
    expect(textNodes.some((n) => n.text?.value === "Orphan Layout")).toBe(true);
  });

  it("@drawable 참조 → src='asset://xxx' 형식으로 설정된다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    const allNodes = collectAllNodes(node);
    const images = allNodes.filter((n) => n.type === "Image");
    expect(images.some((n) => n.src?.startsWith("asset://"))).toBe(true);
  });

  it("layout_weight → layout.flex에 반영된다", async () => {
    const layoutPath = path.join(
      FIXTURE,
      "app/src/main/res/layout/activity_main.xml"
    );
    const node = await parseXmlLayout(layoutPath, new Map(), new Map());
    const allNodes = collectAllNodes(node);
    const nodesWithFlex = allNodes.filter(
      (n) => n.layout?.flex !== undefined && n.layout.flex > 0
    );
    expect(nodesWithFlex.length).toBeGreaterThan(0);
  });
});

// ── IR 스냅샷 테스트 ─────────────────────────────────────────────────────────

describe("buildXmlScreenIR — IR 스냅샷", () => {
  it("activity_main IR 구조가 스냅샷과 일치한다", async () => {
    const doc = await buildXmlScreenIR(FIXTURE, "activity_main", 42);
    expect(doc.screen.root.type).toMatchSnapshot();
    expect(doc.screen.root.layout?.width).toMatchSnapshot();
    expect(doc.screen.root.layout?.height).toMatchSnapshot();
    expect(doc.designTokens?.colors).toMatchSnapshot();
  });
});

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function collectAllNodes(node: IRNode): IRNode[] {
  const result: IRNode[] = [node];
  for (const child of node.children ?? []) {
    result.push(...collectAllNodes(child));
  }
  return result;
}
