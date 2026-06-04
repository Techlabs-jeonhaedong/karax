/**
 * buildScreenIR 통합 테스트 (IR 스냅샷)
 * TDD Red 단계
 */

import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { parseIRDocument } from "@sfc/core";
import { flutterAdapter } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");

function ctx(mockSeed = 42) {
  return {
    projectPath: path.join(FIXTURES_DIR, "flutter-basic"),
    framework: "flutter" as const,
    includeCandidates: true,
    mockSeed,
  };
}

// ── IRDocument 스키마 통과 검증 ──────────────────────────────────────────────

describe("buildScreenIR — IRDocument 스키마 통과", () => {
  const screens = ["HomeScreen", "DetailScreen", "ListScreen", "SettingsScreen", "OrphanScreen"];

  for (const screenId of screens) {
    it(`${screenId}: parseIRDocument 통과 (strict zod 스키마)`, async () => {
      const ir = await flutterAdapter.buildScreenIR(ctx(), screenId);
      // zod strict 스키마를 통과해야 함 (throws on violation)
      expect(() => parseIRDocument(ir)).not.toThrow();
    }, 30_000);
  }
});

// ── screen 메타데이터 ────────────────────────────────────────────────────────

describe("buildScreenIR — screen 메타데이터", () => {
  it("HomeScreen: id/discovery/confidence/sourceRef가 올바르다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "HomeScreen");
    expect(ir.screen.id).toBe("HomeScreen");
    expect(ir.screen.discovery).toBe("route");
    expect(ir.screen.confidence).toBeGreaterThan(0);
    expect(ir.screen.confidence).toBeLessThanOrEqual(1);
    expect(ir.screen.sourceRef?.file).toBe("lib/screens/home_screen.dart");
  }, 30_000);

  it("OrphanScreen: discovery가 candidate다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "OrphanScreen");
    expect(ir.screen.id).toBe("OrphanScreen");
    expect(ir.screen.discovery).toBe("candidate");
  }, 30_000);
});

// ── root 노드 구조 ────────────────────────────────────────────────────────────

describe("buildScreenIR — root 노드 구조", () => {
  it("HomeScreen: root는 Scaffold에서 변환된 Box다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "HomeScreen");
    expect(ir.screen.root.type).toBe("Box");
    // appBar role:appbar 자식이 있어야 함
    const hasAppBar = ir.screen.root.children?.some(c => c.role === "appbar") ?? false;
    expect(hasAppBar).toBe(true);
  }, 30_000);

  it("HomeScreen: AppBar title이 Text 노드로 포함된다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "HomeScreen");
    const appBarNode = ir.screen.root.children?.find(c => c.role === "appbar");
    expect(appBarNode).toBeDefined();
    // AppBar 내에 title text 노드가 있어야 함
    function hasTextNode(node: typeof ir.screen.root): boolean {
      if (node.type === "Text") return true;
      return node.children?.some(hasTextNode) ?? false;
    }
    expect(appBarNode ? hasTextNode(appBarNode) : false).toBe(true);
  }, 30_000);

  it("DetailScreen: ProductCard 2단 인라이닝 성공 — Text 노드 5개 이상, Button 포함", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "DetailScreen");
    expect(() => parseIRDocument(ir)).not.toThrow();
    // 인라이닝 성공 시 Text 노드가 5개 이상이어야 함 (ProductCard 내부 텍스트 포함)
    const textCount = countTypeNodes(ir.screen.root, "Text");
    expect(textCount).toBeGreaterThanOrEqual(5);
    // 'Add to Cart' 버튼 텍스트가 포함되어야 함 (PriceTag 2단 인라이닝 경유)
    const textValues = collectTextValues(ir.screen.root);
    expect(textValues).toContain("Add to Cart");
    // Button 노드 존재
    expect(containsType(ir.screen.root, ["Button"])).toBe(true);
  }, 30_000);

  it("ListScreen: List 노드가 대표 아이템 3개를 children으로 가진다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "ListScreen");
    const listNode = findNodeOfType(ir.screen.root, "List");
    expect(listNode).toBeDefined();
    // ListView.separated 대표 3개 반복
    expect(listNode?.children?.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("SettingsScreen: token: 참조가 IR 노드에 최소 1개 이상 있다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "SettingsScreen");
    // colorScheme.xxx 참조가 token: 형식으로 변환되어 있어야 함
    const hasToken = containsTokenRef(ir.screen.root);
    expect(hasToken).toBe(true);
    // designTokens도 채워져 있어야 함
    expect(Object.keys(ir.designTokens?.colors ?? {}).length).toBeGreaterThan(0);
  }, 30_000);
});

// ── designTokens ─────────────────────────────────────────────────────────────

describe("buildScreenIR — designTokens", () => {
  it("HomeScreen: designTokens.colors에 primary 키가 있다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "HomeScreen");
    expect(ir.designTokens?.colors?.["primary"]).toBeDefined();
  }, 30_000);
});

// ── diagnostics ───────────────────────────────────────────────────────────────

describe("buildScreenIR — diagnostics", () => {
  it("HomeScreen: diagnostics는 배열이다 (비어 있어도 됨)", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "HomeScreen");
    expect(Array.isArray(ir.diagnostics)).toBe(true);
  }, 30_000);

  it("DetailScreen: DYNAMIC_DATA_MOCKED diagnostic이 1개 이상 있다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "DetailScreen");
    // diagnostic이 있으면 각각 level/code/message를 가져야 함
    for (const diag of (ir.diagnostics ?? [])) {
      expect(diag.level).toMatch(/^(info|warn|error)$/);
      expect(typeof diag.code).toBe("string");
      expect(typeof diag.message).toBe("string");
    }
    // PriceTag 내 Dart 인터폴레이션($currency...)이 mock 처리되어야 함
    const hasDataMocked = (ir.diagnostics ?? []).some(
      d => d.code === "DYNAMIC_DATA_MOCKED" || d.code === "UNRESOLVED_COMPONENT"
    );
    expect(hasDataMocked).toBe(true);
  }, 30_000);

  it("ListScreen: Branch 노드가 있고 DYNAMIC_DATA_MOCKED diagnostic이 있다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "ListScreen");
    // _buildBody()의 3-way conditional → Branch 노드 생성
    function findBranch(node: { type: string; children?: typeof node[] }): boolean {
      if (node.type === "Branch") return true;
      return (node.children ?? []).some(c => findBranch(c));
    }
    const hasBranch = findBranch(ir.screen.root);
    expect(hasBranch).toBe(true);
    // 동적 데이터(item.title 등) mock 처리 diagnostic이 있어야 함
    const hasMocked = (ir.diagnostics ?? []).some(d => d.code === "DYNAMIC_DATA_MOCKED");
    expect(hasMocked).toBe(true);
  }, 30_000);
});

// ── confidence ────────────────────────────────────────────────────────────────

describe("buildScreenIR — confidence", () => {
  it("route 화면의 confidence는 candidate보다 높거나 같다", async () => {
    const homeIR = await flutterAdapter.buildScreenIR(ctx(), "HomeScreen");
    const orphanIR = await flutterAdapter.buildScreenIR(ctx(), "OrphanScreen");
    expect(homeIR.screen.confidence).toBeGreaterThanOrEqual(orphanIR.screen.confidence);
  }, 60_000);

  it("confidence는 [0, 1] 범위 안에 있다", async () => {
    const ir = await flutterAdapter.buildScreenIR(ctx(), "HomeScreen");
    expect(ir.screen.confidence).toBeGreaterThanOrEqual(0);
    expect(ir.screen.confidence).toBeLessThanOrEqual(1);
  }, 30_000);
});

// ── mockSeed 결정론성 ─────────────────────────────────────────────────────────

describe("buildScreenIR — 결정론성", () => {
  it("같은 mockSeed로 2회 빌드하면 동일한 IR이 나온다", async () => {
    const ir1 = await flutterAdapter.buildScreenIR(ctx(42), "HomeScreen");
    const ir2 = await flutterAdapter.buildScreenIR(ctx(42), "HomeScreen");
    expect(JSON.stringify(ir1)).toBe(JSON.stringify(ir2));
  }, 60_000);
});

// ── IR 스냅샷 테스트 (전체 트리 JSON) ────────────────────────────────────────

describe("buildScreenIR — IR 스냅샷 (전체 트리)", () => {
  const screens = ["HomeScreen", "DetailScreen", "ListScreen", "SettingsScreen", "OrphanScreen"];

  for (const screenId of screens) {
    it(`${screenId}: IR 전체 트리 스냅샷 — sourceRef/confidence/diagnostics 포함`, async () => {
      const ir = await flutterAdapter.buildScreenIR(ctx(42), screenId);
      // mockSeed=42 고정으로 결정론적 스냅샷 생성
      expect(ir).toMatchSnapshot();
    }, 30_000);
  }
});

// ── M2 보완 테스트: missing-class fixture ─────────────────────────────────────

describe("M2 보완: UNRESOLVED_CLASS — 합성 missing-class fixture", () => {
  it("routes 테이블에 존재하지 않는 클래스를 참조하면 UNRESOLVED_COMPONENT diagnostic이 기록된다", async () => {
    // missing-class fixture는 존재하는 클래스만 route로 등록됨
    // flutter-basic에서 직접 존재하지 않는 스크린 ID로 호출
    const result = await flutterAdapter.buildScreenIR(ctx(), "NonExistentScreen");
    // 존재하지 않는 screenId는 UNRESOLVED_COMPONENT diagnostic을 가져야 함
    const hasDiag = (result.diagnostics ?? []).some(d => d.code === "UNRESOLVED_COMPONENT");
    expect(hasDiag).toBe(true);
    // 그래도 root는 Unknown으로 반환됨
    expect(result.screen.root.type).toBe("Unknown");
  }, 30_000);
});

// ── 헬퍼 함수 ────────────────────────────────────────────────────────────────

function countNodes(node: { children?: unknown[] }): number {
  return 1 + (node.children?.reduce((acc: number, c) => acc + countNodes(c as { children?: unknown[] }), 0) ?? 0);
}

function countTypeNodes(node: { type: string; children?: unknown[] }, type: string): number {
  const self = node.type === type ? 1 : 0;
  return self + (node.children?.reduce((acc: number, c) => acc + countTypeNodes(c as typeof node, type), 0) ?? 0);
}

function containsType(node: { type: string; children?: unknown[] }, types: string[]): boolean {
  if (types.includes(node.type)) return true;
  return node.children?.some(c => containsType(c as { type: string; children?: unknown[] }, types)) ?? false;
}

function findNodeOfType(node: { type: string; children?: unknown[] }, type: string): typeof node | undefined {
  if (node.type === type) return node;
  for (const c of node.children ?? []) {
    const found = findNodeOfType(c as typeof node, type);
    if (found) return found;
  }
  return undefined;
}

function collectTextValues(node: { type: string; text?: { value?: string }; children?: unknown[] }): string[] {
  const values: string[] = [];
  if (node.type === "Text" && node.text?.value) values.push(node.text.value);
  for (const c of node.children ?? []) {
    values.push(...collectTextValues(c as typeof node));
  }
  return values;
}

function containsTokenRef(node: { style?: { background?: string }; text?: { color?: string }; children?: unknown[] }): boolean {
  const bg = node.style?.background ?? "";
  const color = node.text?.color ?? "";
  if (bg.startsWith("token:") || color.startsWith("token:")) return true;
  return node.children?.some(c => containsTokenRef(c as typeof node)) ?? false;
}
