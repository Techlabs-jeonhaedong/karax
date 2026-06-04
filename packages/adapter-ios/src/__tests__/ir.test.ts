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

  it("ProductCard/PriceTag 2단 인라이닝 — 구조 인라이닝 동작 확인 (M1)", () => {
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

  it("PriceTag 인라이닝 — simple_identifier 체인 바인딩으로 구조 전달 (M1)", () => {
    // ProductCard body에서 PriceTag(originalPrice: originalPrice, discountedPrice: discountedPrice) 호출 시
    // 'originalPrice', 'discountedPrice'는 simple_identifier — 상위 ProductCard argBindings에서 체인 바인딩됨.
    // DetailScreen→ForEach에서 product.originalPrice, product.discountedPrice는 navigation_expression이므로
    // extractCallArgsMap의 navigation_expression 해석을 통해 실제 값이 전달됨.
    // 중요: PriceTag 구조(HStack > Text 등)가 IR에 나타나야 함 (Unknown으로 붕괴하지 않음)
    const countByType = (node: any, type: string): number => {
      if (!node) return 0;
      let cnt = node.type === type ? 1 : 0;
      for (const c of node.children ?? []) cnt += countByType(c, type);
      return cnt;
    };
    // DetailScreen IR에 Row(HStack) 노드가 있어야 함 — PriceTag의 HStack이 인라이닝된 결과
    const rowCount = countByType(detailDoc.screen.root, "Row");
    expect(rowCount).toBeGreaterThan(0);
  });

  it("member-access 인자로 인한 DYNAMIC_DATA_MOCKED diagnostic이 발생한다", () => {
    // product.title, product.description 등은 navigation_expression이라 mock으로 대체됨
    const hasMockedDiag = detailDoc.diagnostics?.some(
      (d) => d.code === "DYNAMIC_DATA_MOCKED"
    );
    expect(hasMockedDiag).toBe(true);
  });

  it("ForEach 컬렉션 상수 평가 — 3개 카드 각각의 실제 상품명·가격·배지가 IR에 존재한다", () => {
    // DetailScreen은 private let products = [ProductItem(...)] 배열을 ForEach로 순회한다.
    // 컬렉션 리터럴 정적 평가 + if-let 지역 바인딩 추적 구현 후:
    // - 각 ProductItem의 title, originalPrice, discountedPrice, badge 값이 IR Text 노드에 나타나야 함
    // - 3개 카드가 서로 다른 실제 데이터를 가져야 함 (fixture 소스 값과 일치)

    const collectTextValues = (node: any): string[] => {
      if (!node) return [];
      const vals: string[] = [];
      if (node.type === "Text" && node.text?.value) vals.push(String(node.text.value));
      for (const c of node.children ?? []) vals.push(...collectTextValues(c));
      return vals;
    };
    const textValues = collectTextValues(detailDoc.screen.root);

    // fixture의 실제 상품명 (3개 모두 다름)
    expect(textValues.some((v) => v.includes("Wireless Noise-Cancelling Headphones"))).toBe(true);
    expect(textValues.some((v) => v.includes("Mechanical Keyboard Pro"))).toBe(true);
    expect(textValues.some((v) => v.includes("USB-C Hub 7-in-1"))).toBe(true);

    // fixture의 실제 가격 (originalPrice)
    expect(textValues.some((v) => v.includes("299.99"))).toBe(true);
    expect(textValues.some((v) => v.includes("149"))).toBe(true);
    expect(textValues.some((v) => v.includes("89.99"))).toBe(true);

    // fixture의 실제 할인가 (discountedPrice) — if-let 지역 바인딩 추적으로 추출
    // Card0: 199.99, Card2: 69.99 (Card1은 nil이라 없음)
    expect(textValues.some((v) => v.includes("199.99"))).toBe(true);
    expect(textValues.some((v) => v.includes("69.99"))).toBe(true);

    // fixture의 실제 배지 (SALE, NEW, 세 번째는 nil이라 없음)
    expect(textValues.some((v) => v === "SALE")).toBe(true);
    expect(textValues.some((v) => v === "NEW")).toBe(true);
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

  it("SettingsScreen의 Color(\"LogoColor\") 사용이 token: 참조로 IR에 기록된다 (M2)", () => {
    // SettingsScreen에 Color("LogoColor") 사용이 추가됨 (About 섹션 Brand Color HStack).
    // adapter-ios가 이를 token:LogoColor 참조로 IR에 기록해야 함.
    const hasLogoColorRef = (node: any): boolean => {
      if (!node) return false;
      const styleColor = node.style?.background ?? node.style?.color ?? node.text?.color ?? "";
      if (typeof styleColor === "string" && styleColor.includes("LogoColor")) return true;
      return (node.children ?? []).some(hasLogoColorRef);
    };
    // SettingsScreen IR에 LogoColor token 참조가 있어야 함
    expect(hasLogoColorRef(settingsDoc.screen.root)).toBe(true);
  });

  it("designTokens에 LogoColor colorset 값이 포함된다 (M2)", () => {
    // themeResolver가 colorset을 파싱해 designTokens에 기록하고,
    // 이를 기반으로 IR 노드가 token: 참조를 생성함
    const colors = settingsDoc.designTokens?.colors ?? {};
    const hasLogoColor = "LogoColor" in colors || "color:LogoColor" in colors;
    expect(hasLogoColor).toBe(true);
    const val = colors["LogoColor"] ?? colors["color:LogoColor"];
    expect(val).toMatch(/^#[0-9a-fA-F]{6}$/);
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
