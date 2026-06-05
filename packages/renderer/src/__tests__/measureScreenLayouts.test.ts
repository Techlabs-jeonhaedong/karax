/**
 * 4단계: measureScreenLayouts + collectNodesWithIdx 테스트
 *
 * (a) collectNodesWithIdx 순회 순서가 collectNodeInfoWithIdx와 일치 (단위)
 * (b) measureScreenLayouts가 간단한 IR(버튼 포함)에 대해 bounds 배열 반환,
 *     버튼 bounds의 width/height > 0, sourceRef 동봉 확인 (Chromium 통합)
 */
import { describe, it, expect } from "vitest";
import type { IRDocument, IRNode } from "@karax/core";
import {
  collectNodeInfoWithIdx,
  collectNodesWithIdx,
  filterFiniteBounds,
  measureScreenLayouts,
  type MeasuredBounds,
} from "../capture/capture.js";

// ── 헬퍼 ────────────────────────────────────────────────────────────

function makeDoc(root: IRNode, id = "TestScreen"): IRDocument {
  return {
    schemaVersion: "0.1",
    screen: { id, discovery: "route", confidence: 1.0, root },
    designTokens: {},
    diagnostics: [],
  };
}

// ── (a) collectNodesWithIdx 단위 테스트 ─────────────────────────────

describe("collectNodesWithIdx — collectNodeInfoWithIdx와 동일 순회 순서", () => {
  it("단순 Column+Text: idx 순서와 노드 수가 collectNodeInfoWithIdx와 일치", () => {
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [
        { type: "Text", confidence: 1.0, text: { value: "A" } },
        { type: "Text", confidence: 1.0, text: { value: "B" } },
      ],
    };

    const withNode = collectNodesWithIdx(root);
    const withInfo = collectNodeInfoWithIdx(root);

    expect(withNode.length).toBe(withInfo.length);
    for (let i = 0; i < withNode.length; i++) {
      expect(withNode[i].idx).toBe(withInfo[i].idx);
      expect(withNode[i].node.type).toBe(
        i === 0 ? "Column" : "Text"
      );
    }
  });

  it("Branch: idx 소비·미수록·첫 child만 포함 — collectNodeInfoWithIdx와 일치", () => {
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [
        {
          type: "Branch",
          confidence: 0.7,
          children: [
            { type: "Text", confidence: 1.0, text: { value: "VariantA" } },
            { type: "Text", confidence: 1.0, text: { value: "VariantB" } },
          ],
        },
        { type: "Text", confidence: 1.0, text: { value: "after" } },
      ],
    };

    const withNode = collectNodesWithIdx(root);
    const withInfo = collectNodeInfoWithIdx(root);

    // Branch 제외 → Column, VariantA Text, after Text = 3개
    expect(withNode.length).toBe(withInfo.length);
    for (let i = 0; i < withNode.length; i++) {
      expect(withNode[i].idx).toBe(withInfo[i].idx);
    }

    const idxs = withNode.map((n) => n.idx);
    expect(idxs).toEqual([0, 2, 3]); // Branch가 idx=1 소비
  });

  it("Button(컨테이너): children까지 순회 — collectNodeInfoWithIdx와 idx 일치", () => {
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [
        {
          type: "Button",
          confidence: 1.0,
          children: [{ type: "Text", confidence: 1.0, text: { value: "Click" } }],
        },
        { type: "Text", confidence: 1.0, text: { value: "after" } },
      ],
    };

    const withNode = collectNodesWithIdx(root);
    const withInfo = collectNodeInfoWithIdx(root);

    expect(withNode.length).toBe(4); // Column, Button, Click Text, after Text
    expect(withNode.length).toBe(withInfo.length);
    for (let i = 0; i < withNode.length; i++) {
      expect(withNode[i].idx).toBe(withInfo[i].idx);
    }
  });

  it("leaf(Text)에 children이 있어도 순회하지 않음 — collectNodeInfoWithIdx와 동일", () => {
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [
        {
          type: "Text",
          confidence: 1.0,
          text: { value: "parent" },
          children: [{ type: "Text", confidence: 0.5, text: { value: "nested" } }],
        },
      ],
    };

    const withNode = collectNodesWithIdx(root);
    const withInfo = collectNodeInfoWithIdx(root);

    // Column + Text parent = 2개 (nested 미수록)
    expect(withNode.length).toBe(2);
    expect(withNode.length).toBe(withInfo.length);
    for (let i = 0; i < withNode.length; i++) {
      expect(withNode[i].idx).toBe(withInfo[i].idx);
    }
  });

  it("각 entry에 node 원본 객체가 포함됨", () => {
    const btnNode: IRNode = {
      type: "Button",
      confidence: 0.9,
      children: [],
      sourceRef: { file: "lib/foo.dart", line: 10 },
    };
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [btnNode],
    };

    const entries = collectNodesWithIdx(root);
    const btnEntry = entries.find((e) => e.node.type === "Button");
    expect(btnEntry).toBeDefined();
    expect(btnEntry!.node).toBe(btnNode); // 동일 객체 참조
  });
});

// ── (b) measureScreenLayouts 통합 테스트 (Chromium) ─────────────────

describe("measureScreenLayouts — Chromium 통합", () => {
  const irWithButton: IRDocument = {
    schemaVersion: "0.1",
    screen: {
      id: "ButtonScreen",
      discovery: "route",
      confidence: 1.0,
      root: {
        type: "Column",
        confidence: 1.0,
        layout: {
          mainAxis: "start",
          crossAxis: "stretch",
          width: "fill",
          height: "fill",
          padding: [16, 16, 16, 16],
          gap: 8,
        },
        style: { background: "#FFFFFF" },
        children: [
          {
            type: "Button",
            confidence: 0.9,
            sourceRef: { file: "lib/home.dart", line: 42 },
            layout: { width: 200, height: 48 },
            style: { background: "#6200EE", borderRadius: 8 },
            children: [
              { type: "Text", confidence: 1.0, text: { value: "Go to Detail" } },
            ],
          },
          {
            type: "Text",
            confidence: 1.0,
            text: { value: "Hello" },
          },
        ],
      },
    },
    designTokens: {},
    diagnostics: [],
  };

  it(
    "반환값이 Map이고 화면 id를 키로 가짐",
    async () => {
      const result = await measureScreenLayouts([irWithButton]);
      expect(result).toBeInstanceOf(Map);
      expect(result.has("ButtonScreen")).toBe(true);
    },
    60_000,
  );

  it(
    "MeasuredBounds 배열이 비어있지 않음",
    async () => {
      const result = await measureScreenLayouts([irWithButton]);
      const bounds = result.get("ButtonScreen")!;
      expect(Array.isArray(bounds)).toBe(true);
      expect(bounds.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "Button 노드의 width/height가 0보다 큼",
    async () => {
      const result = await measureScreenLayouts([irWithButton]);
      const bounds = result.get("ButtonScreen")!;
      const btnBounds = bounds.find((b) => b.nodeType === "Button");
      expect(btnBounds).toBeDefined();
      expect(btnBounds!.width).toBeGreaterThan(0);
      expect(btnBounds!.height).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "Button 노드에 sourceRef(file+line)가 동봉됨",
    async () => {
      const result = await measureScreenLayouts([irWithButton]);
      const bounds = result.get("ButtonScreen")!;
      const btnBounds = bounds.find((b) => b.nodeType === "Button");
      expect(btnBounds).toBeDefined();
      expect(btnBounds!.sourceRef).toBeDefined();
      expect(btnBounds!.sourceRef!.file).toBe("lib/home.dart");
      expect(btnBounds!.sourceRef!.line).toBe(42);
    },
    60_000,
  );

  it(
    "복수 화면: 각 화면 id가 Map 키로 존재",
    async () => {
      const ir2: IRDocument = {
        schemaVersion: "0.1",
        screen: {
          id: "SecondScreen",
          discovery: "route",
          confidence: 1.0,
          root: {
            type: "Box",
            confidence: 1.0,
            style: { background: "#F0F0F0" },
            children: [{ type: "Text", confidence: 1.0, text: { value: "Second" } }],
          },
        },
        designTokens: {},
        diagnostics: [],
      };

      const result = await measureScreenLayouts([irWithButton, ir2]);
      expect(result.has("ButtonScreen")).toBe(true);
      expect(result.has("SecondScreen")).toBe(true);
    },
    60_000,
  );

  it(
    "device 옵션이 전달되면 해당 프로파일로 측정",
    async () => {
      // pixel-8 프로파일 사용 시도 — 에러 없이 결과 반환하면 OK
      const result = await measureScreenLayouts([irWithButton], { device: "pixel-8" });
      expect(result.has("ButtonScreen")).toBe(true);
    },
    60_000,
  );

  it(
    "빈 배열 입력 시 빈 Map 반환",
    async () => {
      const result = await measureScreenLayouts([]);
      expect(result.size).toBe(0);
    },
    60_000,
  );

  it(
    "각 MeasuredBounds 항목에 x, y, width, height, nodeType이 존재",
    async () => {
      const result = await measureScreenLayouts([irWithButton]);
      const bounds = result.get("ButtonScreen")!;
      for (const b of bounds) {
        expect(typeof b.x).toBe("number");
        expect(typeof b.y).toBe("number");
        expect(typeof b.width).toBe("number");
        expect(typeof b.height).toBe("number");
        expect(typeof b.nodeType).toBe("string");
      }
    },
    60_000,
  );

  it(
    "통합: 반환 bounds가 모두 유한하고 width/height >= 0",
    async () => {
      const result = await measureScreenLayouts([irWithButton]);
      const bounds = result.get("ButtonScreen")!;
      for (const b of bounds) {
        expect(Number.isFinite(b.x)).toBe(true);
        expect(Number.isFinite(b.y)).toBe(true);
        expect(Number.isFinite(b.width)).toBe(true);
        expect(Number.isFinite(b.height)).toBe(true);
        expect(b.width).toBeGreaterThanOrEqual(0);
        expect(b.height).toBeGreaterThanOrEqual(0);
      }
    },
    60_000,
  );
});

// ── filterFiniteBounds 단위 테스트 ───────────────────────────────────

describe("filterFiniteBounds — NaN/Infinity/음수 width·height 필터", () => {
  it("정상 bounds는 그대로 반환된다", () => {
    const input = [
      { nodeType: "Box", x: 0, y: 0, width: 100, height: 50 },
      { nodeType: "Text", x: 10, y: 20, width: 200, height: 30 },
    ];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(2);
  });

  it("NaN x를 가진 항목이 제외된다", () => {
    const input = [
      { nodeType: "Box", x: NaN, y: 0, width: 100, height: 50 },
      { nodeType: "Text", x: 0, y: 0, width: 100, height: 50 },
    ];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.nodeType).toBe("Text");
  });

  it("NaN y를 가진 항목이 제외된다", () => {
    const input = [{ nodeType: "Box", x: 0, y: NaN, width: 100, height: 50 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(0);
  });

  it("NaN width를 가진 항목이 제외된다", () => {
    const input = [{ nodeType: "Box", x: 0, y: 0, width: NaN, height: 50 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(0);
  });

  it("NaN height를 가진 항목이 제외된다", () => {
    const input = [{ nodeType: "Box", x: 0, y: 0, width: 100, height: NaN }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(0);
  });

  it("Infinity x를 가진 항목이 제외된다", () => {
    const input = [{ nodeType: "Box", x: Infinity, y: 0, width: 100, height: 50 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(0);
  });

  it("-Infinity y를 가진 항목이 제외된다", () => {
    const input = [{ nodeType: "Box", x: 0, y: -Infinity, width: 100, height: 50 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(0);
  });

  it("Infinity width를 가진 항목이 제외된다", () => {
    const input = [{ nodeType: "Box", x: 0, y: 0, width: Infinity, height: 50 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(0);
  });

  it("음수 width를 가진 항목이 제외된다", () => {
    const input = [{ nodeType: "Box", x: 0, y: 0, width: -1, height: 50 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(0);
  });

  it("음수 height를 가진 항목이 제외된다", () => {
    const input = [{ nodeType: "Box", x: 0, y: 0, width: 100, height: -5 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(0);
  });

  it("width=0, height=0은 허용된다", () => {
    const input = [{ nodeType: "Spacer", x: 0, y: 0, width: 0, height: 0 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(1);
  });

  it("음수 x/y는 허용된다 (뷰포트 밖 노드)", () => {
    const input = [{ nodeType: "Box", x: -10, y: -5, width: 100, height: 50 }];
    const result = filterFiniteBounds(input);
    expect(result).toHaveLength(1);
  });

  it("빈 배열은 빈 배열로 반환된다", () => {
    expect(filterFiniteBounds([])).toHaveLength(0);
  });

  it("모두 비유한 항목이면 빈 배열로 반환된다", () => {
    const input = [
      { nodeType: "A", x: NaN, y: 0, width: 100, height: 50 },
      { nodeType: "B", x: 0, y: 0, width: Infinity, height: 50 },
      { nodeType: "C", x: 0, y: 0, width: 100, height: -1 },
    ];
    expect(filterFiniteBounds(input)).toHaveLength(0);
  });
});
