/**
 * karax ui 서브커맨드 — 에이전트용 결정론 헬퍼
 *
 * dump     : 런타임 UI를 정규화 JSON으로 (center 좌표 사전 계산)
 * locate   : 라벨로 요소 검색 → 탭 좌표 즉답
 * which-screen : 현재 화면이 AppMap의 어느 화면인지 식별
 *
 * 에이전트 전용 — stdout에는 JSON 한 덩어리만 출력.
 * 진단·로그는 stderr.
 */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  parseUiautomatorXml,
  flattenInteractive,
  locateLabel,
  identifyScreen,
  AppMapReadSchema,
} from "@karax/core";
import type { RuntimeNode, RuntimeBounds, AppMap } from "@karax/core";

// ── 타입 정의 ─────────────────────────────────────────────────────────

export type UiErrorCode =
  | "INVALID_ARGUMENT"
  | "DEVICE_NOT_FOUND"
  | "DUMP_FAILED"
  | "APPMAP_PARSE_ERROR"
  | "UNSUPPORTED_PLATFORM";

export interface UiErrorResult {
  ok: false;
  error: UiErrorCode;
  message: string;
}

export interface UiDumpNode {
  text: string;
  resourceId: string;
  contentDesc: string;
  className: string;
  clickable: boolean;
  enabled: boolean;
  bounds: RuntimeBounds;
  center: { x: number; y: number };
}

export interface UiDumpResult {
  ok: true;
  platform: string;
  deviceWidth: number;
  deviceHeight: number;
  nodes: UiDumpNode[];
  truncatedNodes?: true;
}

export interface UiLocateResult {
  ok: true;
  found: true;
  method: string;
  score: number;
  tap: { x: number; y: number };
  bounds: RuntimeBounds;
  clickable: boolean;
  ambiguous?: boolean;
  tappable?: false;
  candidates?: never;
}

export interface UiLocateNotFoundResult {
  ok: true;
  found: false;
  candidates: Array<{ text: string; center: { x: number; y: number } }>;
}

export interface UiWhichScreenResult {
  ok: true;
  screenId: string | null;
  confidence: number;
  ranked: Array<{ screenId: string; similarity: number }>;
}

export type UiLocateAnyResult = UiLocateResult | UiLocateNotFoundResult | UiErrorResult;

// ── parseUiArgs ────────────────────────────────────────────────────────

const VALID_SUBCOMMANDS = ["dump", "locate", "which-screen"] as const;
type UiSubcommand = (typeof VALID_SUBCOMMANDS)[number];

const VALID_PLATFORMS = ["android", "ios"] as const;
type UiPlatform = (typeof VALID_PLATFORMS)[number];

export interface UiArgs {
  subcommand: UiSubcommand;
  device: string;
  platform: UiPlatform;
  json: boolean;
  label?: string;
  appmap?: string;
  screen?: string;
}

function makeUiProgram(name: string): Command {
  const prog = new Command(name);
  prog.exitOverride();
  return prog;
}

export function parseUiArgs(argv: string[]): UiArgs {
  const prog = makeUiProgram("ui");
  prog.argument("<subcommand>", `서브커맨드: ${VALID_SUBCOMMANDS.join("|")}`);
  prog.requiredOption("--device <id>", "디바이스 ID (필수)");
  prog.option("--platform <platform>", "플랫폼: android|ios", "android");
  prog.option("--json", "JSON 출력 (기본 동작, 플래그는 호환성용)", false);
  prog.option("--label <label>", "검색할 라벨 (locate 전용)");
  prog.option("--appmap <path>", "AppMap JSON 경로 (locate/which-screen 전용)");
  prog.option("--screen <id>", "AppMap 화면 ID (locate 전용)");

  prog.parse(["node", "ui", ...argv]);

  const sub = prog.args[0];
  if (!sub) {
    throw new Error("서브커맨드를 지정해야 합니다: dump | locate | which-screen");
  }
  if (!(VALID_SUBCOMMANDS as readonly string[]).includes(sub)) {
    throw new Error(
      `잘못된 서브커맨드: '${sub}'. 허용: ${VALID_SUBCOMMANDS.join(", ")}`
    );
  }

  const opts = prog.opts<{
    device: string;
    platform: string;
    json: boolean;
    label?: string;
    appmap?: string;
    screen?: string;
  }>();

  if (!(VALID_PLATFORMS as readonly string[]).includes(opts.platform)) {
    throw new Error(
      `잘못된 --platform 값: '${opts.platform}'. 허용: android, ios`
    );
  }

  return {
    subcommand: sub as UiSubcommand,
    device: opts.device,
    platform: opts.platform as UiPlatform,
    json: opts.json,
    label: opts.label,
    appmap: opts.appmap,
    screen: opts.screen,
  };
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────

const NODE_LIMIT = 500;

function computeCenter(bounds: RuntimeBounds): { x: number; y: number } {
  return {
    x: Math.round((bounds.x1 + bounds.x2) / 2),
    y: Math.round((bounds.y1 + bounds.y2) / 2),
  };
}

function toUiDumpNode(node: RuntimeNode): UiDumpNode {
  return {
    text: node.text,
    resourceId: node.resourceId,
    contentDesc: node.contentDesc,
    className: node.className,
    clickable: node.clickable,
    enabled: node.enabled,
    bounds: node.bounds,
    center: computeCenter(node.bounds),
  };
}

/** E2eError / 일반 Error를 UiErrorCode로 매핑 */
function mapErrorCode(err: unknown): UiErrorCode {
  if (err && typeof err === "object" && "code" in err) {
    const code = (err as { code: string }).code;
    if (code === "NO_DEVICE_AVAILABLE" || code === "DEVICE_NOT_FOUND") return "DEVICE_NOT_FOUND";
    if (code === "DUMP_FAILED") return "DUMP_FAILED";
    if (code === "INVALID_ARGUMENT") return "INVALID_ARGUMENT";
  }
  return "DUMP_FAILED";
}

function makeError(error: UiErrorCode, message: string): UiErrorResult {
  return { ok: false, error, message };
}

type AppMapReadResult =
  | { success: true; data: ReturnType<typeof AppMapReadSchema.parse> }
  | { success: false; error: UiErrorResult };

/** appmap.json 파일을 읽고 AppMapReadSchema로 파싱 */
function readAppMap(appmapPath: string): AppMapReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(appmapPath, "utf-8");
  } catch (e) {
    return {
      success: false,
      error: makeError(
        "APPMAP_PARSE_ERROR",
        `AppMap 파일을 읽을 수 없습니다: ${appmapPath} (${e instanceof Error ? e.message : String(e)})`
      ),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      success: false,
      error: makeError("APPMAP_PARSE_ERROR", `AppMap JSON 파싱 실패: ${appmapPath}`),
    };
  }

  const result = AppMapReadSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: makeError(
        "APPMAP_PARSE_ERROR",
        `AppMap 스키마 검증 실패: ${result.error.message}`
      ),
    };
  }
  return { success: true, data: result.data };
}

// ── runUiDump ──────────────────────────────────────────────────────────

export interface RunUiDumpOptions {
  device: string;
  platform: string;
}

export async function runUiDump(
  opts: RunUiDumpOptions
): Promise<UiDumpResult | UiErrorResult> {
  if (opts.platform === "ios") {
    return makeError(
      "UNSUPPORTED_PLATFORM",
      "iOS 런타임 덤프는 미지원 — 스크린샷 + AppMap 좌표 추정 사용 (M10에서 idb 지원 예정)"
    );
  }

  // 동적 import: CLI에서는 e2e가 deps에 있어야 함
  const { dumpAndroidUI } = await import("@karax/e2e");

  let xml: string;
  try {
    xml = await dumpAndroidUI(opts.device);
  } catch (err) {
    const code = mapErrorCode(err);
    const message = err instanceof Error ? err.message : String(err);
    return makeError(code, message);
  }

  const tree = parseUiautomatorXml(xml);
  const allNodes = flattenInteractive(tree);

  const truncated = allNodes.length > NODE_LIMIT;
  const nodes = allNodes.slice(0, NODE_LIMIT).map(toUiDumpNode);

  const result: UiDumpResult = {
    ok: true,
    platform: "android",
    deviceWidth: tree.deviceWidth,
    deviceHeight: tree.deviceHeight,
    nodes,
  };
  if (truncated) {
    result.truncatedNodes = true;
  }
  return result;
}

// ── runUiLocate ────────────────────────────────────────────────────────

export interface RunUiLocateOptions {
  device: string;
  platform: string;
  label: string;
  appmap?: string;
  screen?: string;
}

export async function runUiLocate(
  opts: RunUiLocateOptions
): Promise<UiLocateAnyResult> {
  if (opts.platform === "ios") {
    return makeError(
      "UNSUPPORTED_PLATFORM",
      "iOS 런타임 덤프는 미지원 — 스크린샷 + AppMap 좌표 추정 사용 (M10에서 idb 지원 예정)"
    );
  }

  if (!opts.label || !opts.label.trim()) {
    return makeError("INVALID_ARGUMENT", "--label 옵션이 필요합니다.");
  }

  const { dumpAndroidUI } = await import("@karax/e2e");

  let xml: string;
  try {
    xml = await dumpAndroidUI(opts.device);
  } catch (err) {
    const code = mapErrorCode(err);
    const message = err instanceof Error ? err.message : String(err);
    return makeError(code, message);
  }

  // appmap 파싱 (있을 때) — 유효성 검증 + 향후 matchAppMapElement 사용을 위해
  if (opts.appmap) {
    const appMapResult = readAppMap(opts.appmap);
    if (!appMapResult.success) {
      return appMapResult.error;
    }
    // appMap 파싱은 성공 — locateLabel이 라벨 기반 매칭만으로 충분히 동작
    void appMapResult.data; // 현재 M4에서는 유효성 검증용, M10에서 idb 매칭에 사용 예정
  }

  const tree = parseUiautomatorXml(xml);
  const nodes = flattenInteractive(tree);

  const located = locateLabel(opts.label, nodes);

  if (located.node === null) {
    // 미발견 — candidates 반환
    const candidates = located.candidates.map((n) => ({
      text: n.text,
      center: computeCenter(n.bounds),
    }));
    return { ok: true, found: false, candidates };
  }

  const node = located.node;
  const center = computeCenter(node.bounds);

  const result: UiLocateResult = {
    ok: true,
    found: true,
    method: located.method,
    score: located.score,
    tap: center,
    bounds: node.bounds,
    clickable: node.clickable,
  };

  // clickable:false 경고
  if (!node.clickable) {
    result.tappable = false;
  }

  return result;
}

// ── runUiWhichScreen ───────────────────────────────────────────────────

export interface RunUiWhichScreenOptions {
  device: string;
  platform: string;
  appmap: string | undefined;
}

export async function runUiWhichScreen(
  opts: RunUiWhichScreenOptions
): Promise<UiWhichScreenResult | UiErrorResult> {
  if (opts.platform === "ios") {
    return makeError(
      "UNSUPPORTED_PLATFORM",
      "iOS 런타임 덤프는 미지원 — 스크린샷 + AppMap 좌표 추정 사용 (M10에서 idb 지원 예정)"
    );
  }

  if (!opts.appmap) {
    return makeError("INVALID_ARGUMENT", "--appmap 옵션이 필요합니다.");
  }

  const appMapResult = readAppMap(opts.appmap);
  if (!appMapResult.success) {
    return appMapResult.error;
  }
  const appMap = appMapResult.data;

  const { dumpAndroidUI } = await import("@karax/e2e");

  let xml: string;
  try {
    xml = await dumpAndroidUI(opts.device);
  } catch (err) {
    const code = mapErrorCode(err);
    const message = err instanceof Error ? err.message : String(err);
    return makeError(code, message);
  }

  const tree = parseUiautomatorXml(xml);
  const nodes = flattenInteractive(tree);

  // AppMapRead는 schemaVersion이 "appmap/1"|"appmap/2" union.
  // identifyScreen은 AppMap(appmap/2)을 받지만 런타임 매칭에 schemaVersion은 사용하지 않으므로 단언 안전.
  const identification = identifyScreen(appMap as AppMap, nodes);

  // ranked 상위 5개만
  const ranked = identification.ranked.slice(0, 5);

  return {
    ok: true,
    screenId: identification.screenId,
    confidence: identification.confidence,
    ranked,
  };
}
