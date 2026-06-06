import type { AppMap, ScreenNode, NavigationEdge, ElementStyle, Bounds, MapElement } from "./schema.js";

// ── 출력 타입 ─────────────────────────────────────────────────────────

export interface AppMapDocument {
  fileName: string;
  content: string;
}

export interface RenderOptions {
  /** 문서 1개당 최대 문자 수 (초과 시 분할). 기본 12000 */
  maxChars?: number;
}

// ── 이스케이핑 헬퍼 ──────────────────────────────────────────────────

/**
 * Mermaid 노드 라벨 이스케이핑
 * - `"` → `#quot;`
 * - `[` / `]` → `(` / `)` (Mermaid 노드 구문 보호)
 * - 개행 → 공백
 */
function escapeMermaidLabel(label: string): string {
  return label
    .replace(/\r?\n/g, " ")
    .replace(/"/g, "#quot;")
    .replace(/\[/g, "(")
    .replace(/\]/g, ")");
}

/**
 * 마크다운 테이블 셀 이스케이핑
 * - `\` → `\\`  (먼저 처리해야 이중 이스케이핑 방지)
 * - 개행 → 공백
 * - `|` → `\|`
 * - `` ` `` → `` \` ``
 * - `[` → `\[`
 * - `]` → `\]`
 */
function escapeMarkdownCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// ── 역할 포맷 헬퍼 ────────────────────────────────────────────────────

/**
 * MapElement의 역할 컬럼 문자열을 생성한다.
 * - role:"ad" → `⚠ ad (위젯명)` 형태로 명확하게 광고 표기 (에이전트가 탭 회피 인지)
 * - 그 외 role → `역할명 (위젯명 또는 -)`
 * - role 없음 → `-`
 */
function formatElementRole(elem: MapElement): string {
  if (!elem.role) return "-";
  const source = elem.dynamicSource ? escapeMarkdownCell(elem.dynamicSource) : "-";
  if (elem.role === "ad") {
    return escapeMarkdownCell(`⚠ ad (${source}) — 탭 회피`);
  }
  return escapeMarkdownCell(`${elem.role} (${source})`);
}

// ── bounds / style 포맷 헬퍼 ─────────────────────────────────────────

/**
 * Bounds → 위치 문자열 `(x, y)` (정수 반올림)
 * 없으면 "-"
 */
function formatPosition(bounds: Bounds | undefined): string {
  if (!bounds) return "-";
  return `(${Math.round(bounds.x)}, ${Math.round(bounds.y)})`;
}

/**
 * Bounds → 크기 문자열 `W×H` (정수 반올림)
 * 없으면 "-"
 */
function formatSize(bounds: Bounds | undefined): string {
  if (!bounds) return "-";
  return `${Math.round(bounds.width)}×${Math.round(bounds.height)}`;
}

/**
 * ElementStyle → 요약 문자열 (존재하는 속성만 ` · ` 연결)
 * 없거나 모든 속성 undefined면 "-"
 */
function formatStyle(style: ElementStyle | undefined): string {
  if (!style) return "-";
  const parts: string[] = [];
  if (style.background !== undefined) parts.push(`배경 ${style.background}`);
  if (style.borderRadius !== undefined) parts.push(`r${style.borderRadius}`);
  if (style.borderColor !== undefined || style.borderWidth !== undefined) {
    const color = style.borderColor ?? "";
    const width = style.borderWidth !== undefined ? ` ${style.borderWidth}px` : "";
    parts.push(`테두리 ${color}${width}`.trim());
  }
  if (style.textColor !== undefined) parts.push(`텍스트 ${style.textColor}`);
  if (style.opacity !== undefined) parts.push(`불투명도 ${style.opacity}`);
  return parts.length > 0 ? parts.join(" · ") : "-";
}

// ── 엣지 셀 포맷 헬퍼 ─────────────────────────────────────────────────

/** 트리거 셀: `라벨 @(x,y) W×H [스타일]` */
function formatEdgeTrigger(edge: NavigationEdge): string {
  const baseLabel = edge.trigger.label ?? edge.trigger.kind;
  const boundsInfo = edge.trigger.bounds
    ? ` @${formatPosition(edge.trigger.bounds)} ${formatSize(edge.trigger.bounds)}`
    : "";
  const styleInfo = edge.trigger.style ? ` [${formatStyle(edge.trigger.style)}]` : "";
  return escapeMarkdownCell(`${baseLabel}${boundsInfo}${styleInfo}`);
}

/** 목적지 셀: 링크 / `↗ 라우트 (미해석)` / `❓ 미확인` / `↩ 뒤로` */
function formatEdgeDest(
  edge: NavigationEdge,
  docFileNameFn: (screenId: string) => string
): string {
  if (edge.to !== null) {
    const destAnchor = edge.to.toLowerCase().replace(/[^a-z0-9]/g, "-");
    return `[${escapeMarkdownCell(edge.to)}](${docFileNameFn(edge.to)}#${destAnchor})`;
  }
  if (edge.action === "pop") return "↩ 뒤로";
  if (edge.toRouteName) {
    return `↗ \`${escapeMarkdownCell(edge.toRouteName)}\` (미해석)`;
  }
  return "❓ 미확인";
}

/** 호출 위치 셀: `file:line` 코드 표기 (경로도 분석 대상 입력이므로 이스케이프) */
function formatFromRef(edge: NavigationEdge): string {
  if (!edge.fromRef?.file) return "-";
  const line = edge.fromRef.line !== undefined ? `:${edge.fromRef.line}` : "";
  return `\`${escapeMarkdownCell(`${edge.fromRef.file}${line}`)}\``;
}

// ── Mermaid 렌더 ──────────────────────────────────────────────────────

/** Mermaid 노드 ID로 사용 가능하도록 특수문자를 제거한다 */
function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function renderMermaid(appMap: AppMap): string {
  const lines: string[] = ["```mermaid", "flowchart TD"];

  // 노드 정의
  for (const screen of appMap.screens) {
    const mid = mermaidId(screen.id);
    const rawLabel = screen.title ?? screen.id;
    const nodeLabel = escapeMermaidLabel(screen.isEntry ? `🏠 ${rawLabel}` : rawLabel);
    lines.push(`  ${mid}["${nodeLabel}"]`);
  }

  // 엣지 정의
  const unknownNode = "__unknown__";
  const backNode = "__back__";
  const globalNode = "__global__";
  const screenIdSet = new Set(appMap.screens.map((s) => s.id));
  let hasUnknown = false;
  let hasBack = false;
  let hasGlobal = false;

  for (const edge of appMap.edges) {
    // 화면에 귀속되지 않은 from((global) 등)은 전역 노드로 표현
    const isGlobalFrom = !screenIdSet.has(edge.from);
    if (isGlobalFrom) hasGlobal = true;
    const fromId = isGlobalFrom ? globalNode : mermaidId(edge.from);

    const rawLabel = edge.trigger.label ? edge.trigger.label : edge.action;
    const label = escapeMermaidLabel(rawLabel);

    if (edge.to === null) {
      if (edge.action === "pop") {
        hasBack = true;
        lines.push(`  ${fromId} -.->|"${label}"| ${backNode}`);
      } else {
        hasUnknown = true;
        lines.push(`  ${fromId} -->|"${label}"| ${unknownNode}`);
      }
    } else {
      const toId = mermaidId(edge.to);
      if (edge.action === "pop") {
        lines.push(`  ${fromId} -.->|"${label}"| ${toId}`);
      } else {
        lines.push(`  ${fromId} -->|"${label}"| ${toId}`);
      }
    }
  }

  if (hasUnknown) {
    lines.push(`  ${unknownNode}["❓ 미확인"]`);
  }
  if (hasBack) {
    lines.push(`  ${backNode}["↩ 뒤로"]`);
  }
  if (hasGlobal) {
    lines.push(`  ${globalNode}["🌐 공통/전역"]`);
  }

  lines.push("```");
  return lines.join("\n");
}

// ── 화면 상세 섹션 렌더 ───────────────────────────────────────────────

function renderScreenSection(
  screen: ScreenNode,
  appName: string,
  allScreenIds: Set<string>,
  docFileNameFn: (screenId: string) => string
): string {
  const lines: string[] = [];
  const anchor = screen.id.toLowerCase().replace(/[^a-z0-9]/g, "-");

  lines.push(`\n### ${escapeMarkdownCell(screen.id)} {#${anchor}}`);
  if (screen.title && screen.title !== screen.id) {
    lines.push(`**타이틀**: ${escapeMarkdownCell(screen.title)}`);
  }

  const discoveryLabel = screen.discovery === "route" ? "라우트 발견" : "후보 (heuristic)";
  const confPct = (screen.confidence * 100).toFixed(0) + "%";
  lines.push(`**발견 방식**: ${discoveryLabel} | **신뢰도**: ${confPct}`);

  if (screen.sourceRef) {
    lines.push(`**정의 위치**: \`${screen.sourceRef.file}\`${screen.sourceRef.line ? `:${screen.sourceRef.line}` : ""}`);
  }

  // 요소 테이블 — interactive + 광고/동적 노드 (role 있는 것) 포함
  const displayElements = screen.elements.filter((e) =>
    ["Button", "Input", "List", "Image"].includes(e.type) || e.role !== undefined
  );

  if (displayElements.length > 0) {
    lines.push("\n**UI 요소**:");
    lines.push("| 타입 | 라벨 | 역할 | 위치 | 크기 | 스타일 |");
    lines.push("|------|------|------|------|------|--------|");
    for (const elem of displayElements) {
      const pos = escapeMarkdownCell(formatPosition(elem.bounds));
      const size = escapeMarkdownCell(formatSize(elem.bounds));
      const style = escapeMarkdownCell(formatStyle(elem.style));
      const roleCell = formatElementRole(elem);
      lines.push(`| ${escapeMarkdownCell(elem.type)} | ${escapeMarkdownCell(elem.label ?? "-")} | ${roleCell} | ${pos} | ${size} | ${style} |`);
    }
  }

  // 이동 테이블
  if (screen.outgoing.length > 0) {
    lines.push("\n**이동 경로**:");
    lines.push("| 트리거 | 동작 | 목적지 | 호출 위치 | 신뢰도 |");
    lines.push("|--------|------|--------|-----------|--------|");
    for (const edge of screen.outgoing) {
      const triggerCell = formatEdgeTrigger(edge);
      const action = escapeMarkdownCell(edge.action);
      const dest = formatEdgeDest(edge, docFileNameFn);
      const callSite = formatFromRef(edge);
      const conf = (edge.confidence * 100).toFixed(0) + "%";
      lines.push(`| ${triggerCell} | ${action} | ${dest} | ${callSite} | ${conf} |`);
    }
  }

  return lines.join("\n");
}

// ── 인덱스 섹션 렌더 ─────────────────────────────────────────────────

function renderIndex(appMap: AppMap, indexFileName: string): string {
  const lines: string[] = [];

  lines.push(`# ${escapeMarkdownCell(appMap.appName)} — 프로그램 지도`);
  lines.push("");
  lines.push(`- **프레임워크**: ${appMap.framework}`);
  lines.push(`- **화면 수**: ${appMap.screens.length}`);
  lines.push(`- **이동 경로 수**: ${appMap.edges.length}`);
  lines.push(`- **진입점**: ${appMap.entryScreenId ?? "(미확인)"}`);
  lines.push(`- **전체 신뢰도**: ${(appMap.overallConfidence * 100).toFixed(1)}%`);
  lines.push("");

  // Mermaid
  lines.push("## 네비게이션 그래프");
  lines.push("");
  lines.push(renderMermaid(appMap));
  lines.push("");

  // 화면 목록 테이블
  lines.push("## 화면 목록");
  lines.push("");
  lines.push("| 화면 ID | 발견 방식 | 진입점 | 신뢰도 |");
  lines.push("|---------|-----------|--------|--------|");

  for (const screen of appMap.screens) {
    const anchor = screen.id.toLowerCase().replace(/[^a-z0-9]/g, "-");
    const link = `[${escapeMarkdownCell(screen.id)}](#${anchor})`;
    const disc = screen.discovery === "route" ? "route" : "candidate";
    const entry = screen.isEntry ? "✓" : "-";
    const conf = (screen.confidence * 100).toFixed(0) + "%";
    lines.push(`| ${link} | ${disc} | ${entry} | ${conf} |`);
  }
  lines.push("");

  // 공통/전역 이동 — 어떤 화면에도 귀속되지 않은 엣지 (util/세션 만료 등)
  const screenIdSet = new Set(appMap.screens.map((s) => s.id));
  const globalEdges = appMap.edges.filter((e) => !screenIdSet.has(e.from));
  if (globalEdges.length > 0) {
    lines.push("## 공통/전역 이동");
    lines.push("");
    lines.push("어느 화면에서든 발생할 수 있는 이동입니다 (유틸/세션 로직 등에서 호출).");
    lines.push("");
    lines.push("| 발생 위치 | 트리거 | 동작 | 목적지 | 신뢰도 |");
    lines.push("|-----------|--------|------|--------|--------|");
    for (const edge of globalEdges) {
      const origin = formatFromRef(edge);
      const trigger = formatEdgeTrigger(edge);
      const action = escapeMarkdownCell(edge.action);
      const dest = formatEdgeDest(edge, () => indexFileName);
      const conf = (edge.confidence * 100).toFixed(0) + "%";
      lines.push(`| ${origin} | ${trigger} | ${action} | ${dest} | ${conf} |`);
    }
    lines.push("");
  }

  // 진단
  if (appMap.diagnostics.length > 0) {
    lines.push("## 진단 및 한계");
    lines.push("");
    for (const diag of appMap.diagnostics) {
      lines.push(`- **${diag.code}**: ${diag.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── 공개 API ──────────────────────────────────────────────────────────

/**
 * AppMap → 마크다운 문서 배열 (순수 함수, I/O 없음)
 *
 * - 첫 번째 문서: `{appName}_map_1.md` (인덱스 + Mermaid + 화면 목록)
 * - 이후: 화면 상세 섹션 (누적 길이 > maxChars면 새 파일로 분할)
 * - 비인덱스 문서 첫 줄: 목차 링크
 */
export function renderAppMapMarkdown(
  appMap: AppMap,
  opts: RenderOptions = {}
): AppMapDocument[] {
  const maxChars = opts.maxChars ?? 12000;
  const baseName = appMap.appName;
  const indexFileName = `${baseName}_map_1.md`;

  // 인덱스 문서
  const indexContent = renderIndex(appMap, indexFileName);
  const documents: AppMapDocument[] = [{ fileName: indexFileName, content: indexContent }];

  if (appMap.screens.length === 0) {
    return documents;
  }

  // 화면별 상세 섹션을 청크로 분배
  const allScreenIds = new Set(appMap.screens.map((s) => s.id));

  // 화면 → 파일명 룩업 (분할 후 링크에 사용)
  // 먼저 각 화면 섹션의 크기를 계산해 분할 계획을 세운다
  const screenSections: Array<{ screenId: string; content: string }> = [];

  // docFileNameFn은 나중에 채운다 (placeholder)
  const tempDocFn = (_: string): string => indexFileName;

  for (const screen of appMap.screens) {
    const section = renderScreenSection(screen, baseName, allScreenIds, tempDocFn);
    screenSections.push({ screenId: screen.id, content: section });
  }

  // 분할: 인덱스에 이어 붙이되 maxChars 초과 시 새 파일
  let docIndex = 1; // _map_1은 인덱스, 화면 상세는 _map_1에 이어 붙이거나 _map_2부터
  let currentContent = indexContent;
  let currentDocIndex = 1;

  // 인덱스 문서에 화면 상세를 이어 붙이면서 분할 결정
  const screenIdToDocNum = new Map<string, number>();

  // 일단 배치해서 파일 번호 확정
  for (const { screenId, content } of screenSections) {
    if (currentContent.length + content.length > maxChars && currentContent !== indexContent) {
      // 현재 문서 확정
      documents[currentDocIndex - 1]!.content = currentContent;
      currentDocIndex++;
      const newFileName = `${baseName}_map_${currentDocIndex}.md`;
      const backLink = `> [목차로 돌아가기](${indexFileName})\n`;
      currentContent = backLink;
      documents.push({ fileName: newFileName, content: "" });
    } else if (currentContent.length + content.length > maxChars && currentContent === indexContent) {
      // 인덱스가 이미 maxChars에 근접한 경우 — 화면 상세를 새 파일로 분리
      documents[0]!.content = currentContent;
      currentDocIndex++;
      const newFileName = `${baseName}_map_${currentDocIndex}.md`;
      const backLink = `> [목차로 돌아가기](${indexFileName})\n`;
      currentContent = backLink;
      documents.push({ fileName: newFileName, content: "" });
    }

    screenIdToDocNum.set(screenId, currentDocIndex);
    currentContent += content;
  }

  // 마지막 문서 내용 확정
  if (currentDocIndex === 1) {
    documents[0]!.content = currentContent;
  } else {
    documents[currentDocIndex - 1]!.content = currentContent;
  }

  // 화면 섹션 링크 재생성 (정확한 파일 번호 반영)
  const resolvedDocFn = (screenId: string): string => {
    const docNum = screenIdToDocNum.get(screenId) ?? 1;
    return docNum === 1 ? indexFileName : `${baseName}_map_${docNum}.md`;
  };

  // 분할이 발생한 경우 내용 재생성
  if (documents.length > 1) {
    // 재렌더링
    let rebuildDocIndex = 1;
    let rebuildContent = indexContent;

    for (const screen of appMap.screens) {
      const section = renderScreenSection(screen, baseName, allScreenIds, resolvedDocFn);

      if (rebuildContent.length + section.length > maxChars && rebuildContent !== indexContent) {
        documents[rebuildDocIndex - 1]!.content = rebuildContent;
        rebuildDocIndex++;
        const backLink = `> [목차로 돌아가기](${indexFileName})\n`;
        rebuildContent = backLink;
      } else if (rebuildContent.length + section.length > maxChars && rebuildContent === indexContent) {
        documents[0]!.content = rebuildContent;
        rebuildDocIndex++;
        const backLink = `> [목차로 돌아가기](${indexFileName})\n`;
        rebuildContent = backLink;
      }

      rebuildContent += section;
    }

    if (rebuildDocIndex === 1) {
      documents[0]!.content = rebuildContent;
    } else if (documents[rebuildDocIndex - 1]) {
      documents[rebuildDocIndex - 1]!.content = rebuildContent;
    }
  }

  return documents;
}
