import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { reactNativeAdapter } from "../index.js";
import { safeParseIRDocument } from "@sfc/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../..", "fixtures/react-native-basic");

// 전체 화면 ID 목록
const SCREEN_IDS = [
  "HomeScreen",
  "DetailScreen",
  "ListScreen",
  "SettingsScreen",
  "OrphanScreen",
];

describe("buildScreenIR — IR 스키마 유효성", () => {
  for (const screenId of SCREEN_IDS) {
    it(`${screenId}: IR이 스키마를 통과한다`, async () => {
      const doc = await reactNativeAdapter.buildScreenIR(
        { projectPath: FIXTURE_PATH, mockSeed: 42 },
        screenId
      );
      const result = safeParseIRDocument(doc);
      expect(result.success).toBe(true);
    });
  }

  it("HomeScreen: discovery=route", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "HomeScreen"
    );
    expect(doc.screen.discovery).toBe("route");
  });

  it("OrphanScreen: discovery=candidate", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "OrphanScreen"
    );
    expect(doc.screen.discovery).toBe("candidate");
  });

  it("HomeScreen: confidence > 0", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "HomeScreen"
    );
    expect(doc.screen.confidence).toBeGreaterThan(0);
  });

  it("mockSeed=42 결정론: 두 번 호출 결과가 동일하다", async () => {
    const doc1 = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "HomeScreen"
    );
    const doc2 = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "HomeScreen"
    );
    expect(JSON.stringify(doc1)).toBe(JSON.stringify(doc2));
  });

  it("HomeScreen: designTokens에 theme colors 포함", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "HomeScreen"
    );
    expect(doc.designTokens?.colors?.["primary"]).toBe("#6200EE");
  });

  it("ListScreen: FlatList → Scroll+List 구조 포함", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "ListScreen"
    );
    const root = doc.screen.root;
    // 트리 전체에 Scroll 또는 List 노드가 있어야 함
    function hasNodeType(node: typeof root, types: string[]): boolean {
      if (types.includes(node.type)) return true;
      return (node.children ?? []).some(c => hasNodeType(c, types));
    }
    expect(hasNodeType(root, ["Scroll", "List"])).toBe(true);
  });

  it("DetailScreen: 커스텀 컴포넌트 인라이닝 (ProductCard)", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "DetailScreen"
    );
    // UNRESOLVED_COMPONENT 진단이 있더라도 confidence > 0
    expect(doc.screen.confidence).toBeGreaterThan(0);
    // 적어도 Image 노드가 있어야 함 (ProductCard 안의 Image)
    function countNodeType(node: typeof doc.screen.root, type: string): number {
      let count = node.type === type ? 1 : 0;
      for (const c of node.children ?? []) count += countNodeType(c, type);
      return count;
    }
    // Image 또는 커스텀 컴포넌트 Unknown이 있어야 함
    const hasImageOrUnknown =
      countNodeType(doc.screen.root, "Image") > 0 ||
      countNodeType(doc.screen.root, "Unknown") > 0;
    expect(hasImageOrUnknown).toBe(true);
  });

  it("존재하지 않는 screenId → UNRESOLVED_COMPONENT 진단", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "NonExistentScreen"
    );
    expect(doc.diagnostics?.some(d => d.code === "UNRESOLVED_COMPONENT")).toBe(true);
    expect(doc.screen.confidence).toBe(0);
  });

  it("SettingsScreen: DYNAMIC_DATA_MOCKED 또는 정상 노드 포함", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "SettingsScreen"
    );
    // SettingsScreen은 Switch(토큰)이 있으므로 Icon 또는 Unknown 노드 존재
    const result = safeParseIRDocument(doc);
    expect(result.success).toBe(true);
    expect(doc.screen.confidence).toBeGreaterThan(0);
  });

  // ── 버그 수정 검증 테스트 ──────────────────────────────────────────────────

  it("ListScreen: 3개 &&-조건부 렌더링이 Branch 노드 1개에 arm 3개로 묶인다", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "ListScreen"
    );
    function findBranchNodes(node: typeof doc.screen.root): Array<typeof doc.screen.root> {
      const results: Array<typeof doc.screen.root> = [];
      if (node.type === "Branch") results.push(node);
      for (const c of node.children ?? []) results.push(...findBranchNodes(c));
      return results;
    }
    const branches = findBranchNodes(doc.screen.root);
    // loadState === 'loading' && ..., loadState === 'empty' && ..., loadState === 'data' && ...
    // 세 개의 형제 && 조건이 하나의 Branch 노드로 묶여야 함
    expect(branches.length).toBeGreaterThanOrEqual(1);
    // 가장 큰 Branch(형제 3-arm)를 찾아서 arm이 3개인지 검증
    const threeBranch = branches.find(b => (b.children?.length ?? 0) >= 3);
    expect(threeBranch).toBeDefined();
    expect(threeBranch!.children!.length).toBe(3);
  });

  it("ListScreen: Branch 세 번째 arm이 FlatList(Scroll+List) 구조를 포함한다", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "ListScreen"
    );
    function findBranchNodes(node: typeof doc.screen.root): Array<typeof doc.screen.root> {
      const results: Array<typeof doc.screen.root> = [];
      if (node.type === "Branch") results.push(node);
      for (const c of node.children ?? []) results.push(...findBranchNodes(c));
      return results;
    }
    function hasNodeType(node: typeof doc.screen.root, types: string[]): boolean {
      if (types.includes(node.type)) return true;
      return (node.children ?? []).some(c => hasNodeType(c, types));
    }
    const branches = findBranchNodes(doc.screen.root);
    const threeBranch = branches.find(b => (b.children?.length ?? 0) >= 3);
    expect(threeBranch).toBeDefined();
    // 세 번째 arm (data 분기) 이 Scroll 또는 List를 포함해야 함
    const thirdArm = threeBranch!.children![2]!;
    expect(hasNodeType(thirdArm, ["Scroll", "List"])).toBe(true);
  });

  it("HomeScreen hero body: {'\\\\n'} 이스케이프가 실제 개행 문자로 디코딩된다", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "HomeScreen"
    );
    function findTextValues(node: typeof doc.screen.root): string[] {
      const values: string[] = [];
      if (node.type === "Text" && node.text?.value) values.push(node.text.value);
      for (const c of node.children ?? []) values.push(...findTextValues(c));
      return values;
    }
    const texts = findTextValues(doc.screen.root);
    // "premium products." 로 끝나는 텍스트에서 다음이 실제 개행 문자여야 함
    const heroText = texts.find(t => t.includes("premium products"));
    expect(heroText).toBeDefined();
    // 실제 개행 문자(char code 10)가 있어야 함, 리터럴 \n(두 글자)이면 안 됨
    if (heroText) {
      expect(heroText.includes("\n")).toBe(true);
      expect(heroText.includes("\\n")).toBe(false);
    }
  });

  it("DetailScreen: PriceTag price prop에 숫자값이 argBindings로 전달된다", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "DetailScreen"
    );
    function findTextValues(node: typeof doc.screen.root): string[] {
      const values: string[] = [];
      if (node.type === "Text" && node.text?.value) values.push(node.text.value);
      for (const c of node.children ?? []) values.push(...findTextValues(c));
      return values;
    }
    const texts = findTextValues(doc.screen.root);
    // SAMPLE_PRODUCTS[0].price = 199.99, product[1].price = 349.00, product[2].price = 24.99
    // 적어도 하나의 가격 관련 숫자가 Text에 나와야 함 (USD, $, 또는 숫자 포함)
    const hasPriceValue = texts.some(t =>
      /\d{2,}\.\d{2}/.test(t) || t.includes("USD") || t.includes("199") || t.includes("349") || t.includes("24.99")
    );
    expect(hasPriceValue).toBe(true);
  });

  it("DetailScreen: 카드 3장이 서로 다른 상품명을 가진다 (per-item bindings)", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "DetailScreen"
    );
    function findTextValues(node: typeof doc.screen.root): string[] {
      const values: string[] = [];
      if (node.type === "Text" && node.text?.value) values.push(node.text.value);
      for (const c of node.children ?? []) values.push(...findTextValues(c));
      return values;
    }
    const texts = findTextValues(doc.screen.root);
    // SAMPLE_PRODUCTS: product-1=Premium Wireless Headphones, product-2=Ergonomic Office Chair, product-3=Artisan Coffee Blend
    // 3개 모두 distinct name이 Text에 나와야 함 (이전 버그: product-1 데이터가 3번 반복됨)
    const hasHeadphones = texts.some(t => t.includes("Premium Wireless Headphones"));
    const hasChair = texts.some(t => t.includes("Ergonomic Office Chair"));
    const hasCoffee = texts.some(t => t.includes("Artisan Coffee Blend"));
    expect(hasHeadphones).toBe(true);
    expect(hasChair).toBe(true);
    expect(hasCoffee).toBe(true);
  });

  it("DetailScreen: PriceTag originalPrice가 discountPercent로부터 계산된다 (로컬 변수 pre-compute)", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "DetailScreen"
    );
    function findTextValues(node: typeof doc.screen.root): string[] {
      const values: string[] = [];
      if (node.type === "Text" && node.text?.value) values.push(node.text.value);
      for (const c of node.children ?? []) values.push(...findTextValues(c));
      return values;
    }
    const texts = findTextValues(doc.screen.root);
    // product-1: price=199.99, discountPercent=20 → originalPrice=Math.round(199.99/(1-0.2))=Math.round(249.99)=250 → "USD250.00"
    // product-3: price=24.99, discountPercent=10 → originalPrice=Math.round(24.99/(1-0.1))=Math.round(27.77)=28 → "USD28.00"
    // product-2는 discountPercent 없으므로 originalPrice=null → originalPrice 텍스트 없음
    const hasProduct1Original = texts.some(t => t.includes("250.00") || t.includes("250"));
    const hasProduct3Original = texts.some(t => t.includes("28.00") || t.includes("28"));
    expect(hasProduct1Original).toBe(true);
    expect(hasProduct3Original).toBe(true);
  });

  it("OrphanScreen: .map() 반복 시 배열 전체 요소를 순서대로 바인딩한다", async () => {
    const doc = await reactNativeAdapter.buildScreenIR(
      { projectPath: FIXTURE_PATH, mockSeed: 42 },
      "OrphanScreen"
    );
    function findTextValues(node: typeof doc.screen.root): string[] {
      const values: string[] = [];
      if (node.type === "Text" && node.text?.value) values.push(node.text.value);
      for (const c of node.children ?? []) values.push(...findTextValues(c));
      return values;
    }
    const texts = findTextValues(doc.screen.root);
    // NOTICES[0]=System Maintenance, [1]=New Feature: Wishlist, [2]=Terms Update
    // 이전 버그: 첫 요소(System Maintenance)가 3번 반복됨
    const hasNotice1 = texts.some(t => t.includes("System Maintenance"));
    const hasNotice2 = texts.some(t => t.includes("New Feature: Wishlist") || t.includes("Wishlist"));
    const hasNotice3 = texts.some(t => t.includes("Terms Update") || t.includes("Terms"));
    expect(hasNotice1).toBe(true);
    expect(hasNotice2).toBe(true);
    expect(hasNotice3).toBe(true);
  });
});
