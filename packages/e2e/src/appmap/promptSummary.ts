/**
 * appmap/promptSummary.ts — 순수 함수
 *
 * AppMap 데이터를 에이전트 프롬프트에 주입하기 좋은 요약 형태로 변환한다.
 * @karax/core 타입만 의존 — sdk 동적 import 없음.
 */

import type { AppMap } from "@karax/core";

// ── 공개 타입 ─────────────────────────────────────────────────────────────────

export interface AppMapPromptSummary {
  screenCount: number;
  entryScreenId: string | null;
  navPaths: Array<{ screenId: string; title?: string; pathHint: string }>;
  screens: Array<{ id: string; title?: string; interactiveLabels: string[]; adCount: number }>;
  truncated: boolean;
}

// ── 상수 ─────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_SCREENS = 40;
const DEFAULT_MAX_LABELS_PER_SCREEN = 10;
const LABEL_MAX_LENGTH = 80;
/**
 * 이 값 이하일 때 renderSummaryForPrompt가 화면별 요소를 인라인으로 출력한다.
 * DEFAULT_MAX_SCREENS(40)보다 작아야 한다 — 화면이 많을수록 프롬프트가 폭발적으로 커지므로.
 */
const INLINE_LABEL_MAX_SCREENS = 12;

// ── 라벨 정제 ─────────────────────────────────────────────────────────────────

/**
 * 앱 소스 유래 라벨에서 개행·백틱을 제거하고, 격리 경계 문자열(====)을 무력화한 뒤 80자로 절단한다.
 * 프롬프트 인젝션 1차 방어 (APPMAP 격리 블록과 이중 방어).
 *
 * - 개행 → 공백: 격리 블록 조기 탈출 방지
 * - 4개 이상 연속 `=` → `==~`: `==== APPMAP END ====` 등 경계 시퀀스 무력화
 * - 백틱 → 작은따옴표: 마크다운 코드 블록 탈출 방지
 */
function sanitizeLabel(raw: string): string {
  return raw
    .replace(/[\r\n]/g, " ")       // 개행 → 공백
    .replace(/={4,}/g, "==~")      // 4개 이상 = 연속 → 경계 시퀀스 무력화
    .replace(/`/g, "'")             // 백틱 → 작은따옴표
    .slice(0, LABEL_MAX_LENGTH)
    .trim();
}

// ── BFS 경로 계산 ─────────────────────────────────────────────────────────────

interface BfsPathStep {
  screenId: string;
  triggerLabel: string | null;  // 이 화면으로 오는 데 사용된 트리거 라벨
  action: string;
}

/**
 * entryScreenId에서 각 화면까지 BFS 최단 경로를 계산한다.
 * - 도달 불가 화면: null 반환
 * - to가 null인 엣지 무시
 * - 사이클 안전 처리
 */
function bfsAllPaths(
  appMap: AppMap
): Map<string, BfsPathStep[]> {
  const entryId = appMap.entryScreenId;
  const result = new Map<string, BfsPathStep[]>();

  if (!entryId) return result;

  // 인접 리스트 구성 (to가 null인 엣지 제외)
  const adj = new Map<string, Array<{ to: string; label: string | null; action: string }>>();
  for (const edge of appMap.edges) {
    if (!edge.to) continue;
    const neighbors = adj.get(edge.from) ?? [];
    neighbors.push({
      to: edge.to,
      label: edge.trigger.label ?? null,
      action: edge.action,
    });
    adj.set(edge.from, neighbors);
  }

  // BFS
  const visited = new Set<string>();
  const queue: Array<{ screenId: string; path: BfsPathStep[] }> = [
    { screenId: entryId, path: [] },
  ];
  visited.add(entryId);
  result.set(entryId, []);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current.screenId) ?? [];

    for (const neighbor of neighbors) {
      if (visited.has(neighbor.to)) continue;
      visited.add(neighbor.to);

      const newPath: BfsPathStep[] = [
        ...current.path,
        { screenId: neighbor.to, triggerLabel: neighbor.label, action: neighbor.action },
      ];
      result.set(neighbor.to, newPath);
      queue.push({ screenId: neighbor.to, path: newPath });
    }
  }

  return result;
}

/**
 * BFS 경로 배열을 사람이 읽기 좋은 경로 힌트 문자열로 변환한다.
 * 예: "HomeScreen → DetailScreen(버튼 '시작') → SettingsScreen(버튼 '설정')"
 */
function buildPathHint(
  entryId: string,
  path: BfsPathStep[],
  screenTitleMap: Map<string, string | undefined>
): string {
  const entryLabel = sanitizeLabel(screenTitleMap.get(entryId) ?? entryId);

  if (path.length === 0) {
    // 진입점 자체
    return entryLabel;
  }

  const parts: string[] = [entryLabel];

  for (const step of path) {
    const screenLabel = sanitizeLabel(screenTitleMap.get(step.screenId) ?? step.screenId);
    const triggerSuffix = step.triggerLabel
      ? `(버튼 '${sanitizeLabel(step.triggerLabel)}')`
      : `(${step.action})`;
    parts.push(`${screenLabel}${triggerSuffix}`);
  }

  return parts.join(" → ");
}

// ── summarizeAppMap ───────────────────────────────────────────────────────────

export function summarizeAppMap(
  appMap: AppMap,
  opts?: { maxScreens?: number; maxLabelsPerScreen?: number }
): AppMapPromptSummary {
  const maxScreens = opts?.maxScreens ?? DEFAULT_MAX_SCREENS;
  const maxLabels = opts?.maxLabelsPerScreen ?? DEFAULT_MAX_LABELS_PER_SCREEN;
  const screenCount = appMap.screens.length;

  // 화면별 제목 맵
  const screenTitleMap = new Map<string, string | undefined>(
    appMap.screens.map((s) => [s.id, s.title])
  );

  // BFS 경로 계산
  const bfsPaths = bfsAllPaths(appMap);

  // navPaths 구성 (모든 화면) — screenId·title 모두 정제
  const navPaths: AppMapPromptSummary["navPaths"] = appMap.screens.map((screen) => {
    const safeId = sanitizeLabel(screen.id);
    const safeTitle = screen.title !== undefined ? sanitizeLabel(screen.title) : undefined;
    const path = bfsPaths.get(screen.id);
    if (path === undefined) {
      return {
        screenId: safeId,
        title: safeTitle,
        pathHint: `(진입 경로 미발견 — 직접 탐색 필요)`,
      };
    }
    return {
      screenId: safeId,
      title: safeTitle,
      pathHint: buildPathHint(appMap.entryScreenId!, path, screenTitleMap),
    };
  });

  // screens 요약 구성
  const truncated = screenCount > maxScreens;
  // 50개 초과 시 진입점 + route 발견 위주 상위 maxScreens개
  let screensToInclude = appMap.screens;
  if (truncated) {
    screensToInclude = appMap.screens
      .filter((s) => s.isEntry || s.discovery === "route")
      .slice(0, maxScreens);
  }

  const screens: AppMapPromptSummary["screens"] = screensToInclude.map((screen) => {
    // interactive 라벨: label이 있는 요소, ad 제외
    const interactiveLabels = screen.elements
      .filter((el) => el.label && el.role !== "ad")
      .map((el) => sanitizeLabel(el.label!))
      .filter((l) => l.length > 0)
      .slice(0, maxLabels);

    const adCount = screen.elements.filter((el) => el.role === "ad").length;

    return {
      id: sanitizeLabel(screen.id),
      title: screen.title !== undefined ? sanitizeLabel(screen.title) : undefined,
      interactiveLabels,
      adCount,
    };
  });

  return {
    screenCount,
    entryScreenId: appMap.entryScreenId !== null
      ? sanitizeLabel(appMap.entryScreenId)
      : null,
    navPaths,
    screens,
    truncated,
  };
}

// ── renderSummaryForPrompt ────────────────────────────────────────────────────

export function renderSummaryForPrompt(
  s: AppMapPromptSummary,
  paths: { markdownIndexPath: string | null; appMapJsonPath: string }
): string {
  const lines: string[] = [];

  lines.push(`앱 화면 수: ${s.screenCount}${s.truncated ? " (일부만 표시)" : ""}`);
  if (s.entryScreenId) {
    lines.push(`진입점: ${s.entryScreenId}`);
  }
  lines.push("");

  // 화면별 네비게이션 경로
  lines.push("### 네비게이션 경로");
  for (const nav of s.navPaths.slice(0, 40)) {
    lines.push(`- [${nav.screenId}${nav.title ? ` / ${nav.title}` : ""}] ${nav.pathHint}`);
  }
  lines.push("");

  // 화면별 상세 (screenCount ≤ INLINE_LABEL_MAX_SCREENS인 경우만 라벨 인라인)
  if (s.screenCount <= INLINE_LABEL_MAX_SCREENS) {
    lines.push("### 화면별 요소");
    for (const screen of s.screens) {
      const adNote = screen.adCount > 0 ? ` ⚠ 이 화면에 광고 영역 ${screen.adCount}개 — 탭 회피` : "";
      lines.push(`#### ${screen.id}${screen.title ? ` (${screen.title})` : ""}${adNote}`);
      if (screen.interactiveLabels.length > 0) {
        lines.push(`  인터랙티브 요소: ${screen.interactiveLabels.join(", ")}`);
      }
    }
    if (paths.markdownIndexPath) {
      lines.push("");
      lines.push(`전체 지도 마크다운: ${paths.markdownIndexPath}`);
    }
  } else {
    // INLINE_LABEL_MAX_SCREENS 초과: 광고 경고만 포함
    const screensWithAds = s.screens.filter((s) => s.adCount > 0);
    if (screensWithAds.length > 0) {
      lines.push("### 광고 영역 주의");
      for (const screen of screensWithAds) {
        lines.push(`- ${screen.id}: ⚠ 이 화면에 광고 영역 ${screen.adCount}개 — 탭 회피`);
      }
      lines.push("");
    }

    if (paths.markdownIndexPath) {
      lines.push(`전체 화면별 요소 상세: cat ${paths.markdownIndexPath}`);
    }
  }

  if (s.truncated && paths.markdownIndexPath) {
    lines.push("");
    lines.push(`※ 화면 수(${s.screenCount})가 많아 일부만 표시됨. 전체 지도: cat ${paths.markdownIndexPath}`);
  }

  lines.push("");
  lines.push(`AppMap JSON: ${paths.appMapJsonPath}`);

  return lines.join("\n");
}
