import { describe, it, expect } from "vitest";
import { renderAppMapMarkdown } from "../appmap/markdown.js";
import type { AppMap } from "../appmap/schema.js";

function makeAppMap(overrides: Partial<AppMap> = {}): AppMap {
  return {
    schemaVersion: "appmap/1",
    appName: "TestApp",
    framework: "flutter",
    entryScreenId: "HomeScreen",
    screens: [
      {
        id: "HomeScreen",
        title: "Home Screen",
        discovery: "route",
        isEntry: true,
        confidence: 1.0,
        elements: [
          { type: "Button", label: "View Details" },
          { type: "Text", label: "Welcome" },
        ],
        outgoing: [
          {
            from: "HomeScreen",
            to: "DetailScreen",
            action: "push",
            trigger: { kind: "button", label: "View Details" },
            confidence: 1.0,
            diagnostics: [],
          },
        ],
      },
      {
        id: "DetailScreen",
        title: "Detail Screen",
        discovery: "route",
        isEntry: false,
        confidence: 1.0,
        elements: [],
        outgoing: [
          {
            from: "DetailScreen",
            to: null,
            action: "pop",
            trigger: { kind: "back" },
            confidence: 1.0,
            diagnostics: [],
          },
        ],
      },
    ],
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
    overallConfidence: 1.0,
    ...overrides,
  };
}

describe("renderAppMapMarkdown", () => {
  it("파일 배열을 반환하고 첫 번째 파일명이 {앱}_map_1.md이다", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs[0]!.fileName).toBe("TestApp_map_1.md");
  });

  it("인덱스 문서에 Mermaid flowchart 블록이 포함된다", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    expect(docs[0]!.content).toContain("```mermaid");
    expect(docs[0]!.content).toContain("flowchart TD");
  });

  it("Mermaid에 push 엣지가 실선 -->로 표현된다", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    expect(docs[0]!.content).toContain("-->");
  });

  it("pop 엣지가 점선 -.->로 표현된다", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    expect(docs[0]!.content).toContain("-.->");
  });

  it("미해석 엣지(to=null)가 ❓로 표시된다", () => {
    const appMap = makeAppMap({
      edges: [
        {
          from: "HomeScreen",
          to: null,
          action: "unknown",
          trigger: { kind: "button", label: "Unknown Nav" },
          confidence: 0.3,
          diagnostics: [{ code: "DYNAMIC_NAV", message: "동적" }],
        },
      ],
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [],
          outgoing: [
            {
              from: "HomeScreen",
              to: null,
              action: "unknown",
              trigger: { kind: "button", label: "Unknown Nav" },
              confidence: 0.3,
              diagnostics: [],
            },
          ],
        },
      ],
    });
    const docs = renderAppMapMarkdown(appMap);
    expect(docs[0]!.content).toContain("❓");
  });

  it("화면 목록 테이블이 포함된다", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    expect(docs[0]!.content).toContain("HomeScreen");
    expect(docs[0]!.content).toContain("DetailScreen");
  });

  it("maxChars 초과 시 분할된다", () => {
    // 화면 5개짜리 큰 AppMap으로 강제 분할
    const bigScreens = Array.from({ length: 10 }, (_, i) => ({
      id: `Screen${i}`,
      title: `Screen ${i}`,
      discovery: "route" as const,
      isEntry: i === 0,
      confidence: 1.0,
      elements: Array.from({ length: 5 }, (_, j) => ({
        type: "Button" as const,
        label: `Button ${j} on Screen ${i} with a very long label that takes up space`,
      })),
      outgoing: [],
    }));

    const appMap = makeAppMap({
      screens: bigScreens,
      entryScreenId: "Screen0",
      edges: [],
    });

    const docs = renderAppMapMarkdown(appMap, { maxChars: 800 });
    expect(docs.length).toBeGreaterThan(1);
  });

  it("분할된 비인덱스 문서 첫 줄에 목차 링크가 있다", () => {
    const bigScreens = Array.from({ length: 10 }, (_, i) => ({
      id: `Screen${i}`,
      discovery: "route" as const,
      isEntry: i === 0,
      confidence: 1.0,
      elements: Array.from({ length: 5 }, (_, j) => ({
        type: "Button" as const,
        label: `Button ${j} on Screen ${i} with very long text content here`,
      })),
      outgoing: [],
    }));

    const appMap = makeAppMap({
      screens: bigScreens,
      entryScreenId: "Screen0",
      edges: [],
    });

    const docs = renderAppMapMarkdown(appMap, { maxChars: 800 });
    if (docs.length > 1) {
      expect(docs[1]!.content.split("\n")[0]).toContain("TestApp_map_1.md");
    }
  });

  it("분할 시 파일명이 순서대로 TestApp_map_2.md 형태이다", () => {
    const bigScreens = Array.from({ length: 10 }, (_, i) => ({
      id: `Screen${i}`,
      discovery: "route" as const,
      isEntry: i === 0,
      confidence: 1.0,
      elements: Array.from({ length: 5 }, (_, j) => ({
        type: "Button" as const,
        label: `Button ${j} long label on Screen ${i}`,
      })),
      outgoing: [],
    }));

    const appMap = makeAppMap({
      screens: bigScreens,
      entryScreenId: "Screen0",
      edges: [],
    });

    const docs = renderAppMapMarkdown(appMap, { maxChars: 800 });
    if (docs.length > 1) {
      expect(docs[1]!.fileName).toBe("TestApp_map_2.md");
    }
  });

  it("빈 AppMap도 문서를 반환한다", () => {
    const appMap = makeAppMap({
      screens: [],
      edges: [],
      entryScreenId: null,
    });
    const docs = renderAppMapMarkdown(appMap);
    expect(docs.length).toBe(1);
    expect(docs[0]!.content).toBeTruthy();
  });

  it("앱 이름에 언더스코어가 포함되면 파일명에 정상 반영된다", () => {
    const docs = renderAppMapMarkdown(makeAppMap({ appName: "My_App" }));
    expect(docs[0]!.fileName).toBe("My_App_map_1.md");
  });

  it("진단 섹션에 NAV_UNSUPPORTED가 표시된다", () => {
    const appMap = makeAppMap({
      diagnostics: [{ code: "NAV_UNSUPPORTED", message: "네비게이션 미지원 프레임워크" }],
    });
    const docs = renderAppMapMarkdown(appMap);
    expect(docs[0]!.content).toContain("NAV_UNSUPPORTED");
  });
});
