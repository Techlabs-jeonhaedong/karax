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
import {
  computeSourceFingerprint,
  readBuildCache,
  writeBuildCache,
  isArtifactFresh,
} from "./build/cache.js";
import { startAndroidRecording, startIosRecording } from "./recorder.js";
import type { Recorder } from "./recorder.js";
import { isDebug, debugLog, createDebugArtifacts } from "./debug.js";
import { emitProgress } from "./progress.js";
export type { E2eProgressEvent, E2eProgressPhase, E2eProgressStatus, E2eProgressCallback } from "./progress.js";

export type { RunE2eTestOptions, E2eTestResult, Platform };
export { E2eError, E2E_ERROR_CODES } from "./types.js";
export type { E2eErrorCode, AgentKind } from "./types.js";
export { dumpAndroidUI } from "./runtime/dumpAndroid.js";
export { isIdbAvailable, dumpIosUI } from "./runtime/dumpIos.js";

// ── suite 타입 ────────────────────────────────────────────────────────

export interface RunE2eSuiteOptions extends Omit<RunE2eTestOptions, "scenarioPath"> {
  /** 파일 또는 디렉토리 경로 */
  scenarioPath: string;
}

export interface E2eSuiteResult {
  /** 전체 집계: 우선순위 error > fail > partial > pass */
  outcome: "pass" | "fail" | "error" | "partial";
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
    reuseBuild = false,
    noBuild = false,
    recordVideo = false,
    buildCommand,
    onProgress,
  } = opts;

  const debug = isDebug(opts.debug);
  const startTime = Date.now();
  const session = createSessionDir(outDir, { debug });
  const artifacts = createDebugArtifacts(session.debugDir);

  // manifest.json 기록 (debug 시)
  if (debug) {
    let karaxVersion = "unknown";
    try {
      const pkgPath = new URL("../../package.json", import.meta.url);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
      karaxVersion = pkg.version ?? "unknown";
    } catch {
      // package.json 읽기 실패 무시
    }
    const manifest = {
      karaxVersion,
      nodeVersion: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString(),
      // apiKey 제외한 옵션 스냅샷 (경로는 상대 경로로 축소 — 절대경로 노출 최소화)
      options: {
        projectPath: toRelativePath(opts.projectPath),
        platform: opts.platform,
        scenarioPath: opts.scenarioPath !== undefined ? toRelativePath(opts.scenarioPath) : undefined,
        agent: opts.agent,
        deviceId: opts.deviceId,
        outDir: opts.outDir !== undefined ? toRelativePath(opts.outDir) : undefined,
        keepBooted: opts.keepBooted,
        failOnCrash: opts.failOnCrash,
        reuseBuild: opts.reuseBuild,
        noBuild: opts.noBuild,
        recordVideo: opts.recordVideo,
        debug: opts.debug,
      },
    };
    await artifacts.writeJson("manifest.json", manifest);
  }

  // 시나리오 파싱
  await emitProgress(onProgress, { phase: "scenario", status: "start", timestamp: Date.now() });
  let scenario: { body: string; exploratory: boolean; appId?: string; platform?: Platform; steps?: import("./scenario/schema.js").ScenarioStep[]; permissions?: string[] } = { body: "", exploratory: true };
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
      await emitProgress(onProgress, { phase: "scenario", status: "error", timestamp: Date.now(), detail: e instanceof Error ? e.message : String(e) });
      const errResult = makeErrorResult(session, startTime, platform, agent, scenarioPath, e);
      return errResult;
    }
  }
  await emitProgress(onProgress, { phase: "scenario", status: "done", timestamp: Date.now() });

  let deviceManager: Awaited<ReturnType<typeof createDeviceManager>> | null = null;
  let boostedByUs = false;
  let recorder: Recorder | null = null;

  try {
    // 프레임워크 감지 (실패해도 일단 진행, builder가 에러 처리)
    await emitProgress(onProgress, { phase: "detect", status: "start", timestamp: Date.now() });
    const framework = detectFrameworkFromPath(projectPath);
    await emitProgress(onProgress, { phase: "detect", status: "done", timestamp: Date.now(), detail: framework });

    // 디바이스 매니저 생성
    await emitProgress(onProgress, { phase: "device", status: "start", timestamp: Date.now(), detail: "디바이스 부팅 확인 중" });
    deviceManager = await createDeviceManager(platform);

    // 디바이스 부팅 확인
    const deviceInfo = await deviceManager.ensureBooted(deviceId);
    boostedByUs = true;
    await emitProgress(onProgress, { phase: "device", status: "done", timestamp: Date.now(), detail: deviceInfo.id });

    // ── M11: 빌드 게이트 ──────────────────────────────────────────────
    const builder = selectBuilder(framework, platform);

    // AppMap 생성 (병렬, progress 이벤트 포함)
    await emitProgress(onProgress, { phase: "appmap", status: "start", timestamp: Date.now(), detail: "AppMap 생성 중" });
    const appMapPromise = opts.appMapGenerator
      ? generateAppMapForSession({
          projectPath,
          framework,
          platform,
          appMapDir: session.appMapDir,
          generator: opts.appMapGenerator,
        }).catch(() => null)
      : Promise.resolve(null);

    let buildResultPromise: Promise<import("./build/index.js").BuildResult>;
    // fp는 reuseBuild/noBuild 경로와 writeBuildCache 호출 모두에서 재사용
    let fp: import("./build/cache.js").SourceFingerprint | null = null;

    // noBuild=true이면 buildCommand는 무시 (에러 아님)
    const effectiveBuildCmd = noBuild ? undefined : buildCommand;

    if (reuseBuild || noBuild) {
      fp = computeSourceFingerprint(projectPath, framework, { buildCommand: effectiveBuildCmd });
      const cached = readBuildCache(projectPath, platform);

      const canReuse =
        cached !== null &&
        cached.sourceHash === fp.hash &&
        isArtifactFresh(cached.artifactPath, fp);

      if (canReuse) {
        // 캐시 히트 — 빌드 스킵
        process.stderr.write(
          `[karax/e2e] 빌드 스킵 (캐시 히트): ${cached!.artifactPath}\n`
        );
        await emitProgress(onProgress, { phase: "build", status: "start", timestamp: Date.now(), detail: "빌드 스킵 (캐시 히트)" });
        buildResultPromise = Promise.resolve({
          artifactPath: cached!.artifactPath,
          appId: cached!.appId,
        });
      } else if (noBuild) {
        // noBuild 모드에서 재사용 불가 → ARTIFACT_NOT_FOUND
        throw new E2eError(
          "ARTIFACT_NOT_FOUND",
          `noBuild=true인데 유효한 캐시 artifact가 없습니다. 먼저 빌드하거나 reuseBuild=true를 사용하세요.`
        );
      } else {
        // reuseBuild이지만 불일치 → 자동 재빌드
        await emitProgress(onProgress, { phase: "build", status: "start", timestamp: Date.now(), detail: "앱 빌드 중 (캐시 불일치, 재빌드)" });
        buildResultPromise = builder.build(projectPath, {
          debug,
          debugDir: session.debugDir,
          buildCommand: effectiveBuildCmd,
        });
      }
    } else {
      // 기본 경로: 항상 빌드
      await emitProgress(onProgress, { phase: "build", status: "start", timestamp: Date.now(), detail: "앱 빌드 중" });
      buildResultPromise = builder.build(projectPath, {
        debug,
        debugDir: session.debugDir,
        buildCommand: effectiveBuildCmd,
      });
    }

    const [buildResult, sessionAppMap] = await Promise.all([
      buildResultPromise,
      appMapPromise,
    ]);
    await emitProgress(onProgress, { phase: "build", status: "done", timestamp: Date.now(), detail: buildResult.artifactPath });
    await emitProgress(onProgress, { phase: "appmap", status: "done", timestamp: Date.now(), detail: sessionAppMap ? `화면 ${sessionAppMap.appMap.screens.length}개` : "AppMap 없음" });

    // M11: 빌드 성공 후 캐시 기록 (noBuild=true이면 이 분기 자체에 도달 불가 — 위에서 throw)
    if (!noBuild) {
      // fp가 이미 계산됐으면 재사용, 아니면 새로 계산
      const fpForWrite = fp ?? computeSourceFingerprint(projectPath, framework, { buildCommand: effectiveBuildCmd });
      try {
        writeBuildCache(projectPath, platform, {
          artifactPath: buildResult.artifactPath,
          appId: buildResult.appId,
          sourceHash: fpForWrite.hash,
          builtAtMs: Date.now(),
        });
      } catch (cacheErr) {
        process.stderr.write(
          `[karax/e2e] 빌드 캐시 기록 실패 (무시): ${cacheErr instanceof Error ? cacheErr.message : String(cacheErr)}\n`
        );
      }
    }

    // M11: grantPermissions 결정
    // - 명시 true: install -g (전체 권한) + 개별 pm grant
    // - 자동 활성(명시 없음 + permissions 선언 존재): install -g 없음 + 개별 pm grant만 (최소 권한 원칙)
    // - 명시 false: 권한 처리 없음
    const scenarioPermissions = scenario.permissions;
    const userExplicitGrant = opts.grantPermissions === true;
    const autoGrant =
      opts.grantPermissions !== false &&
      Array.isArray(scenarioPermissions) &&
      scenarioPermissions.length > 0;
    const shouldGrant = userExplicitGrant || autoGrant;

    // 설치 (M11: -g는 사용자가 명시적으로 grantPermissions=true일 때만)
    await emitProgress(onProgress, { phase: "install", status: "start", timestamp: Date.now(), detail: "앱 설치 중" });
    await deviceManager.install(
      deviceInfo.id,
      buildResult.artifactPath,
      { grantAllPermissions: userExplicitGrant && platform === "android" }
    );
    await emitProgress(onProgress, { phase: "install", status: "done", timestamp: Date.now() });

    // M11: 런타임 pm grant (Android) / simctl privacy (iOS) — 명시·자동 모두 개별 grant 수행
    const grantFailedPermissions: string[] = [];
    if (shouldGrant && deviceManager.grantPermissions && Array.isArray(scenarioPermissions) && scenarioPermissions.length > 0) {
      const resolvedAppIdForGrant = scenario.appId ?? buildResult.appId;
      try {
        await deviceManager.grantPermissions(deviceInfo.id, resolvedAppIdForGrant, scenarioPermissions);
      } catch (e) {
        // 전체 grant 실패 — 모든 permissions를 failed로 기록
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`[karax/e2e] grantPermissions 실패: ${msg}\n`);
        grantFailedPermissions.push(...scenarioPermissions);
      }
    }

    // 실행
    const resolvedAppId = scenario.appId ?? buildResult.appId;
    await emitProgress(onProgress, { phase: "launch", status: "start", timestamp: Date.now(), detail: `앱 실행 중: ${resolvedAppId}` });
    await deviceManager.launch(deviceInfo.id, resolvedAppId);
    await emitProgress(onProgress, { phase: "launch", status: "done", timestamp: Date.now(), detail: resolvedAppId });

    // M11: 비디오 녹화 시작 (launch 직후)
    if (recordVideo) {
      try {
        if (platform === "android") {
          recorder = await startAndroidRecording(deviceInfo.id, session.videosDir);
        } else {
          recorder = await startIosRecording(deviceInfo.id, session.videosDir);
        }
      } catch (e) {
        // 녹화 시작 실패 — 비차단
        process.stderr.write(`[karax/e2e] 비디오 녹화 시작 실패 (무시): ${e instanceof Error ? e.message : String(e)}\n`);
      }
    }

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

    // M10: iOS 플랫폼에서 idb 가용 여부 probe (Android는 불필요)
    let iosInputAvailable: boolean | undefined;
    if (platform === "ios") {
      const { isIdbAvailable } = await import("./runtime/dumpIos.js");
      iosInputAvailable = await isIdbAvailable();
    }

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
      // M10: iOS idb 가용 여부
      ...(iosInputAvailable !== undefined ? { iosInputAvailable } : {}),
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

    await emitProgress(onProgress, { phase: "agent", status: "start", timestamp: Date.now(), detail: `LLM 에이전트 실행 중 (${agent})` });
    try {
      agentResult = await runAgent(invocation, session.screenshotsDir, {
        timeoutMs: budget.timeoutMs,
        debugDir: session.debugDir,
      });
      await emitProgress(onProgress, { phase: "agent", status: "done", timestamp: Date.now(), detail: agentResult.outcome });
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
          await emitProgress(onProgress, { phase: "agent", status: "done", timestamp: Date.now(), detail: "partial 복구" });
        } else {
          await emitProgress(onProgress, { phase: "agent", status: "error", timestamp: Date.now(), detail: agentErr instanceof Error ? agentErr.message : String(agentErr) });
          throw agentErr; // 복구 불가 → 기존 에러 경로
        }
      } else {
        await emitProgress(onProgress, { phase: "agent", status: "error", timestamp: Date.now(), detail: agentErr instanceof Error ? agentErr.message : String(agentErr) });
        throw agentErr;
      }
    }

    // M8: 에이전트 종료 후 logcat 캡처 + 크래시 감지 (best-effort)
    await emitProgress(onProgress, { phase: "crash-scan", status: "start", timestamp: Date.now(), detail: "크래시 로그 분석 중" });
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
    await emitProgress(onProgress, { phase: "crash-scan", status: "done", timestamp: Date.now(), detail: crashes ? `크래시 ${crashes.length}건` : "이상 없음" });

    // M11: 녹화 중지 (에이전트 완료 후, 비차단)
    let videoFiles: string[] | undefined;
    if (recorder) {
      videoFiles = await recorder.stop().catch((recErr) => {
        if (debug) {
          const msg = recErr instanceof Error ? recErr.message : String(recErr);
          debugLog(debug, "teardown", `recorder.stop 실패: ${msg}`);
          artifacts.append("teardown.log", `recorder.stop 실패: ${msg}`).catch(() => undefined);
        }
        return undefined;
      });
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

    // M7: qualityWarnings 생성 — non-skip 스텝 중 screenshot 없는 스텝 + 권한 grant 실패
    const qualityWarnings: string[] = sanitizedSteps
      .filter((step) => step.status !== "skip" && !step.screenshot)
      .map((step) => `스텝 ${step.index}: 스크린샷 누락`);

    // M11: 권한 grant 실패 경고 추가
    for (const failedPerm of grantFailedPermissions) {
      qualityWarnings.push(`권한 grant 실패: ${failedPerm}`);
    }

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

    // M8: 크래시 synthetic finding 주입 — crashFindings를 앞에 배치해 상한 500에서 잘리지 않게 함
    let allFindings = sanitizedFindings ? [...sanitizedFindings] : [];
    if (crashes && crashes.length > 0) {
      const crashFindings = crashes.map((c, idx) => ({
        id: `crash-synthetic-${idx}`,
        severity: "critical" as const,
        category: "crash" as const,
        description: `[${c.type}] ${c.excerpt.split("\n")[0] ?? c.type}`,
      }));
      allFindings = [...crashFindings, ...allFindings].slice(0, 500);
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
    // 강등 조건: pass 또는 partial 상태에서만 강등 (fail/error는 이미 비성공이므로 그대로)
    let finalOutcome: E2eReport["outcome"] = isPartialRecovery ? "partial" : agentResult.outcome;
    if (
      crashes && crashes.length > 0 &&
      failOnCrash &&
      (finalOutcome === "pass" || finalOutcome === "partial")
    ) {
      finalOutcome = "fail";
    }

    // M11: videos — report에는 "videos/<basename>" 상대 형태 (write.ts buildVideosSection 정합)
    const videosForReport = videoFiles
      ?.filter((v) => v.length > 0)
      .map((v) => `videos/${path.basename(v)}`);

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
      // M11: 녹화 영상
      ...(videosForReport && videosForReport.length > 0 ? { videos: videosForReport } : {}),
    };

    await emitProgress(onProgress, { phase: "report", status: "start", timestamp: Date.now(), detail: "리포트 작성 중" });
    const { reportJsonPath, reportMdPath } = writeReport(session.dir, report);
    await emitProgress(onProgress, { phase: "report", status: "done", timestamp: Date.now(), detail: reportJsonPath });

    // 선택적 shutdown
    if (!keepBooted && deviceManager.shutdown) {
      await deviceManager.shutdown(deviceInfo.id).catch((e) => {
        // 종료 실패 — debug 시 teardown.log 기록, off 시 기존 침묵
        if (debug) {
          const msg = e instanceof Error ? e.message : String(e);
          debugLog(debug, "teardown", `shutdown 실패: ${msg}`);
          artifacts.append("teardown.log", `shutdown 실패: ${msg}`).catch(() => undefined);
        }
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
      // M11: 녹화 파일 경로 (절대 경로)
      ...(videoFiles && videoFiles.length > 0 ? { videos: videoFiles } : {}),
    };
  } catch (e) {
    // 인프라 에러 → progress error 이벤트 발행 후 outcome: "error"로 리포트 작성
    const errorMsg = e instanceof Error ? e.message : String(e);
    await emitProgress(onProgress, { phase: "report", status: "error", timestamp: Date.now(), detail: errorMsg });

    const errResult = makeErrorResult(session, startTime, platform, agent, scenarioPath, e);

    // debug 시 error.json 기록 (report.json 스키마 불변)
    if (debug) {
      const errorData: Record<string, unknown> = {};
      if (e instanceof E2eError) {
        errorData["code"] = e.code;
        errorData["message"] = e.message;
        if (e.details !== undefined) {
          // details는 redactSecrets를 통해 저장됨 (createDebugArtifacts 내부 처리)
          errorData["details"] = e.details;
        }
      } else if (e instanceof Error) {
        errorData["message"] = e.message;
        errorData["stack"] = e.stack;
      } else {
        errorData["raw"] = String(e);
      }
      await artifacts.writeJson("error.json", errorData);
    }

    // recorder 프로세스 누수 방지 — 에러 경로에서도 반드시 정지
    await recorder?.stop().catch((recErr) => {
      if (debug) {
        const msg = recErr instanceof Error ? recErr.message : String(recErr);
        debugLog(debug, "teardown", `recorder.stop 실패: ${msg}`);
        artifacts.append("teardown.log", `recorder.stop 실패: ${msg}`).catch(() => undefined);
      }
    });

    // 선택적 shutdown (에러 경우에도)
    if (!keepBooted && deviceManager?.shutdown && deviceManager.platform === platform) {
      await deviceManager.shutdown(deviceId ?? "").catch((shutdownErr) => {
        if (debug) {
          const msg = shutdownErr instanceof Error ? shutdownErr.message : String(shutdownErr);
          debugLog(debug, "teardown", `shutdown 실패 (error path): ${msg}`);
          artifacts.append("teardown.log", `shutdown 실패 (error path): ${msg}`).catch(() => undefined);
        }
      });
    }

    return errResult;
  }
}

// ── 유틸 ──────────────────────────────────────────────────────────

/**
 * 절대 경로를 process.cwd() 기준 상대 경로로 변환한다.
 * 상대 변환 결과가 ".."로 시작하거나 비어있으면 원본 절대 경로를 유지한다.
 */
function toRelativePath(p: string): string {
  const rel = path.relative(process.cwd(), p);
  if (!rel || rel.startsWith("..")) return p;
  return rel;
}

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
  const { scenarioPath, onProgress: userOnProgress, ...restOpts } = opts;
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

    // suite 진행 이벤트: stepIndex/totalSteps 주입하여 onProgress 래핑
    const suiteOnProgress = userOnProgress
      ? (event: import("./progress.js").E2eProgressEvent) =>
          userOnProgress({ ...event, stepIndex: i, totalSteps: total })
      : undefined;

    const result = await runE2eTest({
      ...restOpts,
      scenarioPath: filePath,
      keepBooted,
      onProgress: suiteOnProgress,
    });

    results.push({ scenarioPath: filePath, result });
  }

  // 집계: error > fail > partial > pass
  const hasError = results.some((r) => r.result.outcome === "error");
  const hasFail = results.some((r) => r.result.outcome === "fail");
  const hasPartial = results.some((r) => r.result.outcome === "partial");
  const outcome: E2eSuiteResult["outcome"] =
    hasError ? "error" : hasFail ? "fail" : hasPartial ? "partial" : "pass";

  const passCount = results.filter((r) => r.result.outcome === "pass").length;
  const summary = `${passCount}/${total} pass`;

  return { outcome, results, summary, suiteDir: restOpts.outDir };
}
