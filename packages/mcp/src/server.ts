/**
 * @sfc/mcp — MCP 서버 구현 (PLAN.md 9절)
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
} from "@sfc/sdk";
import type { FrameworkId, DeviceProfileId, CaptureMode } from "@sfc/sdk";

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
 * projectPath 존재 여부를 검증한다.
 * 빈 문자열, 비정상적인 경로도 여기서 탐지.
 */
function validateProjectPath(projectPath: string): void {
  if (!projectPath || projectPath.trim().length === 0) {
    throw new Error("projectPath가 비어있습니다");
  }
  if (!fs.existsSync(projectPath)) {
    throw new Error(`경로를 찾을 수 없습니다: ${projectPath}`);
  }
}

// ── PNG → base64 ──────────────────────────────────────────────────────

function pngToBase64(pngPath: string): string {
  const buf = fs.readFileSync(pngPath);
  return buf.toString("base64");
}

// ── 사이드카 경로 ─────────────────────────────────────────────────────
// captureEngine은 사이드카를 outDir/<screenId>.report.json으로 기록한다.
// pngPath는 디바이스 접미사가 붙어(e.g. HomeScreen_iphone-15.png) screenId와 다를 수 있으므로
// screenId를 직접 사용해 outDir/<screenId>.report.json을 계산한다.

function sidecarPath(pngPath: string, screenId: string): string {
  return path.join(path.dirname(pngPath), `${screenId}.report.json`);
}

// ── McpServer 팩토리 ──────────────────────────────────────────────────

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "@sfc/mcp", version: "0.0.1" },
    {
      capabilities: { tools: {} },
      instructions:
        "소스코드를 분석해 앱 화면 스크린샷을 추출하는 MCP 서버. " +
        "Flutter(M4까지 구현), 향후 RN/iOS/Android 지원 예정.",
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
        return errorContent(wrapError(e));
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
        return errorContent(wrapError(e));
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
        const resolvedOutDir = outDir ?? "/tmp/sfc-out";

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
        const sidecar = sidecarPath(result.pngPath, result.screenId);
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
        return errorContent(wrapError(e));
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
        return errorContent(wrapError(e));
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
        return errorContent(wrapError(e));
      }
    }
  );

  return server;
}

// ── 진입점 (stdio 모드) ───────────────────────────────────────────────

export async function startStdioServer(): Promise<void> {
  if (process.env.SFC_SKIP_ENSURE !== "1") {
    await ensureDependencies();
  }

  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
