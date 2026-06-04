/**
 * storyboardParser — UIKit Storyboard/XIB 파싱 + 화면 발견 + IR 빌드
 *
 * 전략:
 * - 순수 XML 파싱 (tree-sitter 불필요): 경량 재귀 XML 파서 내장
 * - scene/viewController 탐색 → segue 그래프로 route/candidate 분류
 * - view 계층 → UI IR (label→Text, imageView→Image, button→Button,
 *   textField→Input, stackView→Row|Column, scrollView→Scroll, tableView→Scroll+List)
 * - 코드 기반 UIViewController 서브클래스는 heuristic + Unknown 위주 IR (낮은 confidence)
 */

import { readFile, readdir, access } from "fs/promises";
import path from "path";
import type { IRDocument, IRNode } from "@sfc/core";
import { aggregateScreenConfidence, NODE_CONFIDENCE, parseIRDocument } from "@sfc/core";

// ── 경량 XML 파서 ─────────────────────────────────────────────────────────────

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function parseXml(xml: string): XmlNode {
  // 간단한 상태 머신 기반 XML 파서
  // (주석·CDATA·처리 지시문 제거 후 파싱)
  const src = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "");

  let pos = 0;

  function skipWs(): void {
    while (pos < src.length && /\s/.test(src[pos]!)) pos++;
  }

  function parseAttrValue(): string {
    const quote = src[pos];
    if (quote !== '"' && quote !== "'") return "";
    pos++;
    let val = "";
    while (pos < src.length && src[pos] !== quote) {
      val += src[pos];
      pos++;
    }
    pos++; // closing quote
    return val;
  }

  function parseAttrs(): Record<string, string> {
    const attrs: Record<string, string> = {};
    while (pos < src.length) {
      skipWs();
      if (src[pos] === ">" || src[pos] === "/" || src[pos] === undefined) break;
      // attr name
      let name = "";
      while (pos < src.length && !/[\s=/>]/.test(src[pos]!)) {
        name += src[pos];
        pos++;
      }
      if (!name) { pos++; continue; }
      skipWs();
      if (src[pos] === "=") {
        pos++;
        skipWs();
        attrs[name] = parseAttrValue();
      } else {
        attrs[name] = "";
      }
    }
    return attrs;
  }

  function parseNode(): XmlNode | null {
    skipWs();
    if (pos >= src.length || src[pos] !== "<") return null;
    pos++; // <

    // closing tag
    if (src[pos] === "/") {
      // skip to >
      while (pos < src.length && src[pos] !== ">") pos++;
      pos++;
      return null;
    }

    // tag name
    let tag = "";
    while (pos < src.length && !/[\s/>]/.test(src[pos]!)) {
      tag += src[pos];
      pos++;
    }
    if (!tag) return null;

    const attrs = parseAttrs();
    skipWs();

    const node: XmlNode = { tag, attrs, children: [], text: "" };

    if (src[pos] === "/") {
      // self-closing
      pos += 2; // />
      return node;
    }

    if (src[pos] === ">") {
      pos++;
    }

    // children + text
    while (pos < src.length) {
      skipWs();
      if (pos >= src.length) break;

      if (src[pos] === "<") {
        if (src.slice(pos, pos + 2) === "</") {
          // closing tag
          while (pos < src.length && src[pos] !== ">") pos++;
          pos++;
          break;
        }
        const child = parseNode();
        if (child) node.children.push(child);
      } else {
        // text content
        let t = "";
        while (pos < src.length && src[pos] !== "<") {
          t += src[pos];
          pos++;
        }
        node.text += t.trim();
      }
    }

    return node;
  }

  // root 탐색: document 엘리먼트 찾기
  skipWs();
  const root = parseNode();
  return root ?? { tag: "document", attrs: {}, children: [], text: "" };
}

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface ViewNode {
  type: string;         // label | imageView | button | textField | stackView | scrollView | tableView | view | etc.
  id: string;
  text?: string;        // label/button title text
  axis?: "horizontal" | "vertical";  // stackView
  frame?: { x: number; y: number; width: number; height: number };
  children: ViewNode[];
}

export interface SegueInfo {
  identifier: string;
  destination: string;
  kind: string;
}

export interface StoryboardScene {
  sceneId: string;
  viewControllerId: string;
  customClass: string;      // e.g. "HomeViewController"
  navigationTitle: string;  // navigationItem title=""
  viewHierarchy: ViewNode[];
  segues: SegueInfo[];
}

export interface UIKitDiscoveryResult {
  screens: Array<{
    id: string;
    title: string;
    discovery: "route" | "candidate";
    confidence: number;
    sourceRef?: { file: string; storyboard: string };
  }>;
  diagnostics: Array<{ level: string; code: string; message: string }>;
  initialViewControllerId: string | undefined;
}

export interface UIKitDetectResult {
  hasStoryboard: boolean;
  hasSwiftUI: boolean;
  storyboardFiles: string[];
}

// ── XML → ViewNode 변환 ───────────────────────────────────────────────────────

const VIEW_ELEMENT_TYPES = new Set([
  "label", "imageView", "button", "textField", "stackView",
  "scrollView", "tableView", "view", "containerView", "webView",
  "mapView", "collectionView", "activityIndicatorView",
]);

function parseRect(rectNode: XmlNode | undefined): ViewNode["frame"] {
  if (!rectNode) return undefined;
  return {
    x: parseFloat(rectNode.attrs["x"] ?? "0"),
    y: parseFloat(rectNode.attrs["y"] ?? "0"),
    width: parseFloat(rectNode.attrs["width"] ?? "0"),
    height: parseFloat(rectNode.attrs["height"] ?? "0"),
  };
}

function xmlToViewNode(xml: XmlNode): ViewNode {
  const type = xml.tag;
  const id = xml.attrs["id"] ?? "";

  // frame
  const rectEl = xml.children.find((c) => c.tag === "rect" && c.attrs["key"] === "frame");
  const frame = parseRect(rectEl);

  // text: label(text attr), button(state[key=normal] title attr)
  let text: string | undefined;
  if (type === "label") {
    text = xml.attrs["text"];
  } else if (type === "button") {
    const stateEl = xml.children.find(
      (c) => c.tag === "state" && c.attrs["key"] === "normal"
    );
    text = stateEl?.attrs["title"] ?? xml.attrs["text"];
  } else if (type === "textField") {
    text = xml.attrs["text"] ?? xml.attrs["placeholder"];
  }

  // stackView axis
  const axis: ViewNode["axis"] =
    type === "stackView"
      ? xml.attrs["axis"] === "horizontal" ? "horizontal" : "vertical"
      : undefined;

  // segues from button connections — collected at scene level
  // children
  const subviewsEl = xml.children.find((c) => c.tag === "subviews");
  const childXmls = subviewsEl ? subviewsEl.children : [];
  const children: ViewNode[] = childXmls
    .filter((c) => VIEW_ELEMENT_TYPES.has(c.tag))
    .map(xmlToViewNode);

  return { type, id, text, axis, frame, children };
}

// ── Segue 수집 (viewController 노드 전체에서 재귀) ────────────────────────────

function collectSegues(node: XmlNode): SegueInfo[] {
  const result: SegueInfo[] = [];

  function walk(n: XmlNode): void {
    if (n.tag === "segue") {
      result.push({
        identifier: n.attrs["identifier"] ?? "",
        destination: n.attrs["destination"] ?? "",
        kind: n.attrs["kind"] ?? "",
      });
    }
    for (const child of n.children) walk(child);
  }

  walk(node);
  return result;
}

// ── viewController 노드에서 StoryboardScene 추출 ─────────────────────────────

const VC_TAGS = new Set(["viewController", "tableViewController", "collectionViewController", "navigationController", "tabBarController", "splitViewController", "pageViewController"]);

function extractScene(sceneNode: XmlNode): StoryboardScene | null {
  // scene > objects > viewController
  const objectsEl = sceneNode.children.find((c) => c.tag === "objects");
  if (!objectsEl) return null;

  const vcEl = objectsEl.children.find((c) => VC_TAGS.has(c.tag) && c.attrs["customClass"]);
  if (!vcEl) return null;

  const sceneId = sceneNode.attrs["sceneID"] ?? "";
  const viewControllerId = vcEl.attrs["id"] ?? "";
  const customClass = vcEl.attrs["customClass"] ?? "";

  // navigationItem title
  const navItemEl = vcEl.children.find((c) => c.tag === "navigationItem");
  const navigationTitle = navItemEl?.attrs["title"] ?? customClass;

  // view hierarchy
  const viewEl = vcEl.children.find((c) => c.tag === "view" && c.attrs["key"] === "view");
  const subviewsEl = viewEl?.children.find((c) => c.tag === "subviews");
  const viewHierarchy: ViewNode[] = (subviewsEl?.children ?? [])
    .filter((c) => VIEW_ELEMENT_TYPES.has(c.tag))
    .map(xmlToViewNode);

  // segues
  const segues = collectSegues(vcEl);

  return {
    sceneId,
    viewControllerId,
    customClass,
    navigationTitle,
    viewHierarchy,
    segues,
  };
}

// ── 공개 API: parseStoryboard ─────────────────────────────────────────────────

export async function parseStoryboard(storyboardPath: string): Promise<StoryboardScene[]> {
  const xml = await readFile(storyboardPath, "utf-8");
  const root = parseXml(xml);

  // document > scenes > scene[]
  const scenesEl = root.children.find((c) => c.tag === "scenes");
  if (!scenesEl) return [];

  const scenes: StoryboardScene[] = [];
  for (const sceneNode of scenesEl.children) {
    if (sceneNode.tag !== "scene") continue;
    const scene = extractScene(sceneNode);
    if (scene) scenes.push(scene);
  }

  return scenes;
}

// ── 공개 API: detectUIKit ─────────────────────────────────────────────────────

export async function detectUIKit(projectPath: string): Promise<UIKitDetectResult> {
  const storyboardFiles: string[] = [];
  let hasSwiftUI = false;

  async function walkDir(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".build" || entry === "DerivedData") continue;
      const full = path.join(dir, entry);
      if (entry.endsWith(".storyboard") || entry.endsWith(".xib")) {
        storyboardFiles.push(full);
      } else if (entry.endsWith(".swift")) {
        // @main App 패턴으로 SwiftUI 감지
        try {
          const src = await readFile(full, "utf-8");
          if (src.includes("@main") && src.includes(": App")) {
            hasSwiftUI = true;
          }
        } catch {
          // ignore
        }
      } else if (!entry.includes(".")) {
        // 디렉토리 탐색
        try {
          await walkDir(full);
        } catch {
          // ignore
        }
      }
    }
  }

  await walkDir(projectPath);

  return {
    hasStoryboard: storyboardFiles.length > 0,
    hasSwiftUI,
    storyboardFiles,
  };
}

// ── 공개 API: discoverUIKitScreens ───────────────────────────────────────────

export async function discoverUIKitScreens(projectPath: string): Promise<UIKitDiscoveryResult> {
  const diagnostics: Array<{ level: string; code: string; message: string }> = [];

  // 1. storyboard 파일 탐색
  const detect = await detectUIKit(projectPath);
  if (!detect.hasStoryboard) {
    return { screens: [], diagnostics, initialViewControllerId: undefined };
  }

  // 2. Main.storyboard 우선, 없으면 첫 번째
  const mainSb = detect.storyboardFiles.find((f) => path.basename(f) === "Main.storyboard")
    ?? detect.storyboardFiles[0]!;

  let scenes: StoryboardScene[];
  try {
    scenes = await parseStoryboard(mainSb);
  } catch (e) {
    diagnostics.push({ level: "error", code: "STORYBOARD_PARSE_ERROR", message: String(e) });
    return { screens: [], diagnostics, initialViewControllerId: undefined };
  }

  // 3. Info.plist에서 UIMainStoryboardFile 확인 (이미 Main.storyboard 사용 중이므로 참고만)
  //    initialViewController는 storyboard 루트 document 속성으로부터 추출
  const sbXml = await readFile(mainSb, "utf-8");
  const sbRoot = parseXml(sbXml);
  const initialVcId: string | undefined = sbRoot.attrs["initialViewController"] ?? undefined;

  // 4. segue 그래프 구축: initialVC → BFS
  const vcById = new Map<string, StoryboardScene>();
  for (const scene of scenes) {
    vcById.set(scene.viewControllerId, scene);
  }

  // BFS에서 도달 가능한 VC 수집
  const reachable = new Set<string>();
  if (initialVcId) {
    const queue: string[] = [initialVcId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;

      // navigationController는 rootViewController segue로 첫 VC를 가리킴
      // 해당 VC를 scenes에서 찾아야 함
      const scene = vcById.get(id);
      if (!scene) {
        // navigationController 같은 컨테이너: scenes에서 segue destination 찾기
        // (이미 scene에서 extractScene이 필터링했으므로 segue만 탐색)
        // storyboard XML에서 navigationController의 relationship segue destination을 찾음
        const navSegues = findNavControllerSegues(sbRoot, id);
        for (const dest of navSegues) {
          if (!reachable.has(dest)) queue.push(dest);
        }
        reachable.add(id);
        continue;
      }

      reachable.add(id);
      for (const segue of scene.segues) {
        if (segue.destination && !reachable.has(segue.destination)) {
          queue.push(segue.destination);
        }
      }
    }
  }

  // 5. screens 조립
  const screens: UIKitDiscoveryResult["screens"] = [];
  const seen = new Set<string>();

  for (const scene of scenes) {
    if (seen.has(scene.customClass)) continue;
    seen.add(scene.customClass);

    const isRoute = reachable.has(scene.viewControllerId);
    screens.push({
      id: scene.customClass,
      title: scene.navigationTitle || scene.customClass,
      discovery: isRoute ? "route" : "candidate",
      confidence: isRoute ? 0.9 : 0.55,
      sourceRef: {
        file: path.relative(projectPath, mainSb),
        storyboard: path.basename(mainSb),
      },
    });
  }

  if (scenes.length === 0) {
    diagnostics.push({
      level: "warn",
      code: "NO_STORYBOARD_SCENES",
      message: "Storyboard에서 viewController scene을 찾을 수 없습니다",
    });
  }

  return { screens, diagnostics, initialViewControllerId: initialVcId };
}

// ── navigationController relationship segue 탐색 ─────────────────────────────

function findNavControllerSegues(sbRoot: XmlNode, navControllerId: string): string[] {
  const result: string[] = [];

  function walk(node: XmlNode): void {
    if (
      node.tag === "navigationController" &&
      node.attrs["id"] === navControllerId
    ) {
      const conns = node.children.find((c) => c.tag === "connections");
      if (conns) {
        for (const seg of conns.children) {
          if (seg.tag === "segue" && seg.attrs["relationship"] === "rootViewController") {
            const dest = seg.attrs["destination"];
            if (dest) result.push(dest);
          }
        }
      }
    }
    for (const child of node.children) walk(child);
  }

  walk(sbRoot);
  return result;
}

// ── ViewNode → IRNode 변환 ─────────────────────────────────────────────────────

function viewNodeToIR(view: ViewNode): IRNode {
  switch (view.type) {
    case "label":
      return {
        type: "Text",
        text: { value: view.text ?? "", token: "body" },
        confidence: NODE_CONFIDENCE.standard,
        ...(view.frame ? {
          layout: {
            width: Math.round(view.frame.width),
            height: Math.round(view.frame.height),
          }
        } : {}),
      };

    case "imageView":
      return {
        type: "Image",
        src: "asset://placeholder",
        confidence: NODE_CONFIDENCE.standard,
        ...(view.frame ? {
          layout: {
            width: Math.round(view.frame.width),
            height: Math.round(view.frame.height),
          }
        } : {}),
      };

    case "button":
      return {
        type: "Button",
        text: { value: view.text ?? "Button", token: "body" },
        confidence: NODE_CONFIDENCE.standard,
        ...(view.frame ? {
          layout: {
            width: Math.round(view.frame.width),
            height: Math.round(view.frame.height),
          }
        } : {}),
      };

    case "textField":
      return {
        type: "Input",
        text: { value: view.text ?? "", token: "body" },
        confidence: NODE_CONFIDENCE.standard,
        ...(view.frame ? {
          layout: {
            width: Math.round(view.frame.width),
            height: Math.round(view.frame.height),
          }
        } : {}),
      };

    case "stackView": {
      const direction = view.axis === "horizontal" ? "row" : "column";
      const irType = direction === "row" ? "Row" : "Column";
      return {
        type: irType,
        layout: {
          direction,
          gap: 8,
          ...(view.frame ? {
            width: Math.round(view.frame.width),
            height: Math.round(view.frame.height),
          } : {}),
        },
        confidence: NODE_CONFIDENCE.standard,
        children: view.children.map(viewNodeToIR),
      };
    }

    case "scrollView":
      return {
        type: "Scroll",
        confidence: NODE_CONFIDENCE.standard,
        ...(view.frame ? {
          layout: {
            width: Math.round(view.frame.width),
            height: Math.round(view.frame.height),
          }
        } : {}),
        children: view.children.map(viewNodeToIR),
      };

    case "tableView":
      // 3행 mock 반복
      return {
        type: "Scroll",
        confidence: NODE_CONFIDENCE.standard,
        children: [
          buildMockListRow(),
          buildMockListRow(),
          buildMockListRow(),
        ],
      };

    default:
      if (view.children.length > 0) {
        // 알 수 없는 컨테이너 → Box + 자식 투과
        return {
          type: "Box",
          confidence: NODE_CONFIDENCE.inlined,
          ...(view.frame ? {
            layout: {
              width: Math.round(view.frame.width),
              height: Math.round(view.frame.height),
            }
          } : {}),
          children: view.children.map(viewNodeToIR),
        };
      }
      return {
        type: "Unknown",
        role: `component:${view.type}`,
        confidence: NODE_CONFIDENCE.unknown,
      };
  }
}

function buildMockListRow(): IRNode {
  return {
    type: "Row",
    layout: { direction: "row", gap: 8, height: 44 },
    confidence: NODE_CONFIDENCE.mocked,
    children: [
      {
        type: "Text",
        text: { value: "List item", token: "body" },
        confidence: NODE_CONFIDENCE.mocked,
      },
    ],
  };
}

// ── 공개 API: buildUIKitScreenIR ──────────────────────────────────────────────

export async function buildUIKitScreenIR(
  projectPath: string,
  viewControllerId: string
): Promise<IRDocument> {
  const diagnostics: Array<{ level: "info" | "warn" | "error"; code: string; message: string }> = [];

  // 1. 화면 발견
  const discovery = await discoverUIKitScreens(projectPath);
  const screen = discovery.screens.find((s) => s.id === viewControllerId);

  if (!screen) {
    const doc = {
      schemaVersion: "0.1",
      screen: {
        id: viewControllerId,
        discovery: "candidate" as const,
        confidence: 0,
        root: {
          type: "Unknown",
          role: `component:${viewControllerId}`,
          confidence: NODE_CONFIDENCE.unknown,
        },
      },
      designTokens: undefined,
      diagnostics: [{
        level: "warn" as const,
        code: "UNRESOLVED_COMPONENT",
        message: `viewController '${viewControllerId}'를 Storyboard에서 찾을 수 없음`,
      }],
    };
    return parseIRDocument(doc);
  }

  // 2. Storyboard 파싱
  const detect = await detectUIKit(projectPath);
  const mainSb = detect.storyboardFiles.find((f) => path.basename(f) === "Main.storyboard")
    ?? detect.storyboardFiles[0];

  if (!mainSb) {
    return buildFallback(viewControllerId, screen.discovery, diagnostics);
  }

  let scenes: StoryboardScene[];
  try {
    scenes = await parseStoryboard(mainSb);
  } catch {
    return buildFallback(viewControllerId, screen.discovery, diagnostics);
  }

  const scene = scenes.find((s) => s.customClass === viewControllerId);
  if (!scene) {
    return buildFallback(viewControllerId, screen.discovery, diagnostics);
  }

  // 3. view hierarchy → IR children
  const children: IRNode[] = scene.viewHierarchy.map(viewNodeToIR);

  // 4. appbar (navigationItem title)
  const appbarNode: IRNode = {
    type: "Box",
    role: "appbar",
    layout: { direction: "row", crossAxis: "center" },
    confidence: NODE_CONFIDENCE.standard,
    children: [
      {
        type: "Text",
        text: { value: scene.navigationTitle, token: "headline" },
        confidence: NODE_CONFIDENCE.standard,
      },
    ],
  };

  // 5. root Box
  const rootNode: IRNode = {
    type: "Box",
    confidence: NODE_CONFIDENCE.standard,
    children: [appbarNode, ...children],
  };

  // 6. confidence 집계
  const confidence = aggregateScreenConfidence(rootNode, screen.discovery);

  const rawDoc = {
    schemaVersion: "0.1",
    screen: {
      id: viewControllerId,
      sourceRef: {
        file: screen.sourceRef?.file ?? "",
        line: 0,
        symbol: viewControllerId,
      },
      device: "iphone-15" as const,
      discovery: screen.discovery,
      confidence,
      root: rootNode,
    },
    designTokens: undefined,
    diagnostics: diagnostics.map((d) => ({
      level: d.level,
      code: d.code,
      message: d.message,
    })),
  };

  return parseIRDocument(rawDoc);
}

// ── 폴백 ─────────────────────────────────────────────────────────────────────

function buildFallback(
  id: string,
  discovery: "route" | "candidate",
  diagnostics: Array<{ level: "info" | "warn" | "error"; code: string; message: string }>
): IRDocument {
  const root: IRNode = {
    type: "Unknown",
    role: `component:${id}`,
    confidence: NODE_CONFIDENCE.unknown,
  };

  const doc = {
    schemaVersion: "0.1",
    screen: {
      id,
      discovery,
      confidence: aggregateScreenConfidence(root, discovery),
      root,
    },
    designTokens: undefined,
    diagnostics: diagnostics.map((d) => ({
      level: d.level,
      code: d.code,
      message: d.message,
    })),
  };

  return parseIRDocument(doc);
}
