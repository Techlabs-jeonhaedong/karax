/**
 * @karax/e2e — public API
 *
 * 파이프라인:
 * detect framework → parse scenario → ensureBooted → build → install+launch
 * → spawnAgent(검증/재시도) → report 작성 → (옵션) shutdown
 */

import fs from "fs";
import path from "path";
import { E2eError } from "./types.js";
import type {
  RunE2eTestOptions,
  E2eTestResult,
  Platform,
} from "./types.js";
import { createSessionDir } from "./session.js";
import { parseScenario } from "./scenario/parse.js";
import { createDeviceManager } from "./device/index.js";
import { selectBuilder } from "./build/index.js";
import { buildAgentInvocation } from "./agent/args.js";
import { buildAgentPrompt } from "./agent/prompt.js";
import { runAgent } from "./agent/runner.js";
import { writeReport } from "./report/write.js";
import type { E2eReport } from "./report/schema.js";
import { sanitizeScreenshotPath } from "./report/sanitize.js";

export type { RunE2eTestOptions, E2eTestResult, Platform };
export { E2eError, E2E_ERROR_CODES } from "./types.js";
export type { E2eErrorCode, AgentKind } from "./types.js";

/**
 * E2E 테스트를 실행하고 결과를 반환한다.
 */
export async function runE2eTest(opts: RunE2eTestOptions): Promise<E2eTestResult> {
  const {
    projectPath,
    platform,
    scenarioPath,
    agent = "claude",
    apiKey,
    deviceId,
    outDir = "/tmp/karax-e2e-out",
    timeoutMs = 900_000,
    maxSteps = 20,
    keepBooted = false,
  } = opts;

  const startTime = Date.now();
  const session = createSessionDir(outDir);

  // 시나리오 파싱
  let scenario: { body: string; exploratory: boolean; appId?: string; platform?: Platform } = { body: "", exploratory: true };
  if (scenarioPath) {
    try {
      // 파일인지 확인 및 크기 상한(1MB) 검사
      const stat = fs.statSync(scenarioPath);
      if (!stat.isFile()) {
        throw new E2eError("SCENARIO_PARSE_ERROR", `scenarioPath가 파일이 아닙니다: ${scenarioPath}`);
      }
      const MAX_SCENARIO_SIZE = 1 * 1024 * 1024; // 1MB
      if (stat.size > MAX_SCENARIO_SIZE) {
        throw new E2eError("SCENARIO_PARSE_ERROR", `시나리오 파일이 너무 큽니다 (최대 1MB): ${stat.size} bytes`);
      }
      const content = fs.readFileSync(scenarioPath, "utf-8");
      scenario = parseScenario(content);
    } catch (e) {
      const errResult = makeErrorResult(session, startTime, platform, agent, scenarioPath, e);
      return errResult;
    }
  }

  let deviceManager: Awaited<ReturnType<typeof createDeviceManager>> | null = null;
  let boostedByUs = false;

  try {
    // 프레임워크 감지 (실패해도 일단 진행, builder가 에러 처리)
    const framework = detectFrameworkFromPath(projectPath);

    // 디바이스 매니저 생성
    deviceManager = await createDeviceManager(platform);

    // 디바이스 부팅 확인
    const deviceInfo = await deviceManager.ensureBooted(deviceId);
    boostedByUs = true;

    // 빌드
    const builder = selectBuilder(framework, platform);
    const buildResult = await builder.build(projectPath);

    // 설치
    await deviceManager.install(deviceInfo.id, buildResult.artifactPath);

    // 실행
    const resolvedAppId = scenario.appId ?? buildResult.appId;
    await deviceManager.launch(deviceInfo.id, resolvedAppId);

    // 에이전트 프롬프트 생성
    const prompt = buildAgentPrompt({
      platform,
      deviceId: deviceInfo.id,
      appId: resolvedAppId,
      screenshotsDir: session.screenshotsDir,
      maxSteps,
      exploratory: scenario.exploratory,
      scenarioBody: scenario.exploratory ? undefined : scenario.body,
    });

    // 에이전트 호출 인수 구성
    const invocation = buildAgentInvocation(agent, { prompt, apiKey });

    // 에이전트 실행
    const agentResult = await runAgent(invocation, session.screenshotsDir, { timeoutMs });

    const durationMs = Date.now() - startTime;

    // screenshot 경로 sanitize — path traversal 방어
    const sanitizedSteps = agentResult.steps.map((step) => {
      if (!step.screenshot) return step;
      const safe = sanitizeScreenshotPath(session.screenshotsDir, step.screenshot);
      if (safe === null) {
        // 탈출 감지: screenshot 필드 제거, 스텝 자체는 유지
        const { screenshot: _dropped, ...rest } = step;
        return rest;
      }
      return step;
    });

    // 리포트 작성
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath,
      platform,
      agent,
      scenarioPath,
      outcome: agentResult.outcome,
      summary: agentResult.summary,
      steps: sanitizedSteps,
      screenshotsDir: session.screenshotsDir,
      durationMs,
      createdAt: new Date().toISOString(),
    };

    const { reportJsonPath, reportMdPath } = writeReport(session.dir, report);

    // 선택적 shutdown
    if (!keepBooted && deviceManager.shutdown) {
      await deviceManager.shutdown(deviceInfo.id).catch(() => {
        // 종료 실패는 무시
      });
    }

    return {
      outcome: agentResult.outcome,
      sessionDir: session.dir,
      reportJsonPath,
      reportMdPath,
      screenshotsDir: session.screenshotsDir,
      summary: agentResult.summary,
      steps: sanitizedSteps,
    };
  } catch (e) {
    // 인프라 에러 → outcome: "error"로 리포트 작성
    const errResult = makeErrorResult(session, startTime, platform, agent, scenarioPath, e);

    // 선택적 shutdown (에러 경우에도)
    if (!keepBooted && deviceManager?.shutdown && deviceManager.platform === platform) {
      await deviceManager.shutdown(deviceId ?? "").catch(() => {
        // 무시
      });
    }

    return errResult;
  }
}

// ── 유틸 ──────────────────────────────────────────────────────────

function detectFrameworkFromPath(projectPath: string): "flutter" | "react-native" | "android" | "ios" {
  // pubspec.yaml → flutter
  if (fs.existsSync(path.join(projectPath, "pubspec.yaml"))) return "flutter";
  // package.json + react-native → react-native
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
      const deps = { ...((pkg["dependencies"] as object) ?? {}), ...((pkg["devDependencies"] as object) ?? {}) };
      if ("react-native" in deps) return "react-native";
    } catch {
      // ignore
    }
  }
  // build.gradle → android
  if (
    fs.existsSync(path.join(projectPath, "build.gradle")) ||
    fs.existsSync(path.join(projectPath, "build.gradle.kts"))
  ) return "android";
  // *.xcodeproj / *.xcworkspace → ios
  try {
    for (const entry of fs.readdirSync(projectPath)) {
      if (entry.endsWith(".xcodeproj") || entry.endsWith(".xcworkspace")) return "ios";
    }
  } catch {
    // ignore
  }
  // 기본값: android
  return "android";
}

function makeErrorResult(
  session: { dir: string; screenshotsDir: string; sessionId: string },
  startTime: number,
  platform: Platform,
  agent: string,
  scenarioPath: string | undefined,
  e: unknown
): E2eTestResult {
  const durationMs = Date.now() - startTime;
  const isE2eError = e instanceof E2eError;
  const errorCode = isE2eError ? e.code : "UNKNOWN";
  const errorMessage = e instanceof Error ? e.message : String(e);

  const report: E2eReport = {
    sessionId: session.sessionId,
    projectPath: "",
    platform,
    agent,
    scenarioPath,
    outcome: "error",
    summary: errorMessage,
    steps: [],
    screenshotsDir: session.screenshotsDir,
    durationMs,
    createdAt: new Date().toISOString(),
    errorCode,
    errorMessage,
  };

  const { reportJsonPath, reportMdPath } = writeReport(session.dir, report);

  return {
    outcome: "error",
    sessionDir: session.dir,
    reportJsonPath,
    reportMdPath,
    screenshotsDir: session.screenshotsDir,
    summary: errorMessage,
    steps: [],
  };
}
