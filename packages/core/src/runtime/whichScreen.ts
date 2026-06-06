/**
 * whichScreen.ts
 *
 * 런타임 노드 집합으로 "현재 화면이 AppMap의 어느 화면인지" 식별 (순수 함수, I/O 없음)
 *
 * similarity = 0.5 * Jaccard + 0.5 * recall
 *   Jaccard  = |A ∩ B| / |A ∪ B|
 *   recall   = |A ∩ B| / |B|   (B = 화면 라벨 집합)
 *
 * - dynamic:true 또는 role:"ad" 요소는 화면 라벨 집합에서 제외
 * - best.similarity < 0.3 → screenId: null
 * - confidence = best * (1 - 0.5 * second/best), second 없으면 그대로
 */

import type { AppMap } from "../appmap/schema.js";
import type { RuntimeNode } from "./uiautomatorParser.js";
import { normalizeLabel } from "./matchRuntime.js";

export interface ScreenIdentification {
  screenId: string | null;
  confidence: number;
  ranked: Array<{ screenId: string; similarity: number }>;
}

// ─────────────────────────────────────────────────────────────────
// 내부 유틸
// ─────────────────────────────────────────────────────────────────

/** 런타임 노드들에서 정규화 라벨 집합 추출 */
function runtimeLabelSet(nodes: RuntimeNode[]): Set<string> {
  const set = new Set<string>();
  for (const n of nodes) {
    const t = normalizeLabel(n.text);
    const c = normalizeLabel(n.contentDesc);
    if (t) set.add(t);
    if (c) set.add(c);
  }
  return set;
}

/**
 * 화면 라벨 집합 추출
 * - dynamic:true 또는 role:"ad" 요소 제외
 * - label 없는 요소 제외
 */
function screenLabelSet(screen: AppMap["screens"][number]): Set<string> {
  const set = new Set<string>();
  for (const el of screen.elements) {
    if (el.dynamic === true || el.role === "ad") continue;
    if (!el.label) continue;
    const norm = normalizeLabel(el.label);
    if (norm) set.add(norm);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const v of b) {
    if (a.has(v)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function recall(a: Set<string>, b: Set<string>): number {
  if (b.size === 0) return 0;
  let intersection = 0;
  for (const v of b) {
    if (a.has(v)) intersection++;
  }
  return intersection / b.size;
}

function similarity(runtimeSet: Set<string>, screenSet: Set<string>): number {
  return 0.5 * jaccard(runtimeSet, screenSet) + 0.5 * recall(runtimeSet, screenSet);
}

// ─────────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────────

export function identifyScreen(
  appMap: AppMap,
  runtimeNodes: RuntimeNode[]
): ScreenIdentification {
  const empty: ScreenIdentification = { screenId: null, confidence: 0, ranked: [] };

  if (appMap.screens.length === 0) return empty;
  if (runtimeNodes.length === 0) return empty;

  const runtimeSet = runtimeLabelSet(runtimeNodes);

  const scored: Array<{ screenId: string; similarity: number }> = [];

  for (const screen of appMap.screens) {
    const sSet = screenLabelSet(screen);
    if (sSet.size === 0) continue; // 라벨 없는 화면은 제외
    const sim = similarity(runtimeSet, sSet);
    scored.push({ screenId: screen.id, similarity: sim });
  }

  if (scored.length === 0) return empty;

  // 내림차순 정렬
  scored.sort((a, b) => b.similarity - a.similarity);

  const best = scored[0];
  const second = scored[1];

  if (best.similarity < 0.3) {
    return { screenId: null, confidence: best.similarity, ranked: scored };
  }

  let confidence = best.similarity;
  if (second) {
    confidence = best.similarity * (1 - 0.5 * (second.similarity / best.similarity));
  }

  return {
    screenId: best.screenId,
    confidence,
    ranked: scored,
  };
}
