import type { AppMap, NavigationGraph, NavigationEdge, ScreenNode, MapElement, TriggerInfo, ElementStyle } from "./schema.js";
import type { IRDocument, IRNode } from "../ir/schema.js";

// ── 외부 의존 없이 사용할 수 있는 최소 타입 재정의 ─────────────────────

export interface ScreenSummary {
  id: string;
  title?: string;
  discovery: "route" | "candidate";
  confidence: number;
  sourceRef?: { file: string; line?: number; symbol?: string };
}

export interface AssembleOptions {
  appName: string;
  framework: "flutter" | "react-native" | "android" | "ios";
  screens: ScreenSummary[];
  navGraph: NavigationGraph;
  irDocs: IRDocument[];
}

// ── IR에서 상호작용 요소(Button/Input/List 등) BFS 수집 ───────────────

const INTERACTIVE_TYPES = new Set<IRNode["type"]>([
  "Button", "Input", "List", "Image", "Icon",
]);

/** node.text 없을 때 자손에서 첫 번째 Text 노드의 값을 반환 (깊이 3 제한) */
function findChildTextLabel(node: IRNode): string | undefined {
  if (!node.children) return undefined;
  const stack: Array<{ n: IRNode; depth: number }> = node.children.map((c) => ({ n: c, depth: 1 }));
  while (stack.length > 0) {
    const { n, depth } = stack.pop()!;
    if (n.type === "Text" && (n.text?.value ?? n.text?.token)) {
      return n.text?.value ?? n.text?.token;
    }
    if (depth < 3 && n.children) {
      for (const child of n.children) {
        stack.push({ n: child, depth: depth + 1 });
      }
    }
  }
  return undefined;
}

/**
 * IR 노드에서 ElementStyle을 추출한다.
 * style.background/borderRadius/border.{color,width}/opacity + text.color → textColor
 * 추출 가능한 값이 하나도 없으면 undefined를 반환한다.
 */
export function extractElementStyle(node: IRNode): ElementStyle | undefined {
  const style: ElementStyle = {};
  let hasAny = false;

  if (node.style?.background) {
    style.background = node.style.background;
    hasAny = true;
  }
  if (node.style?.borderRadius !== undefined) {
    style.borderRadius = node.style.borderRadius;
    hasAny = true;
  }
  if (node.style?.border?.color) {
    style.borderColor = node.style.border.color;
    hasAny = true;
  }
  if (node.style?.border?.width !== undefined) {
    style.borderWidth = node.style.border.width;
    hasAny = true;
  }
  if (node.style?.opacity !== undefined) {
    style.opacity = node.style.opacity;
    hasAny = true;
  }
  if (node.text?.color) {
    style.textColor = node.text.color;
    hasAny = true;
  }

  return hasAny ? style : undefined;
}

/**
 * trigger를 elements 배열에서 매칭한다. (export — sdk에서 재사용 예정)
 * 1순위: elementRef.file === element.sourceRef.file && |line 차| <= 2 인 것 중 최근접
 *   (trigger.elementRef.line과 element.sourceRef.line 둘 다 존재할 때만)
 * 2순위: trigger.label === element.label 인 첫 요소 (fallback)
 * 실패 시: undefined
 */
export function matchElement(
  trigger: TriggerInfo,
  elements: MapElement[],
): MapElement | undefined {
  const eRef = trigger.elementRef;

  // 1순위: elementRef line 기반 근접 매칭
  if (eRef?.file && eRef.line !== undefined) {
    const triggerLine = eRef.line;
    let bestElement: MapElement | undefined;
    let bestDiff = Infinity;

    for (const el of elements) {
      if (el.sourceRef?.file !== eRef.file) continue;
      if (el.sourceRef?.line === undefined) continue;
      const diff = Math.abs(el.sourceRef.line - triggerLine);
      if (diff <= 2 && diff < bestDiff) {
        bestDiff = diff;
        bestElement = el;
      }
    }

    if (bestElement) return bestElement;
  }

  // 2순위: label fallback
  if (trigger.label) {
    return elements.find((el) => el.label === trigger.label);
  }

  return undefined;
}

function collectElements(root: IRNode): MapElement[] {
  const results: MapElement[] = [];
  const queue: IRNode[] = [root];

  while (queue.length > 0) {
    const node = queue.shift()!;

    if (INTERACTIVE_TYPES.has(node.type)) {
      const label = node.text?.value ?? node.text?.token ?? findChildTextLabel(node);
      const style = extractElementStyle(node);
      results.push({
        type: node.type as MapElement["type"],
        ...(label ? { label } : {}),
        ...(node.sourceRef ? { sourceRef: node.sourceRef as MapElement["sourceRef"] } : {}),
        ...(style ? { style } : {}),
      });
    }

    if (node.children) {
      for (const child of node.children) {
        queue.push(child);
      }
    }
  }

  return results;
}

/**
 * 엣지를 enrich한다 — trigger에 style 주입, 매칭 실패 시 TRIGGER_UNMATCHED 추가.
 * 원본 edge 객체를 변형하지 않고 새 객체를 반환한다.
 */
function enrichEdge(edge: NavigationEdge, elements: MapElement[]): NavigationEdge {
  const matched = matchElement(edge.trigger, elements);

  if (matched) {
    // 매칭 성공 — style이 있으면 주입, 없으면 edge 그대로 반환 (TRIGGER_UNMATCHED 없음)
    if (matched.style) {
      return { ...edge, trigger: { ...edge.trigger, style: matched.style } };
    }
    return edge;
  }

  // 매칭 단서(elementRef/label)가 아예 없는 트리거(전역/시스템 이동)는
  // 매칭 실패가 아니라 매칭 비대상 — diagnostic을 붙이지 않는다.
  if (!edge.trigger.elementRef && !edge.trigger.label) {
    return edge;
  }

  // 매칭 실패 시 TRIGGER_UNMATCHED diagnostic 추가
  return {
    ...edge,
    diagnostics: [
      ...edge.diagnostics,
      { code: "TRIGGER_UNMATCHED", message: `트리거 요소를 elements에서 찾지 못했습니다.` },
    ],
  };
}

// ── 공개 API ──────────────────────────────────────────────────────────

/**
 * 화면 목록 + 네비게이션 그래프 + IR 문서를 결합해 AppMap을 생성한다.
 * 순수 함수 — I/O 없음.
 */
export function assembleAppMap(opts: AssembleOptions): AppMap {
  const { appName, framework, screens, navGraph, irDocs } = opts;

  // IRDocument 룩업 맵
  const irByScreen = new Map<string, IRDocument>();
  for (const doc of irDocs) {
    irByScreen.set(doc.screen.id, doc);
  }

  // 엣지를 from 기준으로 분배 + enrich (새 객체 생성, 원본 불변)
  const edgesByFrom = new Map<string, NavigationEdge[]>();
  const enrichedEdges: NavigationEdge[] = [];

  for (const edge of navGraph.edges) {
    const irDoc = irByScreen.get(edge.from);
    const elements: MapElement[] = irDoc ? collectElements(irDoc.screen.root) : [];
    const enriched = enrichEdge(edge, elements);
    enrichedEdges.push(enriched);

    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(enriched);
    edgesByFrom.set(edge.from, list);
  }

  // ScreenNode 생성
  const screenNodes: ScreenNode[] = screens.map((screen) => {
    const irDoc = irByScreen.get(screen.id);
    const elements: MapElement[] = irDoc ? collectElements(irDoc.screen.root) : [];
    const outgoing = edgesByFrom.get(screen.id) ?? [];

    return {
      id: screen.id,
      ...(screen.title ? { title: screen.title } : {}),
      discovery: screen.discovery,
      isEntry: screen.id === navGraph.entryScreenId,
      confidence: screen.confidence,
      ...(screen.sourceRef ? { sourceRef: screen.sourceRef } : {}),
      elements,
      outgoing,
    };
  });

  // overallConfidence: 엣지가 있으면 엣지 confidence 평균, 없으면 화면 confidence 평균
  let overallConfidence = 0;
  if (navGraph.edges.length > 0) {
    const sum = navGraph.edges.reduce((acc, e) => acc + e.confidence, 0);
    overallConfidence = sum / navGraph.edges.length;
  } else if (screens.length > 0) {
    const sum = screens.reduce((acc, s) => acc + s.confidence, 0);
    overallConfidence = sum / screens.length;
  }

  return {
    schemaVersion: "appmap/1",
    appName,
    framework,
    entryScreenId: navGraph.entryScreenId,
    screens: screenNodes,
    edges: enrichedEdges,
    diagnostics: navGraph.diagnostics,
    overallConfidence,
  };
}
