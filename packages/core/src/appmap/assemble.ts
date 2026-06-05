import type { AppMap, NavigationGraph, ScreenNode, MapElement } from "./schema.js";
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

function collectElements(root: IRNode): MapElement[] {
  const results: MapElement[] = [];
  const queue: IRNode[] = [root];

  while (queue.length > 0) {
    const node = queue.shift()!;

    if (INTERACTIVE_TYPES.has(node.type)) {
      const label = node.text?.value ?? node.text?.token;
      results.push({
        type: node.type as MapElement["type"],
        ...(label ? { label } : {}),
        ...(node.sourceRef ? { sourceRef: node.sourceRef as MapElement["sourceRef"] } : {}),
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

  // 엣지를 from 기준으로 분배
  const edgesByFrom = new Map<string, AppMap["edges"]>();
  for (const edge of navGraph.edges) {
    const list = edgesByFrom.get(edge.from) ?? [];
    list.push(edge);
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
    edges: navGraph.edges,
    diagnostics: navGraph.diagnostics,
    overallConfidence,
  };
}
