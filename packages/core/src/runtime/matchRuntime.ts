/**
 * matchRuntime.ts
 *
 * AppMap MapElement ↔ 런타임 RuntimeNode 매칭 (순수 함수, I/O 없음)
 *
 * 매칭 우선순위:
 *  1. label 정확 일치 → score 1.0
 *  2. label 정규화 일치 → 0.85
 *  3. content-desc 정규화 일치 → 0.75
 *  4. bounds 비례 스케일링 → 0.3~0.6
 */

import type { MapElement } from "../appmap/schema.js";
import type { RuntimeNode } from "./uiautomatorParser.js";

// ─────────────────────────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────────────────────────

export interface ScaleContext {
  appMapWidth: number;
  appMapHeight: number;
  runtimeWidth: number;
  runtimeHeight: number;
}

export type MatchMethod =
  | "label-exact"
  | "label-normalized"
  | "content-desc"
  | "bounds-proportional"
  | "none";

export interface ElementMatch {
  element: MapElement;
  node: RuntimeNode | null;
  score: number;
  method: MatchMethod;
  ambiguous?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// normalizeLabel — 유니코드 안전 (한글 보존, 구두점 제거, 공백 압축)
// ─────────────────────────────────────────────────────────────────

/**
 * - lowercase + trim
 * - 내부 공백(탭·줄바꿈 포함) 압축
 * - ASCII 구두점 제거 (`!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~`)
 *   단, 한글·CJK·이모지 등은 보존
 */
export function normalizeLabel(s: string): string {
  // ASCII 구두점만 제거 (한글/이모지 등 멀티바이트는 건드리지 않음)
  return s
    .toLowerCase()
    .replace(/[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────────

function nodeCenterX(node: RuntimeNode): number {
  return (node.bounds.x1 + node.bounds.x2) / 2;
}

function nodeCenterY(node: RuntimeNode): number {
  return (node.bounds.y1 + node.bounds.y2) / 2;
}

/** AppMap 논리 좌표 중심 → 런타임 물리 좌표로 변환 */
function toRuntimeCenter(
  el: MapElement,
  scale: ScaleContext
): { cx: number; cy: number } | null {
  if (!el.bounds) return null;
  const logicalCx = el.bounds.x + el.bounds.width / 2;
  const logicalCy = el.bounds.y + el.bounds.height / 2;
  const cx = logicalCx * (scale.runtimeWidth / scale.appMapWidth);
  const cy = logicalCy * (scale.runtimeHeight / scale.appMapHeight);
  return { cx, cy };
}

/** 화면 대각선 길이 */
function diagonal(scale: ScaleContext): number {
  return Math.sqrt(scale.runtimeWidth ** 2 + scale.runtimeHeight ** 2);
}

/** 유클리드 거리 기반 proximity score (0..1) */
function proximityScore(
  node: RuntimeNode,
  cx: number,
  cy: number,
  diag: number
): number {
  const dx = nodeCenterX(node) - cx;
  const dy = nodeCenterY(node) - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const threshold = diag * 0.15;
  if (dist > threshold) return -1; // 범위 밖
  // dist=0 → proximity=1, dist=threshold → proximity=0
  const proximity = 1 - dist / threshold;
  return 0.3 + 0.3 * proximity;
}

// ─────────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────────

export function matchAppMapElement(
  el: MapElement,
  nodes: RuntimeNode[],
  scale?: ScaleContext
): ElementMatch {
  const none: ElementMatch = { element: el, node: null, score: 0, method: "none" };

  const label = el.label;

  // ── 1. label 정확 일치 ──
  if (label !== undefined) {
    const exact = nodes.filter((n) => n.text === label);
    if (exact.length === 1) {
      return { element: el, node: exact[0], score: 1.0, method: "label-exact" };
    }
    if (exact.length > 1) {
      // 동명 라벨 복수 — bounds 타이브레이크 시도
      const winner = tiebreak(exact, el, scale);
      return {
        element: el,
        node: winner.node,
        score: 1.0,
        method: "label-exact",
        ambiguous: winner.ambiguous,
      };
    }
  }

  // ── 2. label 정규화 일치 ──
  if (label !== undefined) {
    const normLabel = normalizeLabel(label);
    if (normLabel !== "") {
      const normMatches = nodes.filter(
        (n) => n.text !== label && normalizeLabel(n.text) === normLabel
      );
      if (normMatches.length === 1) {
        return { element: el, node: normMatches[0], score: 0.85, method: "label-normalized" };
      }
      if (normMatches.length > 1) {
        const winner = tiebreak(normMatches, el, scale);
        return {
          element: el,
          node: winner.node,
          score: 0.85,
          method: "label-normalized",
          ambiguous: winner.ambiguous,
        };
      }
    }
  }

  // ── 3. content-desc 정규화 일치 ──
  if (label !== undefined) {
    const normLabel = normalizeLabel(label);
    if (normLabel !== "") {
      const descMatches = nodes.filter(
        (n) => normalizeLabel(n.contentDesc) === normLabel && n.contentDesc !== ""
      );
      if (descMatches.length === 1) {
        return { element: el, node: descMatches[0], score: 0.75, method: "content-desc" };
      }
      if (descMatches.length > 1) {
        const winner = tiebreak(descMatches, el, scale);
        return {
          element: el,
          node: winner.node,
          score: 0.75,
          method: "content-desc",
          ambiguous: winner.ambiguous,
        };
      }
    }
  }

  // ── 4. bounds 비례 스케일링 ──
  if (el.bounds && scale) {
    const center = toRuntimeCenter(el, scale);
    if (center) {
      const diag = diagonal(scale);
      const clickable = nodes.filter((n) => n.clickable);
      let best: RuntimeNode | null = null;
      let bestScore = -1;
      for (const node of clickable) {
        const s = proximityScore(node, center.cx, center.cy, diag);
        if (s > bestScore) {
          bestScore = s;
          best = node;
        }
      }
      if (best !== null && bestScore > 0) {
        return { element: el, node: best, score: bestScore, method: "bounds-proportional" };
      }
    }
  }

  return none;
}

/** 동점 후보들 중 bounds 스케일 근접도로 타이브레이크 */
function tiebreak(
  candidates: RuntimeNode[],
  el: MapElement,
  scale?: ScaleContext
): { node: RuntimeNode; ambiguous?: boolean } {
  if (candidates.length === 0) return { node: candidates[0] };

  if (el.bounds && scale) {
    const center = toRuntimeCenter(el, scale);
    if (center) {
      let best = candidates[0];
      let bestDist = Infinity;
      for (const node of candidates) {
        const dx = nodeCenterX(node) - center.cx;
        const dy = nodeCenterY(node) - center.cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < bestDist) {
          bestDist = dist;
          best = node;
        }
      }
      return { node: best };
    }
  }

  // bounds 없으면 첫 번째 + ambiguous:true
  return { node: candidates[0], ambiguous: true };
}

/**
 * locateLabel
 *
 * 라벨로 노드를 검색한다. 매칭 실패 시 candidates에 부분 포함 상위 3개 반환.
 */
export function locateLabel(
  label: string,
  nodes: RuntimeNode[]
): { node: RuntimeNode | null; method: MatchMethod; score: number; candidates: RuntimeNode[] } {
  if (nodes.length === 0) {
    return { node: null, method: "none", score: 0, candidates: [] };
  }

  // 1. label 정확 일치
  const exact = nodes.filter((n) => n.text === label);
  if (exact.length > 0) {
    return { node: exact[0], method: "label-exact", score: 1.0, candidates: [] };
  }

  // 2. 정규화 일치
  const normLabel = normalizeLabel(label);
  if (normLabel !== "") {
    const norm = nodes.filter((n) => normalizeLabel(n.text) === normLabel);
    if (norm.length > 0) {
      return { node: norm[0], method: "label-normalized", score: 0.85, candidates: [] };
    }

    // 3. content-desc
    const desc = nodes.filter(
      (n) => normalizeLabel(n.contentDesc) === normLabel && n.contentDesc !== ""
    );
    if (desc.length > 0) {
      return { node: desc[0], method: "content-desc", score: 0.75, candidates: [] };
    }
  }

  // 실패 — 부분 포함 candidates 최대 3개
  const partial = normLabel
    ? nodes
        .filter((n) => {
          const nt = normalizeLabel(n.text);
          const nc = normalizeLabel(n.contentDesc);
          return (nt && nt.includes(normLabel)) || (nc && nc.includes(normLabel));
        })
        .slice(0, 3)
    : [];

  return { node: null, method: "none", score: 0, candidates: partial };
}
