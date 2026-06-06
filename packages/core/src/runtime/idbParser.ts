/**
 * idbParser.ts — idb ui describe-all JSON 파서 (순수 함수, I/O 없음)
 *
 * idb describe-all 출력을 RuntimeUITree로 정규화한다.
 * iOS는 논리 좌표(pt)를 사용하므로 스케일 변환 불필요.
 *
 * 지원 포맷:
 * - 표준 배열: [{ type, AXLabel, frame: {x,y,width,height}, ... }]
 * - AXFrame 문자열: [{ type, AXLabel, AXFrame: "{{x, y}, {w, h}}", ... }]
 * - NDJSON: 줄 단위 JSON 객체 열거 (자동 감지)
 */

import type { RuntimeUITree, RuntimeNode, RuntimeBounds } from "./uiautomatorParser.js";

// ─── 상수 ────────────────────────────────────────────────────────────────────

const MAX_BYTES = 4 * 1024 * 1024; // 4MB

/** Button류 타입 → clickable 판정 */
const CLICKABLE_TYPES = new Set([
  "Button",
  "Cell",
  "Switch",
  "Link",
  "MenuItem",
  "Toggle",
  "CheckBox",
  "RadioButton",
  "Slider",
  "Stepper",
  "Tab",
  "Picker",
  "PickerWheel",
  "SegmentedControl",
  "SecureTextField",
  "TextField",
  "SearchField",
  "Other", // AXEnabled=true 조합으로만 판정
]);

// ─── AXFrame 문자열 파서 ─────────────────────────────────────────────────────

/** "{{x, y}, {w, h}}" 포맷 파싱 */
const AXFRAME_RE = /\{\{([\d.+-]+),\s*([\d.+-]+)\},\s*\{([\d.+-]+),\s*([\d.+-]+)\}\}/;

function parseAXFrame(raw: string): { x: number; y: number; width: number; height: number } | null {
  const m = AXFRAME_RE.exec(raw);
  if (!m) return null;
  return {
    x: parseFloat(m[1]),
    y: parseFloat(m[2]),
    width: parseFloat(m[3]),
    height: parseFloat(m[4]),
  };
}

// ─── 노드 변환 ───────────────────────────────────────────────────────────────

interface RawIdbNode {
  type?: string;
  role?: string;
  AXLabel?: string | null;
  AXValue?: string | null;
  AXIdentifier?: string | null;
  AXEnabled?: boolean;
  AXFrame?: string;
  frame?: { x?: number; y?: number; width?: number; height?: number };
  children?: unknown[];
}

function toBounds(raw: RawIdbNode): RuntimeBounds {
  // frame 우선, 없으면 AXFrame 문자열 시도
  if (raw.frame && typeof raw.frame.x === "number") {
    const { x = 0, y = 0, width = 0, height = 0 } = raw.frame;
    return { x1: x, y1: y, x2: x + width, y2: y + height };
  }
  if (typeof raw.AXFrame === "string") {
    const parsed = parseAXFrame(raw.AXFrame);
    if (parsed) {
      const { x, y, width, height } = parsed;
      return { x1: x, y1: y, x2: x + width, y2: y + height };
    }
  }
  return { x1: 0, y1: 0, x2: 0, y2: 0 };
}

function isClickable(raw: RawIdbNode): boolean {
  if (!raw.AXEnabled) return false;
  const type = raw.type ?? raw.role ?? "";
  // "Other" 타입은 AXEnabled=true면 clickable
  if (type === "Other") return raw.AXEnabled === true;
  return CLICKABLE_TYPES.has(type);
}

function extractText(raw: RawIdbNode): string {
  // AXLabel 우선, 없으면 AXValue
  if (typeof raw.AXLabel === "string" && raw.AXLabel) return raw.AXLabel;
  if (typeof raw.AXValue === "string" && raw.AXValue) return raw.AXValue;
  return "";
}

function convertNode(raw: RawIdbNode): RuntimeNode {
  const children: RuntimeNode[] = [];
  if (Array.isArray(raw.children)) {
    for (const child of raw.children) {
      if (child && typeof child === "object") {
        try {
          children.push(convertNode(child as RawIdbNode));
        } catch {
          // 깨진 자식 무시
        }
      }
    }
  }

  return {
    text: extractText(raw),
    resourceId: "",
    contentDesc: typeof raw.AXIdentifier === "string" ? raw.AXIdentifier : "",
    className: raw.type ?? raw.role ?? "",
    clickable: isClickable(raw),
    enabled: raw.AXEnabled !== false,
    bounds: toBounds(raw),
    children,
  };
}

// ─── deviceWidth/Height 역산 ─────────────────────────────────────────────────

/**
 * 최상위 노드들의 bounds에서 디바이스 논리 해상도를 역산한다.
 * (iOS idb frame은 논리 pt 단위이므로 스케일 불필요)
 */
function computeDeviceSize(nodes: RuntimeNode[]): { w: number; h: number } {
  let maxW = 0;
  let maxH = 0;
  for (const n of nodes) {
    if (n.bounds.x2 > maxW) maxW = n.bounds.x2;
    if (n.bounds.y2 > maxH) maxH = n.bounds.y2;
  }
  return { w: maxW, h: maxH };
}

// ─── NDJSON 감지·파싱 ────────────────────────────────────────────────────────

function tryParseNdjson(raw: string): unknown[] | null {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null; // 한 줄이면 일반 JSON일 가능성 높음
  const result: unknown[] = [];
  for (const line of lines) {
    try {
      result.push(JSON.parse(line));
    } catch {
      // 줄 파싱 실패 시 NDJSON 아님으로 판단
      return null;
    }
  }
  return result;
}

// ─── 공개 API ────────────────────────────────────────────────────────────────

const EMPTY: RuntimeUITree = { root: null, deviceWidth: 0, deviceHeight: 0 };

/**
 * idb ui describe-all --json 출력을 RuntimeUITree로 정규화한다.
 *
 * - 표준 배열, AXFrame 문자열, NDJSON 포맷을 모두 수용한다.
 * - 4MB 초과, 빈 입력, 잘못된 JSON → 빈 트리 graceful.
 * - iOS 논리 좌표(pt) 그대로 보존 (스케일 변환 없음).
 */
export function parseIdbDescribeAll(json: string): RuntimeUITree {
  // null/undefined 방어
  if (!json || typeof json !== "string") return EMPTY;

  // 4MB 상한
  if (json.length > MAX_BYTES) return EMPTY;

  // 빈 문자열
  const trimmed = json.trim();
  if (!trimmed) return EMPTY;

  let parsed: unknown;

  // NDJSON 우선 시도 (여러 줄이면)
  if (trimmed.includes("\n")) {
    const ndjson = tryParseNdjson(trimmed);
    if (ndjson) {
      parsed = ndjson;
    }
  }

  if (!parsed) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return EMPTY;
    }
  }

  // 단일 객체이면 배열로 래핑
  let items: unknown[];
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === "object") {
    items = [parsed];
  } else {
    return EMPTY;
  }

  if (items.length === 0) return EMPTY;

  // 최상위 노드들을 변환
  const topNodes: RuntimeNode[] = [];
  for (const item of items) {
    if (item && typeof item === "object") {
      try {
        topNodes.push(convertNode(item as RawIdbNode));
      } catch {
        // 변환 실패 무시
      }
    }
  }

  if (topNodes.length === 0) return EMPTY;

  // 최상위 노드가 여럿이면 가상 root에 매달기
  let root: RuntimeNode;
  const { w, h } = computeDeviceSize(topNodes);

  if (topNodes.length === 1) {
    root = topNodes[0];
  } else {
    root = {
      text: "",
      resourceId: "",
      contentDesc: "",
      className: "Application",
      clickable: false,
      enabled: true,
      bounds: { x1: 0, y1: 0, x2: w, y2: h },
      children: topNodes,
    };
  }

  return {
    root,
    deviceWidth: w || root.bounds.x2,
    deviceHeight: h || root.bounds.y2,
  };
}
