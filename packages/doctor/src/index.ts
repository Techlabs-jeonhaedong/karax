import {
  checkNode,
  checkPlaywrightChromium,
  checkFlutter,
  checkDart,
  checkJava,
  checkGradle,
  checkXcodebuild,
  checkCocoaPods,
  checkAndroidSdk,
} from "./checks/index.js";
import type { CheckResult } from "./checks/types.js";
import { computeTiers, type TiersAvailable } from "./tiers.js";
import { ensureChromium, getManualInstallHints } from "./ensure.js";

export type { CheckResult } from "./checks/index.js";
export type { TiersAvailable } from "./tiers.js";

export interface DoctorReport {
  checks: CheckResult[];
  tiersAvailable: TiersAvailable;
  overallOk: boolean;
}

/**
 * 전체 환경을 진단하고 DoctorReport를 반환한다.
 * @param _projectPath 미래 확장을 위한 옵셔널 프로젝트 경로 (현재 미사용)
 */
export async function runDoctor(_projectPath?: string): Promise<DoctorReport> {
  const checks = await runAllChecks();
  const tiersAvailable = computeTiers(checks);

  // overallOk: autoInstallable이 아닌 필수 항목에 missing이 없으면 true
  // (playwright-chromium은 autoInstallable=true 이므로 overallOk에서 제외)
  const nonAutoMissing = checks.filter(
    (c) => c.status === "missing" && !c.autoInstallable
  );
  const overallOk = nonAutoMissing.length === 0;

  return { checks, tiersAvailable, overallOk };
}

/**
 * autoInstallable 항목을 설치한 뒤 재진단한다.
 * 대형 툴체인(flutter, xcode 등)은 hint만 출력하고 에러를 throw하지 않는다.
 */
export async function doctorFix(report?: DoctorReport): Promise<DoctorReport> {
  const currentReport = report ?? (await runDoctor());

  const autoInstallable = currentReport.checks.filter(
    (c) => c.status !== "ok" && c.autoInstallable
  );

  for (const check of autoInstallable) {
    if (check.id === "playwright-chromium") {
      await ensureChromium();
    }
  }

  const manualMissing = currentReport.checks
    .filter((c) => c.status !== "ok" && !c.autoInstallable)
    .map((c) => c.id);

  const hints = getManualInstallHints(manualMissing);
  if (hints.length > 0) {
    console.warn("[doctor] 수동 설치 필요 항목:");
    hints.forEach((h) => console.warn(" •", h));
  }

  // 재진단
  return runDoctor();
}

async function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all([
    checkNode(),
    checkPlaywrightChromium(),
    checkFlutter(),
    checkDart(),
    checkJava(),
    checkGradle(),
    checkXcodebuild(),
    checkCocoaPods(),
    checkAndroidSdk(),
  ]);
}
