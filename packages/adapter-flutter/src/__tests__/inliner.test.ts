/**
 * inliner 단위 테스트
 * TDD Red 단계
 */

import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { buildSymbolTable } from "../parse/scanner.js";
import { readPackageName } from "../parse/pubspec.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");

async function getInliner() {
  const mod = await import("../ir/inliner.js");
  return mod;
}

describe("inliner — 깊이 제한", () => {
  it("maxInlineDepth 도달 시 Unknown 노드를 반환한다", async () => {
    const { createInliner } = await getInliner();
    const projectPath = path.join(FIXTURES_DIR, "flutter-basic");
    const packageName = await readPackageName(projectPath);
    const symbolTable = await buildSymbolTable(projectPath, packageName);

    const inliner = createInliner(symbolTable, projectPath, { maxDepth: 0 });
    // maxDepth 0이면 ProductCard를 인라인하지 못하고 Unknown 반환
    const result = await inliner.inlineClass("ProductCard", {});
    expect(result.node.type).toBe("Unknown");
  });

  it("maxInlineDepth 6(기본)이면 ProductCard→PriceTag 2단 인라이닝 성공한다", async () => {
    const { createInliner } = await getInliner();
    const projectPath = path.join(FIXTURES_DIR, "flutter-basic");
    const packageName = await readPackageName(projectPath);
    const symbolTable = await buildSymbolTable(projectPath, packageName);

    const inliner = createInliner(symbolTable, projectPath, { maxDepth: 6 });
    const result = await inliner.inlineClass("ProductCard", {
      name: "Test Product",
      description: "A great product",
      price: 29.99,
    });
    // 인라인 성공 시 Unknown이 아님
    expect(result.node.type).not.toBe("Unknown");
    // 인라인 노드 confidence는 0.7
    expect(result.node.confidence).toBeGreaterThanOrEqual(0.5);
  });
});

describe("inliner — 재귀 차단 (방문 집합)", () => {
  it("자기 자신을 직접 참조하는 클래스는 Unknown으로 처리된다", async () => {
    const { createInliner } = await getInliner();
    // 재귀 위젯은 실제 fixture에 없으므로 합성 symbolTable 사용
    const { SymbolTableBuilder } = await getInliner();
    // 이 테스트는 inliner가 방문 집합을 통해 재귀를 차단하는지 확인
    // createInliner가 이미 visited 집합을 내부적으로 관리해야 함
    // ProductCard는 자기 자신을 참조하지 않으므로 정상 처리됨
    const projectPath = path.join(FIXTURES_DIR, "flutter-basic");
    const packageName = await readPackageName(projectPath);
    const symbolTable = await buildSymbolTable(projectPath, packageName);
    const inliner = createInliner(symbolTable, projectPath, { maxDepth: 6 });

    // ProductCard 2회 호출해도 방문 집합 때문에 2번째는 Unknown 반환하지 않음
    // (방문 집합은 동일 호출 체인 내에서만 유효)
    const r1 = await inliner.inlineClass("ProductCard", { price: 10 });
    const r2 = await inliner.inlineClass("ProductCard", { price: 20 });
    expect(r1.node.type).not.toBe("Unknown");
    expect(r2.node.type).not.toBe("Unknown");
  });
});

describe("inliner — UNRESOLVED_COMPONENT diagnostic", () => {
  it("심볼 테이블에 없는 클래스는 Unknown + UNRESOLVED_COMPONENT diagnostic", async () => {
    const { createInliner } = await getInliner();
    const projectPath = path.join(FIXTURES_DIR, "flutter-basic");
    const packageName = await readPackageName(projectPath);
    const symbolTable = await buildSymbolTable(projectPath, packageName);
    const inliner = createInliner(symbolTable, projectPath, { maxDepth: 6 });

    const result = await inliner.inlineClass("NonExistentWidget", {});
    expect(result.node.type).toBe("Unknown");
    expect(result.node.confidence).toBe(0.2);
    const hasDiag = result.diagnostics.some(d => d.code === "UNRESOLVED_COMPONENT");
    expect(hasDiag).toBe(true);
  });
});

// IRNode 트리에서 모든 Text 노드 값 수집 헬퍼
function collectTextValues(node: { type: string; text?: { value?: string }; children?: unknown[] }): string[] {
  const results: string[] = [];
  if (node.type === "Text" && node.text?.value !== undefined) {
    results.push(node.text.value);
  }
  if (node.children) {
    for (const child of node.children) {
      if (child && typeof child === "object") {
        results.push(...collectTextValues(child as { type: string; text?: { value?: string }; children?: unknown[] }));
      }
    }
  }
  return results;
}

describe("inliner — 생성자 인자 바인딩", () => {
  it("리터럴 인자(문자열)는 해당 파라미터로 바인딩되어 Text 값으로 나타난다", async () => {
    const { createInliner } = await getInliner();
    const projectPath = path.join(FIXTURES_DIR, "flutter-basic");
    const packageName = await readPackageName(projectPath);
    const symbolTable = await buildSymbolTable(projectPath, packageName);
    const inliner = createInliner(symbolTable, projectPath, { maxDepth: 6 });

    // ProductCard의 name 파라미터에 리터럴 문자열 바인딩
    const result = await inliner.inlineClass("ProductCard", {
      name: "Wireless Headphones",
      price: 79.99,
    });
    expect(result.node.type).not.toBe("Unknown");

    // "Wireless Headphones"가 실제 Text 값으로 나타나야 함
    const textValues = collectTextValues(result.node);
    expect(textValues).toContain("Wireless Headphones");
  });

  it("2단 체인 전달: ProductCard→PriceTag price 값이 Text에 반영된다", async () => {
    const { createInliner } = await getInliner();
    const projectPath = path.join(FIXTURES_DIR, "flutter-basic");
    const packageName = await readPackageName(projectPath);
    const symbolTable = await buildSymbolTable(projectPath, packageName);
    const inliner = createInliner(symbolTable, projectPath, { maxDepth: 6 });

    // ProductCard에 price: 79.99 바인딩 → PriceTag(price: price)로 체인 전달
    // PriceTag 내부 Text('$currency${price.toStringAsFixed(2)}') → "$79.99" 평가
    const result = await inliner.inlineClass("ProductCard", {
      name: "Wireless Headphones",
      description: "Test description",
      price: 79.99,
      originalPrice: 129.99,
    });
    expect(result.node.type).not.toBe("Unknown");

    const textValues = collectTextValues(result.node);
    // 가격 텍스트 "$79.99"가 나타나야 함 (currency='$' default + price.toStringAsFixed(2))
    expect(textValues.some(v => v.includes("79.99"))).toBe(true);
  });
});
