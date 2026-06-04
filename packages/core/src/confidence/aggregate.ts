import type { IRNode } from "../ir/schema.js";

// ── 노드 단위 confidence 상수 (PLAN.md 12절) ─────────────────────

export const NODE_CONFIDENCE = {
  standard: 1.0,
  inlined: 0.7,
  mocked: 0.5,
  unknown: 0.2,
} as const;

// ── discovery 가중치 ──────────────────────────────────────────────

const DISCOVERY_WEIGHT = {
  route: 1.0,
  candidate: 0.6,
} as const;

// ── 내부: 노드 트리 순회해 모든 노드의 confidence 수집 ──────────

function collectConfidences(node: IRNode, out: number[]): void {
  out.push(node.confidence);
  if (node.children) {
    for (const child of node.children) {
      collectConfidences(child, out);
    }
  }
}

// ── aggregateScreenConfidence ─────────────────────────────────────

/**
 * IRNode 트리를 순회해 노드 수 가중 평균(= 단순 산술 평균)을 구하고
 * discovery 가중치를 곱한 뒤 [0, 1] 클램프.
 *
 * - 노드 수 가중: 모든 노드를 동등하게 취급 → confidence 합 / 노드 수
 * - discovery 가중: route × 1.0 / candidate × 0.6
 */
export function aggregateScreenConfidence(
  root: IRNode,
  discovery: "route" | "candidate"
): number {
  const values: number[] = [];
  collectConfidences(root, values);

  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const weighted = mean * DISCOVERY_WEIGHT[discovery];

  // [0, 1] 클램프
  return Math.max(0, Math.min(1, weighted));
}

// ── computeProjectConfidence ──────────────────────────────────────

export interface ProjectConfidence {
  /** 화면 confidence의 산술 평균 */
  average: number;
  /** 평균 confidence를 커버리지로 사용 (0~1, 화면이 없으면 0) */
  coverage: number;
}

/**
 * 화면 목록의 confidence를 집계해 프로젝트 단위 confidence를 계산한다.
 * screens 배열이 비어 있으면 { average: 0, coverage: 0 } 반환.
 */
export function computeProjectConfidence(
  screens: Array<{ confidence: number }>
): ProjectConfidence {
  if (screens.length === 0) {
    return { average: 0, coverage: 0 };
  }

  const sum = screens.reduce((acc, s) => acc + s.confidence, 0);
  const average = Math.max(0, Math.min(1, sum / screens.length));

  // coverage: 높은 confidence 화면 비율 (0.5 이상을 "해석된" 화면으로 간주)
  const interpreted = screens.filter((s) => s.confidence >= 0.5).length;
  const coverage = interpreted / screens.length;

  return { average, coverage };
}
