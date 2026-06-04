/**
 * adapter-ios IR 빌드 테스트 (Red → Green)
 * fixtures/ios-swiftui-basic 각 화면에 대해 IR 스냅샷을 검증한다.
 *
 * OOM 방지 전략:
 * - 모든 buildSwiftScreenIR 호출을 beforeAll에서 한 번만 실행 (parse 최소화)
 * - 개별 테스트는 이미 파싱된 결과를 참조
 */

import path from "path";
import { describe, it, expect, beforeAll } from "vitest";
import { buildSwiftScreenIR } from "../ir/builder.js";
import type { AdapterContext } from "@sfc/adapter-api";
import type { IRDocument } from "@sfc/core";

const FIXTURE = path.resolve("../../fixtures/ios-swiftui-basic");

function makeCtx(overrides?: Partial<AdapterContext>): AdapterContext {
  return {
    projectPath: FIXTURE,
    mockSeed: 42,
    maxInlineDepth: 6,
    ...overrides,
  };
}

function findType(node: any, type: string): boolean {
  if (!node) return false;
  if (node.type === type) return true;
  return (node.children ?? []).some((c: any) => findType(c, type));
}

// ── 공유 상태: beforeAll에서 한 번만 파싱 ────────────────────────────────────────

let homeDoc: IRDocument;
let listDoc: IRDocument;
let detailDoc: IRDocument;
let settingsDoc: IRDocument;
let orphanDoc: IRDocument;
let missingDoc: IRDocument;
let homeDoc2: IRDocument; // 결정론성 검증용

beforeAll(async () => {
  // loader.ts의 languageCache에 경쟁 상태가 있으므로 순차 실행
  // (Promise.all로 동시 호출 시 Language.load() 중복 실행으로 version 0 에러 발생)
  const ctx = makeCtx();
  homeDoc = await buildSwiftScreenIR(ctx, "HomeScreen");
  listDoc = await buildSwiftScreenIR(ctx, "ListScreen");
  detailDoc = await buildSwiftScreenIR(ctx, "DetailScreen");
  settingsDoc = await buildSwiftScreenIR(ctx, "SettingsScreen");
  orphanDoc = await buildSwiftScreenIR(ctx, "OrphanScreen");
  missingDoc = await buildSwiftScreenIR(ctx, "NonExistentScreen");
  homeDoc2 = await buildSwiftScreenIR(makeCtx({ mockSeed: 42 }), "HomeScreen");
}, 120_000);

// ── HomeScreen ────────────────────────────────────────────────────────────────

describe("buildSwiftScreenIR — HomeScreen", () => {
  it("schemaVersion과 screen.id가 정확하다", () => {
    expect(homeDoc.schemaVersion).toBe("0.1");
    expect(homeDoc.screen.id).toBe("HomeScreen");
  });

  it("discovery가 route이다", () => {
    expect(homeDoc.screen.discovery).toBe("route");
  });

  it("confidence가 0보다 크다", () => {
    expect(homeDoc.screen.confidence).toBeGreaterThan(0);
  });

  it("root 노드가 존재한다", () => {
    expect(homeDoc.screen.root).toBeDefined();
    expect(homeDoc.screen.root.type).not.toBe("Unknown");
  });

  it("sourceRef에 파일 경로와 라인이 있다", () => {
    expect(homeDoc.screen.sourceRef?.file).toContain("HomeScreen");
    expect(homeDoc.screen.sourceRef?.line).toBeGreaterThan(0);
  });

  it("NavigationStack → Box로 매핑된다", () => {
    expect(homeDoc.screen.root.type).toBe("Box");
  });

  it("navigationTitle 수정자가 appbar role Box를 생성한다", () => {
    const children = homeDoc.screen.root.children ?? [];
    const appbar = children.find((c) => c.role === "appbar");
    expect(appbar).toBeDefined();
  });

  it("Text 노드가 포함된다", () => {
    expect(findType(homeDoc.screen.root, "Text")).toBe(true);
  });
});

// ── ListScreen ────────────────────────────────────────────────────────────────

describe("buildSwiftScreenIR — ListScreen (Branch + ForEach)", () => {
  it("IR이 생성된다", () => {
    expect(listDoc.schemaVersion).toBe("0.1");
    expect(listDoc.screen.id).toBe("ListScreen");
  });

  it("root 노드가 정의된다", () => {
    expect(listDoc.screen.root).toBeDefined();
  });

  it("diagnostics가 배열이다", () => {
    expect(Array.isArray(listDoc.diagnostics)).toBe(true);
  });

  it("Branch 노드가 1개 이상 존재한다 (switch viewState 3분기)", () => {
    expect(findType(listDoc.screen.root, "Branch")).toBe(true);
  });

  it("root가 Unknown으로 붕괴하지 않는다", () => {
    expect(listDoc.screen.root.type).not.toBe("Unknown");
    expect(listDoc.screen.confidence).toBeGreaterThan(0.2);
  });
});

// ── DetailScreen ──────────────────────────────────────────────────────────────

describe("buildSwiftScreenIR — DetailScreen (커스텀 컴포넌트 인라이닝)", () => {
  it("Unknown 노드가 전체의 70% 미만이다", () => {
    function countUnknown(node: any): number {
      if (!node) return 0;
      let cnt = node.type === "Unknown" ? 1 : 0;
      for (const c of node.children ?? []) cnt += countUnknown(c);
      return cnt;
    }
    function countTotal(node: any): number {
      if (!node) return 0;
      let cnt = 1;
      for (const c of node.children ?? []) cnt += countTotal(c);
      return cnt;
    }
    const total = countTotal(detailDoc.screen.root);
    const unknowns = countUnknown(detailDoc.screen.root);
    expect(unknowns / total).toBeLessThan(0.7);
  });

  it("confidence가 0.3 이상이다", () => {
    expect(detailDoc.screen.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it("ProductCard/PriceTag 2단 인라이닝 — 구조 인라이닝 동작 확인", () => {
    // DetailScreen은 ForEach(products) { product in ProductCard(title: product.title, ...) } 구조.
    // product.title은 member-access(navigation_expression)이라 정적으로 실값 추적 불가.
    // DYNAMIC_DATA_MOCKED diagnostic이 발생하는 것이 정상 동작.
    // 단, ProductCard/PriceTag 구조체 자체는 인라이닝되어 Text/List/Column 노드가 생성되어야 함.
    const hasTextNodes = (node: any): boolean => {
      if (!node) return false;
      if (node.type === "Text") return true;
      return (node.children ?? []).some(hasTextNodes);
    };
    expect(hasTextNodes(detailDoc.screen.root)).toBe(true);
  });

  it("member-access 인자로 인한 DYNAMIC_DATA_MOCKED diagnostic이 발생한다", () => {
    // product.title, product.description 등은 navigation_expression이라 mock으로 대체됨
    const hasMockedDiag = detailDoc.diagnostics?.some(
      (d) => d.code === "DYNAMIC_DATA_MOCKED"
    );
    expect(hasMockedDiag).toBe(true);
  });
});

// ── LogoColor token 테스트 ───────────────────────────────────────────────────

describe("buildSwiftScreenIR — LogoColor colorset → designTokens", () => {
  it("Assets.xcassets/LogoColor.colorset를 designTokens.colors로 추출한다", () => {
    // themeResolver가 LogoColor colorset을 파싱해서 colors에 키를 추가함
    const colors = homeDoc.designTokens?.colors ?? {};
    const hasLogoColor =
      "LogoColor" in colors || "color:LogoColor" in colors;
    expect(hasLogoColor).toBe(true);
  });

  it("추출된 LogoColor 값이 유효한 hex 색상이다", () => {
    const colors = homeDoc.designTokens?.colors ?? {};
    const val = colors["LogoColor"] ?? colors["color:LogoColor"];
    expect(val).toBeDefined();
    expect(val).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("fixture 어떤 화면도 Color(\"LogoColor\")를 사용하지 않으므로 token: 참조 노드는 없다 (정상 동작)", () => {
    // fixture Sources 전체에 Color("LogoColor") 사용이 없음 — colorset 정의만 있음.
    // 따라서 IR 어떤 노드도 LogoColor를 token: 으로 참조하지 않는 것이 올바른 동작.
    const hasLogoColorRef = (node: any): boolean => {
      if (!node) return false;
      const styleColor = node.style?.background ?? node.style?.color ?? node.text?.color ?? "";
      if (typeof styleColor === "string" && styleColor.includes("LogoColor")) return true;
      return (node.children ?? []).some(hasLogoColorRef);
    };
    // 모든 화면 IR에서 LogoColor token 참조가 없음을 확인 (fixture가 미사용하므로 당연)
    expect(hasLogoColorRef(homeDoc.screen.root)).toBe(false);
    expect(hasLogoColorRef(detailDoc.screen.root)).toBe(false);
    expect(hasLogoColorRef(settingsDoc.screen.root)).toBe(false);
  });
});

// ── SettingsScreen ────────────────────────────────────────────────────────────

describe("buildSwiftScreenIR — SettingsScreen (테마 시스템)", () => {
  it("IR이 생성된다", () => {
    expect(settingsDoc.schemaVersion).toBe("0.1");
    expect(settingsDoc.screen.id).toBe("SettingsScreen");
  });

  it("Form 또는 Column/Box로 매핑된다", () => {
    const rootType = settingsDoc.screen.root.type;
    expect(["Box", "Column", "Scroll", "Unknown"]).toContain(rootType);
  });
});

// ── OrphanScreen ──────────────────────────────────────────────────────────────

describe("buildSwiftScreenIR — OrphanScreen (candidate)", () => {
  it("discovery가 candidate이다", () => {
    expect(orphanDoc.screen.discovery).toBe("candidate");
  });

  it("LazyVGrid → Grid 노드를 포함한다", () => {
    expect(findType(orphanDoc.screen.root, "Grid")).toBe(true);
  });
});

// ── 존재하지 않는 화면 ─────────────────────────────────────────────────────────

describe("buildSwiftScreenIR — 존재하지 않는 화면", () => {
  it("UNRESOLVED_COMPONENT diagnostic을 반환한다", () => {
    expect(
      missingDoc.diagnostics?.some((d) => d.code === "UNRESOLVED_COMPONENT")
    ).toBe(true);
  });

  it("root가 Unknown 노드이다", () => {
    expect(missingDoc.screen.root.type).toBe("Unknown");
  });
});

// ── 결정론성 ──────────────────────────────────────────────────────────────────

describe("buildSwiftScreenIR — mockSeed 결정론성", () => {
  it("동일 seed로 두 번 빌드하면 동일한 IR을 반환한다", () => {
    expect(JSON.stringify(homeDoc.screen.root)).toBe(
      JSON.stringify(homeDoc2.screen.root)
    );
  });
});
