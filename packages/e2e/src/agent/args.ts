/**
 * agent/args.ts — 순수 함수: CLI별 argv+env 구성
 *
 * 플래그 검증 결과:
 * - claude: -p, --output-format json, --allowedTools "Bash"
 *   headless -p 모드에서 allowedTools에 지정된 도구는 자동 허용, 그 외 차단됨.
 *   // VERIFY: 실제 claude CLI 버전에서 --allowedTools 단독 동작 확인 필요
 * - codex: exec <prompt> --full-auto 확인됨 (codex exec --help 2026-06-05 기준)
 *   // NOTE: codex --full-auto는 자율 실행 모드임. 더 제한적인 대안 없음.
 * - gemini: -p <prompt> --yolo 확인됨 (gemini --help 2026-06-05 기준)
 *   // NOTE: gemini --yolo는 자율 실행 모드임. 더 제한적인 대안 없음.
 */

import type { AgentKind, AgentInvocation, AgentRunOptions } from "./types.js";
import { E2eError } from "../types.js";

/**
 * screenshotsDir 절대경로가 안전한지 검증한다.
 * - 절대경로여야 한다 (슬래시로 시작)
 * - 허용 문자: ^[A-Za-z0-9_./:\-]+$ (공백, 세미콜론, 백틱, 개행 등 금지)
 *
 * 위반 시 E2eError("INVALID_ARGUMENT")를 throw한다.
 * screenshotsDir은 세션 코드가 생성한 신뢰 경로이므로, 위반은 버그 신호 — 안전 폴백 없이 throw.
 */
export function assertSafePathArg(dir: string): void {
  if (!dir || !dir.startsWith("/") || !/^[A-Za-z0-9_./:@\-]+$/.test(dir)) {
    throw new E2eError(
      "INVALID_ARGUMENT",
      `screenshotsDir가 유효하지 않습니다: "${dir}". 절대경로이고 안전 문자([A-Za-z0-9_./:-])만 허용됩니다.`
    );
  }
}

/**
 * 에이전트 서브프로세스에 전달할 최소 env를 구성한다.
 *
 * 보안 원칙:
 * - process.env를 통째로 전파하지 않는다 (GITHUB_TOKEN, AWS_*, 타사 API 키 등 시크릿 노출 방지)
 * - 에이전트 CLI 구동에 필요한 최소 키만 명시적으로 선택한다
 * - 선택된 에이전트의 API 키 1개만 주입한다
 */
function buildMinimalEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  // 필수 셸 환경
  if (process.env["PATH"]) env["PATH"] = process.env["PATH"];
  if (process.env["HOME"]) env["HOME"] = process.env["HOME"];
  if (process.env["TMPDIR"]) env["TMPDIR"] = process.env["TMPDIR"];
  if (process.env["SHELL"]) env["SHELL"] = process.env["SHELL"];

  // Android SDK (adb 사용 에이전트를 위해)
  if (process.env["ANDROID_HOME"]) env["ANDROID_HOME"] = process.env["ANDROID_HOME"];
  if (process.env["ANDROID_SDK_ROOT"]) env["ANDROID_SDK_ROOT"] = process.env["ANDROID_SDK_ROOT"];

  return env;
}

/**
 * 에이전트 CLI 호출 인수를 구성한다.
 * apiKey가 있을 때만 해당 에이전트의 API 키를 주입, 없으면 ambient env passthrough(구독 로그인 활용).
 * 다른 에이전트의 API 키나 GITHUB_TOKEN, AWS_* 등 시크릿은 절대 전파하지 않는다.
 */
export function buildAgentInvocation(
  kind: AgentKind,
  opts: AgentRunOptions
): AgentInvocation {
  const baseEnv = buildMinimalEnv();

  switch (kind) {
    case "claude": {
      const env = { ...baseEnv };
      if (opts.apiKey) {
        // apiKey 명시 시: 해당 키만 주입
        env["ANTHROPIC_API_KEY"] = opts.apiKey;
      } else {
        // apiKey 없음: ambient env의 ANTHROPIC_API_KEY만 passthrough (구독 로그인 활용)
        if (process.env["ANTHROPIC_API_KEY"]) {
          env["ANTHROPIC_API_KEY"] = process.env["ANTHROPIC_API_KEY"];
        }
      }

      // screenshotsDir 있으면 스코프 제한 Read 허용
      // VERIFY: claude CLI --allowedTools에 스코프 Read 구문("Read(//<path>/**)") 동작 확인 필요.
      //   - 권한 규칙 구문: Read(//<절대경로>/**) — // 프리픽스 사용
      //   - 다중 툴: --allowedTools "Bash" --allowedTools "Read(//<path>/**)" 형식(각각 별도 argv 요소)
      //   - 실패 시 폴백: assertSafePathArg throw로 screenshotsDir 검증 실패 시 Read 없이 Bash만
      const allowedToolsArgs: string[] = ["--allowedTools", "Bash"];
      if (opts.screenshotsDir !== undefined) {
        assertSafePathArg(opts.screenshotsDir);
        // // VERIFY: --allowedTools "Read(//<path>/**)" 형식으로 각각 별도 argv 요소 전달
        allowedToolsArgs.push("--allowedTools", `Read(//${opts.screenshotsDir}/**)`);
      }

      return {
        bin: "claude",
        args: [
          "-p",
          opts.prompt,
          "--output-format",
          "json",
          ...allowedToolsArgs,
          // VERIFY: headless -p 모드에서 --allowedTools만으로 Bash 자동 허용 확인 필요.
          // --dangerously-skip-permissions 제거 — allowedTools 지정 도구만 허용하는 것이 더 제한적임.
        ],
        env,
      };
    }

    case "codex": {
      const env = { ...baseEnv };
      if (opts.apiKey) {
        env["OPENAI_API_KEY"] = opts.apiKey;
      } else {
        if (process.env["OPENAI_API_KEY"]) {
          env["OPENAI_API_KEY"] = process.env["OPENAI_API_KEY"];
        }
      }
      return {
        bin: "codex",
        // NOTE: codex --full-auto는 자율 실행 모드. 더 제한적인 대안이 없어 유지.
        args: [
          "exec",
          opts.prompt,
          "--full-auto",
        ],
        env,
      };
    }

    case "gemini": {
      const env = { ...baseEnv };
      if (opts.apiKey) {
        env["GEMINI_API_KEY"] = opts.apiKey;
      } else {
        if (process.env["GEMINI_API_KEY"]) {
          env["GEMINI_API_KEY"] = process.env["GEMINI_API_KEY"];
        }
      }
      return {
        bin: "gemini",
        // NOTE: gemini --yolo는 자율 실행 모드. 더 제한적인 대안이 없어 유지.
        args: [
          "-p",
          opts.prompt,
          "--yolo",
        ],
        env,
      };
    }
  }
}
