/**
 * 실제 로컬 환경 통합 테스트
 * SFC_DOCTOR_INTEGRATION=1 환경변수가 있을 때만 실행됨.
 *
 * 이 머신 기준: flutter/dart/java/xcode/gradle/pod 모두 설치됨
 * → 대형 툴체인 체크 ok + 4개 프레임워크 tier1=true 단언
 * → playwright-chromium은 autoInstallable=true 이므로 overallOk에서 제외됨
 */

import { describe, it, expect } from "vitest";
import { runDoctor } from "../index.js";

const INTEGRATION = process.env.SFC_DOCTOR_INTEGRATION === "1";

describe.skipIf(!INTEGRATION)("Doctor 로컬 통합 테스트", () => {
  it("모든 대형 툴체인 체크 ok, 4개 프레임워크 tier1=true", async () => {
    const report = await runDoctor();

    const checksById = Object.fromEntries(report.checks.map((c) => [c.id, c]));

    // 이 머신에 설치된 도구들
    expect(checksById["node"]?.status).toBe("ok");
    expect(checksById["flutter"]?.status).toBe("ok");
    expect(checksById["dart"]?.status).toBe("ok");
    expect(checksById["java"]?.status).toBe("ok");
    expect(checksById["gradle"]?.status).toBe("ok");
    expect(checksById["xcodebuild"]?.status).toBe("ok");
    expect(checksById["cocoapods"]?.status).toBe("ok");

    // playwright-chromium은 autoInstallable이므로 상태와 무관하게 아래 단언
    expect(checksById["playwright-chromium"]?.autoInstallable).toBe(true);

    // 4개 프레임워크 tier1=true
    expect(report.tiersAvailable.flutter.tier1).toBe(true);
    expect(report.tiersAvailable["react-native"].tier1).toBe(true);
    expect(report.tiersAvailable.android.tier1).toBe(true);
    expect(report.tiersAvailable.ios.tier1).toBe(true);

    // tier2는 항상 true
    expect(report.tiersAvailable.flutter.tier2).toBe(true);
    expect(report.tiersAvailable["react-native"].tier2).toBe(true);
    expect(report.tiersAvailable.android.tier2).toBe(true);
    expect(report.tiersAvailable.ios.tier2).toBe(true);

    // overallOk: autoInstallable이 아닌 항목에 missing이 없으면 true
    expect(report.overallOk).toBe(true);
  }, 30_000);
});
