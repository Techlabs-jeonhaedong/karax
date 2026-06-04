/**
 * RN 웹 컴파일 러너
 *
 * PLAN 1-1:
 * - esbuild: alias{react-native:react-native-web}, nodePaths, loader tsx, bundle, format iife
 * - HTML 셸: 디바이스 프로파일 뷰포트, 번들 인라인 → Playwright Chromium 캡처
 * - 에러 분류: BUNDLE_FAILED / RENDER_FAILED / TIMEOUT
 */
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import type { DeviceProfileId } from "@sfc/adapter-api";
import { createNativeMockPlugin, type MockedModule } from "./harness/nativeMockPlugin.js";

// ── playwright 로더 ───────────────────────────────────────────────────────────
//
// playwright는 @sfc/renderer 패키지 의존성으로 설치됨.
// 이 패키지 node_modules에는 없으므로 workspace 내 renderer 패키지에서 찾는다.
// createRequire로 CJS 로드 (ESM dynamic import는 Node.js 패키지 해석 경계를 넘지 못함).

function findPlaywrightNodeModules(): string {
  // 이 파일 위치(dist/runner.js 또는 src/runner.ts) 기준으로 renderer 패키지 탐색
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    // dist/runner.js → packages/compile-react-native/dist → ../../renderer/node_modules
    path.resolve(here, "../../renderer/node_modules/playwright/index.js"),
    // src/runner.ts → packages/compile-react-native/src → ../../renderer/node_modules (vitest)
    path.resolve(here, "../../../renderer/node_modules/playwright/index.js"),
    // workspace root node_modules (hoisting)
    path.resolve(here, "../../../../node_modules/playwright/index.js"),
    path.resolve(here, "../../../../../node_modules/playwright/index.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    "playwright를 찾을 수 없음. @sfc/renderer 패키지가 설치되어 있어야 합니다."
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadPlaywright(): any {
  const pwPath = findPlaywrightNodeModules();
  const req = createRequire(pwPath);
  return req(pwPath);
}

// ── 에러 타입 ──────────────────────────────────────────────────────────────────

export type CompileErrorCode = "BUNDLE_FAILED" | "RENDER_FAILED" | "TIMEOUT";

export class CompileCaptureError extends Error {
  constructor(
    public readonly code: CompileErrorCode,
    message: string,
    public readonly stderr: string = ""
  ) {
    super(message);
    this.name = "CompileCaptureError";
  }
}

// ── 디바이스 프로파일 (간소화 — renderer 패키지 미의존) ──────────────────────

interface ViewportSize {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

const DEVICE_SIZES: Record<string, ViewportSize> = {
  "iphone-15": { width: 393, height: 852, deviceScaleFactor: 3 },
  "iphone-se": { width: 375, height: 667, deviceScaleFactor: 2 },
  "pixel-8": { width: 412, height: 915, deviceScaleFactor: 2.625 },
  "pixel-7": { width: 412, height: 915, deviceScaleFactor: 2.625 },
  "generic-tablet": { width: 768, height: 1024, deviceScaleFactor: 2 },
};

function getViewport(device: DeviceProfileId): ViewportSize {
  return DEVICE_SIZES[device] ?? DEVICE_SIZES["pixel-8"];
}

// ── esbuild 번들 ──────────────────────────────────────────────────────────────

export interface BundleOptions {
  entryPath: string;
  projectPath: string;
  workDir: string;
}

export interface BundleResult {
  bundleJs: string;
  mockedModules: MockedModule[];
}

/**
 * entry.jsx를 esbuild로 번들한다.
 * - react-native → react-native-web alias
 * - 네이티브 모듈 자동 mock plugin
 * - nodePaths: 이 패키지 node_modules + 프로젝트 node_modules
 */
export async function bundleEntry(opts: BundleOptions): Promise<BundleResult> {
  const { build } = await import("esbuild");

  const mockedModules: MockedModule[] = [];
  const nativeMockPlugin = createNativeMockPlugin(mockedModules);

  // 이 패키지의 node_modules 경로를 createRequire로 안전하게 해석
  // (import.meta.url 기반 경로는 dist/ 실행 시 다를 수 있으므로 require.resolve 사용)
  const _require = createRequire(import.meta.url);
  const ownNodeModules = path.dirname(
    path.dirname(_require.resolve("react-native-web/package.json"))
  );

  let result: { outputFiles: Array<{ text: string }> };
  try {
    result = await build({
      entryPoints: [opts.entryPath],
      bundle: true,
      format: "iife",
      write: false,
      loader: {
        ".tsx": "tsx",
        ".ts": "ts",
        ".jsx": "jsx",
        ".js": "jsx",
        // 이미지 파일은 dataURL로 인라인 처리
        ".png": "dataurl",
        ".jpg": "dataurl",
        ".jpeg": "dataurl",
        ".gif": "dataurl",
        ".webp": "dataurl",
        ".svg": "text",
      },
      alias: {
        "react-native": "react-native-web",
      },
      nodePaths: [
        ownNodeModules,
        path.join(opts.projectPath, "node_modules"),
      ],
      absWorkingDir: opts.projectPath,
      plugins: [nativeMockPlugin],
      define: {
        "process.env.NODE_ENV": '"production"',
        "__DEV__": "false",
      },
      // 타입 오류는 무시하고 번들에 집중
      logLevel: "silent",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new CompileCaptureError("BUNDLE_FAILED", `esbuild 번들 실패: ${msg}`, msg);
  }

  const bundleJs = result.outputFiles[0]?.text ?? "";
  if (!bundleJs) {
    throw new CompileCaptureError("BUNDLE_FAILED", "esbuild 출력이 비어있음", "");
  }

  return { bundleJs, mockedModules };
}

// ── HTML 셸 생성 ──────────────────────────────────────────────────────────────

/**
 * 디바이스 뷰포트 + 번들 인라인 HTML 생성
 */
export function generateHtmlShell(bundleJs: string, viewport: ViewportSize): string {
  // react-native-web 기본 스타일 리셋
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${viewport.width}, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body, #root {
      margin: 0;
      padding: 0;
      width: ${viewport.width}px;
      height: ${viewport.height}px;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    /* react-native-web View default */
    [data-testid], div { position: relative; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
${bundleJs}
  </script>
</body>
</html>`;
}

// ── Playwright 캡처 ───────────────────────────────────────────────────────────

export interface CaptureOptions {
  htmlContent: string;
  outPath: string;
  viewport: ViewportSize;
  timeoutMs?: number;
}

export interface CaptureResult {
  width: number;
  height: number;
}

/**
 * HTML 셸을 Playwright Chromium으로 렌더링해 PNG로 캡처한다.
 * - 빈 루트 / 콘솔 에러 → RENDER_FAILED
 */
export async function captureWithPlaywright(opts: CaptureOptions): Promise<CaptureResult> {
  // playwright는 renderer 패키지 dep를 통해 workspace에 설치됨.
  // createRequire + 탐색으로 playwright 로드.
  const { chromium } = loadPlaywright();
  const { htmlContent, outPath, viewport, timeoutMs = 30_000 } = opts;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
    });
    const page = await context.newPage();

    // 콘솔 에러 수집
    const consoleErrors: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    page.on("console", (msg: any) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.setContent(htmlContent, {
      timeout: timeoutMs,
      waitUntil: "networkidle",
    });

    // #root가 비어있으면 RENDER_FAILED (문자열 evaluate로 DOM 타입 의존 제거)
    const rootEmpty = await page.evaluate(
      "document.getElementById('root') === null || document.getElementById('root').children.length === 0"
    ) as boolean;

    if (rootEmpty) {
      const errSummary = consoleErrors.slice(0, 3).join("; ");
      throw new CompileCaptureError(
        "RENDER_FAILED",
        `#root가 비어있음 (렌더링 실패). 콘솔 에러: ${errSummary || "없음"}`,
        errSummary
      );
    }

    // PNG 캡처
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: false, type: "png" });

    const pngSize = readPngSize(outPath);
    return pngSize;
  } catch (e) {
    if (e instanceof CompileCaptureError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Timeout") || msg.includes("ETIMEDOUT")) {
      throw new CompileCaptureError("TIMEOUT", `Playwright 캡처 타임아웃: ${msg}`, msg);
    }
    throw new CompileCaptureError("RENDER_FAILED", `Playwright 캡처 실패: ${msg}`, msg);
  } finally {
    try { await browser?.close(); } catch {}
  }
}

// ── PNG 크기 파싱 ──────────────────────────────────────────────────────────────

function readPngSize(pngPath: string): { width: number; height: number } {
  try {
    const fd = fs.openSync(pngPath, "r");
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    // PNG IHDR: 바이트 16-19 = width, 20-23 = height (big-endian)
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  } catch {
    return { width: 0, height: 0 };
  }
}

// ── 통합 실행 ────────────────────────────────────────────────────────────────

export interface RunOptions {
  entryPath: string;
  projectPath: string;
  workDir: string;
  outPath: string;
  device: DeviceProfileId;
  timeoutMs?: number;
}

export interface RunResult {
  width: number;
  height: number;
  mockedModules: MockedModule[];
}

/**
 * entry.jsx 번들 → HTML 셸 → Playwright 캡처 파이프라인
 */
export async function runRnWebCapture(opts: RunOptions): Promise<RunResult> {
  const viewport = getViewport(opts.device);

  // Step 1: esbuild 번들
  const { bundleJs, mockedModules } = await bundleEntry({
    entryPath: opts.entryPath,
    projectPath: opts.projectPath,
    workDir: opts.workDir,
  });

  // Step 2: HTML 셸 생성
  const htmlContent = generateHtmlShell(bundleJs, viewport);

  // Step 3: Playwright 캡처
  const { width, height } = await captureWithPlaywright({
    htmlContent,
    outPath: opts.outPath,
    viewport,
    timeoutMs: opts.timeoutMs,
  });

  return { width, height, mockedModules };
}
