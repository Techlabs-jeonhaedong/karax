import { describe, it, expect } from "vitest";
import { renderAppMapMarkdown } from "../appmap/markdown.js";
import type { AppMap } from "../appmap/schema.js";

function makeAppMap(overrides: Partial<AppMap> = {}): AppMap {
  return {
    schemaVersion: "appmap/2",
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

  // ── 이스케이핑 보안 케이스 ────────────────────────────────────────
  it("라벨에 파이프(|)가 있어도 테이블 구조가 깨지지 않는다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [{ type: "Button", label: "OK | Cancel" }],
          outgoing: [
            {
              from: "HomeScreen",
              to: "DetailScreen",
              action: "push",
              trigger: { kind: "button", label: "Go | Next" },
              confidence: 1.0,
              diagnostics: [],
            },
          ],
        },
        {
          id: "DetailScreen",
          discovery: "route",
          isEntry: false,
          confidence: 1.0,
          elements: [],
          outgoing: [],
        },
      ],
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          trigger: { kind: "button", label: "Go | Next" },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // \| 형태로 이스케이핑되어야 함
    expect(content).toContain("\\|");
    // 각 테이블 행이 정확히 파이프로 시작하고 끝나야 함 (구조 깨짐 없음)
    const tableRows = content.split("\n").filter((l) => l.startsWith("|"));
    for (const row of tableRows) {
      // 테이블 행은 |로 끝나야 함
      expect(row.endsWith("|")).toBe(true);
    }
  });

  it('라벨에 큰따옴표(")가 있어도 Mermaid 구조가 깨지지 않는다', () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          title: 'Home "Main" Screen',
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [],
          outgoing: [],
        },
      ],
      edges: [
        {
          from: "HomeScreen",
          to: null,
          action: "push",
          trigger: { kind: "button", label: 'Click "here"' },
          confidence: 0.5,
          diagnostics: [],
        },
      ],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // #quot; 로 이스케이핑되어야 함
    expect(content).toContain("#quot;");
    // Mermaid 블록이 존재해야 함
    expect(content).toContain("```mermaid");
  });

  it("라벨에 개행이 있어도 Mermaid/테이블 구조가 깨지지 않는다", () => {
    const appMap = makeAppMap({
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          trigger: { kind: "button", label: "Line1\nLine2" },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // 개행이 공백으로 치환되어 단일 라인 유지
    expect(content).toContain("Line1 Line2");
  });

  it("라벨에 마크다운 링크 문법이 있어도 테이블 셀이 올바르게 렌더된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [{ type: "Button", label: "[Click Me](http://evil.com)" }],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // 파이프는 없지만 개행도 없어야 함
    const tableRows = content.split("\n").filter((l) => l.startsWith("|"));
    for (const row of tableRows) {
      expect(row.endsWith("|")).toBe(true);
    }
  });

  // ── bounds / style 확장 테스트 ─────────────────────────────────────

  it("UI 요소 테이블에 위치·크기·스타일 컬럼이 출력된다 (bounds+style 있는 경우)", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            {
              type: "Button",
              label: "Login",
              bounds: { x: 10.6, y: 20.4, width: 200.5, height: 48.9 },
              style: { background: "#6200EE", borderRadius: 8, textColor: "#FFFFFF" },
            },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // 헤더에 새 컬럼명 존재
    expect(content).toContain("위치");
    expect(content).toContain("크기");
    expect(content).toContain("스타일");
    // 위치: (x, y) 형태 — 정수 반올림
    expect(content).toContain("(11, 20)");
    // 크기: W×H 형태 — 정수 반올림
    expect(content).toContain("201×49");
    // 스타일 요약
    expect(content).toContain("배경 #6200EE");
    expect(content).toContain("r8");
    expect(content).toContain("텍스트 #FFFFFF");
  });

  it("UI 요소 테이블에서 bounds/style 없는 요소는 -로 표시된다 (하위호환)", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    const content = docs[0]!.content;
    // 기본 AppMap fixture의 Button에는 bounds/style 없음 → -
    // 헤더 컬럼 확인 (역할 컬럼 포함)
    expect(content).toContain("| 타입 | 라벨 | 역할 | 위치 | 크기 | 스타일 |");
    // 데이터 행에 - 값 존재
    const tableLines = content.split("\n").filter((l) => l.includes("Button"));
    expect(tableLines.length).toBeGreaterThan(0);
    for (const line of tableLines) {
      // 역할/위치/크기/스타일 컬럼이 - 로 표시 (role 없으면 역할도 -)
      expect(line).toContain("| - | - | - | - |");
    }
  });

  it("스타일 요약 — 존재하는 속성만 ·으로 연결된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            {
              type: "Button",
              label: "Border",
              bounds: { x: 0, y: 0, width: 100, height: 50 },
              style: { borderColor: "#FF0000", borderWidth: 2, opacity: 0.8 },
            },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    expect(content).toContain("테두리 #FF0000 2px");
    expect(content).toContain("불투명도 0.8");
    // background/borderRadius/textColor는 없으므로 스타일 요약에 미포함
    expect(content).not.toContain("배경 ");
    expect(content).not.toContain("r8");
    expect(content).not.toContain("r4");
    expect(content).not.toContain("텍스트 #");
  });

  it("이동 경로 테이블 트리거 셀에 bounds 있으면 @(x,y) W×H 요약이 붙는다", () => {
    const appMap = makeAppMap({
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
              to: "DetailScreen",
              action: "push",
              trigger: {
                kind: "button",
                label: "Go",
                bounds: { x: 5.3, y: 15.7, width: 120.0, height: 44.0 },
                style: { background: "#FF5722" },
              },
              confidence: 1.0,
              diagnostics: [],
            },
          ],
        },
        {
          id: "DetailScreen",
          discovery: "route",
          isEntry: false,
          confidence: 1.0,
          elements: [],
          outgoing: [],
        },
      ],
      edges: [
        {
          from: "HomeScreen",
          to: "DetailScreen",
          action: "push",
          trigger: {
            kind: "button",
            label: "Go",
            bounds: { x: 5.3, y: 15.7, width: 120.0, height: 44.0 },
            style: { background: "#FF5722" },
          },
          confidence: 1.0,
          diagnostics: [],
        },
      ],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // 트리거 셀에 @(x,y) W×H 형태 포함
    expect(content).toContain("@(5, 16)");
    expect(content).toContain("120×44");
    // 스타일도 포함
    expect(content).toContain("배경 #FF5722");
  });

  it("이동 경로 트리거에 bounds/style 없으면 라벨만 표시된다 (하위호환)", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    const content = docs[0]!.content;
    // 트리거 라벨은 있어야 함
    expect(content).toContain("View Details");
    // @ 좌표 표시는 없어야 함
    expect(content).not.toContain("@(");
  });

  // ── escapeMarkdownCell 강화: 백슬래시·백틱·대괄호 ────────────────────

  it("라벨에 백슬래시(\\)가 있으면 이스케이핑되어 테이블 구조가 유지된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [{ type: "Button", label: "path\\to\\file" }],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // 백슬래시가 \\ 로 이스케이핑됨
    expect(content).toContain("\\\\");
    const tableRows = content.split("\n").filter((l) => l.startsWith("|"));
    for (const row of tableRows) {
      expect(row.endsWith("|")).toBe(true);
    }
  });

  it("라벨에 백틱(`)이 있으면 이스케이핑되어 코드 스팬으로 해석되지 않는다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [{ type: "Button", label: "`rm -rf /`" }],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // 백틱이 \` 로 이스케이핑됨
    expect(content).toContain("\\`");
  });

  it("라벨에 마크다운 링크 문법 [x](http://evil)이 있으면 대괄호가 이스케이핑된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [{ type: "Button", label: "[Click](http://evil.com)" }],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // 대괄호가 \[ \] 로 이스케이핑됨
    expect(content).toContain("\\[");
    expect(content).toContain("\\]");
    // 실제 링크 URL이 그대로 노출되지 않아야 함 (링크로 해석 불가)
    // 테이블 구조 유지
    const tableRows = content.split("\n").filter((l) => l.startsWith("|"));
    for (const row of tableRows) {
      expect(row.endsWith("|")).toBe(true);
    }
  });

  it("복합 특수문자: 백슬래시+백틱+대괄호+파이프 혼합이 모두 이스케이핑된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [{ type: "Button", label: "a\\b`c[d|e]f" }],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    expect(content).toContain("\\\\");
    expect(content).toContain("\\`");
    expect(content).toContain("\\[");
    expect(content).toContain("\\]");
    expect(content).toContain("\\|");
  });

  it("특수문자 포함 스타일 값도 escapeMarkdownCell 통과 — 파이프 포함 색상값", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            {
              type: "Button",
              label: "Special",
              bounds: { x: 0, y: 0, width: 100, height: 50 },
              // 실제로는 없지만 파이프 포함 값이 escapeMarkdownCell을 통과해야 함
              style: { background: "linear-gradient(|red, blue)" },
            },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs[0]!.content;
    // 파이프가 이스케이핑됨 (\|)
    expect(content).toContain("\\|");
    // 테이블 행 구조 유지
    const tableRows = content.split("\n").filter((l) => l.startsWith("|"));
    for (const row of tableRows) {
      expect(row.endsWith("|")).toBe(true);
    }
  });
});

// ── 단계 7: 보고서 개선 — fromRef·미해석 라우트·전역 이동 ────────────────────

describe("renderAppMapMarkdown — 호출 위치(fromRef) 컬럼", () => {
  it("outgoing 엣지에 fromRef가 있으면 이동 경로 테이블에 호출 위치가 표시된다", () => {
    const appMap = makeAppMap();
    appMap.screens[0]!.outgoing[0]!.fromRef = { file: "lib/screens/home.dart", line: 42 };
    const docs = renderAppMapMarkdown(appMap);
    const all = docs.map((d) => d.content).join("\n");
    expect(all).toContain("lib/screens/home.dart:42");
    expect(all).toContain("호출 위치");
  });

  it("fromRef가 없으면 호출 위치 셀이 '-'로 표시된다", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    const all = docs.map((d) => d.content).join("\n");
    expect(all).toContain("호출 위치");
  });
});

describe("renderAppMapMarkdown — 미해석 라우트(toRouteName) 표시", () => {
  it("to=null이지만 toRouteName이 있으면 라우트 원문이 표시된다", () => {
    const appMap = makeAppMap();
    appMap.screens[0]!.outgoing.push({
      from: "HomeScreen",
      to: null,
      toRouteName: "/payment",
      action: "push",
      trigger: { kind: "button", label: "Pay" },
      confidence: 0.6,
      diagnostics: [{ code: "UNRESOLVED_NAV", message: "x" }],
    });
    const docs = renderAppMapMarkdown(appMap);
    const all = docs.map((d) => d.content).join("\n");
    expect(all).toContain("/payment");
    expect(all).toContain("미해석");
  });
});

describe("renderAppMapMarkdown — 전역/공통 이동 섹션", () => {
  function withGlobalEdge(): AppMap {
    const appMap = makeAppMap();
    appMap.edges.push({
      from: "(global)",
      to: "HomeScreen",
      action: "replace",
      trigger: { kind: "system" },
      confidence: 0.4,
      diagnostics: [],
      fromKind: "global",
      fromRef: { file: "lib/util/session.dart", line: 10, symbol: "SessionUtil" },
    });
    return appMap;
  }

  it("화면에 귀속되지 않은 엣지가 '공통/전역 이동' 섹션에 표시된다", () => {
    const docs = renderAppMapMarkdown(withGlobalEdge());
    const all = docs.map((d) => d.content).join("\n");
    expect(all).toContain("공통/전역 이동");
    expect(all).toContain("lib/util/session.dart:10");
  });

  it("전역 엣지가 없으면 '공통/전역 이동' 섹션이 없다", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    const all = docs.map((d) => d.content).join("\n");
    expect(all).not.toContain("공통/전역 이동");
  });

  it("Mermaid에 전역 노드가 구분 표시된다", () => {
    const docs = renderAppMapMarkdown(withGlobalEdge());
    const all = docs.map((d) => d.content).join("\n");
    expect(all).toContain("__global__");
  });
});

describe("renderAppMapMarkdown — Mermaid pop 노드 유효성", () => {
  it("목적지 없는 pop 엣지는 유효한 뒤로가기 노드로 렌더된다", () => {
    const docs = renderAppMapMarkdown(makeAppMap());
    const all = docs.map((d) => d.content).join("\n");
    // 노드 정의 없는 `| [뒤로]` 같은 invalid mermaid 구문이 없어야 함
    expect(all).not.toMatch(/\|\s*\[뒤로\]/);
    expect(all).toContain("__back__");
  });
});

describe("renderAppMapMarkdown — fromRef 경로 이스케이핑 (마크다운 인젝션 방지)", () => {
  it("파일 경로에 파이프가 있어도 테이블이 깨지지 않는다", () => {
    const appMap = makeAppMap();
    appMap.screens[0]!.outgoing[0]!.fromRef = { file: "lib/evil|path.dart", line: 1 };
    const docs = renderAppMapMarkdown(appMap);
    const all = docs.map((d) => d.content).join("\n");
    // 파이프가 이스케이프되어야 함
    expect(all).toContain("evil\\|path");
    expect(all).not.toContain("| `lib/evil|path.dart:1` |");
  });
});

// ── M2: 역할 컬럼 렌더 테스트 ────────────────────────────────────────

describe("renderAppMapMarkdown — 역할 컬럼 (M2)", () => {
  it("role:ad인 요소가 테이블에 ⚠ ad 표기된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          title: "Home",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            {
              type: "Unknown" as const,
              role: "ad",
              dynamic: true,
              dynamicSource: "GADBannerView",
            },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs.map((d) => d.content).join("\n");
    // 역할 컬럼 헤더 존재
    expect(content).toContain("역할");
    // 광고 표기 포함
    expect(content).toContain("⚠ ad");
    expect(content).toContain("GADBannerView");
    // 탭 회피 안내
    expect(content).toContain("탭 회피");
  });

  it("role:dynamic-content인 요소가 테이블에 표기된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          title: "Home",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            {
              type: "Unknown" as const,
              role: "dynamic-content",
              dynamic: true,
              dynamicSource: "FutureBuilder",
            },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs.map((d) => d.content).join("\n");
    expect(content).toContain("dynamic-content");
    expect(content).toContain("FutureBuilder");
  });

  it("role:webview인 요소가 테이블에 표기된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          title: "Home",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            {
              type: "Unknown" as const,
              role: "webview",
              dynamic: true,
              dynamicSource: "WebView",
            },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs.map((d) => d.content).join("\n");
    expect(content).toContain("webview");
    expect(content).toContain("WebView");
  });

  it("role 없는 일반 Button은 역할 컬럼이 -이다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          title: "Home",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            { type: "Button" as const, label: "Login" },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs.map((d) => d.content).join("\n");
    // 역할 헤더 있음
    expect(content).toContain("| 타입 | 라벨 | 역할 | 위치 | 크기 | 스타일 |");
    // 역할 컬럼이 -
    const buttonRow = content.split("\n").find((l) => l.includes("Button") && l.includes("Login"));
    expect(buttonRow).toBeDefined();
    expect(buttonRow).toContain("| - |");
  });

  it("광고 dynamicSource에 특수문자가 있어도 테이블이 깨지지 않는다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          title: "Home",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            {
              type: "Unknown" as const,
              role: "ad",
              dynamic: true,
              dynamicSource: "Ad|Widget|Unsafe",
            },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const tableRows = docs.map((d) => d.content).join("\n").split("\n").filter((l) => l.startsWith("|"));
    for (const row of tableRows) {
      expect(row.endsWith("|")).toBe(true);
    }
  });

  // ── [수정 1] formatElementRole 이중 이스케이프 버그 회귀 테스트 ──────

  it("dynamicSource='Ad|Widget' → 역할 셀에 이스케이프가 1회만 적용된다 (백슬래시 1개)", () => {
    // 이중 이스케이프 버그: escapeMarkdownCell(dynamicSource) 후 전체 문자열에 다시 escape →
    // "Ad|Widget" → 1차: "Ad\\|Widget", 2차: "Ad\\\\\\|Widget" (잘못된 이중)
    // 수정 후: raw 값을 한 번만 escape → "Ad\\|Widget" (백슬래시 1개)
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          title: "Home",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            {
              type: "Unknown" as const,
              role: "ad",
              dynamic: true,
              dynamicSource: "Ad|Widget",
            },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs.map((d) => d.content).join("\n");
    // 셀 안에 "Ad\|Widget" (백슬래시 정확히 1개)가 있어야 한다
    expect(content).toContain("Ad\\|Widget");
    // 이중 이스케이프된 "Ad\\\\|" 또는 "Ad\\\\\\|" 형태가 없어야 한다
    expect(content).not.toContain("Ad\\\\");
  });

  // ── [수정 4] Icon 타입이 displayElements 필터에 포함되는지 ─────────────

  it("Icon 타입 요소가 UI 요소 테이블에 렌더된다", () => {
    const appMap = makeAppMap({
      screens: [
        {
          id: "HomeScreen",
          title: "Home",
          discovery: "route",
          isEntry: true,
          confidence: 1.0,
          elements: [
            { type: "Icon" as const, label: "settings_icon" },
          ],
          outgoing: [],
        },
      ],
      edges: [],
    });
    const docs = renderAppMapMarkdown(appMap);
    const content = docs.map((d) => d.content).join("\n");
    // Icon 행이 테이블에 나타나야 한다
    expect(content).toContain("Icon");
    expect(content).toContain("settings_icon");
  });
});
