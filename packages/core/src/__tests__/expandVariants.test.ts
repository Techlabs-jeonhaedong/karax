import { describe, it, expect } from "vitest";
import type { IRDocument, IRNode } from "../ir/schema.js";
import { expandVariants } from "../ir/expandVariants.js";

// ── 테스트 픽스처 헬퍼 ─────────────────────────────────────────────

function makeDoc(root: IRNode, id = "TestScreen"): IRDocument {
  return {
    schemaVersion: "0.1",
    screen: {
      id,
      discovery: "route",
      confidence: 0.8,
      root,
    },
    designTokens: {},
    diagnostics: [],
  };
}

function textNode(value: string): IRNode {
  return { type: "Text", confidence: 1.0, text: { value } };
}

function branchNode(arms: IRNode[]): IRNode {
  return {
    type: "Branch",
    confidence: 0.5,
    children: arms,
  };
}

function columnNode(children: IRNode[]): IRNode {
  return {
    type: "Column",
    confidence: 1.0,
    children,
  };
}

// ── 테스트 ────────────────────────────────────────────────────────

describe("expandVariants", () => {
  it("Branch 없으면 빈 배열 반환", () => {
    const doc = makeDoc(columnNode([textNode("Hello")]));
    expect(expandVariants(doc)).toEqual([]);
  });

  it("Branch가 root에 있는 경우 arm1부터 variant 반환", () => {
    const arm0 = textNode("Default");
    const arm1 = textNode("Arm 1");
    const arm2 = textNode("Arm 2");
    const doc = makeDoc(branchNode([arm0, arm1, arm2]));

    const variants = expandVariants(doc);
    expect(variants).toHaveLength(2);
    expect(variants[0].label).toBe("arm1");
    expect(variants[1].label).toBe("arm2");
  });

  it("arm1 variant의 root가 arm1 노드로 교체됨", () => {
    const arm0 = textNode("Default");
    const arm1 = textNode("Variant One");
    const doc = makeDoc(branchNode([arm0, arm1]));

    const variants = expandVariants(doc);
    expect(variants[0].doc.screen.root).toEqual(arm1);
  });

  it("원본 doc은 불변 유지", () => {
    const arm0 = textNode("Default");
    const arm1 = textNode("Variant One");
    const original = makeDoc(branchNode([arm0, arm1]));

    expandVariants(original);

    // 원본 root는 Branch 노드여야 함
    expect(original.screen.root.type).toBe("Branch");
  });

  it("Branch가 자식 노드에 중첩된 경우도 처리", () => {
    const arm0 = textNode("Default child");
    const arm1 = textNode("Alt child");
    const branch = branchNode([arm0, arm1]);
    const root = columnNode([textNode("Header"), branch]);
    const doc = makeDoc(root);

    const variants = expandVariants(doc);
    expect(variants).toHaveLength(1);
    expect(variants[0].label).toBe("arm1");

    // 교체된 doc의 root는 Column이고 children[1]이 arm1이어야 함
    const newRoot = variants[0].doc.screen.root;
    expect(newRoot.type).toBe("Column");
    expect(newRoot.children?.[1]).toEqual(arm1);
  });

  it("arm 1개(default만)이면 빈 배열 반환", () => {
    const doc = makeDoc(branchNode([textNode("Only one")]));
    expect(expandVariants(doc)).toEqual([]);
  });

  it("최대 5 variant 제한 — arm이 6개여도 4개만 반환 (arm1~arm4)", () => {
    const arms = Array.from({ length: 6 }, (_, i) => textNode(`Arm ${i}`));
    const doc = makeDoc(branchNode(arms));

    const variants = expandVariants(doc);
    // arms[0] = default, arms[1]~arms[4] = 4 variants (arm1~arm4)
    expect(variants).toHaveLength(4);
    expect(variants[3].label).toBe("arm4");
  });

  it("variant doc의 screen.id는 원본과 동일하게 유지", () => {
    const doc = makeDoc(branchNode([textNode("A"), textNode("B")]), "ListScreen");
    const variants = expandVariants(doc);
    expect(variants[0].doc.screen.id).toBe("ListScreen");
  });

  it("BRANCH_VARIANT_EXPANDED diagnostic이 추가됨", () => {
    const doc = makeDoc(branchNode([textNode("A"), textNode("B")]));
    const variants = expandVariants(doc);
    const diags = variants[0].doc.diagnostics ?? [];
    expect(diags.some((d) => d.code === "BRANCH_VARIANT_EXPANDED")).toBe(true);
  });

  it("3개 arm인 Branch — 3개 variant 라벨 정확성", () => {
    const arms = [textNode("A"), textNode("B"), textNode("C")];
    const doc = makeDoc(branchNode(arms));
    const variants = expandVariants(doc);

    expect(variants.map((v) => v.label)).toEqual(["arm1", "arm2"]);
  });

  it("빈 children Branch도 빈 배열 반환 (arms 없음)", () => {
    const doc = makeDoc({ type: "Branch", confidence: 0.5, children: [] });
    expect(expandVariants(doc)).toEqual([]);
  });
});
