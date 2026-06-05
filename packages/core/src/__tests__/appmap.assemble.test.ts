import { describe, it, expect } from "vitest";
import { assembleAppMap } from "../appmap/assemble.js";
import type { ScreenSummary } from "../appmap/assemble.js";
import type { NavigationGraph } from "../appmap/schema.js";
import type { IRDocument } from "../ir/schema.js";

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

    expect(appMap.schemaVersion).toBe("appmap/1");
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
