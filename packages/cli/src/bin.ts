#!/usr/bin/env node
/**
 * karax CLI — 진입점
 *
 * 종료 코드:
 *   0 — 성공
 *   1 — 실패 (에러 / 잘못된 인수)
 *   2 — 부분 실패 (일부 화면 캡처 실패)
 */

// ─── WASM Turboshaft 워크어라운드 self-respawn ────────────────────────
// Node v24 V8 Turboshaft가 tree-sitter-swift.wasm을 백그라운드 컴파일할 때
// Zone OOM으로 프로세스가 즉사한다 (iOS 어댑터 사용 시 100% 재현).
// packages/adapter-ios/vitest.config.ts에 동일한 워크어라운드 적용돼 있음.
// V8 플래그는 NODE_OPTIONS 허용 목록에 없어 환경 변수 전달 불가 → execArgv로만 가능.
// 플래그 없이 진입하면 자기 자신을 플래그와 함께 재실행하고 exit code를 그대로 전파.
{
  // 동적 import 대신 동기 require-style로 처리: ESM static import는 top-level await 전에 실행되므로
  // child_process와 wasmFlags를 인라인으로 가져온다.
  const { spawnSync } = await import("node:child_process");
  const { shouldRespawn, WASM_FLAGS, WASM_MARKER_ENV } = await import("./wasmFlags.js");

  // `karax ui` 서브커맨드는 정적 분석(tree-sitter WASM) 불필요 → respawn 건너뜀
  // 에이전트가 매 탭마다 호출하므로 기동 비용 절감
  const isUiSubcommand = process.argv[2] === "ui";

  if (!isUiSubcommand && shouldRespawn(process.execArgv, process.env)) {
    const result = spawnSync(
      process.execPath,
      [...WASM_FLAGS, process.argv[1], ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, [WASM_MARKER_ENV]: "1" },
      }
    );
    process.exit(result.status ?? 1);
  }
}
// ─────────────────────────────────────────────────────────────────────

import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  EXIT_CODES,
  parseDetectArgs,
  parseDoctorArgs,
  parseListArgs,
  parseCaptureArgs,
  parseMapArgs,
  parseMcpConfigArgs,
  parseTestArgs,
} from "./commands.js";
import {
  parseUiArgs,
  runUiDump,
  runUiLocate,
  runUiWhichScreen,
} from "./commands/ui.js";
import type { DeviceProfileId } from "@karax/sdk";

// repo 루트: packages/cli/dist/bin.js → ../../../ (= repo root)
// realpathSync로 symlink를 실제 경로로 정규화해 경로 우회 공격 방지
const __filename = realpathSync(fileURLToPath(import.meta.url));
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

// ─── map ──────────────────────────────────────────────────────────

program
  .command("map <path>")
  .description("프로젝트의 화면 구조와 네비게이션 그래프를 분석해 AppMap 마크다운을 생성한다")
  .option("--out <dir>", "마크다운 파일 출력 디렉토리 (기본: ./)")
  .option("--max-chars <n>", "문서 분할 기준 최대 글자 수")
  .option("--json", "JSON 형식으로 AppMap 출력", false)
  .option("--no-layout", "정적 좌표 측정 비활성화 (Chromium 미사용)")
  .option("--framework <id>", "프레임워크 강제 지정: flutter|react-native|android|ios")
  .option("--stdout", "파일 저장 없이 마크다운을 stdout으로 출력", false)
  .action(
    async (
      pathArg: string,
      opts: {
        out?: string;
        maxChars?: string;
        json: boolean;
        layout: boolean;
        framework?: string;
        stdout: boolean;
      }
    ) => {
      try {
        const args = parseMapArgs([
          pathArg,
          ...(opts.out ? ["--out", opts.out] : []),
          ...(opts.maxChars ? ["--max-chars", opts.maxChars] : []),
          ...(opts.json ? ["--json"] : []),
          ...(opts.layout === false ? ["--no-layout"] : []),
          ...(opts.framework ? ["--framework", opts.framework] : []),
          ...(opts.stdout ? ["--stdout"] : []),
        ]);

        const { generateAppMap, renderAppMapMarkdown, writeAppMapDocuments } =
          await import("@karax/sdk");

        const generateOpts = {
          projectPath: args.path,
          includeLayout: args.layout,
          ...(args.framework ? { framework: args.framework } : {}),
        };

        if (args.json) {
          // JSON 출력: AppMap 직접 반환 (기존 오버로드)
          const appMap = await generateAppMap(generateOpts);
          console.log(JSON.stringify(appMap, null, 2));
          process.exit(EXIT_CODES.SUCCESS);
          return;
        }

        if (args.stdout) {
          // --stdout: 파일 저장 없이 마크다운 본문을 stdout으로 출력
          const appMap = await generateAppMap(generateOpts);
          const docs = renderAppMapMarkdown(appMap, {
            ...(args.maxChars !== undefined ? { maxChars: args.maxChars } : {}),
          });
          const separator = "\n\n---\n\n";
          console.log(docs.map((d) => d.content).join(separator));
          process.exit(EXIT_CODES.SUCCESS);
          return;
        }

        // 파일 저장: SDK write 오버로드 사용 (중복 로직 제거)
        const outDir = args.out ?? ".";
        const result = await generateAppMap({
          ...generateOpts,
          write: true,
          outDir,
          ...(args.maxChars !== undefined ? { maxCharsPerDoc: args.maxChars } : {}),
        });

        for (const p of result.writtenPaths) {
          console.log(`생성됨: ${p}`);
        }

        console.log(
          `\n앱 지도 생성 완료 (${result.writtenPaths.length}개 파일, confidence: ${(result.appMap.overallConfidence * 100).toFixed(1)}%)\n`
        );
        process.exit(EXIT_CODES.SUCCESS);
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

// ─── test ─────────────────────────────────────────────────────────

program
  .command("test <path>")
  .description("LLM 에이전트로 E2E 테스트를 실행한다 (에뮬레이터/시뮬레이터 + 풀 빌드)")
  .requiredOption("--platform <platform>", "타겟 플랫폼: android|ios")
  .option("--scenario <file>", "시나리오 마크다운 파일 경로")
  .option("--agent <agent>", "LLM 에이전트: claude|codex|gemini", "claude")
  .option("--api-key <key>", "에이전트 API 키 (없으면 CLI 로그인 사용)")
  .option("--device <id>", "디바이스/에뮬레이터 ID")
  .option("--out <dir>", "결과 출력 디렉토리", "/tmp/karax-e2e-out")
  .option("--timeout <ms>", "에이전트 전체 타임아웃 (ms)", "900000")
  .option("--max-steps <n>", "에이전트 최대 스텝 수", "20")
  .option("--json", "JSON 형식으로 출력", false)
  .option("--keep-booted", "테스트 후 디바이스를 종료하지 않음", false)
  .action(
    async (
      pathArg: string,
      opts: {
        platform: string;
        scenario?: string;
        agent: string;
        apiKey?: string;
        device?: string;
        out: string;
        timeout: string;
        maxSteps: string;
        json: boolean;
        keepBooted: boolean;
      }
    ) => {
      try {
        const args = parseTestArgs([
          pathArg,
          "--platform", opts.platform,
          ...(opts.scenario ? ["--scenario", opts.scenario] : []),
          "--agent", opts.agent,
          ...(opts.apiKey ? ["--api-key", opts.apiKey] : []),
          ...(opts.device ? ["--device", opts.device] : []),
          "--out", opts.out,
          "--timeout", opts.timeout,
          "--max-steps", opts.maxSteps,
          ...(opts.json ? ["--json"] : []),
          ...(opts.keepBooted ? ["--keep-booted"] : []),
        ]);

        // SDK 단일 진입점 원칙 — @karax/sdk의 runE2eTest가 기본 AppMapGenerator를 주입한다
        const { runE2eTest } = await import("@karax/sdk");

        console.log(`\nE2E 테스트 시작: ${args.path} (플랫폼: ${args.platform}, 에이전트: ${args.agent})\n`);

        const result = await runE2eTest({
          projectPath: args.path,
          platform: args.platform,
          scenarioPath: args.scenario,
          agent: args.agent,
          apiKey: args.apiKey,
          deviceId: args.device,
          outDir: args.out,
          timeoutMs: args.timeout,
          maxSteps: args.maxSteps,
          keepBooted: args.keepBooted,
        });

        if (args.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const outcomeIcon = result.outcome === "pass" ? "✓" : result.outcome === "fail" ? "✗" : "!";
          console.log(`\nE2E 테스트 ${result.outcome === "pass" ? "통과" : result.outcome === "fail" ? "실패" : "오류"}:\n`);
          console.log(`  결과:       ${outcomeIcon} ${result.outcome}`);
          console.log(`  요약:       ${result.summary}`);
          console.log(`  리포트:     ${result.reportJsonPath}`);
          console.log(`  스크린샷:   ${result.screenshotsDir}`);
          console.log(`  스텝 수:    ${result.steps.length}\n`);
        }

        // 종료 코드 매핑
        // pass → 0, fail → 2 (PARTIAL_FAILURE), error → 1 (FAILURE)
        if (result.outcome === "pass") {
          process.exit(EXIT_CODES.SUCCESS);
        } else if (result.outcome === "fail") {
          process.exit(EXIT_CODES.PARTIAL_FAILURE);
        } else {
          process.exit(EXIT_CODES.FAILURE);
        }
      } catch (e) {
        console.error("오류:", e instanceof Error ? e.message : String(e));
        process.exit(EXIT_CODES.FAILURE);
      }
    }
  );

// ─── ui ───────────────────────────────────────────────────────────
// 에이전트용 결정론 헬퍼 — dump/locate/which-screen
// stdout에는 JSON 한 덩어리만 출력. 진단·로그는 stderr.

const uiCmd = program.command("ui").description("에이전트용 런타임 UI 헬퍼 (dump|locate|which-screen)");
uiCmd
  .argument("[subcommand]", "서브커맨드: dump | locate | which-screen")
  .allowUnknownOption(true)
  .action(async (_sub: string | undefined) => {
    // commander에서 나머지 argv를 수동으로 파싱
    const rawArgs = process.argv.slice(3); // ["dump", "--device", "emulator-5554", ...]
    try {
      const args = parseUiArgs(rawArgs);

      let result: unknown;

      if (args.subcommand === "dump") {
        result = await runUiDump({ device: args.device, platform: args.platform });
      } else if (args.subcommand === "locate") {
        result = await runUiLocate({
          device: args.device,
          platform: args.platform,
          label: args.label ?? "",
          appmap: args.appmap,
          screen: args.screen,
        });
      } else {
        // which-screen
        result = await runUiWhichScreen({
          device: args.device,
          platform: args.platform,
          appmap: args.appmap,
        });
      }

      const json = result as { ok: boolean; found?: boolean };

      // stdout: JSON 한 덩어리
      console.log(JSON.stringify(result));

      // exit code
      if (!json.ok) {
        process.exit(EXIT_CODES.FAILURE);
      } else if (json.ok && json.found === false) {
        // locate: 미발견 → exit 2
        process.exit(EXIT_CODES.PARTIAL_FAILURE);
      } else {
        process.exit(EXIT_CODES.SUCCESS);
      }
    } catch (e) {
      const errorResult = {
        ok: false,
        error: "INVALID_ARGUMENT",
        message: e instanceof Error ? e.message : String(e),
      };
      console.log(JSON.stringify(errorResult));
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
