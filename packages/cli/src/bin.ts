#!/usr/bin/env node
/**
 * karax CLI — 진입점
 *
 * 종료 코드:
 *   0 — 성공
 *   1 — 실패 (에러 / 잘못된 인수)
 *   2 — 부분 실패 (일부 화면 캡처 실패)
 */

import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  EXIT_CODES,
  parseDetectArgs,
  parseDoctorArgs,
  parseListArgs,
  parseCaptureArgs,
  parseMcpConfigArgs,
} from "./commands.js";
import type { DeviceProfileId } from "@karax/sdk";

// repo 루트: packages/cli/dist/bin.js → ../../../ (= repo root)
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "../../..");

// SDK 는 커맨드 핸들러에서 동적으로 import (초기 로드 최소화)

const VERSION = "0.0.1";

const program = new Command("karax");
program.version(VERSION, "-V, --version", "버전 출력");
program.description("소스코드 기반 앱 스크린샷 추출 도구");

// ─── detect ───────────────────────────────────────────────────────

program
  .command("detect <path>")
  .description("프로젝트의 프레임워크 후보를 감지해 테이블로 출력한다")
  .action(async (pathArg: string) => {
    try {
      parseDetectArgs([pathArg]); // 파싱 검증용
      const { detectFramework } = await import("@karax/sdk");
      const result = await detectFramework(pathArg);

      if (result.frameworks.length === 0) {
        console.error("프레임워크를 감지하지 못했습니다.");
        process.exit(EXIT_CODES.FAILURE);
        return;
      }

      // 테이블 출력
      console.log("\n프레임워크 감지 결과:\n");
      console.log(
        String("프레임워크").padEnd(20) +
          String("confidence").padEnd(14) +
          "evidence"
      );
      console.log("─".repeat(60));
      for (const fw of result.frameworks) {
        const conf = (fw.confidence * 100).toFixed(0) + "%";
        const evidence = fw.evidence.slice(0, 3).join(", ");
        console.log(
          String(fw.id).padEnd(20) + conf.padEnd(14) + evidence
        );
      }
      console.log("");
      process.exit(EXIT_CODES.SUCCESS);
    } catch (e) {
      console.error("오류:", e instanceof Error ? e.message : String(e));
      process.exit(EXIT_CODES.FAILURE);
    }
  });

// ─── doctor ───────────────────────────────────────────────────────

program
  .command("doctor [path]")
  .description("환경을 진단하고 프레임워크별 가용 티어를 출력한다")
  .option("--fix", "설치 가능한 의존성을 자동 설치", false)
  .action(async (pathArg: string | undefined, opts: { fix: boolean }) => {
    try {
      const { doctor, doctorFix } = await import("@karax/sdk");
      const report = opts.fix
        ? await doctorFix(await doctor(pathArg))
        : await doctor(pathArg);

      // checks 테이블
      console.log("\n환경 진단 결과:\n");
      console.log(
        String("항목").padEnd(28) +
          String("상태").padEnd(12) +
          "자동설치"
      );
      console.log("─".repeat(55));

      for (const c of report.checks) {
        const status =
          c.status === "ok" ? "✓ ok" : c.status === "missing" ? "✗ missing" : "? warn";
        const auto = c.autoInstallable ? "가능" : "수동";
        console.log(String(c.id).padEnd(28) + String(status).padEnd(12) + auto);
      }

      // 가용 티어 요약
      console.log("\n가용 티어:");
      const t = report.tiersAvailable;
      console.log(
        `  flutter: tier1(compile)=${t.flutter.tier1 ? "✓" : "✗"}  tier2(static)=${t.flutter.tier2 ? "✓" : "✗"}`
      );
      console.log("");

      process.exit(
        report.overallOk ? EXIT_CODES.SUCCESS : EXIT_CODES.PARTIAL_FAILURE
      );
    } catch (e) {
      console.error("오류:", e instanceof Error ? e.message : String(e));
      process.exit(EXIT_CODES.FAILURE);
    }
  });

// ─── list ─────────────────────────────────────────────────────────

program
  .command("list <path>")
  .description("프로젝트의 화면 목록을 정적 분석으로 출력한다")
  .option("--include-candidates", "라우트 미연결 후보 화면 포함 (기본 on)")
  .option("--no-candidates", "후보 화면 제외")
  .option("--json", "JSON 형식으로 출력", false)
  .action(
    async (
      pathArg: string,
      opts: { includeCandidates?: boolean; candidates?: boolean; json: boolean }
    ) => {
      try {
        const listOpts = parseListArgs([
          pathArg,
          ...(opts.candidates === false ? ["--no-candidates"] : []),
          ...(opts.includeCandidates === true ? ["--include-candidates"] : []),
          ...(opts.json ? ["--json"] : []),
        ]);

        const { listScreens } = await import("@karax/sdk");
        const screens = await listScreens({
          projectPath: listOpts.path,
          includeCandidates: listOpts.includeCandidates,
        });

        if (listOpts.json) {
          console.log(JSON.stringify(screens, null, 2));
        } else {
          console.log(`\n화면 목록 (${screens.length}개):\n`);
          console.log(
            String("ID").padEnd(32) +
              String("discovery").padEnd(14) +
              String("confidence").padEnd(12) +
              "sourceRef"
          );
          console.log("─".repeat(75));
          for (const s of screens) {
            const conf = (s.confidence * 100).toFixed(0) + "%";
            const ref = s.sourceRef ? `${s.sourceRef.file}:${s.sourceRef.line}` : "";
            console.log(
              String(s.id).padEnd(32) +
                String(s.discovery).padEnd(14) +
                conf.padEnd(12) +
                ref
            );
          }
          console.log("");
        }

        process.exit(EXIT_CODES.SUCCESS);
      } catch (e) {
        console.error("오류:", e instanceof Error ? e.message : String(e));
        process.exit(EXIT_CODES.FAILURE);
      }
    }
  );

// ─── capture ──────────────────────────────────────────────────────

program
  .command("capture <path>")
  .description("화면을 캡처해 PNG로 저장한다")
  .option("--screen <id>", "캡처할 화면 ID (없으면 전체)")
  .option("--device <id>", "디바이스 프로파일 ID")
  .option("--mode <mode>", "캡처 모드: auto|compile|static", "auto")
  .option("--out <dir>", "출력 디렉토리", "/tmp/karax-out")
  .option("--seed <n>", "mock 결정론 시드 (숫자)")
  .option("--json", "JSON 형식으로 출력", false)
  .option("--variants", "Branch 분기별 variant PNG 추가 생성 (Tier 2 전용)", false)
  .option("--overlay", "confidence < 0.5 노드 오버레이 PNG 추가 생성", false)
  .action(
    async (
      pathArg: string,
      opts: {
        screen?: string;
        device?: string;
        mode: string;
        out: string;
        seed?: string;
        json: boolean;
        variants: boolean;
        overlay: boolean;
      }
    ) => {
      try {
        // 파싱 검증 (mode 유효성 포함)
        const args = parseCaptureArgs([
          pathArg,
          ...(opts.screen ? ["--screen", opts.screen] : []),
          ...(opts.device ? ["--device", opts.device] : []),
          "--mode",
          opts.mode,
          "--out",
          opts.out,
          ...(opts.seed !== undefined ? ["--seed", opts.seed] : []),
          ...(opts.json ? ["--json"] : []),
          ...(opts.variants ? ["--variants"] : []),
          ...(opts.overlay ? ["--overlay"] : []),
        ]);

        const { captureScreen, captureAll } = await import("@karax/sdk");
        const outDir = args.out ?? "/tmp/karax-out";

        if (args.screen) {
          // 단일 화면 캡처
          const result = await captureScreen({
            projectPath: args.path,
            screenId: args.screen,
            device: args.device as DeviceProfileId | undefined,
            captureMode: args.mode,
            outDir,
            mockSeed: args.seed,
            variants: args.variants,
            overlay: args.overlay ? "confidence" : undefined,
          });

          if (args.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(`\n캡처 완료:\n`);
            console.log(`  화면:       ${result.screenId}`);
            console.log(`  경로:       ${result.pngPath}`);
            console.log(`  크기:       ${result.width}×${result.height}`);
            console.log(`  티어:       ${result.tierUsed}`);
            console.log(`  confidence: ${(result.confidence * 100).toFixed(1)}%\n`);
          }

          process.exit(EXIT_CODES.SUCCESS);
        } else {
          // 전체 화면 캡처
          const { screens, report } = await captureAll({
            projectPath: args.path,
            device: args.device as DeviceProfileId | undefined,
            captureMode: args.mode,
            outDir,
            mockSeed: args.seed,
            includeCandidates: true,
            variants: args.variants,
            overlay: args.overlay ? "confidence" : undefined,
          });

          // 실제 캡처 실패가 있을 때만 PARTIAL_FAILURE (exit 2)
          const hasFailures = report.failures.length > 0;
          let exitCode: number = hasFailures
            ? EXIT_CODES.PARTIAL_FAILURE
            : EXIT_CODES.SUCCESS;

          if (args.json) {
            console.log(JSON.stringify({ screens, report }, null, 2));
          } else {
            console.log(`\n캡처 결과 (${screens.length}개 화면):\n`);
            console.log(
              String("화면 ID").padEnd(32) +
                String("티어").padEnd(10) +
                String("confidence").padEnd(12) +
                "경로"
            );
            console.log("─".repeat(80));
            for (const s of screens) {
              const conf = (s.confidence * 100).toFixed(1) + "%";
              console.log(
                String(s.screenId).padEnd(32) +
                  String(s.tierUsed).padEnd(10) +
                  conf.padEnd(12) +
                  s.pngPath
              );
            }
            if (hasFailures) {
              console.log("\n주의사항 (부분 실패):");
              for (const id of report.failures) {
                const lim = report.limitations.find((l) => l.startsWith(`${id}:`));
                console.log(`  ⚠ ${lim ?? id}`);
              }
            }
            if (report.limitations.length > 0) {
              console.log("\n한계 안내:");
              for (const lim of report.limitations) {
                console.log(`  ℹ ${lim}`);
              }
            }
            console.log(
              `\n전체 confidence: ${(report.overallConfidence * 100).toFixed(1)}%\n`
            );
          }

          process.exit(exitCode);
        }
      } catch (e) {
        console.error("오류:", e instanceof Error ? e.message : String(e));
        process.exit(EXIT_CODES.FAILURE);
      }
    }
  );

// ─── mcp-config / mcp install-config ─────────────────────────────
// PLAN 7절은 'karax mcp install-config'로 명시하고 있어 별칭으로도 동작하게 한다.

function runMcpConfig(): void {
  parseMcpConfigArgs([]);
  // git clone 기반 런처 — npm 배포 없이 사용 가능
  const launcherPath = join(REPO_ROOT, "scripts/mcp-launcher.mjs");
  const snippet = {
    mcpServers: {
      karax: {
        command: "node",
        args: [launcherPath],
      },
    },
  };
  console.log(JSON.stringify(snippet, null, 2));
  process.exit(EXIT_CODES.SUCCESS);
}

program
  .command("mcp-config")
  .description("MCP 클라이언트 설정 스니펫(JSON)을 출력한다")
  .action(() => {
    try {
      runMcpConfig();
    } catch (e) {
      console.error("오류:", e instanceof Error ? e.message : String(e));
      process.exit(EXIT_CODES.FAILURE);
    }
  });

// PLAN 7절 명칭 호환 별칭: karax mcp install-config
const mcpCmd = program.command("mcp").description("MCP 관련 유틸리티 커맨드");
mcpCmd
  .command("install-config")
  .description("MCP 클라이언트 설정 스니펫(JSON)을 출력한다 (karax mcp-config의 별칭)")
  .action(() => {
    try {
      runMcpConfig();
    } catch (e) {
      console.error("오류:", e instanceof Error ? e.message : String(e));
      process.exit(EXIT_CODES.FAILURE);
    }
  });

// ─── 알 수 없는 커맨드 처리 ───────────────────────────────────────

program.on("command:*", () => {
  console.error(`오류: 알 수 없는 커맨드 '${program.args.join(" ")}'.`);
  console.error("사용법: karax --help");
  process.exit(EXIT_CODES.FAILURE);
});

// ─── 실행 ─────────────────────────────────────────────────────────

program.parseAsync(process.argv).catch((e) => {
  console.error("오류:", e instanceof Error ? e.message : String(e));
  process.exit(EXIT_CODES.FAILURE);
});
