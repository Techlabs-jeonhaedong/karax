import { describe, it, expect } from "vitest";
import {
  AppMapSchema,
  NavigationEdgeSchema,
  ScreenNodeSchema,
  NavigationGraphSchema,
  sanitizeAppName,
  BoundsSchema,
  ElementStyleSchema,
  TriggerInfoSchema,
  MapElementSchema,
} from "../appmap/schema.js";

describe("AppMap schema", () => {
  describe("NavigationEdgeSchema", () => {
    it("유효한 엣지를 파싱한다", () => {
      const edge = {
        from: "HomeScreen",
        to: "DetailScreen",
        action: "push",
        trigger: { kind: "button", label: "View Details" },
        confidence: 1.0,
        diagnostics: [],
      };
      const result = NavigationEdgeSchema.parse(edge);
      expect(result.from).toBe("HomeScreen");
      expect(result.to).toBe("DetailScreen");
      expect(result.trigger.label).toBe("View Details");
    });

    it("to=null (미해석 목적지)을 허용한다", () => {
      const edge = {
        from: "HomeScreen",
        to: null,
        action: "unknown",
        trigger: { kind: "button" },
        confidence: 0.3,
        diagnostics: [{ code: "DYNAMIC_NAV", message: "동적 네비게이션" }],
      };
      const result = NavigationEdgeSchema.parse(edge);
      expect(result.to).toBeNull();
    });

    it("pop 액션과 back trigger를 허용한다", () => {
      const edge = {
        from: "DetailScreen",
        to: null,
        action: "pop",
        trigger: { kind: "back" },
        confidence: 1.0,
        diagnostics: [],
      };
      const result = NavigationEdgeSchema.parse(edge);
      expect(result.action).toBe("pop");
      expect(result.trigger.kind).toBe("back");
    });

    it("confidence가 0~1 범위를 벗어나면 에러를 던진다", () => {
      expect(() =>
        NavigationEdgeSchema.parse({
          from: "A",
          to: "B",
          action: "push",
          trigger: { kind: "button" },
          confidence: 1.5,
          diagnostics: [],
        })
      ).toThrow();
    });
  });

  describe("ScreenNodeSchema", () => {
    it("유효한 ScreenNode를 파싱한다", () => {
      const node = {
        id: "HomeScreen",
        discovery: "route",
        isEntry: true,
        confidence: 1.0,
        elements: [],
        outgoing: [],
      };
      const result = ScreenNodeSchema.parse(node);
      expect(result.id).toBe("HomeScreen");
      expect(result.isEntry).toBe(true);
    });
  });

  describe("AppMapSchema", () => {
    it("최소한의 유효한 AppMap을 파싱한다", () => {
      const appMap = {
        schemaVersion: "appmap/1",
        appName: "TestApp",
        framework: "flutter",
        entryScreenId: "HomeScreen",
        screens: [
          {
            id: "HomeScreen",
            discovery: "route",
            isEntry: true,
            confidence: 1.0,
            elements: [],
            outgoing: [],
          },
        ],
        edges: [],
        diagnostics: [],
        overallConfidence: 1.0,
      };
      const result = AppMapSchema.parse(appMap);
      expect(result.schemaVersion).toBe("appmap/1");
      expect(result.appName).toBe("TestApp");
    });

    it("빈 화면 목록(NAV_UNSUPPORTED 시나리오)도 유효하다", () => {
      const appMap = {
        schemaVersion: "appmap/1",
        appName: "EmptyApp",
        framework: "flutter",
        entryScreenId: null,
        screens: [],
        edges: [],
        diagnostics: [{ code: "NAV_UNSUPPORTED", message: "네비게이션 미지원" }],
        overallConfidence: 0,
      };
      expect(() => AppMapSchema.parse(appMap)).not.toThrow();
    });
  });

  describe("NavigationGraphSchema", () => {
    it("어댑터 반환용 중간 타입을 파싱한다", () => {
      const graph = {
        entryScreenId: "HomeScreen",
        edges: [],
        diagnostics: [],
      };
      const result = NavigationGraphSchema.parse(graph);
      expect(result.entryScreenId).toBe("HomeScreen");
    });

    it("entryScreenId=null을 허용한다", () => {
      const graph = {
        entryScreenId: null,
        edges: [],
        diagnostics: [],
      };
      expect(() => NavigationGraphSchema.parse(graph)).not.toThrow();
    });
  });

  describe("sanitizeAppName", () => {
    it("경로 위험 문자를 제거한다", () => {
      expect(sanitizeAppName("my/app")).toBe("my_app");
      expect(sanitizeAppName("my\\app")).toBe("my_app");
    });

    it("공백을 언더스코어로 치환한다", () => {
      expect(sanitizeAppName("My App")).toBe("My_App");
    });

    it("앞뒤 공백을 제거한다", () => {
      expect(sanitizeAppName("  MyApp  ")).toBe("MyApp");
    });

    it("빈 문자열이면 app을 반환한다", () => {
      expect(sanitizeAppName("")).toBe("app");
      expect(sanitizeAppName("   ")).toBe("app");
    });

    it("특수문자를 처리한다", () => {
      expect(sanitizeAppName("my.app:v1")).toBe("my.app_v1");
    });

    it("이모지와 한글을 그대로 유지한다", () => {
      expect(sanitizeAppName("내앱")).toBe("내앱");
    });

    // ── 악성 입력 보안 케이스 ─────────────────────────────────────────
    it("경로 탈출 시퀀스(..)를 차단한다 — 결과에 / \\ .. 미포함", () => {
      const result = sanitizeAppName("../../etc/passwd");
      expect(result).not.toContain("..");
      expect(result).not.toContain("/");
      expect(result).not.toContain("\\");
      // 보안: 결과가 빈 문자열이 아니어야 함
      expect(result.length).toBeGreaterThan(0);
    });

    it("절대경로 형태를 차단한다 (/abs/path) — 결과에 / 미포함", () => {
      const result = sanitizeAppName("/abs/path");
      expect(result).not.toContain("/");
      expect(result).not.toContain("..");
    });

    it("Windows 드라이브 경로를 차단한다 (C:\\Windows) — 결과에 \\ : 미포함", () => {
      const result = sanitizeAppName("C:\\Windows");
      expect(result).not.toContain("\\");
      expect(result).not.toContain(":");
    });

    it("널바이트를 제거한다", () => {
      // 널바이트 후 유효한 이름이 남으면 그 이름 반환
      expect(sanitizeAppName("app\x00x")).toBe("appx");
    });

    it("순수 경로 구분자만 있으면 app을 반환한다", () => {
      expect(sanitizeAppName("/")).toBe("app");
      expect(sanitizeAppName("\\")).toBe("app");
    });
  });

  // ── 신규 스키마 테스트 ─────────────────────────────────────────────

  describe("BoundsSchema", () => {
    it("유효한 bounds를 파싱한다", () => {
      const result = BoundsSchema.parse({ x: 10, y: 20, width: 100, height: 50 });
      expect(result).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    });

    it("x, y는 음수를 허용한다", () => {
      expect(() => BoundsSchema.parse({ x: -5, y: -10, width: 100, height: 50 })).not.toThrow();
    });

    it("width, height가 음수이면 에러를 던진다", () => {
      expect(() => BoundsSchema.parse({ x: 0, y: 0, width: -1, height: 50 })).toThrow();
      expect(() => BoundsSchema.parse({ x: 0, y: 0, width: 100, height: -1 })).toThrow();
    });

    it("width, height가 0이면 허용한다", () => {
      expect(() => BoundsSchema.parse({ x: 0, y: 0, width: 0, height: 0 })).not.toThrow();
    });

    it("미지 필드(strict 위반)를 거부한다", () => {
      expect(() =>
        BoundsSchema.parse({ x: 0, y: 0, width: 100, height: 50, extra: "bad" })
      ).toThrow();
    });

    it("필수 필드 누락 시 에러를 던진다", () => {
      expect(() => BoundsSchema.parse({ x: 0, y: 0, width: 100 })).toThrow(); // height 없음
    });
  });

  describe("ElementStyleSchema", () => {
    it("모든 필드가 있을 때 파싱한다", () => {
      const result = ElementStyleSchema.parse({
        background: "#fff",
        borderRadius: 8,
        borderColor: "#ccc",
        borderWidth: 1,
        textColor: "#000",
        opacity: 0.9,
      });
      expect(result.background).toBe("#fff");
      expect(result.borderRadius).toBe(8);
      expect(result.opacity).toBe(0.9);
    });

    it("모든 필드가 optional — 빈 객체도 유효하다", () => {
      expect(() => ElementStyleSchema.parse({})).not.toThrow();
    });

    it("opacity가 0~1 범위를 벗어나면 에러를 던진다", () => {
      expect(() => ElementStyleSchema.parse({ opacity: 1.1 })).toThrow();
      expect(() => ElementStyleSchema.parse({ opacity: -0.1 })).toThrow();
    });

    it("borderRadius가 음수이면 에러를 던진다", () => {
      expect(() => ElementStyleSchema.parse({ borderRadius: -1 })).toThrow();
    });

    it("borderWidth가 음수이면 에러를 던진다", () => {
      expect(() => ElementStyleSchema.parse({ borderWidth: -1 })).toThrow();
    });

    it("미지 필드(strict 위반)를 거부한다", () => {
      expect(() => ElementStyleSchema.parse({ unknown: "field" })).toThrow();
    });

    it("opacity 경계값 0, 1을 허용한다", () => {
      expect(() => ElementStyleSchema.parse({ opacity: 0 })).not.toThrow();
      expect(() => ElementStyleSchema.parse({ opacity: 1 })).not.toThrow();
    });
  });

  describe("TriggerInfoSchema — 신규 필드", () => {
    it("elementRef 필드를 포함한 TriggerInfo를 파싱한다", () => {
      const result = TriggerInfoSchema.parse({
        kind: "button",
        label: "Submit",
        elementRef: { file: "lib/home.dart", line: 42 },
      });
      expect(result.elementRef?.file).toBe("lib/home.dart");
      expect(result.elementRef?.line).toBe(42);
    });

    it("elementRef.line 없이도 파싱된다", () => {
      const result = TriggerInfoSchema.parse({
        kind: "button",
        elementRef: { file: "lib/home.dart" },
      });
      expect(result.elementRef?.file).toBe("lib/home.dart");
      expect(result.elementRef?.line).toBeUndefined();
    });

    it("elementRef에 미지 필드가 있으면 strict 위반으로 에러를 던진다", () => {
      expect(() =>
        TriggerInfoSchema.parse({
          kind: "button",
          elementRef: { file: "lib/home.dart", unknownField: true },
        })
      ).toThrow();
    });

    it("style 필드를 포함한 TriggerInfo를 파싱한다", () => {
      const result = TriggerInfoSchema.parse({
        kind: "button",
        style: { background: "#ff0000", opacity: 0.8 },
      });
      expect(result.style?.background).toBe("#ff0000");
    });

    it("bounds 필드를 포함한 TriggerInfo를 파싱한다", () => {
      const result = TriggerInfoSchema.parse({
        kind: "button",
        bounds: { x: 10, y: 20, width: 100, height: 40 },
      });
      expect(result.bounds?.x).toBe(10);
      expect(result.bounds?.width).toBe(100);
    });

    it("기존 필드만 있는 데이터가 하위호환으로 파싱된다", () => {
      // 기존 포맷 — 신규 필드 없음
      const legacy = {
        kind: "button",
        label: "Go Back",
        sourceRef: { file: "lib/app.dart", line: 10 },
      };
      expect(() => TriggerInfoSchema.parse(legacy)).not.toThrow();
      const result = TriggerInfoSchema.parse(legacy);
      expect(result.elementRef).toBeUndefined();
      expect(result.style).toBeUndefined();
      expect(result.bounds).toBeUndefined();
    });
  });

  describe("MapElementSchema — 신규 필드", () => {
    it("style, bounds 필드를 포함한 MapElement를 파싱한다", () => {
      const result = MapElementSchema.parse({
        type: "Button",
        label: "Submit",
        style: { background: "#007AFF", borderRadius: 8 },
        bounds: { x: 16, y: 100, width: 200, height: 48 },
      });
      expect(result.style?.background).toBe("#007AFF");
      expect(result.bounds?.height).toBe(48);
    });

    it("기존 필드만 있는 MapElement가 하위호환으로 파싱된다", () => {
      const legacy = {
        type: "Button",
        label: "Click Me",
        sourceRef: { file: "lib/home.dart", line: 5 },
      };
      const result = MapElementSchema.parse(legacy);
      expect(result.style).toBeUndefined();
      expect(result.bounds).toBeUndefined();
    });

    it("MapElement에 미지 필드가 있으면 strict 위반으로 에러를 던진다", () => {
      expect(() =>
        MapElementSchema.parse({ type: "Button", unknownField: "bad" })
      ).toThrow();
    });
  });
});
