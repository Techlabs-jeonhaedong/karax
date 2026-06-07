/**
 * @karax/mcp — MCP 서버 구현 (PLAN.md 9절)
 *
 * McpServer (high-level API) + StdioServerTransport
 * 7개 tool: detect_framework / doctor / list_screens / get_screen_ir /
 *            capture_screen / capture_all / get_analysis_report
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import {
  detectFramework,
  doctor,
  doctorFix,
  listScreens,
  buildScreenIR,
  captureScreen,
  captureAll,
  ensureDependencies,
  generateAppMap,
  renderAppMapMarkdown,
  resetParserState,
} from "@karax/sdk";
import type { FrameworkId, DeviceProfileId, CaptureMode } from "@karax/sdk";

// ── 입력 스키마 (zod) ────────────────────────────────────────────────

const ProjectPathSchema = z.object({
  projectPath: z.string().min(1, "projectPath는 비어있을 수 없습니다"),
});

const FrameworkOptSchema = ProjectPathSchema.extend({
  framework: z.enum(["flutter", "react-native", "ios", "android"]).optional(),
});

// ── 공통 에러 헬퍼 ───────────────────────────────────────────────────

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

function wrapError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * KARAX_DEBUG=1일 때 에러 상세를 stderr로 추가 기록한다.
 * errorContent의 message는 기존 그대로 유지 (JSON-RPC 채널 불변).
 */
function debugLogError(e: unknown, toolName: string): void {
  if (process.env["KARAX_DEBUG"] !== "1") return;
  const lines: string[] = [`[karax/debug] [mcp:${toolName}]`];
  if (e instanceof Error) {
    if (e.stack) lines.push(`  stack: ${e.stack}`);
    const asE2e = e as { code?: unknown; details?: unknown };
    if (asE2e.code !== undefined) lines.push(`  code: ${String(asE2e.code)}`);
    if (asE2e.details !== undefined) lines.push(`  details: ${String(asE2e.details)}`);
  } else {
    lines.push(`  raw: ${String(e)}`);
  }
  process.stderr.write(lines.join("\n") + "\n");
}

/**
 * Emscripten WASM Aborted 에러를 감지한다.
 * web-tree-sitter가 힙 고갈 시 "Aborted(OOM...)" 메시지를 던지거나
 * WebAssembly.RuntimeError("unreachable")를 발생시킨다.
 *
 * 오탐 방지:
 * - "RuntimeError" 단독 문자열 매칭은 일반 JS 에러를 오탐할 수 있으므로 제거
 * - WebAssembly.RuntimeError 인스턴스 검사를 우선 적용
 * - 문자열 매칭은 구체적인 WASM 패턴으로 한정
 */
// Node.js 환경에서 WebAssembly.RuntimeError는 전역이지만 TypeScript ES2022 lib에 미포함.
// globalThis를 통해 안전하게 접근한다.
const _WebAssemblyRuntimeError = (globalThis as Record<string, unknown>)["WebAssembly"] != null
  ? ((globalThis as Record<string, unknown>)["WebAssembly"] as { RuntimeError?: new (...args: unknown[]) => Error }).RuntimeError ?? null
  : null;

/**
 * Emscripten WASM Aborted 에러를 감지한다.
 * 오탐 방지:
 * - WebAssembly.RuntimeError 인스턴스 검사를 우선 적용
 * - 문자열 매칭은 구체적인 WASM 패턴으로 한정 ("RuntimeError" 단독 매칭 제거)
 */
function isWasmAbortedError(e: unknown): boolean {
  // 1. WebAssembly.RuntimeError 인스턴스인 경우 (가장 구체적)
  if (_WebAssemblyRuntimeError && e instanceof _WebAssemblyRuntimeError) return true;

  const msg = e instanceof Error ? e.message : String(e);

  // 2. Emscripten Aborted() 패턴 ("Aborted(" 포함)
  if (msg.includes("Aborted(")) return true;

  // 3. "RuntimeError: unreachable" — WASM trap 패턴
  if (msg.includes("RuntimeError: unreachable")) return true;

  return false;
}

/**
 * WASM 힙 고갈 에러 발생 시 파서 캐시를 재초기화한다.
 * 재초기화 성공/실패를 구분해 정직하게 보고한다.
 */
async function handleWasmError(e: unknown, toolName: string): Promise<string> {
  // debug 시 stderr에 추가 기록 (errorContent message는 불변)
  debugLogError(e, toolName);
  const base = wrapError(e);
  if (isWasmAbortedError(e)) {
    let resetResult: "success" | "failure" = "success";
    let resetErrorMsg = "";
    try {
      await resetParserState();
    } catch (resetErr) {
      resetResult = "failure";
      resetErrorMsg = resetErr instanceof Error ? resetErr.message : String(resetErr);
    }

    if (resetResult === "success") {
      return (
        `[${toolName}] WASM 힙 고갈로 인해 파서가 비정상 종료되었습니다. ` +
        `파서 상태를 재초기화했습니다. 다음 요청은 정상 동작할 수 있습니다. ` +
        `(원인: 대형 프로젝트 분석 후 Emscripten 메모리 고갈) ` +
        `원본 오류: ${base}`
      );
    } else {
      return (
        `[${toolName}] WASM 힙 고갈로 인해 파서가 비정상 종료되었습니다. ` +
        `파서 재초기화 실패 — 서버 재시작이 필요합니다. ` +
        `재초기화 오류: ${resetErrorMsg}. ` +
        `원본 오류: ${base}`
      );
    }
  }
  return base;
}

/**
 * projectPath 존재 여부를 검증한다.
 * 빈 문자열, 비정상적인 경로도 여기서 탐지.
 * 읽기 권한(R_OK)도 확인한다 (MEDIUM-4: 심볼릭 링크는 허용, 오탐 방지).
 */
function validateProjectPath(projectPath: string): void {
  if (!projectPath || projectPath.trim().length === 0) {
    throw new Error("projectPath가 비어있습니다");
  }
  if (!fs.existsSync(projectPath)) {
    throw new Error(`경로를 찾을 수 없습니다: ${projectPath}`);
  }
  try {
    fs.accessSync(projectPath, fs.constants.R_OK);
  } catch {
    throw new Error(`projectPath에 읽기 권한이 없습니다: ${projectPath}`);
  }
}

// ── PNG → base64 ──────────────────────────────────────────────────────

function pngToBase64(pngPath: string): string {
  const buf = fs.readFileSync(pngPath);
  return buf.toString("base64");
}

// ── 사이드카 경로 ─────────────────────────────────────────────────────
// captureEngine은 사이드카를 outDir/<screenId>_<device>.report.json으로 기록한다.
// PNG 파일명({screenId}_{device}.png)과 접미사를 통일해 디바이스별 덮어쓰기를 방지한다.

function sidecarPath(pngPath: string, screenId: string, device: string): string {
  return path.join(path.dirname(pngPath), `${screenId}_${device}.report.json`);
}

// ── McpServer 팩토리 ──────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "@karax/mcp", version: "0.0.1" },
    {
      capabilities: { tools: {} },
      instructions:
        "모바일 앱 테스트 자동화 MCP 서버. " +
        "최종 목표: 사용자가 시나리오를 주면 Android 에뮬레이터/iOS 시뮬레이터에서 완전 자동으로 E2E 테스트를 수행하고 보고서를 작성한다. " +
        "시나리오가 없으면 앱을 자유 탐색하며 anomaly 10종 taxonomy로 findings를 보고한다. " +
        "Flutter/React Native/Android Compose/iOS SwiftUI 4개 프레임워크를 지원한다. " +
        "run_e2e_test: scenarioPath(파일 또는 디렉토리)를 전달하면 에뮬레이터/시뮬레이터에서 LLM 에이전트가 E2E 테스트를 실행한다. " +
        "세션 시작 시 AppMap을 자동 생성해 에이전트 프롬프트에 주입하므로 에이전트가 버튼 위치를 찾는 시간을 줄인다. " +
        "generate_app_map: 화면 구조·네비게이션 그래프를 AppMap(appmap/2 스키마)으로 추출한다. 광고 영역은 role:\"ad\"로 태깅된다. " +
        "capture_screen / capture_all: 2-티어 캡처(Tier 1: 부분 컴파일, Tier 2: 정적 IR→Chromium)로 화면 스크린샷을 추출한다. " +
        "이 기능은 AppMap 생성의 기반이 되는 하부 기능이다. " +
        "doctor: 환경 진단 — emulator/simulator/idb/agent CLI 체크 후 필요 항목 자동 설치(fix=true).",
    }
  );

  // ── 1. detect_framework ───────────────────────────────────────────

  server.tool(
    "detect_framework",
    "프로젝트 경로의 프레임워크를 감지한다",
    {
      projectPath: z.string().min(1),
    },
    async ({ projectPath }) => {
      try {
        validateProjectPath(projectPath);
        const result = await detectFramework(projectPath);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        debugLogError(e, "detect_framework");
        return errorContent(wrapError(e));
      }
    }
  );

  // ── 2. doctor ────────────────────────────────────────────────────

  server.tool(
    "doctor",
    "환경 진단 리포트를 반환한다. fix=true이면 설치 가능 항목을 자동 설치한다",
    {
      projectPath: z.string().optional(),
      fix: z.boolean().optional().default(false),
    },
    async ({ projectPath, fix }) => {
      try {
        if (projectPath !== undefined && projectPath !== "") {
          validateProjectPath(projectPath);
        }
        const report = fix
          ? await doctorFix()
          : await doctor(projectPath);
        return {
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        };
      } catch (e) {
        debugLogError(e, "doctor");
        return errorContent(wrapError(e));
      }
    }
  );

  // ── 3. list_screens ──────────────────────────────────────────────

  server.tool(
    "list_screens",
    "프로젝트에서 화면 목록을 정적 분석으로 발견한다",
    {
      projectPath: z.string().min(1),
      framework: z.enum(["flutter", "react-native", "ios", "android"]).optional(),
      includeCandidates: z.boolean().optional().default(true),
    },
    async ({ projectPath, framework, includeCandidates }) => {
      try {
        validateProjectPath(projectPath);
        const screens = await listScreens({
          projectPath,
          framework: framework as FrameworkId | undefined,
          includeCandidates,
        });
        return {
          content: [
            { type: "text", text: JSON.stringify({ screens }, null, 2) },
          ],
        };
      } catch (e) {
        return errorContent(await handleWasmError(e, "list_screens"));
      }
    }
  );

  // ── 4. get_screen_ir ─────────────────────────────────────────────

  server.tool(
    "get_screen_ir",
    "특정 화면의 UI IR(중간 표현)을 반환한다",
    {
      projectPath: z.string().min(1),
      screenId: z.string().min(1),
      maxInlineDepth: z.number().int().positive().optional(),
      mockSeed: z.number().int().optional(),
    },
    async ({ projectPath, screenId, maxInlineDepth, mockSeed }) => {
      try {
        validateProjectPath(projectPath);
        const docs = await buildScreenIR({
          projectPath,
          screenId,
          maxInlineDepth,
          mockSeed,
        });
        if (docs.length === 0) {
          return errorContent(`화면 '${screenId}'의 IR을 찾을 수 없습니다`);
        }
        return {
          content: [
            { type: "text", text: JSON.stringify({ ir: docs[0] }, null, 2) },
          ],
        };
      } catch (e) {
        return errorContent(await handleWasmError(e, "get_screen_ir"));
      }
    }
  );

  // ── 5. capture_screen ────────────────────────────────────────────

  server.tool(
    "capture_screen",
    "특정 화면을 캡처한다. 텍스트 요약 + image content(base64) + 사이드카 경로 반환",
    {
      projectPath: z.string().min(1),
      screenId: z.string().min(1),
      device: z.string().optional(),
      captureMode: z.enum(["auto", "compile", "static"]).optional().default("auto"),
      outDir: z.string().optional(),
      mockSeed: z.number().int().optional(),
      /** Branch 분기별 variant PNG 추가 생성 (Tier 2 전용) */
      variants: z.boolean().optional().default(false),
      /** confidence < 0.5 노드 오버레이 PNG 추가 생성 */
      overlay: z.enum(["confidence"]).optional(),
    },
    async ({ projectPath, screenId, device, captureMode, outDir, mockSeed, variants, overlay }) => {
      try {
        validateProjectPath(projectPath);
        const resolvedOutDir = outDir ?? "/tmp/karax-out";

        const result = await captureScreen({
          projectPath,
          screenId,
          device: device as DeviceProfileId | undefined,
          captureMode: captureMode as CaptureMode,
          outDir: resolvedOutDir,
          mockSeed,
          variants,
          overlay: overlay as "confidence" | undefined,
        });

        const base64 = pngToBase64(result.pngPath);
        const resolvedDevice = (device as string | undefined) ?? "iphone-15";
        const sidecar = sidecarPath(result.pngPath, result.screenId, resolvedDevice);
        const sidecarExists = fs.existsSync(sidecar);

        const summary = {
          screenId: result.screenId,
          pngPath: result.pngPath,
          sidecarPath: sidecarExists ? sidecar : null,
          width: result.width,
          height: result.height,
          tierUsed: result.tierUsed,
          confidence: result.confidence,
        };

        return {
          content: [
            { type: "text", text: JSON.stringify(summary, null, 2) },
            { type: "image", data: base64, mimeType: "image/png" },
          ],
        };
      } catch (e) {
        return errorContent(await handleWasmError(e, "capture_screen"));
      }
    }
  );

  // ── 6. capture_all ───────────────────────────────────────────────

  server.tool(
    "capture_all",
    "전체 화면을 캡처하고 report를 반환한다",
    {
      projectPath: z.string().min(1),
      outDir: z.string().min(1),
      device: z.string().optional(),
      captureMode: z.enum(["auto", "compile", "static"]).optional().default("auto"),
      includeCandidates: z.boolean().optional().default(true),
      mockSeed: z.number().int().optional(),
      /** Branch 분기별 variant PNG 추가 생성 (Tier 2 전용) */
      variants: z.boolean().optional().default(false),
      /** confidence < 0.5 노드 오버레이 PNG 추가 생성 */
      overlay: z.enum(["confidence"]).optional(),
    },
    async ({ projectPath, outDir, device, captureMode, includeCandidates, mockSeed, variants, overlay }) => {
      try {
        validateProjectPath(projectPath);

        const { screens, report } = await captureAll({
          projectPath,
          outDir,
          device: device as DeviceProfileId | undefined,
          captureMode: captureMode as CaptureMode,
          includeCandidates,
          mockSeed,
          variants,
          overlay: overlay as "confidence" | undefined,
        });

        // 이미지 다수: content 배열로 반환
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [
          {
            type: "text",
            text: JSON.stringify(
              {
                screens: screens.map((s) => ({
                  screenId: s.screenId,
                  pngPath: s.pngPath,
                  tierUsed: s.tierUsed,
                  confidence: s.confidence,
                })),
                report: {
                  overallConfidence: report.overallConfidence,
                  limitations: report.limitations,
                  failures: report.failures,
                },
              },
              null,
              2
            ),
          },
        ];

        for (const s of screens) {
          try {
            const base64 = pngToBase64(s.pngPath);
            content.push({ type: "image", data: base64, mimeType: "image/png" });
          } catch {
            // 개별 이미지 로드 실패 → 건너뜀
          }
        }

        return { content };
      } catch (e) {
        return errorContent(await handleWasmError(e, "capture_all"));
      }
    }
  );

  // ── 7. get_analysis_report ───────────────────────────────────────

  server.tool(
    "get_analysis_report",
    "프로젝트 전체 분석 리포트를 반환한다 (frameworks, screens, overallConfidence, limitations)",
    {
      projectPath: z.string().min(1),
    },
    async ({ projectPath }) => {
      try {
        validateProjectPath(projectPath);

        const [detectResult, screenList] = await Promise.all([
          detectFramework(projectPath),
          listScreens({ projectPath, includeCandidates: true }).catch(() => []),
        ]);

        // confidence: screen confidence 평균
        const screenConfs = screenList.map((s) => s.confidence ?? 0.5);
        const overallConfidence =
          screenConfs.length > 0
            ? screenConfs.reduce((a, b) => a + b, 0) / screenConfs.length
            : 0;

        const report = {
          frameworks: detectResult.frameworks,
          screens: screenList,
          overallConfidence,
          limitations: [
            "Tier 2는 픽셀 퍼펙트가 아닌 구조적 근사입니다",
            "동적 데이터, 차트, 지도, 애니메이션은 placeholder/근사 처리됩니다",
            "코드 생성(build_runner 등) 의존 UI는 누락될 수 있습니다",
          ],
        };

        return {
          content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        };
      } catch (e) {
        debugLogError(e, "get_analysis_report");
        return errorContent(wrapError(e));
      }
    }
  );

  // ── 8. generate_app_map ───────────────────────────────────────────

  server.tool(
    "generate_app_map",
    "프로젝트의 화면 구조와 네비게이션 그래프를 분석해 AppMap을 반환한다. " +
    "includeLayout=false로 Chromium 기반 좌표 측정을 비활성화할 수 있다 (기본 true). " +
    "write=true + outDir 지정 시 파일로 저장하고 writtenPaths만 반환한다 (응답 크기 절약).",
    {
      projectPath: z.string().min(1),
      framework: z.enum(["flutter", "react-native", "ios", "android"]).optional(),
      includeLayout: z.boolean().optional(),
      maxCharsPerDoc: z.number().int().positive().optional(),
      write: z.boolean().optional(),
      outDir: z.string().optional(),
    },
    async ({ projectPath, framework, includeLayout, maxCharsPerDoc, write, outDir }) => {
      try {
        validateProjectPath(projectPath);

        // write=true인데 outDir 누락
        if (write === true && !outDir) {
          return errorContent("write=true로 파일을 저장하려면 outDir을 지정해야 합니다.");
        }

        if (write === true && outDir) {
          // write 오버로드: 파일 저장 후 writtenPaths + 요약만 반환 (문서 본문 미포함)
          const result = await generateAppMap({
            projectPath,
            ...(framework ? { framework: framework as FrameworkId } : {}),
            ...(includeLayout !== undefined ? { includeLayout } : {}),
            write: true,
            outDir,
            ...(maxCharsPerDoc !== undefined ? { maxCharsPerDoc } : {}),
          });

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    appMap: result.appMap,
                    writtenPaths: result.writtenPaths,
                    fileCount: result.writtenPaths.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // 기존 동작: AppMap + 문서 본문 모두 반환
        const appMap = await generateAppMap({
          projectPath,
          ...(framework ? { framework: framework as FrameworkId } : {}),
          ...(includeLayout !== undefined ? { includeLayout } : {}),
        });

        const docs = renderAppMapMarkdown(appMap, {
          ...(maxCharsPerDoc !== undefined ? { maxChars: maxCharsPerDoc } : {}),
        });
        const summaryContent = {
          type: "text" as const,
          text: JSON.stringify(
            {
              appMap,
              documentCount: docs.length,
              fileNames: docs.map((d) => d.fileName),
            },
            null,
            2
          ),
        };

        const docContents = docs.map((doc) => ({
          type: "text" as const,
          text: `# ${doc.fileName}\n\n${doc.content}`,
        }));

        return { content: [summaryContent, ...docContents] };
      } catch (e) {
        return errorContent(await handleWasmError(e, "generate_app_map"));
      }
    }
  );

  // ── 9. run_e2e_test ──────────────────────────────────────────────
  // 주의: 이 툴은 에뮬레이터 부팅 + 앱 빌드 + 에이전트 실행으로 수 분~수십 분 소요됩니다.

  server.tool(
    "run_e2e_test",
    "Android 에뮬레이터 / iOS 시뮬레이터에서 LLM 에이전트로 E2E 테스트를 실행한다. " +
    "에뮬레이터 부팅 + 앱 빌드 + 에이전트 실행으로 수 분~수십 분 소요될 수 있습니다. " +
    "scenarioPath에 디렉토리를 전달하면 *.md 파일을 일괄 실행(suite)한다.",
    {
      projectPath: z.string().min(1),
      platform: z.enum(["android", "ios"]),
      agent: z.enum(["claude", "codex", "gemini"]).optional().default("claude"),
      scenarioPath: z.string().optional(),
      apiKey: z.string().optional(),
      deviceId: z.string().optional(),
      outDir: z.string().optional(),
      timeoutMs: z.number().int().positive().optional(),
      maxSteps: z.number().int().positive().optional(),
      keepBooted: z.boolean().optional().default(false),
      /** M8: 크래시 감지 시 fail 강등 여부 (기본 true) */
      failOnCrash: z.boolean().optional().default(true),
      /** M11: 이전 빌드 캐시 재사용 */
      reuseBuild: z.boolean().optional().default(false),
      /** M11: 빌드 없이 캐시 artifact만 사용 */
      noBuild: z.boolean().optional().default(false),
      /** M11: 시나리오 permissions 자동 grant */
      grantPermissions: z.boolean().optional(),
      /** M11: 비디오 녹화 */
      recordVideo: z.boolean().optional().default(false),
    },
    async ({ projectPath, platform, agent, scenarioPath, apiKey, deviceId, outDir, timeoutMs, maxSteps, keepBooted, failOnCrash, reuseBuild, noBuild, grantPermissions, recordVideo }) => {
      try {
        validateProjectPath(projectPath);

        // scenarioPath가 디렉토리이면 runE2eSuite, 아니면 runE2eTest
        const scenarioIsDir =
          scenarioPath !== undefined &&
          (() => {
            try {
              return fs.statSync(scenarioPath).isDirectory();
            } catch {
              return false;
            }
          })();

        const sdk = await import("@karax/sdk");

        const commonOpts = {
          projectPath,
          platform,
          agent,
          apiKey,
          deviceId,
          outDir,
          timeoutMs,
          maxSteps,
          keepBooted,
          failOnCrash,
          // M11
          reuseBuild,
          noBuild,
          ...(grantPermissions !== undefined ? { grantPermissions } : {}),
          recordVideo,
          // Phase C: KARAX_DEBUG 환경변수 기반 debug 전파
          debug: process.env["KARAX_DEBUG"] === "1",
        };

        if (scenarioIsDir && scenarioPath) {
          // suite 실행 — 시나리오별 요약 응답
          const suiteResult = await sdk.runE2eSuite({ ...commonOpts, scenarioPath });

          const summaryLines = [
            `E2E 스위트 결과: ${suiteResult.outcome}`,
            `요약: ${suiteResult.summary}`,
            "",
            "시나리오별 결과:",
            ...suiteResult.results.map((r) => {
              const icon =
                r.result.outcome === "pass" ? "✓" :
                r.result.outcome === "fail" ? "✗" :
                r.result.outcome === "partial" ? "~" : "!";
              return `  ${icon} ${path.basename(r.scenarioPath)} — ${r.result.outcome}: ${r.result.summary}`;
            }),
          ].join("\n");

          return { content: [{ type: "text" as const, text: summaryLines }] };
        }

        // 단일 파일 / 시나리오 없음 → 기존 runE2eTest
        const result = await sdk.runE2eTest({ ...commonOpts, scenarioPath });

        // 응답: 요약 텍스트 + 리포트 경로 + 최종 스크린샷 소량 base64
        const summaryLines = [
          `E2E 테스트 결과: ${result.outcome}`,
          `요약: ${result.summary}`,
          `리포트: ${result.reportJsonPath}`,
          `스크린샷 디렉토리: ${result.screenshotsDir}`,
          `스텝 수: ${result.steps.length}`,
        ];

        // M8: findings/coverage/crash 요약 추가
        if (result.findings && result.findings.length > 0) {
          summaryLines.push(`발견사항: ${result.findings.length}건 (critical: ${result.findings.filter((f) => f.severity === "critical").length}건)`);
        }
        if (result.coverage) {
          const pct = (result.coverage.coverageRatio * 100).toFixed(0);
          summaryLines.push(`커버리지: ${result.coverage.visitedScreens}/${result.coverage.totalScreens} (${pct}%)`);
        }
        if (result.crashes && result.crashes.length > 0) {
          summaryLines.push(`크래시: ${result.crashes.length}건 감지`);
        }

        const summaryText = summaryLines.join("\n");

        // 마지막 스크린샷 1개만 base64로 포함 (응답 크기 제한)
        const lastScreenshot = result.steps
          .slice()
          .reverse()
          .find((s) => s.screenshot);

        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
          { type: "text", text: summaryText },
        ];

        if (lastScreenshot?.screenshot) {
          // 이중 방어: path traversal 차단 — screenshotsDir 밖 경로는 첨부 생략
          const resolvedScreenshot = path.resolve(result.screenshotsDir, lastScreenshot.screenshot);
          const screenshotsDirNormalized = path.resolve(result.screenshotsDir) + path.sep;
          const isSafe = resolvedScreenshot.startsWith(screenshotsDirNormalized);
          if (isSafe) {
            try {
              const base64 = pngToBase64(resolvedScreenshot);
              content.push({ type: "image", data: base64, mimeType: "image/png" });
            } catch {
              // 스크린샷 첨부 실패는 무시
            }
          }
        }

        return { content };
      } catch (e) {
        return errorContent(await handleWasmError(e, "run_e2e_test"));
      }
    }
  );

  return server;
}

// ── 진입점 (stdio 모드) ───────────────────────────────────────────────

export async function startStdioServer(): Promise<void> {
  if (process.env.KARAX_SKIP_ENSURE !== "1") {
    try {
      await ensureDependencies();
    } catch (e) {
      // 의존성 설치 실패 시 서버는 계속 기동한다.
      // 네트워크 불필요 도구(detect_framework/doctor/list_screens/get_screen_ir)는 정상 동작하며,
      // 캡처 도구 호출 시점에 ensureDependencies가 재시도된다.
      process.stderr.write(
        `[karax-mcp] 경고: 의존성 자동 설치 실패 — 캡처 시 재시도됨. 원인: ${e instanceof Error ? e.message : String(e)}\n`
      );
    }
  }

  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
