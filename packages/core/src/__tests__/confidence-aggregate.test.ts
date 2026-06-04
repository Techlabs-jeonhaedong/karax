import { describe, expect, it } from "vitest";
import {
  NODE_CONFIDENCE,
  aggregateScreenConfidence,
  computeProjectConfidence,
} from "../confidence/aggregate.js";
import type { IRNode } from "../ir/schema.js";

// ── 헬퍼 ──────────────────────────────────────────────────────────

function makeNode(
  confidence: number,
  children?: IRNode[]
): IRNode {
  return {
    type: "Box",
    confidence,
    ...(children ? { children } : {}),
  };
}

function makeLeaf(confidence: number): IRNode {
  return { type: "Text", confidence };
}

// ── NODE_CONFIDENCE 상수 ──────────────────────────────────────────

describe("NODE_CONFIDENCE 상수", () => {
  it("standard = 1.0", () => {
    expect(NODE_CONFIDENCE.standard).toBe(1.0);
  });

  it("inlined = 0.7", () => {
    expect(NODE_CONFIDENCE.inlined).toBe(0.7);
  });

  it("mocked = 0.5", () => {
    expect(NODE_CONFIDENCE.mocked).toBe(0.5);
  });

  it("unknown = 0.2", () => {
    expect(NODE_CONFIDENCE.unknown).toBe(0.2);
  });
});

// ── aggregateScreenConfidence — 기본 동작 ─────────────────────────

describe("aggregateScreenConfidence — 기본 동작", () => {
  it("단일 노드 (leaf) — route: 노드 confidence × 1.0, 클램프", () => {
    const node = makeLeaf(1.0);
    const result = aggregateScreenConfidence(node, "route");
    expect(result).toBeCloseTo(1.0, 5);
  });

  it("단일 노드 — candidate: 노드 confidence × 0.6", () => {
    const node = makeLeaf(1.0);
    const result = aggregateScreenConfidence(node, "candidate");
    expect(result).toBeCloseTo(0.6, 5);
  });

  it("모든 노드 1.0 — route → 1.0", () => {
    const root = makeNode(1.0, [makeLeaf(1.0), makeLeaf(1.0)]);
    expect(aggregateScreenConfidence(root, "route")).toBeCloseTo(1.0, 5);
  });

  it("모든 노드 0.0 — route → 0.0", () => {
    const root = makeNode(0.0, [makeLeaf(0.0), makeLeaf(0.0)]);
    expect(aggregateScreenConfidence(root, "route")).toBeCloseTo(0.0, 5);
  });

  it("반환값은 항상 0~1 범위", () => {
    const root = makeNode(1.5, [makeLeaf(2.0)]); // 유효하지 않은 confidence도 클램프
    const result = aggregateScreenConfidence(root, "route");
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it("candidate discovery는 route보다 낮거나 같은 값", () => {
    const root = makeNode(0.8, [makeLeaf(0.6), makeLeaf(1.0)]);
    const routeConf = aggregateScreenConfidence(root, "route");
    const candidateConf = aggregateScreenConfidence(root, "candidate");
    expect(candidateConf).toBeLessThanOrEqual(routeConf);
  });
});

// ── aggregateScreenConfidence — 노드 수 가중 평균 ─────────────────

describe("aggregateScreenConfidence — 노드 수 가중 평균", () => {
  it("자식 없는 루트 단독: 정확히 루트 confidence × discovery 가중", () => {
    const root = makeLeaf(0.8);
    const result = aggregateScreenConfidence(root, "route");
    // 단일 노드 → 평균 = 0.8 → route 가중 × 1.0 → 0.8
    expect(result).toBeCloseTo(0.8, 5);
  });

  it("3개 노드 균등: 평균이 합산/3", () => {
    // confidence: 1.0, 0.7, 0.5 → 평균 = 2.2/3 ≈ 0.733
    const root = makeNode(1.0, [makeLeaf(0.7), makeLeaf(0.5)]);
    const result = aggregateScreenConfidence(root, "route");
    const expected = (1.0 + 0.7 + 0.5) / 3;
    expect(result).toBeCloseTo(expected, 5);
  });

  it("깊은 트리 (depth=5) — 모든 노드 포함 평균", () => {
    // 각 레벨 confidence: 1.0, 0.8, 0.6, 0.4, 0.2
    const leaf = makeLeaf(0.2);
    const d3 = makeNode(0.4, [leaf]);
    const d2 = makeNode(0.6, [d3]);
    const d1 = makeNode(0.8, [d2]);
    const root = makeNode(1.0, [d1]);
    const result = aggregateScreenConfidence(root, "route");
    const expected = (1.0 + 0.8 + 0.6 + 0.4 + 0.2) / 5;
    expect(result).toBeCloseTo(expected, 5);
  });
});

// ── aggregateScreenConfidence — 단조성 테스트 ────────────────────

describe("aggregateScreenConfidence — 단조성 (Unknown 노드 추가 시 confidence 불증가)", () => {
  /**
   * mulberry32 PRNG (provider와 동일 알고리즘)
   * seed 고정 → 재현 가능
   */
  function mulberry32(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s += 0x6d2b79f5;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildRandomTree(rng: () => number, depth: number): IRNode {
    const confidence = rng();
    if (depth <= 0 || rng() < 0.4) {
      return { type: "Text", confidence };
    }
    const childCount = Math.floor(rng() * 3) + 1;
    const children = Array.from({ length: childCount }, () =>
      buildRandomTree(rng, depth - 1)
    );
    return { type: "Column", confidence, children };
  }

  it("랜덤 트리 20개 — 모든 노드 confidence > Unknown(0.2)인 트리에 Unknown 추가 시 confidence가 오르지 않음", () => {
    const rng = mulberry32(12345);

    // confidence를 [unknown+ε, 1.0] 범위로 고정한 트리 생성
    function buildHighConfidenceTree(r: () => number, depth: number): IRNode {
      // unknown(0.2)보다 확실히 높은 값
      const confidence = 0.3 + r() * 0.7; // 0.3~1.0
      if (depth <= 0 || r() < 0.4) {
        return { type: "Text", confidence };
      }
      const childCount = Math.floor(r() * 3) + 1;
      const children = Array.from({ length: childCount }, () =>
        buildHighConfidenceTree(r, depth - 1)
      );
      return { type: "Column", confidence, children };
    }

    for (let i = 0; i < 20; i++) {
      const tree = buildHighConfidenceTree(rng, 4);
      const before = aggregateScreenConfidence(tree, "route");

      // Unknown 노드(confidence=0.2)를 root의 children에 추가
      const unknownNode: IRNode = { type: "Unknown", confidence: NODE_CONFIDENCE.unknown };
      const augmented: IRNode = {
        ...tree,
        children: [...(tree.children ?? []), unknownNode],
      };
      const after = aggregateScreenConfidence(augmented, "route");

      // 모든 기존 노드 confidence > 0.2 이므로 Unknown 추가 후 평균은 반드시 낮아짐
      expect(after).toBeLessThanOrEqual(before + 1e-9);
    }
  });

  it("모두 standard(1.0) 트리에 unknown(0.2) 추가 → 값이 낮아짐", () => {
    const root = makeNode(1.0, [makeLeaf(1.0), makeLeaf(1.0)]);
    const before = aggregateScreenConfidence(root, "route");

    const unknownNode: IRNode = { type: "Unknown", confidence: NODE_CONFIDENCE.unknown };
    const augmented: IRNode = {
      ...root,
      children: [...(root.children ?? []), unknownNode],
    };
    const after = aggregateScreenConfidence(augmented, "route");

    expect(after).toBeLessThan(before);
  });

  it("반례 명시: 매우 낮은 confidence(0.05) 노드 트리에 Unknown(0.2) 추가 시 평균이 증가할 수 있다 (단조성 한계 문서화)", () => {
    // 루트=0.0, 자식들=0.05 트리 → 평균 ≈ 0.033
    // Unknown(0.2) 추가 → 평균 상승 (단조성 일반 보장 불가)
    const root = makeNode(0.0, [makeLeaf(0.05), makeLeaf(0.05)]);
    const before = aggregateScreenConfidence(root, "route");

    const unknownNode: IRNode = { type: "Unknown", confidence: NODE_CONFIDENCE.unknown };
    const augmented: IRNode = {
      ...root,
      children: [...(root.children ?? []), unknownNode],
    };
    const after = aggregateScreenConfidence(augmented, "route");

    // 이 케이스에서 after > before 이 될 수 있음 (단조성 한계)
    // 실무에서 어댑터는 confidence ∈ {0.2, 0.5, 0.7, 1.0} 만 사용하므로 실제 영향 없음
    // 테스트는 이 현상을 명시적으로 기록 (assert 없이 계산값 확인)
    expect(before).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThanOrEqual(0);
    expect(before).toBeLessThanOrEqual(1);
    expect(after).toBeLessThanOrEqual(1);
  });

  it("어댑터 실제 사용 confidence 집합 {0.2, 0.5, 0.7, 1.0}에서 단조성 — unknown 추가 시 표준 트리는 비증가", () => {
    // 표준 상수만 사용하는 트리: 최소값이 0.5 이상이면 Unknown(0.2) 추가 시 반드시 감소
    const standardValues = [NODE_CONFIDENCE.standard, NODE_CONFIDENCE.inlined, NODE_CONFIDENCE.mocked];
    const root = makeNode(NODE_CONFIDENCE.standard, [
      makeLeaf(NODE_CONFIDENCE.inlined),
      makeLeaf(NODE_CONFIDENCE.mocked),
      makeLeaf(NODE_CONFIDENCE.standard),
    ]);
    const before = aggregateScreenConfidence(root, "route");

    const unknownNode: IRNode = { type: "Unknown", confidence: NODE_CONFIDENCE.unknown };
    const augmented: IRNode = {
      ...root,
      children: [...(root.children ?? []), unknownNode],
    };
    const after = aggregateScreenConfidence(augmented, "route");

    // 모든 기존 노드 confidence ≥ mocked(0.5) > unknown(0.2) → 단조성 보장
    expect(after).toBeLessThan(before);
    void standardValues; // 사용 표시
  });
});

// ── computeProjectConfidence ──────────────────────────────────────

describe("computeProjectConfidence", () => {
  it("빈 배열 → { average: 0, coverage: 0 }", () => {
    const result = computeProjectConfidence([]);
    expect(result.average).toBe(0);
    expect(result.coverage).toBe(0);
  });

  it("단일 화면 confidence = 1.0 → average = 1.0", () => {
    const result = computeProjectConfidence([{ confidence: 1.0 }]);
    expect(result.average).toBeCloseTo(1.0, 5);
  });

  it("여러 화면 → 평균값", () => {
    const screens = [
      { confidence: 0.8 },
      { confidence: 0.6 },
      { confidence: 1.0 },
    ];
    const result = computeProjectConfidence(screens);
    expect(result.average).toBeCloseTo((0.8 + 0.6 + 1.0) / 3, 5);
  });

  it("average는 항상 0~1 범위", () => {
    const screens = [{ confidence: 0.3 }, { confidence: 0.7 }];
    const result = computeProjectConfidence(screens);
    expect(result.average).toBeGreaterThanOrEqual(0);
    expect(result.average).toBeLessThanOrEqual(1);
  });

  it("coverage 필드가 0~1 범위", () => {
    const screens = [{ confidence: 0.5 }, { confidence: 0.9 }];
    const result = computeProjectConfidence(screens);
    expect(result.coverage).toBeGreaterThanOrEqual(0);
    expect(result.coverage).toBeLessThanOrEqual(1);
  });

  it("모든 화면 confidence = 0 → average = 0", () => {
    const screens = Array.from({ length: 5 }, () => ({ confidence: 0 }));
    const result = computeProjectConfidence(screens);
    expect(result.average).toBeCloseTo(0, 5);
  });
});
