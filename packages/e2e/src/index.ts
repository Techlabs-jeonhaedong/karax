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
import { generateAppMapForSession } from "./appmap/sessionAppMap.js";
import { summarizeAppMap, renderSummaryForPrompt } from "./appmap/promptSummary.js";
import { computeBudget } from "./agent/budget.js";
import { discoverScenarioFiles } from "./scenario/discover.js";
import { parseLogcatForCrashes } from "./crash/detect.js";
import type { CrashEvent } from "./crash/detect.js";
import { recoverPartialResult } from "./recovery/partial.js";
import type { Coverage } from "./report/schema.js";

export type { RunE2eTestOptions, E2eTestResult, Platform };
export { E2eError, E2E_ERROR_CODES } from "./types.js";
export type { E2eErrorCode, AgentKind } from "./types.js";
export { dumpAndroidUI } from "./runtime/dumpAndroid.js";

// ── suite 타입 ────────────────────────────────────────────────────────

export interface RunE2eSuiteOptions extends Omit<RunE2eTestOptions, "scenarioPath"> {
  /** 파일 또는 디렉토리 경로 */
  scenarioPath: string;
}

export interface E2eSuiteResult {
  /** 전체 집계: 하나라도 error→error, fail→fail, 전부 pass→pass */
  outcome: "pass" | "fail" | "error";
  results: Array<{ scenarioPath: string; result: E2eTestResult }>;
  /** "3/5 pass" 형태 */
  summary: string;
  suiteDir?: string;
}

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
    keepBooted = false,
    failOnCrash = true,
  } = opts;

  const startTime = Date.now();
  const session = createSessionDir(outDir);

  // 시나리오 파싱
  let scenario: { body: string; exploratory: boolean; appId?: string; platform?: Platform; steps?: import("./scenario/schema.js").ScenarioStep[] } = { body: "", exploratory: true };
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

    // 빌드 + AppMap 생성 병렬 실행 (AppMap 실패는 비차단)
    const builder = selectBuilder(framework, platform);
    const appMapPromise = opts.appMapGenerator
      ? generateAppMapForSession({
          projectPath,
          framework,
          platform,
          appMapDir: session.appMapDir,
          generator: opts.appMapGenerator,
        }).catch(() => null)
      : Promise.resolve(null);
    const [buildResult, sessionAppMap] = await Promise.all([
      builder.build(projectPath),
      appMapPromise,
    ]);

    // 설치
    await deviceManager.install(deviceInfo.id, buildResult.artifactPath);

    // 실행
    const resolvedAppId = scenario.appId ?? buildResult.appId;
    await deviceManager.launch(deviceInfo.id, resolvedAppId);

    // AppMap 화면 수 기반 budget 자동 조정
    const screenCount = sessionAppMap?.appMap.screens.length ?? 0;
    const budget = computeBudget({
      screenCount,
      exploratory: scenario.exploratory,
      userMaxSteps: opts.maxSteps,
      userTimeoutMs: opts.timeoutMs,
    });

    // AppMap 요약 생성 (있는 경우)
    let appMapSection: string | undefined;
    if (sessionAppMap) {
      const summary = summarizeAppMap(sessionAppMap.appMap);
      appMapSection = renderSummaryForPrompt(summary, {
        markdownIndexPath: sessionAppMap.markdownIndexPath,
        appMapJsonPath: sessionAppMap.appMapJsonPath,
      });
    }

    // M7: AppMap 화면 id 목록 → targetScreenIds (커버리지 목표)
    const targetScreenIds = sessionAppMap?.appMap.screens.map((s) => s.id);

    // 에이전트 프롬프트 생성
    const prompt = buildAgentPrompt({
      platform,
      deviceId: deviceInfo.id,
      appId: resolvedAppId,
      screenshotsDir: session.screenshotsDir,
      maxSteps: budget.maxSteps,
      exploratory: scenario.exploratory,
      scenarioBody: scenario.exploratory ? undefined : scenario.body,
      ...(appMapSection !== undefined ? { appMapSection } : {}),
      ...(sessionAppMap ? { appMapJsonPath: sessionAppMap.appMapJsonPath } : {}),
      ...(targetScreenIds && targetScreenIds.length > 0 ? { targetScreenIds } : {}),
      // M7: 구조화 스텝 — 시나리오 모드에서만 전달
      ...(!scenario.exploratory && scenario.steps ? { scenarioSteps: scenario.steps } : {}),
    });

    // 에이전트 호출 인수 구성
    const invocation = buildAgentInvocation(agent, { prompt, apiKey, screenshotsDir: session.screenshotsDir });

    // M8: 에이전트 실행 전 logcat 버퍼 클리어 (best-effort)
    if (deviceManager.clearLogcat) {
      await deviceManager.clearLogcat(deviceInfo.id).catch(() => undefined);
    }

    // 에이전트 실행 (AGENT_TIMEOUT/AGENT_OUTPUT_INVALID 시 partial 복구 경로로)
    let agentResult: Awaited<ReturnType<typeof runAgent>>;
    let isPartialRecovery = false;

    try {
      agentResult = await runAgent(invocation, session.screenshotsDir, { timeoutMs: budget.timeoutMs });
    } catch (agentErr) {
      // AGENT_TIMEOUT / AGENT_OUTPUT_INVALID → partial 복구 시도
      const isRecoverableError =
        agentErr instanceof E2eError &&
        (agentErr.code === "AGENT_TIMEOUT" || agentErr.code === "AGENT_OUTPUT_INVALID");

      if (isRecoverableError) {
        const recovered = recoverPartialResult(session.screenshotsDir);
        if (recovered !== null) {
          agentResult = recovered;
          isPartialRecovery = true;
        } else {
          throw agentErr; // 복구 불가 → 기존 에러 경로
        }
      } else {
        throw agentErr;
      }
    }

    // M8: 에이전트 종료 후 logcat 캡처 + 크래시 감지 (best-effort)
    let crashes: CrashEvent[] | undefined;
    if (deviceManager.captureLogcat) {
      const logcatText = await deviceManager.captureLogcat(deviceInfo.id).catch(() => undefined);
      if (logcatText) {
        const detected = parseLogcatForCrashes(logcatText, resolvedAppId);
        if (detected.length > 0) {
          crashes = detected;
        }
      }
    }

    const durationMs = Date.now() - startTime;

    // screenshot 경로 sanitize — path traversal 방어
    const sanitizedSteps: import("./agent/resultSchema.js").AgentStep[] = agentResult.steps.map((step) => {
      if (!step.screenshot) return step;
      const safe = sanitizeScreenshotPath(session.screenshotsDir, step.screenshot);
      if (safe === null) {
        // 탈출 감지: screenshot 필드 제거, 스텝 자체는 유지
        const { screenshot: _dropped, ...rest } = step;
        return rest;
      }
      return step;
    });

    // M7: qualityWarnings 생성 — non-skip 스텝 중 screenshot 없는 스텝
    const qualityWarnings: string[] = sanitizedSteps
      .filter((step) => step.status !== "skip" && !step.screenshot)
      .map((step) => `스텝 ${step.index}: 스크린샷 누락`);

    // M7: findings evidence sanitize (steps와 동일한 path traversal 방어)
    const sanitizedFindings = agentResult.findings?.map((finding) => {
      if (!finding.evidence) return finding;
      const safe = sanitizeScreenshotPath(session.screenshotsDir, finding.evidence);
      if (safe === null) {
        const { evidence: _dropped, ...rest } = finding;
        return rest;
      }
      return finding;
    });

    // M8: 크래시 synthetic finding 주입 (상한 500 유지)
    let allFindings = sanitizedFindings ? [...sanitizedFindings] : [];
    if (crashes && crashes.length > 0) {
      const crashFindings = crashes.map((c, idx) => ({
        id: `crash-synthetic-${idx}`,
        severity: "critical" as const,
        category: "crash" as const,
        description: `[${c.type}] ${c.excerpt.split("\n")[0] ?? c.type}`,
      }));
      allFindings = [...allFindings, ...crashFindings].slice(0, 500);
    }

    // M7: visitedScreens 정제 — 기본 형식 검증(빈 문자열·초장문·제어문자·중복) + AppMap 교집합 (환각 방어)
    let visitedScreens: string[] | undefined;
    if (agentResult.visitedScreens) {
      // 1차: 기본 형식 필터 (AppMap 유무 무관) + trim (T2: 공백 포함 id 처리)
      const CTRL_RE = /[\x00-\x1f\x7f]/;
      const sanitizedRaw = agentResult.visitedScreens.map((id) => id.trim());
      const sanitized = [...new Set(
        sanitizedRaw.filter(
          (id) => id.length > 0 && id.length <= 100 && !CTRL_RE.test(id)
        )
      )];
      if (sessionAppMap) {
        // 2차: AppMap 교집합 — T2: 정규화(trim+lowercase) 키로 매칭, 원본 id 보존
        const appMapScreens = sessionAppMap.appMap.screens;
        const normalizedToOriginal = new Map<string, string>(
          appMapScreens.map((s) => [s.id.trim().toLowerCase(), s.id])
        );
        const matchedOriginalIds = sanitized
          .map((id) => normalizedToOriginal.get(id.toLowerCase()))
          .filter((id): id is string => id !== undefined);
        visitedScreens = [...new Set(matchedOriginalIds)];
      } else {
        visitedScreens = sanitized;
      }
    }

    // M8: coverage 결정론 계산 (sessionAppMap 있는 경우만)
    let coverage: Coverage | undefined;
    if (sessionAppMap && sessionAppMap.appMap.screens.length > 0) {
      const appMapScreens = sessionAppMap.appMap.screens;
      const totalScreens = appMapScreens.length;

      // 방문된 원본 id 집합 (visitedScreens가 이미 원본 id로 정규화됨)
      const visitedSet = new Set(visitedScreens ?? []);
      const visitedScreenIds = appMapScreens
        .map((s) => s.id)
        .filter((id) => visitedSet.has(id));
      const unvisitedScreenIds = appMapScreens
        .map((s) => s.id)
        .filter((id) => !visitedSet.has(id));

      coverage = {
        totalScreens,
        visitedScreens: visitedScreenIds.length,
        visitedScreenIds,
        unvisitedScreenIds,
        coverageRatio: totalScreens > 0 ? visitedScreenIds.length / totalScreens : 0,
      };
    }

    // M8: 크래시 발생 시 outcome 강등 (failOnCrash=true 기본)
    let finalOutcome: E2eReport["outcome"] = isPartialRecovery ? "partial" : agentResult.outcome;
    if (crashes && crashes.length > 0 && failOnCrash && finalOutcome === "pass") {
      finalOutcome = "fail";
    }

    // 리포트 작성
    const report: E2eReport = {
      sessionId: session.sessionId,
      projectPath,
      platform,
      agent,
      scenarioPath,
      outcome: finalOutcome,
      summary: agentResult.summary,
      steps: sanitizedSteps,
      screenshotsDir: session.screenshotsDir,
      durationMs,
      createdAt: new Date().toISOString(),
      reportVersion: 2,
      // M8: 신규 필드 영속화 (T1)
      ...(allFindings.length > 0 ? { findings: allFindings } : {}),
      ...(coverage ? { coverage } : {}),
      ...(crashes ? { crashes } : {}),
      ...(qualityWarnings.length > 0 ? { qualityWarnings } : {}),
      ...(visitedScreens !== undefined ? { visitedScreens } : {}),
    };

    const { reportJsonPath, reportMdPath } = writeReport(session.dir, report);

    // 선택적 shutdown
    if (!keepBooted && deviceManager.shutdown) {
      await deviceManager.shutdown(deviceInfo.id).catch(() => {
        // 종료 실패는 무시
      });
    }

    return {
      outcome: finalOutcome,
      sessionDir: session.dir,
      reportJsonPath,
      reportMdPath,
      screenshotsDir: session.screenshotsDir,
      summary: agentResult.summary,
      steps: sanitizedSteps,
      ...(sessionAppMap ? { appMapDir: session.appMapDir } : {}),
      ...(qualityWarnings.length > 0 ? { qualityWarnings } : {}),
      ...(allFindings.length > 0 ? { findings: allFindings } : {}),
      ...(visitedScreens !== undefined ? { visitedScreens } : {}),
      ...(crashes ? { crashes } : {}),
      ...(coverage ? { coverage } : {}),
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

// ── runE2eSuite ───────────────────────────────────────────────────────

/**
 * 여러 시나리오를 순차적으로 실행하고 집계 결과를 반환한다.
 *
 * scenarioPath가 파일이면 runE2eTest를 1회, 디렉토리이면 *.md를 사전순으로 실행.
 * 디바이스 재부팅 회피: N-1개 시나리오는 keepBooted=true, 마지막만 사용자 값 사용.
 */
export async function runE2eSuite(opts: RunE2eSuiteOptions): Promise<E2eSuiteResult> {
  const { scenarioPath, ...restOpts } = opts;
  const userKeepBooted = restOpts.keepBooted ?? false;

  // 시나리오 파일 목록 탐색
  let scenarioPaths: string[];
  try {
    scenarioPaths = discoverScenarioFiles(scenarioPath);
  } catch (e) {
    // 탐색 실패(빈 디렉토리 등) → error 집계
    const errMsg = e instanceof Error ? e.message : String(e);
    return {
      outcome: "error",
      results: [],
      summary: `0/0 pass (탐색 실패: ${errMsg})`,
    };
  }

  const results: Array<{ scenarioPath: string; result: E2eTestResult }> = [];
  const total = scenarioPaths.length;

  for (let i = 0; i < total; i++) {
    const filePath = scenarioPaths[i];
    const isLast = i === total - 1;

    // N-1개는 keepBooted=true로 디바이스 재부팅 방지
    const keepBooted = isLast ? userKeepBooted : true;

    process.stderr.write(`[karax suite] (${i + 1}/${total}) ${filePath}\n`);

    const result = await runE2eTest({
      ...restOpts,
      scenarioPath: filePath,
      keepBooted,
    });

    results.push({ scenarioPath: filePath, result });
  }

  // 집계: error > fail > pass
  const hasError = results.some((r) => r.result.outcome === "error");
  const hasFail = results.some((r) => r.result.outcome === "fail");
  const outcome: E2eSuiteResult["outcome"] = hasError ? "error" : hasFail ? "fail" : "pass";

  const passCount = results.filter((r) => r.result.outcome === "pass").length;
  const summary = `${passCount}/${total} pass`;

  return { outcome, results, summary, suiteDir: restOpts.outDir };
}
