/**
 * buildScreenIR 스냅샷 + 구조 테스트
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { androidAdapter } from "../index.js";
import type { AdapterContext } from "@karax/adapter-api";
import type { IRNode } from "@karax/core";
import { safeParseIRDocument } from "@karax/core";

/** 노드 트리에서 모든 Text 노드의 value를 수집한다 */
function collectTextValues(node: IRNode): string[] {
  const values: string[] = [];
  if (node.type === "Text" && node.text?.value) {
    values.push(node.text.value);
  }
  for (const child of node.children ?? []) {
    values.push(...collectTextValues(child));
  }
  return values;
}

/** 노드 트리에서 Branch 노드 개수를 센다 */
function countBranchNodes(node: IRNode): number {
  let count = node.type === "Branch" ? 1 : 0;
  for (const child of node.children ?? []) {
    count += countBranchNodes(child);
  }
  return count;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");
const FIXTURE = path.join(FIXTURES_DIR, "android-compose-basic");

const ctx: AdapterContext = {
  projectPath: FIXTURE,
  mockSeed: 42,
  maxInlineDepth: 6,
};

describe("buildScreenIR — HomeScreen (표준 위젯)", () => {
  it("IR 스키마를 통과한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    const result = safeParseIRDocument(doc);
    expect(result.success).toBe(true);
  });

  it("schemaVersion이 0.1이다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    expect(doc.schemaVersion).toBe("0.1");
  });

  it("discovery=route이다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    expect(doc.screen.discovery).toBe("route");
  });

  it("confidence > 0이다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    expect(doc.screen.confidence).toBeGreaterThan(0);
  });

  it("root 노드 타입이 Box(Scaffold)이다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    expect(doc.screen.root.type).toBe("Box");
  });

  it("appbar role 노드를 포함한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    const hasAppbar = doc.screen.root.children?.some((c) => c.role === "appbar");
    expect(hasAppbar).toBe(true);
  });

  it("designTokens.colors에 primary가 있다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    expect(doc.designTokens?.colors).toBeDefined();
    expect(doc.designTokens?.colors?.primary).toBeDefined();
  });

  it("sourceRef.file이 .kt 확장자이다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    expect(doc.screen.sourceRef?.file).toMatch(/\.kt$/);
  });

  it("스냅샷 — mockSeed 42 결정론 확인", async () => {
    const doc1 = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    const doc2 = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    expect(doc1.screen.confidence).toBe(doc2.screen.confidence);
    expect(doc1.screen.root.type).toBe(doc2.screen.root.type);
  });
});

describe("buildScreenIR — DetailScreen (커스텀 컴포넌트 인라이닝)", () => {
  it("IR 스키마를 통과한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "DetailScreen");
    const result = safeParseIRDocument(doc);
    expect(result.success).toBe(true);
  });

  it("discovery=route이다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "DetailScreen");
    expect(doc.screen.discovery).toBe("route");
  });

  it("ProductCard 인라이닝 결과가 존재한다 (Unknown이 아닌 노드가 있다)", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "DetailScreen");
    function countNonUnknown(node: IRNode): number {
      let count = node.type !== "Unknown" ? 1 : 0;
      for (const c of node.children ?? []) count += countNonUnknown(c);
      return count;
    }
    expect(countNonUnknown(doc.screen.root)).toBeGreaterThan(1);
  });

  it("stringResource 인자로 전달된 productName이 strings.xml 값으로 해석된다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "DetailScreen");
    const texts = collectTextValues(doc.screen.root);
    // ProductCard(productName=stringResource(R.string.product_alpha_name)) → "Alpha Widget Pro"
    expect(texts).toContain("Alpha Widget Pro");
  });

  it("stringResource 인자로 전달된 description이 strings.xml 값으로 해석된다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "DetailScreen");
    const texts = collectTextValues(doc.screen.root);
    // product_alpha_desc
    expect(texts).toContain(
      "High-performance widget with advanced features for power users."
    );
  });

  it("리터럴 price 인자 '$29.99'가 실값으로 전달된다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "DetailScreen");
    const texts = collectTextValues(doc.screen.root);
    expect(texts).toContain("$29.99");
  });
});

describe("buildScreenIR — ListScreen (조건부 렌더링 + LazyColumn)", () => {
  it("IR 스키마를 통과한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "ListScreen");
    const result = safeParseIRDocument(doc);
    expect(result.success).toBe(true);
  });

  it("discovery=route이다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "ListScreen");
    expect(doc.screen.discovery).toBe("route");
  });

  it("when 3분기가 Branch 노드로 보존된다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "ListScreen");
    expect(countBranchNodes(doc.screen.root)).toBeGreaterThanOrEqual(1);
  });

  it("Branch 노드의 role에 Loading|Empty|Data 조건이 포함된다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "ListScreen");
    function findBranch(node: IRNode): IRNode | undefined {
      if (node.type === "Branch") return node;
      for (const c of node.children ?? []) {
        const found = findBranch(c);
        if (found) return found;
      }
      return undefined;
    }
    const branch = findBranch(doc.screen.root);
    expect(branch).toBeDefined();
    expect(branch?.role).toMatch(/Loading/);
    expect(branch?.role).toMatch(/Empty/);
    expect(branch?.role).toMatch(/Data/);
  });

  it("DYNAMIC_DATA_MOCKED diagnostic이 존재한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "ListScreen");
    const hasDynamic = doc.diagnostics?.some(
      (d) => d.code === "DYNAMIC_DATA_MOCKED"
    );
    expect(hasDynamic).toBe(true);
  });

  it("appbar role 노드를 포함한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "ListScreen");
    const hasAppbar = doc.screen.root.children?.some((c) => c.role === "appbar");
    expect(hasAppbar).toBe(true);
  });

  it("TopAppBar title 'Item List'가 appbar 노드 안에 Text로 나타난다 (L1 버그 수정)", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "ListScreen");
    function findInAppbar(node: IRNode): string[] {
      if (node.role === "appbar") return collectTextValues(node);
      const texts: string[] = [];
      for (const c of node.children ?? []) texts.push(...findInAppbar(c));
      return texts;
    }
    const appbarTexts = findInAppbar(doc.screen.root);
    expect(appbarTexts).toContain("Item List");
  });
});

describe("buildScreenIR — SettingsScreen (테마 토큰)", () => {
  it("IR 스키마를 통과한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    const result = safeParseIRDocument(doc);
    expect(result.success).toBe(true);
  });

  it("designTokens에 테마 색상이 있다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    expect(doc.designTokens?.colors?.primary).toBeDefined();
  });

  it("Theme.kt의 primary 토큰이 #6200EE이다 (BrandPrimary)", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    expect(doc.designTokens?.colors?.primary).toBe("#6200EE");
  });

  it("Theme.kt의 tertiary 토큰이 #7857A8이다 (중첩 괄호 파싱 버그 검증)", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    expect(doc.designTokens?.colors?.tertiary).toBe("#7857A8");
  });

  it("Theme.kt의 error 토큰이 #B00020이다 (ErrorRed)", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    expect(doc.designTokens?.colors?.error).toBe("#B00020");
  });

  it("Theme.kt의 surface 토큰이 #FFFFFF이다 (SurfaceLight)", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    expect(doc.designTokens?.colors?.surface).toBe("#FFFFFF");
  });

  it("Theme.kt의 background 토큰이 #FEF7FF이다 (BackgroundLight)", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    expect(doc.designTokens?.colors?.background).toBe("#FEF7FF");
  });

  it("stringResource 인자로 전달된 SettingsSection title이 strings.xml 값으로 해석된다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    const texts = collectTextValues(doc.screen.root);
    // SettingsSection(title=stringResource(R.string.settings_appearance)) → "Appearance"
    expect(texts).toContain("Appearance");
    expect(texts).toContain("Notifications");
  });

  it("stringResource 인자 label이 SettingsToggleRow에서 해석된다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "SettingsScreen");
    const texts = collectTextValues(doc.screen.root);
    // settings_dark_mode = "Dark Mode"
    expect(texts).toContain("Dark Mode");
    // settings_push_notifications = "Push Notifications"
    expect(texts).toContain("Push Notifications");
  });
});

describe("buildScreenIR — OrphanScreen (heuristic candidate)", () => {
  it("IR 스키마를 통과한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "OrphanScreen");
    const result = safeParseIRDocument(doc);
    expect(result.success).toBe(true);
  });

  it("discovery=candidate이다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "OrphanScreen");
    expect(doc.screen.discovery).toBe("candidate");
  });
});

describe("buildScreenIR — 존재하지 않는 화면", () => {
  it("UNRESOLVED_COMPONENT diagnostic을 반환한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "NonExistentScreen");
    const hasUnresolved = doc.diagnostics?.some(
      (d) => d.code === "UNRESOLVED_COMPONENT"
    );
    expect(hasUnresolved).toBe(true);
  });

  it("Unknown 루트 노드를 반환한다", async () => {
    const doc = await androidAdapter.buildScreenIR(ctx, "NonExistentScreen");
    expect(doc.screen.root.type).toBe("Unknown");
  });
});

describe("buildScreenIR — confidence 단조성", () => {
  it("route 화면의 confidence >= candidate 화면의 confidence", async () => {
    const routeDoc = await androidAdapter.buildScreenIR(ctx, "HomeScreen");
    const candidateDoc = await androidAdapter.buildScreenIR(ctx, "OrphanScreen");
    expect(routeDoc.screen.confidence).toBeGreaterThanOrEqual(
      candidateDoc.screen.confidence
    );
  });
});
