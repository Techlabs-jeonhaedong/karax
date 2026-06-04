import { mkdirSync } from "fs";
import { resolve } from "path";
import type { IRDocument, IRNode } from "@sfc/core";
import { getDeviceProfile } from "../devices/profiles.js";
import { irToHtml, irToHtmlWithIdx } from "../html/irToHtml.js";

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
 * 각 DOM 요소에 심어진 data-sfc-idx와 대응하는 NodeInfo 목록을 반환한다.
 *
 * Branch는 첫 번째 child만 렌더링하므로(DOM 요소 생성 없음) 건너뛰고,
 * Branch의 첫 child가 다음 idx를 받는다.
 *
 * Leaf 타입(Text/Image/Icon/Spacer/Divider/Unknown/Slot/Input)은
 * children이 있어도 렌더링하지 않으므로 순회하지 않는다.
 *
 * @internal 테스트에서 직접 검증 가능하도록 export한다.
 */
export function collectNodeInfoWithIdx(root: IRNode): NodeInfo[] {
  const result: NodeInfo[] = [];
  let idx = 0;

  function visit(node: IRNode): void {
    if (node.type === "Branch") {
      // Branch 자체는 DOM 요소를 생성하지 않음 → idx 소비 없음
      // 단, renderNode에서 myIdx = idxRef.value++ 를 먼저 실행하고 Branch로 분기하므로
      // myIdx는 소비되지만 DOM에 심기지 않는다. 여기서도 동일하게 idx를 소비하되 result에 추가하지 않는다.
      idx++; // myIdx 소비에 대응
      const first = node.children?.[0];
      if (first) visit(first);
      // 나머지 Branch 자식들(Variant B 등)은 렌더링 안 됨 → 건너뜀
      return;
    }

    const myIdx = idx++;
    result.push({
      idx: myIdx,
      confidence: node.confidence,
      isUnknown: node.type === "Unknown",
      hasLowConfidence: node.confidence < 0.5,
    });

    // 컨테이너 타입만 children을 순회한다.
    // Leaf 타입은 children이 있어도 renderNode가 무시하므로 여기서도 건너뛴다.
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
 * Playwright page에 confidence 오버레이를 CSS+JS로 적용한다.
 * irToHtmlWithIdx가 심은 data-sfc-idx 속성으로 DOM 요소를 정확히 찾아 마킹한다.
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
      .sfc-low-conf {
        outline: 3px solid rgba(255, 140, 0, 0.75) !important;
        outline-offset: -2px;
        position: relative !important;
      }
      .sfc-low-conf::before {
        content: attr(data-sfc-score) !important;
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
      .sfc-unknown {
        outline: 3px solid rgba(220, 38, 38, 0.85) !important;
        outline-offset: -2px;
        position: relative !important;
      }
      .sfc-unknown::before {
        content: attr(data-sfc-score) !important;
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

  // JS: data-sfc-idx 속성으로 각 DOM 요소를 정확히 찾아 마킹
  await page.evaluate((infos: NodeInfo[]) => {
    for (const info of infos) {
      if (!info.hasLowConfidence) continue;
      const el = document.querySelector(`[data-sfc-idx="${info.idx}"]`);
      if (!el) continue;
      el.setAttribute("data-sfc-score", info.confidence.toFixed(2));
      if (info.isUnknown) {
        el.classList.add("sfc-unknown");
      } else {
        el.classList.add("sfc-low-conf");
      }
    }
  }, nodeInfos);
}

// ── renderScreenshot ──────────────────────────────────────────────

export async function renderScreenshot(
  ir: IRDocument,
  options: RenderOptions,
): Promise<RenderResult> {
  const deviceId = options.device ?? ir.screen.device ?? "iphone-15";
  const profile = getDeviceProfile(deviceId);
  const html = irToHtml(ir, profile);

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

    await page.setContent(html, { waitUntil: "networkidle" });

    const pngFilename = `${ir.screen.id}_${deviceId}.png`;
    const pngPath = resolve(options.outDir, pngFilename);

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

    await context.close();

    const physicalWidth = Math.round(profile.width * profile.deviceScaleFactor);
    const physicalHeight = Math.round(profile.height * profile.deviceScaleFactor);

    const baseResult: RenderResult = { pngPath, width: physicalWidth, height: physicalHeight };

    // overlay 모드: 별도 PNG 생성
    if (options.overlay === "confidence") {
      // data-sfc-idx가 심어진 HTML 사용
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
