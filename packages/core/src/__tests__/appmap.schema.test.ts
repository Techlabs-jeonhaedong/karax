import { describe, it, expect } from "vitest";
import {
  AppMapSchema,
  NavigationEdgeSchema,
  ScreenNodeSchema,
  NavigationGraphSchema,
  sanitizeAppName,
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

    it("빈 문자열이면 unnamed를 반환한다", () => {
      expect(sanitizeAppName("")).toBe("unnamed");
      expect(sanitizeAppName("   ")).toBe("unnamed");
    });

    it("특수문자를 처리한다", () => {
      expect(sanitizeAppName("my.app:v1")).toBe("my.app_v1");
    });

    it("이모지와 한글을 그대로 유지한다", () => {
      expect(sanitizeAppName("내앱")).toBe("내앱");
    });
  });
});
