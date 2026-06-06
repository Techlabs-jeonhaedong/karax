import { describe, it, expect } from "vitest";
import { assembleAppMap, extractElementStyle, matchElement } from "../appmap/assemble.js";
import type { ScreenSummary } from "../appmap/assemble.js";
import { AppMapSchema } from "../appmap/schema.js";
import type { NavigationGraph, MapElement, TriggerInfo } from "../appmap/schema.js";
import type { IRDocument, IRNode } from "../ir/schema.js";

/** 최소 IRDocument 팩토리 */
function makeIR(screenId: string): IRDocument {
  return {
    schemaVersion: "1",
    screen: {
      id: screenId,
      discovery: "route",
      confidence: 1.0,
      root: {
        type: "Box",
        confidence: 1.0,
        children: [
          {
            type: "Button",
            confidence: 1.0,
            text: { value: "Go to Detail" },
          },
        ],
      },
    },
    diagnostics: [],
  };
}

const screens: ScreenSummary[] = [
  { id: "HomeScreen", title: "Home Screen", discovery: "route", confidence: 1.0 },
  { id: "DetailScreen", title: "Detail Screen", discovery: "route", confidence: 1.0 },
  { id: "OrphanScreen", title: "Orphan Screen", discovery: "candidate", confidence: 0.6 },
];

const navGraph: NavigationGraph = {
  entryScreenId: "HomeScreen",
  edges: [
    {
      from: "HomeScreen",
      to: "DetailScreen",
      action: "push",
      trigger: { kind: "button", label: "View Details" },
      confidence: 1.0,
      diagnostics: [],
    },
    {
      from: "DetailScreen",
      to: null,
      action: "pop",
      trigger: { kind: "back" },
      confidence: 1.0,
      diagnostics: [],
    },
  ],
  diagnostics: [],
};

describe("assembleAppMap", () => {
  it("screens, navGraph, IRDocument를 결합해 AppMap을 생성한다", () => {
    const irDocs: IRDocument[] = [makeIR("HomeScreen"), makeIR("DetailScreen")];
    const appMap = assembleAppMap({
      appName: "TestApp",
      framework: "flutter",
      screens,
      navGraph,
      irDocs,
    });

    expect(appMap.schemaVersion).toBe("appmap/2");
    expect(appMap.appName).toBe("TestApp");
    expect(appMap.framework).toBe("flutter");
    expect(appMap.entryScreenId).toBe("HomeScreen");
    expect(appMap.screens.length).toBe(3);
  });

  it("HomeScreen이 isEntry=true로 표시된다", () => {
    const irDocs: IRDocument[] = [makeIR("HomeScreen")];
    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens,
      navGraph,
      irDocs,
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    expect(homeNode?.isEntry).toBe(true);

    const detailNode = appMap.screens.find((s) => s.id === "DetailScreen");
    expect(detailNode?.isEntry).toBe(false);
  });

  it("ScreenNode.outgoing에 해당 화면의 엣지만 분배된다", () => {
    const irDocs: IRDocument[] = [makeIR("HomeScreen"), makeIR("DetailScreen")];
    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens,
      navGraph,
      irDocs,
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    expect(homeNode?.outgoing.length).toBe(1);
    expect(homeNode?.outgoing[0].to).toBe("DetailScreen");

    const detailNode = appMap.screens.find((s) => s.id === "DetailScreen");
    expect(detailNode?.outgoing.length).toBe(1);
    expect(detailNode?.outgoing[0].action).toBe("pop");
  });

  it("IR에서 Button 요소를 elements로 추출한다", () => {
    const irDocs: IRDocument[] = [makeIR("HomeScreen")];
    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [screens[0]!],
      navGraph: { entryScreenId: "HomeScreen", edges: [], diagnostics: [] },
      irDocs,
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    const buttonElem = homeNode?.elements.find((e) => e.type === "Button");
    expect(buttonElem).toBeDefined();
    expect(buttonElem?.label).toBe("Go to Detail");
  });

  it("Button 자식 Text에서 라벨을 가져온다 (node.text 없는 경우)", () => {
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "HomeScreen",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            {
              type: "Button",
              confidence: 1.0,
              // text 없음 — 자식 Text 노드에 라벨이 있는 실제 Flutter 패턴
              children: [
                {
                  type: "Text",
                  confidence: 1.0,
                  text: { value: "View Product Details" },
                },
              ],
            },
          ],
        },
      },
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "HomeScreen", edges: [], diagnostics: [] },
      irDocs: [irDoc],
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    const buttonElem = homeNode?.elements.find((e) => e.type === "Button");
    expect(buttonElem).toBeDefined();
    expect(buttonElem?.label).toBe("View Product Details");
  });

  it("Button 자식 Text가 token만 있을 때도 라벨을 가져온다", () => {
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            {
              type: "Button",
              confidence: 1.0,
              children: [
                {
                  type: "Text",
                  confidence: 1.0,
                  text: { token: "btn.submit" },
                },
              ],
            },
          ],
        },
      },
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "S", edges: [], diagnostics: [] },
      irDocs: [irDoc],
    });

    const buttonElem = appMap.screens[0]?.elements.find((e) => e.type === "Button");
    expect(buttonElem?.label).toBe("btn.submit");
  });

  it("Button에 자식 Text가 없으면 label이 undefined이다", () => {
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            {
              type: "Button",
              confidence: 1.0,
              // text 없고 자식도 없음
            },
          ],
        },
      },
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "S", edges: [], diagnostics: [] },
      irDocs: [irDoc],
    });

    const buttonElem = appMap.screens[0]?.elements.find((e) => e.type === "Button");
    expect(buttonElem).toBeDefined();
    expect(buttonElem?.label).toBeUndefined();
  });

  it("IRDocument 없는 화면은 elements=[]로 처리된다", () => {
    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "OrphanScreen", discovery: "candidate", confidence: 0.6 }],
      navGraph: { entryScreenId: null, edges: [], diagnostics: [] },
      irDocs: [],
    });

    const orphanNode = appMap.screens.find((s) => s.id === "OrphanScreen");
    expect(orphanNode?.elements).toEqual([]);
  });

  it("overallConfidence는 모든 엣지 confidence 평균이다 (엣지 없으면 화면 평균)", () => {
    const irDocs: IRDocument[] = [];
    const simpleScreens: ScreenSummary[] = [
      { id: "A", discovery: "route", confidence: 1.0 },
      { id: "B", discovery: "route", confidence: 0.6 },
    ];
    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: simpleScreens,
      navGraph: { entryScreenId: "A", edges: [], diagnostics: [] },
      irDocs,
    });

    // 엣지 없을 때 화면 confidence 평균
    expect(appMap.overallConfidence).toBeCloseTo(0.8, 2);
  });

  it("빈 screens와 빈 edges로도 AppMap이 생성된다", () => {
    const appMap = assembleAppMap({
      appName: "Empty",
      framework: "flutter",
      screens: [],
      navGraph: { entryScreenId: null, edges: [], diagnostics: [] },
      irDocs: [],
    });

    expect(appMap.screens).toEqual([]);
    expect(appMap.edges).toEqual([]);
    expect(appMap.overallConfidence).toBe(0);
  });
});

// ── extractElementStyle 테스트 ────────────────────────────────────────

describe("extractElementStyle", () => {
  it("style 필드가 없으면 undefined를 반환한다", () => {
    const node: IRNode = { type: "Button", confidence: 1.0 };
    expect(extractElementStyle(node)).toBeUndefined();
  });

  it("style 필드가 모두 없으면 undefined를 반환한다", () => {
    const node: IRNode = { type: "Button", confidence: 1.0, style: {} };
    expect(extractElementStyle(node)).toBeUndefined();
  });

  it("background를 추출한다", () => {
    const node: IRNode = {
      type: "Button",
      confidence: 1.0,
      style: { background: "#007AFF" },
    };
    const result = extractElementStyle(node);
    expect(result?.background).toBe("#007AFF");
  });

  it("borderRadius를 추출한다", () => {
    const node: IRNode = {
      type: "Button",
      confidence: 1.0,
      style: { borderRadius: 8 },
    };
    expect(extractElementStyle(node)?.borderRadius).toBe(8);
  });

  it("border.color → borderColor, border.width → borderWidth 매핑한다", () => {
    const node: IRNode = {
      type: "Button",
      confidence: 1.0,
      style: { border: { color: "#ccc", width: 2 } },
    };
    const result = extractElementStyle(node);
    expect(result?.borderColor).toBe("#ccc");
    expect(result?.borderWidth).toBe(2);
  });

  it("opacity를 추출한다", () => {
    const node: IRNode = {
      type: "Button",
      confidence: 1.0,
      style: { opacity: 0.5 },
    };
    expect(extractElementStyle(node)?.opacity).toBe(0.5);
  });

  it("text.color → textColor 매핑한다", () => {
    const node: IRNode = {
      type: "Button",
      confidence: 1.0,
      text: { color: "#333" },
    };
    expect(extractElementStyle(node)?.textColor).toBe("#333");
  });

  it("여러 style 필드를 동시에 추출한다", () => {
    const node: IRNode = {
      type: "Button",
      confidence: 1.0,
      style: { background: "#fff", borderRadius: 4, opacity: 0.9, border: { color: "#aaa", width: 1 } },
      text: { color: "#111" },
    };
    const result = extractElementStyle(node);
    expect(result).toEqual({
      background: "#fff",
      borderRadius: 4,
      opacity: 0.9,
      borderColor: "#aaa",
      borderWidth: 1,
      textColor: "#111",
    });
  });

  it("shadow 필드는 무시한다 (ElementStyle에 없음)", () => {
    const node: IRNode = {
      type: "Button",
      confidence: 1.0,
      style: { shadow: { blur: 4, color: "#000" } },
    };
    // shadow는 추출 대상 아님 — 나머지 없으면 undefined
    expect(extractElementStyle(node)).toBeUndefined();
  });
});

// ── matchElement 테스트 ───────────────────────────────────────────────

describe("matchElement", () => {
  const makeElement = (overrides: Partial<MapElement> & Pick<MapElement, "type">): MapElement => ({
    ...overrides,
  });

  it("elementRef.file+line 근접 매칭(TOL=2)이 성공한다", () => {
    const elements: MapElement[] = [
      makeElement({
        type: "Button",
        label: "Submit",
        sourceRef: { file: "lib/home.dart", line: 42 },
      }),
    ];
    const trigger: TriggerInfo = {
      kind: "button",
      elementRef: { file: "lib/home.dart", line: 43 }, // 차이 1
    };
    const result = matchElement(trigger, elements);
    expect(result).toBeDefined();
    expect(result?.label).toBe("Submit");
  });

  it("line 차이가 TOL(2) 이내인 것 중 최근접을 반환한다", () => {
    const elements: MapElement[] = [
      makeElement({ type: "Button", label: "Far", sourceRef: { file: "lib/home.dart", line: 50 } }),
      makeElement({ type: "Button", label: "Near", sourceRef: { file: "lib/home.dart", line: 41 } }),
    ];
    const trigger: TriggerInfo = {
      kind: "button",
      elementRef: { file: "lib/home.dart", line: 42 },
    };
    const result = matchElement(trigger, elements);
    expect(result?.label).toBe("Near"); // |41-42|=1 < |50-42|=8
  });

  it("line 차이가 TOL(2)를 초과하면 elementRef 매칭 실패, label fallback으로 간다", () => {
    const elements: MapElement[] = [
      makeElement({
        type: "Button",
        label: "Submit",
        sourceRef: { file: "lib/home.dart", line: 100 },
      }),
    ];
    const trigger: TriggerInfo = {
      kind: "button",
      label: "Submit",
      elementRef: { file: "lib/home.dart", line: 42 }, // |100-42|=58 초과
    };
    // elementRef 매칭 실패 → label fallback
    const result = matchElement(trigger, elements);
    expect(result?.label).toBe("Submit");
  });

  it("file이 다르면 elementRef 매칭 안 함", () => {
    const elements: MapElement[] = [
      makeElement({
        type: "Button",
        label: "Submit",
        sourceRef: { file: "lib/other.dart", line: 42 },
      }),
    ];
    const trigger: TriggerInfo = {
      kind: "button",
      elementRef: { file: "lib/home.dart", line: 42 },
    };
    expect(matchElement(trigger, elements)).toBeUndefined();
  });

  it("elementRef.line이 없으면 elementRef 기반 매칭 스킵", () => {
    const elements: MapElement[] = [
      makeElement({
        type: "Button",
        label: "LabelMatch",
        sourceRef: { file: "lib/home.dart", line: 5 },
      }),
    ];
    const trigger: TriggerInfo = {
      kind: "button",
      label: "LabelMatch",
      elementRef: { file: "lib/home.dart" }, // line 없음
    };
    const result = matchElement(trigger, elements);
    // line 없으면 elementRef 매칭 스킵 → label fallback
    expect(result?.label).toBe("LabelMatch");
  });

  it("label fallback 매칭이 성공한다", () => {
    const elements: MapElement[] = [
      makeElement({ type: "Button", label: "Login" }),
      makeElement({ type: "Button", label: "Register" }),
    ];
    const trigger: TriggerInfo = { kind: "button", label: "Login" };
    expect(matchElement(trigger, elements)?.label).toBe("Login");
  });

  it("elementRef도 label도 없으면 undefined를 반환한다", () => {
    const elements: MapElement[] = [
      makeElement({ type: "Button", label: "Login" }),
    ];
    const trigger: TriggerInfo = { kind: "button" };
    expect(matchElement(trigger, elements)).toBeUndefined();
  });

  it("elements가 빈 배열이면 undefined를 반환한다", () => {
    const trigger: TriggerInfo = {
      kind: "button",
      label: "Login",
      elementRef: { file: "lib/home.dart", line: 5 },
    };
    expect(matchElement(trigger, [])).toBeUndefined();
  });

  it("element.sourceRef.line이 없어도 line이 있는 쪽이 매칭 스킵됨", () => {
    // element에 line 없으면 |line 차이| 비교 불가 → 해당 element 스킵
    const elements: MapElement[] = [
      makeElement({ type: "Button", label: "NoLine", sourceRef: { file: "lib/home.dart" } }), // line 없음
      makeElement({ type: "Button", label: "HasLine", sourceRef: { file: "lib/home.dart", line: 42 } }),
    ];
    const trigger: TriggerInfo = {
      kind: "button",
      elementRef: { file: "lib/home.dart", line: 42 },
    };
    const result = matchElement(trigger, elements);
    expect(result?.label).toBe("HasLine");
  });
});

// ── assembleAppMap — style 주입 + TRIGGER_UNMATCHED 테스트 ─────────────

describe("assembleAppMap — style 주입 및 매칭 실패 diagnostics", () => {
  function makeIRWithStyle(screenId: string): IRDocument {
    return {
      schemaVersion: "1",
      screen: {
        id: screenId,
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            {
              type: "Button",
              confidence: 1.0,
              text: { value: "View Details", color: "#fff" },
              style: { background: "#007AFF", borderRadius: 8, opacity: 1.0 },
              sourceRef: { file: "lib/home.dart", line: 42 },
            },
          ],
        },
      },
      diagnostics: [],
    };
  }

  it("elementRef 매칭 성공 시 edge.trigger에 style이 주입된다", () => {
    const navGraph: NavigationGraph = {
      entryScreenId: "HomeScreen",
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          trigger: {
            kind: "button",
            label: "View Details",
            elementRef: { file: "lib/home.dart", line: 42 },
          },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [
        { id: "HomeScreen", discovery: "route", confidence: 1.0 },
        { id: "DetailScreen", discovery: "route", confidence: 1.0 },
      ],
      navGraph,
      irDocs: [makeIRWithStyle("HomeScreen")],
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    const edge = homeNode?.outgoing[0];
    expect(edge?.trigger.style?.background).toBe("#007AFF");
    expect(edge?.trigger.style?.borderRadius).toBe(8);
    expect(edge?.trigger.style?.textColor).toBe("#fff");
  });

  it("매칭된 style이 appMap.edges에도 반영된다 (screenNode.outgoing과 공유)", () => {
    const navGraph: NavigationGraph = {
      entryScreenId: "HomeScreen",
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          trigger: {
            kind: "button",
            label: "View Details",
            elementRef: { file: "lib/home.dart", line: 42 },
          },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [
        { id: "HomeScreen", discovery: "route", confidence: 1.0 },
        { id: "DetailScreen", discovery: "route", confidence: 1.0 },
      ],
      navGraph,
      irDocs: [makeIRWithStyle("HomeScreen")],
    });

    // appMap.edges와 screenNode.outgoing 모두 style이 주입되어야 함
    expect(appMap.edges[0]?.trigger.style?.background).toBe("#007AFF");
  });

  it("매칭 실패 시 edge.diagnostics에 TRIGGER_UNMATCHED가 추가된다", () => {
    const navGraph: NavigationGraph = {
      entryScreenId: "HomeScreen",
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          trigger: { kind: "button", label: "NonExistent" }, // 매칭 안 됨
          confidence: 1.0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [
        { id: "HomeScreen", discovery: "route", confidence: 1.0 },
        { id: "DetailScreen", discovery: "route", confidence: 1.0 },
      ],
      navGraph,
      irDocs: [makeIRWithStyle("HomeScreen")], // Button label은 "View Details"
    });

    const edge = appMap.edges[0];
    const unmatched = edge?.diagnostics.find((d) => d.code === "TRIGGER_UNMATCHED");
    expect(unmatched).toBeDefined();
  });

  it("TRIGGER_UNMATCHED는 screenNode.outgoing.diagnostics에도 반영된다", () => {
    const navGraph: NavigationGraph = {
      entryScreenId: "HomeScreen",
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          // 매칭 단서(label)는 있지만 elements에 없는 라벨 → 매칭 실패
          trigger: { kind: "button", label: "존재하지 않는 라벨" },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph,
      irDocs: [makeIRWithStyle("HomeScreen")],
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    const edgeDiag = homeNode?.outgoing[0]?.diagnostics.find((d) => d.code === "TRIGGER_UNMATCHED");
    expect(edgeDiag).toBeDefined();
  });

  it("IR이 없는 화면의 엣지는 TRIGGER_UNMATCHED가 추가된다 (elements=[]이므로)", () => {
    const navGraph: NavigationGraph = {
      entryScreenId: "HomeScreen",
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          trigger: { kind: "button", label: "Go" },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph,
      irDocs: [], // IR 없음
    });

    const edge = appMap.edges[0];
    expect(edge?.diagnostics.find((d) => d.code === "TRIGGER_UNMATCHED")).toBeDefined();
  });

  it("매칭 성공했지만 요소에 style이 없으면 TRIGGER_UNMATCHED를 추가하지 않는다", () => {
    // ios-swiftui-basic 재현: Button이 매칭되지만 style 프로퍼티 없음
    const irDocNoStyle: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "HomeScreen",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            {
              type: "Button",
              confidence: 1.0,
              text: { value: "View Details" },
              sourceRef: { file: "ContentView.swift", line: 67 },
              // style 없음 — extractElementStyle이 undefined를 반환하는 경우
            },
          ],
        },
      },
      diagnostics: [],
    };

    const navGraph: NavigationGraph = {
      entryScreenId: "HomeScreen",
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          trigger: {
            kind: "button",
            label: "View Details",
            elementRef: { file: "ContentView.swift", line: 67 }, // 정확히 매칭
          },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "ios",
      screens: [
        { id: "HomeScreen", discovery: "route", confidence: 1.0 },
        { id: "DetailScreen", discovery: "route", confidence: 1.0 },
      ],
      navGraph,
      irDocs: [irDocNoStyle],
    });

    const edge = appMap.edges[0];
    // 매칭 성공 → TRIGGER_UNMATCHED 없어야 함
    expect(edge?.diagnostics.find((d) => d.code === "TRIGGER_UNMATCHED")).toBeUndefined();
    // style도 없으니 trigger.style도 없어야 함
    expect(edge?.trigger.style).toBeUndefined();
  });

  it("매칭 성공 + style 없음 — 원본 diagnostics 배열을 그대로 유지한다", () => {
    const irDocNoStyle: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            {
              type: "Button",
              confidence: 1.0,
              text: { value: "Go" },
              sourceRef: { file: "Screen.swift", line: 10 },
            },
          ],
        },
      },
      diagnostics: [],
    };

    const navGraph: NavigationGraph = {
      entryScreenId: "S",
      edges: [
        {
          from: "S",
          to: null,
          action: "pop",
          trigger: {
            kind: "button",
            elementRef: { file: "Screen.swift", line: 10 },
          },
          confidence: 1.0,
          diagnostics: [{ code: "EXISTING_DIAG", message: "기존 diagnostic" }],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "ios",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph,
      irDocs: [irDocNoStyle],
    });

    const edge = appMap.edges[0];
    // 기존 diagnostic은 유지, TRIGGER_UNMATCHED는 추가 안 됨
    expect(edge?.diagnostics.length).toBe(1);
    expect(edge?.diagnostics[0]?.code).toBe("EXISTING_DIAG");
  });

  it("원본 navGraph 객체를 변형하지 않는다 (순수성)", () => {
    const originalEdge = {
      from: "HomeScreen",
      to: "DetailScreen",
      action: "push" as const,
      trigger: { kind: "button" as const, label: "View Details", elementRef: { file: "lib/home.dart", line: 42 } },
      confidence: 1.0,
      diagnostics: [] as { code: string; message: string }[],
    };
    const navGraph: NavigationGraph = {
      entryScreenId: "HomeScreen",
      edges: [originalEdge],
      diagnostics: [],
    };
    const originalDiagLength = originalEdge.diagnostics.length;
    const originalTriggerStyle = (originalEdge.trigger as Record<string, unknown>).style;

    assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph,
      irDocs: [makeIRWithStyle("HomeScreen")],
    });

    // 원본 변형 없음
    expect(originalEdge.diagnostics.length).toBe(originalDiagLength);
    expect((originalEdge.trigger as Record<string, unknown>).style).toBe(originalTriggerStyle);
  });

  it("collectElements에서 MapElement에 style이 첨부된다", () => {
    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "HomeScreen", edges: [], diagnostics: [] },
      irDocs: [makeIRWithStyle("HomeScreen")],
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    const button = homeNode?.elements.find((e) => e.type === "Button");
    expect(button?.style?.background).toBe("#007AFF");
    expect(button?.style?.textColor).toBe("#fff");
  });

  it("style 없는 element는 style 필드가 없다", () => {
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [{ type: "Button", confidence: 1.0, text: { value: "NoStyle" } }],
        },
      },
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "S", edges: [], diagnostics: [] },
      irDocs: [irDoc],
    });

    const button = appMap.screens[0]?.elements.find((e) => e.type === "Button");
    expect(button?.style).toBeUndefined();
  });
});

// ── 단계 7: 전역 엣지 보존·TRIGGER_UNMATCHED 노이즈 방지 ─────────────────────

describe("assembleAppMap — 전역/(global) 엣지 처리", () => {
  it("화면에 귀속되지 않은 (global) 엣지도 top-level edges에 보존된다", () => {
    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [
        { id: "HomeScreen", discovery: "route", confidence: 1.0 },
      ],
      navGraph: {
        entryScreenId: "HomeScreen",
        edges: [
          {
            from: "(global)",
            to: "HomeScreen",
            action: "replace",
            trigger: { kind: "system" },
            confidence: 0.4,
            diagnostics: [],
            fromKind: "global",
            fromRef: { file: "lib/util/session.dart", line: 5 },
          },
        ],
        diagnostics: [],
      },
      irDocs: [],
    });

    expect(appMap.edges).toHaveLength(1);
    expect(appMap.edges[0]!.from).toBe("(global)");
    // 어떤 화면의 outgoing에도 없음
    expect(appMap.screens[0]!.outgoing).toHaveLength(0);
  });

  it("매칭 단서(elementRef/label) 없는 트리거에는 TRIGGER_UNMATCHED를 붙이지 않는다", () => {
    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph: {
        entryScreenId: null,
        edges: [
          {
            from: "(global)",
            to: "HomeScreen",
            action: "replace",
            trigger: { kind: "system" },
            confidence: 0.4,
            diagnostics: [],
          },
        ],
        diagnostics: [],
      },
      irDocs: [],
    });

    const codes = appMap.edges[0]!.diagnostics.map((d) => d.code);
    expect(codes).not.toContain("TRIGGER_UNMATCHED");
  });
});

// ── 광고/동적 노드 수집 테스트 (M2) ──────────────────────────────────

describe("collectElements — 광고/동적 노드 태깅", () => {
  function makeAdIR(screenId: string): IRDocument {
    return {
      schemaVersion: "1",
      screen: {
        id: screenId,
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            {
              // 광고 노드 — Unknown 타입 + component:GADBannerView
              type: "Unknown",
              confidence: 0.3,
              role: "component:GADBannerView",
            },
            {
              // 일반 버튼
              type: "Button",
              confidence: 1.0,
              text: { value: "Login" },
            },
            {
              // Unknown 타입이지만 광고 아님
              type: "Unknown",
              confidence: 0.5,
              role: "component:Container",
            },
          ],
        },
      },
      diagnostics: [],
    };
  }

  it("Unknown + component:GADBannerView → role:ad, dynamic:true 로 수집된다", () => {
    const appMap = assembleAppMap({
      appName: "App",
      framework: "ios",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "HomeScreen", edges: [], diagnostics: [] },
      irDocs: [makeAdIR("HomeScreen")],
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    const adElem = homeNode?.elements.find((e) => e.role === "ad");
    expect(adElem).toBeDefined();
    expect(adElem?.dynamic).toBe(true);
    expect(adElem?.dynamicSource).toBe("GADBannerView");
    expect(adElem?.type).toBe("Unknown");
  });

  it("일반 Button은 그대로 수집되고 role/dynamic 없다", () => {
    const appMap = assembleAppMap({
      appName: "App",
      framework: "ios",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "HomeScreen", edges: [], diagnostics: [] },
      irDocs: [makeAdIR("HomeScreen")],
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    const buttonElem = homeNode?.elements.find((e) => e.type === "Button");
    expect(buttonElem).toBeDefined();
    expect(buttonElem?.role).toBeUndefined();
    expect(buttonElem?.dynamic).toBeUndefined();
  });

  it("Unknown + component:Container (광고 아님) → 수집 안 됨", () => {
    const appMap = assembleAppMap({
      appName: "App",
      framework: "ios",
      screens: [{ id: "HomeScreen", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "HomeScreen", edges: [], diagnostics: [] },
      irDocs: [makeAdIR("HomeScreen")],
    });

    const homeNode = appMap.screens.find((s) => s.id === "HomeScreen");
    // Container Unknown 노드는 수집 안 됨 (광고도 아니고 INTERACTIVE도 아님)
    const containerElem = homeNode?.elements.find(
      (e) => e.type === "Unknown" && e.dynamicSource !== "GADBannerView"
    );
    expect(containerElem).toBeUndefined();
  });

  it("Flutter AdWidget → role:ad, dynamicSource:AdWidget", () => {
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            { type: "Unknown", confidence: 0.3, role: "component:AdWidget" },
          ],
        },
      },
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "S", edges: [], diagnostics: [] },
      irDocs: [irDoc],
    });

    const adElem = appMap.screens[0]?.elements.find((e) => e.role === "ad");
    expect(adElem?.dynamicSource).toBe("AdWidget");
  });

  it("FutureBuilder → role:dynamic-content", () => {
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            { type: "Unknown", confidence: 0.5, role: "component:FutureBuilder" },
          ],
        },
      },
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "S", edges: [], diagnostics: [] },
      irDocs: [irDoc],
    });

    const dynElem = appMap.screens[0]?.elements.find((e) => e.role === "dynamic-content");
    expect(dynElem).toBeDefined();
    expect(dynElem?.dynamic).toBe(true);
  });

  // ── [수정 2] 광고/Unknown 노드가 트리거 매칭 후보에서 제외되는지 ──────

  it("같은 파일 ±1행에 광고 Unknown(sourceRef 있음)과 Button이 있을 때 Button이 매칭된다", () => {
    // 광고 Unknown 노드가 ±2 TOL 안에 있어도 매칭 후보에서 제외돼야 함
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            // 광고 노드: ±0행 (완전 일치) — 매칭 우선순위에서 제외돼야 함
            {
              type: "Unknown",
              confidence: 0.3,
              role: "component:GADBannerView",
              sourceRef: { file: "lib/home.dart", line: 42 },
            },
            // 버튼: ±1행 — 광고보다 멀지만 비광고이므로 선택돼야 함
            {
              type: "Button",
              confidence: 1.0,
              text: { value: "Go" },
              sourceRef: { file: "lib/home.dart", line: 43 },
            },
          ],
        },
      },
      diagnostics: [],
    };

    const navGraph: NavigationGraph = {
      entryScreenId: "S",
      edges: [
        {
          from: "S",
          to: null,
          action: "push",
          trigger: {
            kind: "button",
            label: "Go",
            elementRef: { file: "lib/home.dart", line: 42 },
          },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph,
      irDocs: [irDoc],
    });

    // Button이 매칭돼야 하므로 trigger.style 없이도 TRIGGER_UNMATCHED는 없어야 함
    // (광고가 아닌 Button이 ±1 TOL 안에 있으므로)
    const edge = appMap.edges[0];
    expect(edge?.diagnostics.find((d) => d.code === "TRIGGER_UNMATCHED")).toBeUndefined();
  });

  it("광고 Unknown 노드만 있고 Button이 없으면 TRIGGER_UNMATCHED가 발생한다", () => {
    // 광고 노드는 매칭 후보에서 제외 → elements에 적합 후보 없음 → TRIGGER_UNMATCHED
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            {
              type: "Unknown",
              confidence: 0.3,
              role: "component:GADBannerView",
              sourceRef: { file: "lib/home.dart", line: 42 },
            },
          ],
        },
      },
      diagnostics: [],
    };

    const navGraph: NavigationGraph = {
      entryScreenId: "S",
      edges: [
        {
          from: "S",
          to: null,
          action: "push",
          trigger: {
            kind: "button",
            label: "AdTrigger",
            elementRef: { file: "lib/home.dart", line: 42 },
          },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph,
      irDocs: [irDoc],
    });

    const edge = appMap.edges[0];
    expect(edge?.diagnostics.find((d) => d.code === "TRIGGER_UNMATCHED")).toBeDefined();
  });

  it("광고 노드가 있어도 전체 elements 배열 구조가 AppMapSchema를 통과한다", () => {
    const irDoc: IRDocument = {
      schemaVersion: "1",
      screen: {
        id: "S",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          children: [
            { type: "Unknown", confidence: 0.3, role: "component:AdWidget" },
            { type: "Button", confidence: 1.0, text: { value: "OK" } },
          ],
        },
      },
      diagnostics: [],
    };

    const appMap = assembleAppMap({
      appName: "App",
      framework: "flutter",
      screens: [{ id: "S", discovery: "route", confidence: 1.0 }],
      navGraph: { entryScreenId: "S", edges: [], diagnostics: [] },
      irDocs: [irDoc],
    });

    // AppMapSchema는 appmap/2라 통과해야 함
    expect(() => AppMapSchema.parse(appMap)).not.toThrow();
  });
});
