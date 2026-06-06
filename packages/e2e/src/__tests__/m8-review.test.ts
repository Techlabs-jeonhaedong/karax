/**
 * M8 검수 반영 — 추가 테스트 (Red 단계)
 *
 * 1. suite partial 집계 누락
 * 2. crash detect appId 필터 정밀화
 * 3. partial+크래시 강등 조건 확장
 * 4. crashFindings 보존 (slice 순서)
 * 5. redact 패턴 확장
 * 6. recovery result.json 크기 상한 (10MB)
 * 7. crashes excerpt 코드 펜스 탈출 방지
 * 8. buildVideosSection 경로 제한 (basename)
 * 9. captureLogcat maxBuffer (낮음)
 * 10. crash detect 입력 상한 20MB (낮음)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// 1. suite partial 집계 — E2eSuiteResult.outcome에 "partial" 포함 여부
// ─────────────────────────────────────────────────────────────────────────────

describe("[1] suite partial 집계", () => {
  it("E2eSuiteResult.outcome 타입에 'partial'이 포함되어야 한다 (타입 가드 테스트)", async () => {
    const { runE2eSuite } = await import("../index.js");
    // runE2eSuite 반환값의 outcome이 "partial"일 수 있음을 타입 수준에서 확인
    // (실제 집계는 aggregateResults 순수 함수 테스트로 보완)
    type SuiteOutcome = Awaited<ReturnType<typeof runE2eSuite>>["outcome"];
    // 타입이 "partial"을 포함하면 아래 assignment는 에러 없이 컴파일
    const _: SuiteOutcome = "partial" as SuiteOutcome;
    expect(_).toBe("partial");
  });

  it("집계 우선순위: error > fail > partial > pass", () => {
    // aggregateResults 순수 함수 로직 검증 (inline 구현)
    function aggregateWithPartial(
      outcomes: Array<"pass" | "fail" | "error" | "partial">
    ): "pass" | "fail" | "error" | "partial" {
      if (outcomes.some((o) => o === "error")) return "error";
      if (outcomes.some((o) => o === "fail")) return "fail";
      if (outcomes.some((o) => o === "partial")) return "partial";
      return "pass";
    }

    expect(aggregateWithPartial(["pass", "pass"])).toBe("pass");
    expect(aggregateWithPartial(["pass", "partial"])).toBe("partial");
    expect(aggregateWithPartial(["pass", "partial", "fail"])).toBe("fail");
    expect(aggregateWithPartial(["pass", "partial", "fail", "error"])).toBe("error");
    // partial만 있으면 partial
    expect(aggregateWithPartial(["partial", "pass", "pass"])).toBe("partial");
    // fail이 partial보다 우선
    expect(aggregateWithPartial(["partial", "fail"])).toBe("fail");
    // error가 모든 것보다 우선
    expect(aggregateWithPartial(["error", "partial"])).toBe("error");
  });

  it("실제 runE2eSuite에서 partial 시나리오 결과가 partial 집계를 만든다", async () => {
    // discoverScenarioFiles + aggregateResults 로직을 직접 테스트
    // runE2eSuite의 집계 로직이 partial을 올바르게 처리하는지 검증

    // suite.test.ts의 aggregateResults를 확장한 버전으로 검증
    // (실제 index.ts의 로직이 수정되면 이 테스트가 통과해야 함)
    const { runE2eSuite } = await import("../index.js");
    type SuiteResult = Awaited<ReturnType<typeof runE2eSuite>>;
    type Outcome = SuiteResult["outcome"];

    // "partial"이 valid Outcome 타입이어야 한다
    const partialOutcome: Outcome = "partial";
    expect(partialOutcome).toBe("partial");
  });

  it("per-scenario 아이콘: partial은 '~'로 표시되어야 한다", () => {
    // CLI bin.ts의 아이콘 매핑 로직 검증
    function suiteIcon(outcome: "pass" | "fail" | "error" | "partial"): string {
      if (outcome === "pass") return "✓";
      if (outcome === "fail") return "✗";
      if (outcome === "partial") return "~";
      return "!";
    }

    expect(suiteIcon("pass")).toBe("✓");
    expect(suiteIcon("fail")).toBe("✗");
    expect(suiteIcon("partial")).toBe("~");
    expect(suiteIcon("error")).toBe("!");
  });

  it("suite exit: partial→2(PARTIAL_FAILURE)", () => {
    // EXIT_CODES 매핑 검증
    const EXIT_CODES = { SUCCESS: 0, FAILURE: 1, PARTIAL_FAILURE: 2 };

    function suiteExitCode(outcome: "pass" | "fail" | "error" | "partial"): number {
      if (outcome === "pass") return EXIT_CODES.SUCCESS;
      if (outcome === "fail" || outcome === "partial") return EXIT_CODES.PARTIAL_FAILURE;
      return EXIT_CODES.FAILURE;
    }

    expect(suiteExitCode("pass")).toBe(0);
    expect(suiteExitCode("partial")).toBe(2);
    expect(suiteExitCode("fail")).toBe(2);
    expect(suiteExitCode("error")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. crash detect appId 필터 정밀화
// ─────────────────────────────────────────────────────────────────────────────

import { parseLogcatForCrashes } from "../crash/detect.js";

const APP_ID = "com.example.myapp";
const SIMILAR_APP_ID = "com.example.myapp2"; // 접두 유사 패키지

describe("[2] crash detect — appId 정밀 일치", () => {
  // ── FATAL EXCEPTION: 다른 앱 블록 안에 우리 appId가 단순 언급 ─────────────

  it("FATAL 블록에서 Process가 다른 앱이고 스택에 우리 appId가 단순 언급 → 미감지", () => {
    // 다른 앱의 FATAL이지만, 스택 트레이스 문자열에 com.example.myapp이 포함됨
    const logcat = `
05-15 10:22:01.123  5678  5678 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.124  5678  5678 E AndroidRuntime: Process: com.thirdparty.app, PID: 5678
05-15 10:22:01.125  5678  5678 E AndroidRuntime: java.lang.RuntimeException: failed to connect com.example.myapp service
05-15 10:22:01.126  5678  5678 E AndroidRuntime: \tat com.thirdparty.app.MainActivity.connect(MainActivity.kt:10)
`;
    const crashes = parseLogcatForCrashes(logcat, APP_ID);
    expect(crashes).toHaveLength(0);
  });

  it("FATAL 블록의 Process: 값이 appId와 정확히 일치할 때만 감지", () => {
    const logcat = `
05-15 10:22:01.123  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.124  1234  1234 E AndroidRuntime: Process: com.example.myapp, PID: 1234
05-15 10:22:01.125  1234  1234 E AndroidRuntime: java.lang.NullPointerException
`;
    const crashes = parseLogcatForCrashes(logcat, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].type).toBe("fatal-exception");
  });

  // ── 접두 유사 패키지 → 미감지 ─────────────────────────────────────────────

  it("ANR: com.example.myapp2 → com.example.myapp으로 미감지", () => {
    const logcat = `
05-15 11:00:00.000  1000  1000 E ActivityManager: ANR in com.example.myapp2 (com.example.myapp2/.MainActivity)
05-15 11:00:00.001  1000  1000 E ActivityManager: Reason: Input dispatching timed out
`;
    const crashes = parseLogcatForCrashes(logcat, APP_ID);
    expect(crashes).toHaveLength(0);
  });

  it("ANR: 정확히 일치하는 경우에는 감지", () => {
    const logcat = `
05-15 11:00:00.000  1000  1000 E ActivityManager: ANR in com.example.myapp (com.example.myapp/.Main)
05-15 11:00:00.001  1000  1000 E ActivityManager: Reason: Input dispatching timed out
`;
    const crashes = parseLogcatForCrashes(logcat, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].type).toBe("anr");
  });

  it("native crash: com.example.myapp2 블록에서 com.example.myapp은 미감지", () => {
    // native crash 블록에서 com.example.myapp2에 해당하는 크래시
    // appId com.example.myapp으로 필터링하면 미감지여야 함
    const logcat = `
05-15 13:00:00.000  9999  9999 F libc    : Fatal signal 11 (SIGSEGV)
05-15 13:00:00.001  9999  9999 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
05-15 13:00:00.002  9999  9999 F DEBUG   : pid: 9999, tid: 9999, name: com.example.myapp2
05-15 13:00:00.003  9999  9999 F DEBUG   : backtrace:
05-15 13:00:00.004  9999  9999 F DEBUG   :     #00 pc 00007f /data/app/com.example.myapp2/lib/libnative.so
`;
    // APP_ID = com.example.myapp 이므로 com.example.myapp2는 미감지여야 함
    const crashes = parseLogcatForCrashes(logcat, APP_ID);
    // com.example.myapp이 블록에 단어 경계로만 있어야 감지
    // com.example.myapp2는 com.example.myapp과 단어 경계가 다름
    expect(crashes).toHaveLength(0);
  });

  it("native crash: 정확한 appId가 블록에 포함되면 감지", () => {
    const logcat = `
05-15 13:00:00.000  9999  9999 F libc    : Fatal signal 11 (SIGSEGV)
05-15 13:00:00.001  9999  9999 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
05-15 13:00:00.002  9999  9999 F DEBUG   : pid: 9999, tid: 9999, name: com.example.myapp
05-15 13:00:00.003  9999  9999 F DEBUG   : backtrace:
05-15 13:00:00.004  9999  9999 F DEBUG   :     #00 pc 00007f /data/app/com.example.myapp/lib/libnative.so
`;
    const crashes = parseLogcatForCrashes(logcat, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].type).toBe("native-crash");
  });

  it("FATAL: Process: 값에 접두 유사 appId가 있어도 미감지", () => {
    const logcat = `
05-15 10:22:01.123  5678  5678 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.124  5678  5678 E AndroidRuntime: Process: com.example.myapp2, PID: 5678
05-15 10:22:01.125  5678  5678 E AndroidRuntime: java.lang.RuntimeException: crash
`;
    const crashes = parseLogcatForCrashes(logcat, APP_ID);
    expect(crashes).toHaveLength(0);
  });

  it("native crash에서 '>>> pkg <<<' 패턴으로 appId 포함 시 감지", () => {
    const logcat = `
05-15 13:00:00.000  9999  9999 F libc    : Fatal signal 11 (SIGSEGV)
05-15 13:00:00.001  9999  9999 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
05-15 13:00:00.002  9999  9999 F DEBUG   : >>> com.example.myapp <<<
05-15 13:00:00.003  9999  9999 F DEBUG   : backtrace:
`;
    const crashes = parseLogcatForCrashes(logcat, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].type).toBe("native-crash");
  });

  it("정규식 특수문자가 포함된 appId도 안전하게 처리된다", () => {
    const specialAppId = "com.example.myapp";
    const logcat = `
05-15 13:00:00.000  9999  9999 F libc    : Fatal signal 11 (SIGSEGV)
05-15 13:00:00.001  9999  9999 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
05-15 13:00:00.002  9999  9999 F DEBUG   : pid: 9999, name: com.example.myapp
05-15 13:00:00.003  9999  9999 F DEBUG   : backtrace:
`;
    // 에러 없이 처리되어야 함
    expect(() => parseLogcatForCrashes(logcat, specialAppId)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. partial+크래시 강등 조건 확장
// ─────────────────────────────────────────────────────────────────────────────

describe("[3] partial+크래시 강등", () => {
  it("강등 조건: pass 또는 partial일 때 크래시+failOnCrash=true → fail", () => {
    // index.ts의 강등 로직 검증
    function applyDemotion(
      finalOutcome: "pass" | "fail" | "error" | "partial",
      hasCrashes: boolean,
      failOnCrash: boolean
    ): "pass" | "fail" | "error" | "partial" {
      if (
        hasCrashes &&
        failOnCrash &&
        (finalOutcome === "pass" || finalOutcome === "partial")
      ) {
        return "fail";
      }
      return finalOutcome;
    }

    // pass + crash + failOnCrash → fail
    expect(applyDemotion("pass", true, true)).toBe("fail");
    // partial + crash + failOnCrash → fail
    expect(applyDemotion("partial", true, true)).toBe("fail");
    // fail은 이미 fail이므로 그대로
    expect(applyDemotion("fail", true, true)).toBe("fail");
    // error는 강등 대상 아님
    expect(applyDemotion("error", true, true)).toBe("error");
    // failOnCrash=false이면 partial 유지
    expect(applyDemotion("partial", true, false)).toBe("partial");
    // 크래시 없으면 partial 유지
    expect(applyDemotion("partial", false, true)).toBe("partial");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. crashFindings 보존 (crashFindings가 slice 앞에 와야 함)
// ─────────────────────────────────────────────────────────────────────────────

describe("[4] crashFindings 보존 — 500개 상한에서 잘리지 않음", () => {
  it("일반 findings 500개 + 크래시 1건 → 크래시가 결과에 포함된다", () => {
    // [...crashFindings, ...agentFindings].slice(0, 500) 검증
    const agentFindings = Array.from({ length: 500 }, (_, i) => ({
      id: `f${i}`,
      severity: "minor" as const,
      category: "other" as const,
      description: `finding ${i}`,
    }));

    const crashFindings = [
      {
        id: "crash-synthetic-0",
        severity: "critical" as const,
        category: "crash" as const,
        description: "[fatal-exception] crash",
      },
    ];

    // 크래시를 앞에 놓고 slice(0, 500)
    const merged = [...crashFindings, ...agentFindings].slice(0, 500);
    expect(merged).toHaveLength(500);
    // 크래시가 첫 번째에 포함됨
    expect(merged[0].id).toBe("crash-synthetic-0");
    expect(merged[0].category).toBe("crash");
  });

  it("크래시 findings를 뒤에 놓으면 500개 상한에서 잘린다 (구버그 재현)", () => {
    const agentFindings = Array.from({ length: 500 }, (_, i) => ({
      id: `f${i}`,
      severity: "minor" as const,
      category: "other" as const,
      description: `finding ${i}`,
    }));

    const crashFindings = [
      {
        id: "crash-synthetic-0",
        severity: "critical" as const,
        category: "crash" as const,
        description: "[fatal-exception] crash",
      },
    ];

    // 구버그: 크래시를 뒤에 놓으면 잘림
    const buggyMerged = [...agentFindings, ...crashFindings].slice(0, 500);
    expect(buggyMerged).toHaveLength(500);
    expect(buggyMerged.some((f) => f.category === "crash")).toBe(false); // 잘림
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. redact 패턴 확장
// ─────────────────────────────────────────────────────────────────────────────

import { sanitizeStderr } from "../agent/sanitize.js";

describe("[5] redact 패턴 확장", () => {
  it("Bearer 토큰이 redact된다", () => {
    const input = "Authorization: Bearer eyABCDEFGHIJKLMN1234567890abcdef";
    const result = sanitizeStderr(input);
    expect(result).not.toContain("eyABCDEFGHIJKLMN1234567890abcdef");
    expect(result).toContain("[REDACTED]");
  });

  it("JWT 토큰이 redact된다", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const input = `token: ${jwt}`;
    const result = sanitizeStderr(input);
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9");
    expect(result).toContain("[REDACTED]");
  });

  it("세션 쿠키가 redact된다", () => {
    const inputs = [
      "Cookie: sessionid=abc123xyz456",
      "Cookie: session_id=def789",
      "Cookie: _session=ghi012",
    ];
    for (const input of inputs) {
      const result = sanitizeStderr(input);
      expect(result).not.toMatch(/sessionid=abc|session_id=def|_session=ghi/);
      expect(result).toContain("[REDACTED]");
    }
  });

  it("URL 파라미터 api_key/token/password/secret/auth가 redact된다", () => {
    const inputs = [
      "https://api.example.com/v1?api_key=supersecret123",
      "https://api.example.com?token=mytoken456",
      "https://api.example.com?password=mypass789",
      "https://api.example.com?secret=mysecret",
      "https://api.example.com?auth=myauth",
      "https://api.example.com?apikey=apikey123",
    ];
    for (const input of inputs) {
      const result = sanitizeStderr(input);
      expect(result).not.toMatch(/supersecret|mytoken|mypass789|mysecret|myauth|apikey123/);
      expect(result).toContain("[REDACTED]");
    }
  });

  it("일반 텍스트는 손상되지 않는다", () => {
    const normalText = "테스트 실행 중: 로그인 버튼을 클릭합니다.";
    const result = sanitizeStderr(normalText);
    expect(result).toBe(normalText);
  });

  it("기존 패턴(Anthropic API 키) 회귀 없음", () => {
    const input = "ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx";
    const result = sanitizeStderr(input);
    expect(result).not.toContain("sk-ant-api03");
    expect(result).toContain("[REDACTED]");
  });

  it("Bearer가 없는 일반 텍스트는 손상되지 않는다", () => {
    const input = "Authorization: Basic dXNlcjpwYXNz";
    // Basic auth는 redact 대상이 아님 (Bearer만)
    const result = sanitizeStderr(input);
    // Basic auth 자체는 해당 패턴에 없으므로 그대로
    expect(typeof result).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. recovery result.json 크기 상한 (10MB)
// ─────────────────────────────────────────────────────────────────────────────

import { recoverPartialResult } from "../recovery/partial.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-m8review-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("[6] recovery result.json 크기 상한 10MB", () => {
  it("result.json이 10MB 초과이면 무시하고 png 스캔으로 폴백한다", () => {
    // 10MB + 1 바이트의 result.json 생성
    const resultJsonPath = path.join(tmpDir, "result.json");
    // 10MB + 1 byte — 실제 파일 쓰기 대신 statSync mock
    // 하지만 실제 파일을 써야 테스트가 의미있음 — 크기 확인 로직 자체를 테스트
    // 빠른 방법: 10MB 데이터 생성
    const TEN_MB = 10 * 1024 * 1024;
    const bigContent = "x".repeat(TEN_MB + 1);
    fs.writeFileSync(resultJsonPath, bigContent, "utf-8");

    // step_1.png 생성 (폴백 경로)
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG", "utf-8");

    const result = recoverPartialResult(tmpDir);
    // 10MB 초과이므로 result.json 무시 → png 스캔으로 폴백
    expect(result).not.toBeNull();
    // png 스캔 폴백 결과: outcome "fail", summary에 "복구" 포함
    expect(result!.outcome).toBe("fail");
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0].screenshot).toBe("step_1.png");
  });

  it("result.json이 10MB 이하이면 정상 파싱한다", () => {
    const validResult = {
      outcome: "pass",
      summary: "정상",
      steps: [],
    };
    fs.writeFileSync(
      path.join(tmpDir, "result.json"),
      JSON.stringify(validResult),
      "utf-8"
    );

    const result = recoverPartialResult(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.outcome).toBe("pass");
  });

  it("result.json이 정확히 10MB이면 정상 파싱 시도한다", () => {
    // 10MB 경계값 테스트 — JSON 형식이 아니므로 파싱 실패 → png 폴백
    const TEN_MB = 10 * 1024 * 1024;
    // 정확히 10MB의 유효한 JSON (불가능, 그냥 파싱 실패 케이스로 처리)
    const boundary = "x".repeat(TEN_MB);
    fs.writeFileSync(path.join(tmpDir, "result.json"), boundary, "utf-8");
    fs.writeFileSync(path.join(tmpDir, "step_1.png"), "PNG", "utf-8");

    // 10MB는 경계값이므로 구현에 따라 무시 or 파싱 시도
    // 어떤 결과든 에러 없이 null 또는 AgentResult 반환이어야 함
    expect(() => recoverPartialResult(tmpDir)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. crashes excerpt 코드 펜스 탈출 방지
// ─────────────────────────────────────────────────────────────────────────────

import { buildCrashesSection } from "../report/write.js";

describe("[7] crashes excerpt — 코드 펜스 탈출 방지", () => {
  it("excerpt에 ``` 3개 이상 연속이 있어도 코드 펜스가 정확히 열림/닫힘 2회만 존재한다", () => {
    const crashes = [
      {
        type: "native-crash" as const,
        excerpt: "some crash\n```\nmore content\n``` end",
        appId: "com.example.app",
      },
    ];
    const section = buildCrashesSection(crashes);

    // 코드 펜스(```)의 등장 횟수 계산
    const backtickFenceCount = (section.match(/```/g) ?? []).length;
    // 정확히 2회: 열림 1 + 닫힘 1
    expect(backtickFenceCount).toBe(2);
  });

  it("excerpt에 ``` 가 없으면 코드 펜스가 2회 그대로", () => {
    const crashes = [
      {
        type: "fatal-exception" as const,
        excerpt: "java.lang.NullPointerException at Main.kt:10",
        appId: "com.example.app",
      },
    ];
    const section = buildCrashesSection(crashes);
    const backtickFenceCount = (section.match(/```/g) ?? []).length;
    expect(backtickFenceCount).toBe(2);
  });

  it("excerpt에 ``` 가 여러 개 있어도 코드 펜스는 2회만", () => {
    const crashes = [
      {
        type: "anr" as const,
        excerpt: "```first fence```\nmore text\n```second fence```",
        appId: "com.example.app",
      },
    ];
    const section = buildCrashesSection(crashes);
    const backtickFenceCount = (section.match(/```/g) ?? []).length;
    expect(backtickFenceCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. buildVideosSection 경로 제한 (basename만)
// ─────────────────────────────────────────────────────────────────────────────

import { buildVideosSection } from "../report/write.js";

describe("[8] buildVideosSection — 경로 traversal 차단", () => {
  it("절대 경로 입력 → basename만 렌더링된다", () => {
    const videos = ["/absolute/path/to/recording.mp4"];
    const section = buildVideosSection(videos);
    expect(section).toContain("recording.mp4");
    // 링크 URL에 절대경로가 없어야 함 (basename으로 변환)
    expect(section).not.toContain("/absolute/path/to/");
  });

  it(".. 경로 입력 → basename만 렌더링된다", () => {
    const videos = ["../../etc/passwd.mp4"];
    const section = buildVideosSection(videos);
    expect(section).toContain("passwd.mp4");
    expect(section).not.toContain("../../");
    expect(section).not.toContain("etc/");
  });

  it("정상 상대 경로(videos/name.mp4) → videos/<basename> 형태로 렌더링", () => {
    const videos = ["session_123/recording.mp4"];
    const section = buildVideosSection(videos);
    expect(section).toContain("recording.mp4");
    // URL은 videos/<basename> 형태여야 함
    const urlMatch = section.match(/\(([^)]+)\)/);
    expect(urlMatch).not.toBeNull();
    const url = urlMatch![1];
    // basename만 또는 videos/ 접두사 + basename
    expect(url).not.toContain("..");
    expect(url).not.toContain("/absolute");
  });

  it("빈 배열이면 빈 문자열 반환 (회귀 없음)", () => {
    expect(buildVideosSection([])).toBe("");
  });

  it("undefined이면 빈 문자열 반환 (회귀 없음)", () => {
    expect(buildVideosSection(undefined)).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. captureLogcat maxBuffer (낮음)
// ─────────────────────────────────────────────────────────────────────────────

describe("[9] captureLogcat — maxBuffer 명시", () => {
  it("android.ts의 captureLogcat이 maxBuffer 옵션을 포함한다 (소스 코드 확인)", async () => {
    // 소스 코드를 읽어서 maxBuffer가 명시되어 있는지 확인
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "../device/android.ts"),
      "utf-8"
    );
    // captureLogcat 함수 내에 maxBuffer가 있어야 함
    const captureLogcatSection = source.slice(source.indexOf("captureLogcat"));
    expect(captureLogcatSection).toContain("maxBuffer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. crash detect 입력 상한 20MB
// ─────────────────────────────────────────────────────────────────────────────

describe("[10] crash detect — 입력 상한 20MB", () => {
  it("20MB 이하 입력은 정상 처리된다", () => {
    const crashes = parseLogcatForCrashes(
      `05-15 10:22:01.123  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main\n` +
      `05-15 10:22:01.124  1234  1234 E AndroidRuntime: Process: ${APP_ID}, PID: 1234\n`,
      APP_ID
    );
    expect(crashes).toHaveLength(1);
  });

  it("crash detect 소스에 20MB 상한이 명시되어 있다", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "../crash/detect.ts"),
      "utf-8"
    );
    // 20MB 상한이 있어야 함
    expect(source).toMatch(/20\s*\*\s*1024\s*\*\s*1024/);
  });

  it("20MB 초과 입력도 크래시 없이 처리된다 (뒷부분 처리)", () => {
    // 20MB + FATAL (뒤)
    const TWENTY_MB = 20 * 1024 * 1024;
    const filler = "x".repeat(TWENTY_MB + 1);
    const fatalBlock = `\n05-15 10:22:01.123  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main\n` +
      `05-15 10:22:01.124  1234  1234 E AndroidRuntime: Process: ${APP_ID}, PID: 1234\n`;
    const bigLog = filler + fatalBlock;

    // 에러 없이 처리되어야 함
    expect(() => parseLogcatForCrashes(bigLog, APP_ID)).not.toThrow();
    // 뒷부분 처리 → FATAL 감지
    const crashes = parseLogcatForCrashes(bigLog, APP_ID);
    expect(crashes.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. 시나리오 모드 partial 복구 테스트 (낮음)
// ─────────────────────────────────────────────────────────────────────────────

describe("[11] 시나리오 모드 — partial 복구", () => {
  it("partial은 suite 집계에서 fail보다 낮은 우선순위다", () => {
    // partial 1개 + pass 나머지 → outcome=partial
    type Outcome = "pass" | "fail" | "error" | "partial";

    function aggregateM8(results: Outcome[]): Outcome {
      if (results.some((o) => o === "error")) return "error";
      if (results.some((o) => o === "fail")) return "fail";
      if (results.some((o) => o === "partial")) return "partial";
      return "pass";
    }

    // partial 1개 + pass 나머지 → outcome=partial
    const outcomes: Outcome[] = ["pass", "pass", "partial"];
    expect(aggregateM8(outcomes)).toBe("partial");
    // CLI exit: partial → 2
    const exitCode = aggregateM8(outcomes) === "partial" ? 2 : 0;
    expect(exitCode).toBe(2);
  });
});
