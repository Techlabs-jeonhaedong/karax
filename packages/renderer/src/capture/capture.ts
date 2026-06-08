import { mkdirSync, writeFileSync } from "fs";
import { resolve, join, basename } from "path";
import type { IRDocument, IRNode } from "@karax/core";
import { redactSecrets, mapConcurrent } from "@karax/core";
import { getDeviceProfile } from "../devices/profiles.js";
import { irToHtml, irToHtmlWithIdx } from "../html/irToHtml.js";

// ── MeasuredBounds ────────────────────────────────────────────────────

export interface MeasuredBounds {
  nodeType: string;
  sourceRef?: { file: string; line?: number; symbol?: string };
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderOptions {
  /** 디바이스 프로파일 ID (기본: "iphone-15") */
  device?: string;
  /** PNG 출력 디렉토리 */
  outDir: string;
  /**
   * "confidence" — confidence < 0.5 노드에 반투명 주황 테두리+코너 라벨,
   * Unknown은 빨강 테두리 오버레이를 적용한 디버그용 PNG를 추가로 생성한다.
   * 출력: <이름>__overlay.png (원본 PNG와 별도)
   */
  overlay?: "confidence";
  /**
   * 디버그 모드. true이면 page console 메시지를 수집하고,
   * setContent/screenshot 실패 시 outDir/debug/에 HTML과 콘솔 로그를 덤프 후 rethrow.
   * headless 유지, browser.close() finally 불변.
   */
  debug?: boolean;
}

export interface RenderResult {
  /** 생성된 PNG 절대 경로 */
  pngPath: string;
  /** 물리 픽셀 너비 */
  width: number;
  /** 물리 픽셀 높이 */
  height: number;
  /**
   * overlay 옵션을 사용했을 때 생성된 오버레이 PNG 경로.
   * overlay 옵션을 사용하지 않으면 undefined.
   */
  overlayPngPath?: string;
}

// ── confidence 오버레이 ──────────────────────────────────────────────

export interface NodeInfo {
  idx: number;
  confidence: number;
  isUnknown: boolean;
  hasLowConfidence: boolean;
}

/**
 * renderNode에서 children을 순회하는 컨테이너 타입 목록.
 * 이 타입만 children을 재귀 순회한다(leaf 타입은 children을 렌더링하지 않음).
 * irToHtml.ts의 renderNode/renderFlex/renderAppBar/renderTabBar와 동기화할 것.
 */
const CONTAINER_TYPES = new Set([
  "Column", "Row", "Box", "Stack", "Scroll", "Grid", "List", "Button",
  // renderAppBar/renderTabBar도 children 순회
  // (Box의 role=appbar|tabbar도 여기에 포함됨)
]);

/**
 * IR 트리를 irToHtmlWithIdx의 renderNode와 동일한 순서로 순회하여
 * idx와 원본 IRNode를 쌍으로 반환한다.
 *
 * Branch는 첫 번째 child만 렌더링하므로(DOM 요소 생성 없음) 건너뛰고,
 * Branch의 첫 child가 다음 idx를 받는다.
 *
 * Leaf 타입(Text/Image/Icon/Spacer/Divider/Unknown/Slot/Input)은
 * children이 있어도 렌더링하지 않으므로 순회하지 않는다.
 *
 * @public SDK가 idx→노드 매핑에 활용한다.
 */
export function collectNodesWithIdx(root: IRNode): Array<{ idx: number; node: IRNode }> {
  const result: Array<{ idx: number; node: IRNode }> = [];
  let idx = 0;

  function visit(node: IRNode): void {
    if (node.type === "Branch") {
      idx++; // myIdx 소비에 대응 (DOM에 심기지 않음)
      const first = node.children?.[0];
      if (first) visit(first);
      return;
    }

    const myIdx = idx++;
    result.push({ idx: myIdx, node });

    if (node.children && CONTAINER_TYPES.has(node.type)) {
      for (const child of node.children) {
        visit(child);
      }
    }
  }

  visit(root);
  return result;
}

/**
 * IR 트리를 irToHtmlWithIdx의 renderNode와 동일한 순서로 순회하여
 * 각 DOM 요소에 심어진 data-karax-idx와 대응하는 NodeInfo 목록을 반환한다.
 *
 * @internal 테스트에서 직접 검증 가능하도록 export한다.
 */
export function collectNodeInfoWithIdx(root: IRNode): NodeInfo[] {
  return collectNodesWithIdx(root).map(({ idx, node }) => ({
    idx,
    confidence: node.confidence,
    isUnknown: node.type === "Unknown",
    hasLowConfidence: node.confidence < 0.5,
  }));
}

/**
 * Playwright page에 confidence 오버레이를 CSS+JS로 적용한다.
 * irToHtmlWithIdx가 심은 data-karax-idx 속성으로 DOM 요소를 정확히 찾아 마킹한다.
 *
 * - confidence < 0.5: 반투명 주황 테두리(3px) + 코너 라벨(점수)
 * - Unknown 타입: 빨강 테두리
 */
async function applyConfidenceOverlay(
  page: import("playwright").Page,
  nodeInfos: NodeInfo[]
): Promise<void> {
  // CSS 주입
  await page.addStyleTag({
    content: `
      .karax-low-conf {
        outline: 3px solid rgba(255, 140, 0, 0.75) !important;
        outline-offset: -2px;
        position: relative !important;
      }
      .karax-low-conf::before {
        content: attr(data-karax-score) !important;
        position: absolute !important;
        top: 2px !important;
        left: 2px !important;
        background: rgba(255, 140, 0, 0.85) !important;
        color: white !important;
        font-size: 9px !important;
        font-family: monospace !important;
        padding: 1px 3px !important;
        border-radius: 2px !important;
        z-index: 9999 !important;
        pointer-events: none !important;
      }
      .karax-unknown {
        outline: 3px solid rgba(220, 38, 38, 0.85) !important;
        outline-offset: -2px;
        position: relative !important;
      }
      .karax-unknown::before {
        content: attr(data-karax-score) !important;
        position: absolute !important;
        top: 2px !important;
        left: 2px !important;
        background: rgba(220, 38, 38, 0.9) !important;
        color: white !important;
        font-size: 9px !important;
        font-family: monospace !important;
        padding: 1px 3px !important;
        border-radius: 2px !important;
        z-index: 9999 !important;
        pointer-events: none !important;
      }
    `,
  });

  // JS: data-karax-idx 속성으로 각 DOM 요소를 정확히 찾아 마킹
  await page.evaluate((infos: NodeInfo[]) => {
    for (const info of infos) {
      if (!info.hasLowConfidence) continue;
      const el = document.querySelector(`[data-karax-idx="${info.idx}"]`);
      if (!el) continue;
      el.setAttribute("data-karax-score", info.confidence.toFixed(2));
      if (info.isUnknown) {
        el.classList.add("karax-unknown");
      } else {
        el.classList.add("karax-low-conf");
      }
    }
  }, nodeInfos);
}

// ── screenId 정규화 ──────────────────────────────────────────────

/**
 * screenId를 파일명으로 안전하게 정규화한다.
 * - path.basename으로 경로 구분자 제거
 * - 허용 문자 이외([^A-Za-z0-9._-])는 _로 치환 (..·경로구분자·널문자 제거 포함)
 * - 빈 문자열이 되면 "unknown"으로 대체
 *
 * @public 테스트에서 직접 검증 가능하도록 export한다.
 */
export function sanitizeScreenId(screenId: string): string {
  const base = basename(screenId);
  const sanitized = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return sanitized.length > 0 ? sanitized : "unknown";
}

// ── renderScreenshot ──────────────────────────────────────────────

export async function renderScreenshot(
  ir: IRDocument,
  options: RenderOptions,
): Promise<RenderResult> {
  const deviceId = options.device ?? ir.screen.device ?? "iphone-15";
  const profile = getDeviceProfile(deviceId);
  const html = irToHtml(ir, profile);
  const debugMode = options.debug === true;

  const { chromium } = await import("playwright");

  mkdirSync(options.outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: {
        width: profile.width,
        height: profile.height,
      },
      deviceScaleFactor: profile.deviceScaleFactor,
    });

    const page = await context.newPage();

    // debug 시 page console 메시지 수집
    const consoleLogs: string[] = [];
    if (debugMode) {
      page.on("console", (msg) => {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      });
    }

    // screenId를 파일명으로 안전하게 정규화 (경로 주입 방어)
    const safeScreenId = sanitizeScreenId(ir.screen.id);
    const debugDir = join(options.outDir, "debug");

    try {
      await page.setContent(html, { waitUntil: "networkidle" });
    } catch (err) {
      // setContent 실패 시 debug 덤프 후 rethrow
      if (debugMode) {
        try {
          mkdirSync(debugDir, { recursive: true });
          // redact 적용 후 덤프
          writeFileSync(join(debugDir, `render-${safeScreenId}.html`), redactSecrets(html), "utf-8");
          writeFileSync(join(debugDir, `render-${safeScreenId}.console.log`), redactSecrets(consoleLogs.join("\n")), "utf-8");
        } catch {
          // 덤프 실패는 무시하고 원본 에러를 rethrow
        }
      }
      throw err;
    }

    const pngFilename = `${safeScreenId}_${deviceId}.png`;
    const pngPath = resolve(options.outDir, pngFilename);

    try {
      await page.screenshot({
        path: pngPath,
        fullPage: false,
        clip: {
          x: 0,
          y: 0,
          width: profile.width,
          height: profile.height,
        },
      });
    } catch (err) {
      // screenshot 실패 시 debug 덤프 후 rethrow
      if (debugMode) {
        try {
          mkdirSync(debugDir, { recursive: true });
          const pageContent = await page.content().catch(() => html);
          // redact 적용 후 덤프
          writeFileSync(join(debugDir, `render-${safeScreenId}.html`), redactSecrets(pageContent), "utf-8");
          writeFileSync(join(debugDir, `render-${safeScreenId}.console.log`), redactSecrets(consoleLogs.join("\n")), "utf-8");
        } catch {
          // 덤프 실패는 무시하고 원본 에러를 rethrow
        }
      }
      throw err;
    }

    await context.close();

    const physicalWidth = Math.round(profile.width * profile.deviceScaleFactor);
    const physicalHeight = Math.round(profile.height * profile.deviceScaleFactor);

    const baseResult: RenderResult = { pngPath, width: physicalWidth, height: physicalHeight };

    // overlay 모드: 별도 PNG 생성
    if (options.overlay === "confidence") {
      // data-karax-idx가 심어진 HTML 사용
      const overlayHtml = irToHtmlWithIdx(ir, profile);
      const nodeInfos = collectNodeInfoWithIdx(ir.screen.root);

      const overlayContext = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.deviceScaleFactor,
      });
      const overlayPage = await overlayContext.newPage();
      await overlayPage.setContent(overlayHtml, { waitUntil: "networkidle" });
      await applyConfidenceOverlay(overlayPage, nodeInfos);

      const overlayFilename = `${ir.screen.id}_${deviceId}__overlay.png`;
      const overlayPngPath = resolve(options.outDir, overlayFilename);

      await overlayPage.screenshot({
        path: overlayPngPath,
        fullPage: false,
        clip: { x: 0, y: 0, width: profile.width, height: profile.height },
      });

      await overlayContext.close();

      return { ...baseResult, overlayPngPath };
    }

    return baseResult;
  } finally {
    await browser.close();
  }
}

// ── 유한성 필터 ──────────────────────────────────────────────────────

/**
 * MeasuredBounds 배열에서 x/y/width/height 중 유한하지 않은(NaN, Infinity)
 * 항목과 width/height 가 음수인 항목을 제외한다.
 *
 * 이 값들이 그대로 AppMapSchema.parse에 전달되면 스키마 검증 실패로
 * graceful degradation 대신 전체 크래시가 발생하므로 사전에 필터링한다.
 *
 * @public 테스트에서 직접 검증 가능하도록 export한다.
 */
export function filterFiniteBounds(bounds: MeasuredBounds[]): MeasuredBounds[] {
  return bounds.filter(
    (b) =>
      Number.isFinite(b.x) &&
      Number.isFinite(b.y) &&
      Number.isFinite(b.width) &&
      Number.isFinite(b.height) &&
      b.width >= 0 &&
      b.height >= 0,
  );
}

// ── measureScreenLayouts ─────────────────────────────────────────────

/**
 * 복수의 IR 문서를 Chromium으로 렌더링하고 각 노드의 CSS px 좌표를 반환한다.
 *
 * 브라우저는 1회만 launch하고 모든 화면을 측정한다 (화면당 launch 금지).
 * idx → collectNodesWithIdx로 IR 노드를 식별하고, sourceRef/nodeType을 동봉한다.
 *
 * @param irs     측정할 IRDocument 배열
 * @param options device: 디바이스 프로파일 ID (기본: ir.screen.device ?? "iphone-15")
 * @returns       Map<screenId, MeasuredBounds[]>
 */
export async function measureScreenLayouts(
  irs: IRDocument[],
  options?: { device?: string },
): Promise<Map<string, MeasuredBounds[]>> {
  const resultMap = new Map<string, MeasuredBounds[]>();
  if (irs.length === 0) return resultMap;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  // 최대 4개 동시성 제한으로 병렬 측정 (브라우저는 1회 launch 재사용, 결과 순서 보존)
  const LAYOUT_MEASURE_CONCURRENCY = 4;
  try {
    const entries = await mapConcurrent(irs, LAYOUT_MEASURE_CONCURRENCY, async (ir) => {
      const deviceId = options?.device ?? ir.screen.device ?? "iphone-15";
      const profile = getDeviceProfile(deviceId);
      const html = irToHtmlWithIdx(ir, profile);

      // idx → IRNode 매핑 (collectNodesWithIdx 재사용)
      const nodesByIdx = new Map<number, IRNode>();
      for (const { idx, node } of collectNodesWithIdx(ir.screen.root)) {
        nodesByIdx.set(idx, node);
      }

      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.deviceScaleFactor,
      });
      try {
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: "networkidle" });

        // page.evaluate로 DOM에서 idx+BoundingClientRect 수집
        const domEntries = await page.evaluate(() => {
          const els = document.querySelectorAll("[data-karax-idx]");
          return Array.from(els).map((el) => {
            const idxAttr = el.getAttribute("data-karax-idx");
            const rect = el.getBoundingClientRect();
            return {
              idx: parseInt(idxAttr!, 10),
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            };
          });
        });

        const rawBounds: MeasuredBounds[] = domEntries.map(({ idx, x, y, width, height }) => {
          const node = nodesByIdx.get(idx);
          const measured: MeasuredBounds = {
            nodeType: node?.type ?? "Unknown",
            x,
            y,
            width,
            height,
          };
          if (node?.sourceRef) {
            measured.sourceRef = node.sourceRef as MeasuredBounds["sourceRef"];
          }
          return measured;
        });

        return { screenId: ir.screen.id, bounds: filterFiniteBounds(rawBounds) };
      } finally {
        await context.close();
      }
    });

    for (const { screenId, bounds } of entries) {
      resultMap.set(screenId, bounds);
    }
  } finally {
    await browser.close();
  }

  return resultMap;
}
