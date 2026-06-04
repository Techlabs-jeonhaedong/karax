import { describe, expect, it } from "vitest";
import {
  IRDocumentSchema,
  parseIRDocument,
  safeParseIRDocument,
} from "../ir/schema.js";

// ── 유효 문서 fixture ──────────────────────────────────────────────

const validDoc = {
  schemaVersion: "0.1",
  screen: {
    id: "HomeScreen",
    sourceRef: { file: "lib/home.dart", line: 12, symbol: "HomeScreen" },
    device: "iphone-15",
    discovery: "route" as const,
    confidence: 0.85,
    root: {
      type: "Column" as const,
      confidence: 1.0,
      children: [
        {
          type: "Text" as const,
          text: { value: "Hello", color: "#000000" },
          confidence: 1.0,
        },
      ],
    },
  },
  designTokens: { colors: {}, spacing: {}, typography: {} },
  diagnostics: [],
};

// ── round-trip ─────────────────────────────────────────────────────

describe("IRDocument — round-trip", () => {
  it("유효 문서를 parse → serialize → parse 해도 동일한 결과", () => {
    const parsed1 = parseIRDocument(validDoc);
    const json = JSON.parse(JSON.stringify(parsed1));
    const parsed2 = parseIRDocument(json);
    expect(parsed2).toEqual(parsed1);
  });

  it("parseIRDocument가 IRDocument 타입을 반환", () => {
    const result = parseIRDocument(validDoc);
    expect(result.schemaVersion).toBe("0.1");
    expect(result.screen.id).toBe("HomeScreen");
  });
});

// ── 유효 케이스 ────────────────────────────────────────────────────

describe("IRDocument — 유효 케이스", () => {
  it("discovery가 candidate인 경우 통과", () => {
    const doc = {
      ...validDoc,
      screen: { ...validDoc.screen, discovery: "candidate" as const },
    };
    expect(() => parseIRDocument(doc)).not.toThrow();
  });

  it("diagnostics에 경고 항목이 있어도 통과", () => {
    const doc = {
      ...validDoc,
      diagnostics: [
        { level: "warn" as const, code: "UNRESOLVED_COMPONENT", message: "unknown widget" },
      ],
    };
    expect(() => parseIRDocument(doc)).not.toThrow();
  });

  it("깊은 재귀 트리 (depth=10) 통과", () => {
    let node: Record<string, unknown> = { type: "Box" as const, confidence: 1.0 };
    for (let i = 0; i < 10; i++) {
      node = { type: "Column" as const, confidence: 1.0, children: [node] };
    }
    const doc = { ...validDoc, screen: { ...validDoc.screen, root: node } };
    expect(() => parseIRDocument(doc)).not.toThrow();
  });

  it("모든 레이아웃 노드 타입 통과", () => {
    const types = ["Box", "Row", "Column", "Stack", "Scroll", "Grid", "List", "Spacer"] as const;
    for (const type of types) {
      const doc = { ...validDoc, screen: { ...validDoc.screen, root: { type, confidence: 1.0 } } };
      expect(() => parseIRDocument(doc), `type=${type} 실패`).not.toThrow();
    }
  });

  it("모든 콘텐츠 노드 타입 통과", () => {
    const types = ["Text", "Image", "Icon", "Button", "Input", "Divider"] as const;
    for (const type of types) {
      const doc = { ...validDoc, screen: { ...validDoc.screen, root: { type, confidence: 1.0 } } };
      expect(() => parseIRDocument(doc), `type=${type} 실패`).not.toThrow();
    }
  });

  it("모든 메타 노드 타입 통과", () => {
    const types = ["Unknown", "Branch", "Slot"] as const;
    for (const type of types) {
      const doc = { ...validDoc, screen: { ...validDoc.screen, root: { type, confidence: 1.0 } } };
      expect(() => parseIRDocument(doc), `type=${type} 실패`).not.toThrow();
    }
  });

  it("layout 전체 필드 통과", () => {
    const doc = {
      ...validDoc,
      screen: {
        ...validDoc.screen,
        root: {
          type: "Column" as const,
          confidence: 1.0,
          layout: {
            direction: "column" as const,
            mainAxis: "spaceBetween" as const,
            crossAxis: "stretch" as const,
            flex: 1,
            width: "fill" as const,
            height: 200,
            padding: [8, 8, 8, 8],
            margin: [0, 0, 0, 0],
            gap: 4,
          },
        },
      },
    };
    expect(() => parseIRDocument(doc)).not.toThrow();
  });

  it("style 전체 필드 통과", () => {
    const doc = {
      ...validDoc,
      screen: {
        ...validDoc.screen,
        root: {
          type: "Box" as const,
          confidence: 0.9,
          style: {
            background: "#FFFFFF",
            borderRadius: 12,
            border: { width: 1, color: "#CCCCCC" },
            shadow: { offsetX: 0, offsetY: 2, blur: 4, color: "#00000040" },
            opacity: 0.8,
          },
        },
      },
    };
    expect(() => parseIRDocument(doc)).not.toThrow();
  });

  it("confidence 경계값 0과 1 통과", () => {
    const docMin = {
      ...validDoc,
      screen: { ...validDoc.screen, confidence: 0, root: { type: "Box" as const, confidence: 0 } },
    };
    const docMax = {
      ...validDoc,
      screen: { ...validDoc.screen, confidence: 1, root: { type: "Box" as const, confidence: 1 } },
    };
    expect(() => parseIRDocument(docMin)).not.toThrow();
    expect(() => parseIRDocument(docMax)).not.toThrow();
  });
});

// ── 무효 케이스 ────────────────────────────────────────────────────

describe("IRDocument — 무효 케이스 (거부)", () => {
  it("잘못된 노드 타입 거부", () => {
    const doc = {
      ...validDoc,
      screen: { ...validDoc.screen, root: { type: "SuperWidget", confidence: 1.0 } },
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("confidence가 0 미만 거부", () => {
    const doc = {
      ...validDoc,
      screen: { ...validDoc.screen, root: { type: "Box" as const, confidence: -0.1 } },
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("confidence가 1 초과 거부", () => {
    const doc = {
      ...validDoc,
      screen: { ...validDoc.screen, root: { type: "Box" as const, confidence: 1.1 } },
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("음수 padding 거부", () => {
    const doc = {
      ...validDoc,
      screen: {
        ...validDoc.screen,
        root: {
          type: "Column" as const,
          confidence: 1.0,
          layout: {
            padding: [-1, 0, 0, 0],
          },
        },
      },
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("음수 margin 거부", () => {
    const doc = {
      ...validDoc,
      screen: {
        ...validDoc.screen,
        root: {
          type: "Column" as const,
          confidence: 1.0,
          layout: {
            margin: [0, -1, 0, 0],
          },
        },
      },
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("discovery가 잘못된 값이면 거부", () => {
    const doc = {
      ...validDoc,
      screen: { ...validDoc.screen, discovery: "unknown_type" },
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("schemaVersion 누락 시 거부", () => {
    const { schemaVersion: _, ...doc } = validDoc;
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("screen.id 누락 시 거부", () => {
    const doc = {
      ...validDoc,
      screen: { ...validDoc.screen, id: undefined },
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("diagnostics level이 잘못된 값이면 거부", () => {
    const doc = {
      ...validDoc,
      diagnostics: [{ level: "critical", code: "X", message: "msg" }],
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });

  it("padding 배열 길이가 4가 아니면 거부", () => {
    const doc = {
      ...validDoc,
      screen: {
        ...validDoc.screen,
        root: {
          type: "Column" as const,
          confidence: 1.0,
          layout: {
            padding: [8, 8],
          },
        },
      },
    };
    expect(() => parseIRDocument(doc)).toThrow();
  });
});

// ── safeParseIRDocument ─────────────────────────────────────────────

describe("safeParseIRDocument", () => {
  it("유효한 문서에서 success=true 반환", () => {
    const result = safeParseIRDocument(validDoc);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe("0.1");
    }
  });

  it("잘못된 문서에서 success=false 반환 (throw 없음)", () => {
    const result = safeParseIRDocument({ invalid: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeDefined();
    }
  });
});

// ── IRDocumentSchema 직접 접근 ──────────────────────────────────────

describe("IRDocumentSchema export", () => {
  it("스키마가 ZodObject로 내보내짐", () => {
    expect(IRDocumentSchema).toBeDefined();
    expect(typeof IRDocumentSchema.parse).toBe("function");
    expect(typeof IRDocumentSchema.safeParse).toBe("function");
  });
});
