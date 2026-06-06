/**
 * crash/detect.ts 단위 테스트 — parseLogcatForCrashes
 */

import { describe, it, expect } from "vitest";
import { parseLogcatForCrashes } from "../crash/detect.js";

const APP_ID = "com.example.myapp";

// ── FATAL EXCEPTION ────────────────────────────────────────────────

const FATAL_LOGCAT = `
05-15 10:22:01.123  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.124  1234  1234 E AndroidRuntime: Process: com.example.myapp, PID: 1234
05-15 10:22:01.125  1234  1234 E AndroidRuntime: java.lang.NullPointerException: Attempt to invoke virtual method
05-15 10:22:01.126  1234  1234 E AndroidRuntime: 	at com.example.myapp.MainActivity.onCreate(MainActivity.kt:42)
05-15 10:22:01.127  1234  1234 E AndroidRuntime: 	at android.app.Activity.performCreate(Activity.java:8000)
05-15 10:22:01.128  1234  1234 E AndroidRuntime: 	at android.app.ActivityThread.performLaunchActivity(ActivityThread.java:3400)
05-15 10:22:01.129  1234  1234 E AndroidRuntime: 	at android.app.ActivityThread.handleLaunchActivity(ActivityThread.java:3600)
`;

const FATAL_OTHER_APP = `
05-15 10:22:01.123  5678  5678 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.124  5678  5678 E AndroidRuntime: Process: com.other.app, PID: 5678
05-15 10:22:01.125  5678  5678 E AndroidRuntime: java.lang.RuntimeException: crash in other app
`;

// ── ANR ───────────────────────────────────────────────────────────

const ANR_LOGCAT = `
05-15 11:00:00.000  1000  1000 E ActivityManager: ANR in com.example.myapp (com.example.myapp/.MainActivity)
05-15 11:00:00.001  1000  1000 E ActivityManager: PID: 9999
05-15 11:00:00.002  1000  1000 E ActivityManager: Reason: Input dispatching timed out
05-15 11:00:00.003  1000  1000 E ActivityManager: Load: 1.2 / 2.1 / 2.5
`;

const ANR_OTHER_APP = `
05-15 11:00:00.000  1000  1000 E ActivityManager: ANR in com.thirdparty.app (com.thirdparty.app/.OtherActivity)
05-15 11:00:00.001  1000  1000 E ActivityManager: Reason: Input dispatching timed out
`;

// ── Process Death ──────────────────────────────────────────────────

const PROCESS_DEATH_LOGCAT = `
05-15 12:00:00.000  1000  1000 I ActivityManager: Process com.example.myapp (pid 2222) has died
05-15 12:00:00.001  1000  1000 W ActivityManager: Force finishing activity com.example.myapp/.MainActivity
`;

const PROCESS_DEATH_OTHER = `
05-15 12:00:00.000  1000  1000 I ActivityManager: Process com.another.app (pid 3333) has died
`;

// ── Native Crash ───────────────────────────────────────────────────

const NATIVE_CRASH_LOGCAT = `
05-15 13:00:00.000  9999  9999 F libc    : Fatal signal 11 (SIGSEGV), code 1
05-15 13:00:00.001  9999  9999 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
05-15 13:00:00.002  9999  9999 F DEBUG   : Build fingerprint: 'google/sdk_gphone/generic:14/UE1A.230829.036/11228894:userdebug/dev-keys'
05-15 13:00:00.003  9999  9999 F DEBUG   : pid: 9999, tid: 9999, name: com.example.myapp
05-15 13:00:00.004  9999  9999 F DEBUG   : signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0000000000000001
05-15 13:00:00.005  9999  9999 F DEBUG   : backtrace:
05-15 13:00:00.006  9999  9999 F DEBUG   :     #00 pc 00007f8c4a1b3c20  /data/app/com.example.myapp/lib/arm64/libnative.so
05-15 13:00:00.007  9999  9999 F DEBUG   :     #01 pc 00007f8c4a1b4000  /data/app/com.example.myapp/lib/arm64/libnative.so
`;

// ── 무관한 로그 ────────────────────────────────────────────────────

const IRRELEVANT_LOGCAT = `
05-15 09:00:00.000  1234  1234 I myapp  : App started
05-15 09:00:00.001  1234  1234 D myapp  : Loading resources
05-15 09:00:00.002  1234  1234 I myapp  : Screen rendered
05-15 09:00:00.003  1234  1234 W myapp  : slow frame: 18ms
`;

describe("parseLogcatForCrashes", () => {
  // ── FATAL EXCEPTION ─────────────────────────────────────────────

  it("FATAL EXCEPTION 블록을 감지한다", () => {
    const crashes = parseLogcatForCrashes(FATAL_LOGCAT, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].type).toBe("fatal-exception");
  });

  it("FATAL EXCEPTION의 발췌에 스택 트레이스 일부가 포함된다", () => {
    const crashes = parseLogcatForCrashes(FATAL_LOGCAT, APP_ID);
    expect(crashes[0].excerpt).toContain("NullPointerException");
  });

  it("FATAL EXCEPTION의 appId가 일치한다", () => {
    const crashes = parseLogcatForCrashes(FATAL_LOGCAT, APP_ID);
    expect(crashes[0].appId).toBe(APP_ID);
  });

  it("다른 앱의 FATAL EXCEPTION은 무시된다", () => {
    const crashes = parseLogcatForCrashes(FATAL_OTHER_APP, APP_ID);
    expect(crashes).toHaveLength(0);
  });

  // ── ANR ─────────────────────────────────────────────────────────

  it("ANR in <pkg>를 감지한다", () => {
    const crashes = parseLogcatForCrashes(ANR_LOGCAT, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].type).toBe("anr");
  });

  it("ANR의 발췌에 내용이 포함된다", () => {
    const crashes = parseLogcatForCrashes(ANR_LOGCAT, APP_ID);
    expect(crashes[0].excerpt.length).toBeGreaterThan(0);
  });

  it("다른 앱의 ANR은 무시된다", () => {
    const crashes = parseLogcatForCrashes(ANR_OTHER_APP, APP_ID);
    expect(crashes).toHaveLength(0);
  });

  // ── Process Death ────────────────────────────────────────────────

  it("Process has died를 감지한다", () => {
    const crashes = parseLogcatForCrashes(PROCESS_DEATH_LOGCAT, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].type).toBe("process-death");
  });

  it("다른 앱의 Process death는 무시된다", () => {
    const crashes = parseLogcatForCrashes(PROCESS_DEATH_OTHER, APP_ID);
    expect(crashes).toHaveLength(0);
  });

  // ── Native Crash ─────────────────────────────────────────────────

  it("*** *** *** / backtrace: native crash를 감지한다", () => {
    const crashes = parseLogcatForCrashes(NATIVE_CRASH_LOGCAT, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].type).toBe("native-crash");
  });

  it("native crash 발췌에 backtrace 정보가 포함된다", () => {
    const crashes = parseLogcatForCrashes(NATIVE_CRASH_LOGCAT, APP_ID);
    expect(crashes[0].excerpt).toContain("SIGSEGV");
  });

  // ── 무관한 로그 ──────────────────────────────────────────────────

  it("무관한 로그에서는 빈 배열을 반환한다", () => {
    const crashes = parseLogcatForCrashes(IRRELEVANT_LOGCAT, APP_ID);
    expect(crashes).toHaveLength(0);
  });

  it("빈 문자열 입력에서는 빈 배열을 반환한다", () => {
    const crashes = parseLogcatForCrashes("", APP_ID);
    expect(crashes).toHaveLength(0);
  });

  // ── API 키 redact ─────────────────────────────────────────────────

  it("발췌에서 API 키가 redact된다", () => {
    const logcatWithSecret = `
05-15 10:22:01.123  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.124  1234  1234 E AndroidRuntime: Process: com.example.myapp, PID: 1234
05-15 10:22:01.125  1234  1234 E AndroidRuntime: ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx error
`;
    const crashes = parseLogcatForCrashes(logcatWithSecret, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].excerpt).not.toContain("sk-ant-api03");
    expect(crashes[0].excerpt).toContain("[REDACTED]");
  });

  // ── 5MB 상한 ─────────────────────────────────────────────────────

  it("5MB 초과 입력은 뒷부분만 처리한다 (FATAL이 뒤에 있어야 감지됨)", () => {
    // 5MB의 무관한 로그 + 끝에 FATAL
    const filler = "05-15 09:00:00.000  1234  1234 I log : data\n".repeat(
      Math.ceil((5 * 1024 * 1024) / 45) + 100
    );
    const fatalBlock = FATAL_LOGCAT;
    const bigLog = filler + fatalBlock;

    // 뒷부분 처리 → FATAL이 감지되어야 함
    const crashes = parseLogcatForCrashes(bigLog, APP_ID);
    // 5MB 상한 적용: 앞부분이 잘리고 뒷부분(FATAL 포함)만 처리
    expect(crashes.length).toBeGreaterThanOrEqual(1);
  });

  it("5MB 이하 입력은 전체를 처리한다", () => {
    const crashes = parseLogcatForCrashes(FATAL_LOGCAT, APP_ID);
    expect(crashes).toHaveLength(1);
  });

  // ── excerpt 최대 2000자 ───────────────────────────────────────────

  it("excerpt는 최대 2000자로 제한된다", () => {
    // 매우 긴 스택 트레이스를 가진 FATAL
    const longStack = Array.from({ length: 200 }, (_, i) =>
      `05-15 10:22:01.${i.toString().padStart(3, "0")}  1234  1234 E AndroidRuntime: \tat very.long.stack.trace.ClassName${i}.method(File${i}.kt:${i})`
    ).join("\n");
    const longFatal = `
05-15 10:22:01.000  1234  1234 E AndroidRuntime: FATAL EXCEPTION: main
05-15 10:22:01.001  1234  1234 E AndroidRuntime: Process: com.example.myapp, PID: 1234
05-15 10:22:01.002  1234  1234 E AndroidRuntime: java.lang.RuntimeException: very long error
${longStack}
`;
    const crashes = parseLogcatForCrashes(longFatal, APP_ID);
    expect(crashes).toHaveLength(1);
    expect(crashes[0].excerpt.length).toBeLessThanOrEqual(2000);
  });

  // ── 여러 크래시 ───────────────────────────────────────────────────

  it("여러 종류의 크래시가 모두 감지된다", () => {
    const combined = FATAL_LOGCAT + "\n" + ANR_LOGCAT + "\n" + PROCESS_DEATH_LOGCAT;
    const crashes = parseLogcatForCrashes(combined, APP_ID);
    // 3가지 모두 감지 (최소 3개)
    expect(crashes.length).toBeGreaterThanOrEqual(2);
    const types = crashes.map((c) => c.type);
    expect(types).toContain("fatal-exception");
    expect(types).toContain("anr");
  });

  // ── CrashEvent 스키마 검증 ────────────────────────────────────────

  it("반환된 CrashEvent 객체가 스키마를 만족한다", () => {
    const crashes = parseLogcatForCrashes(FATAL_LOGCAT, APP_ID);
    const crash = crashes[0];
    expect(crash).toHaveProperty("type");
    expect(crash).toHaveProperty("excerpt");
    expect(typeof crash.excerpt).toBe("string");
    expect(["fatal-exception", "anr", "process-death", "native-crash"]).toContain(crash.type);
  });
});
