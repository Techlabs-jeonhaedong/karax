/**
 * packages/e2e/src/runtime/dumpAndroid.ts 단위 테스트
 *
 * execa mock으로 adb 호출 없이 순수 동작 검증.
 * 실제 디바이스 불필요.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { E2eError } from "../types.js";

// execa mock
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

// @karax/doctor mock (adb 경로 탐지)
vi.mock("@karax/doctor", () => ({
  detectAndroidSdkPath: vi.fn().mockResolvedValue("/sdk"),
}));

import { execa } from "execa";
import { dumpAndroidUI } from "../runtime/dumpAndroid.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 정상 흐름 ───────────────────────────────────────────────────────

describe("dumpAndroidUI — 정상 흐름", () => {
  it("adb uiautomator dump 명령을 올바른 경로로 호출한다", async () => {
    // dump 성공
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    // exec-out cat 성공 (XML 반환)
    mockExeca.mockResolvedValueOnce({ stdout: "<hierarchy/>", stderr: "", exitCode: 0 });
    // rm 성공 (best-effort, void)
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    const xml = await dumpAndroidUI("emulator-5554");
    expect(xml).toBe("<hierarchy/>");

    // dump 호출 검증
    const dumpCall = mockExeca.mock.calls[0];
    expect(dumpCall[0]).toContain("adb");
    expect(dumpCall[1]).toContain("-s");
    expect(dumpCall[1]).toContain("emulator-5554");
    expect(dumpCall[1]).toContain("uiautomator");
    expect(dumpCall[1]).toContain("dump");
    // 고유 경로 — /sdcard/karax_dump_*.xml 패턴 확인
    const dumpPath = dumpCall[1].find((a: string) => a.startsWith("/sdcard/karax_dump_"));
    expect(dumpPath).toMatch(/^\/sdcard\/karax_dump_[a-z0-9]+\.xml$/);
  });

  it("exec-out cat 명령으로 XML을 수신한다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // dump
    mockExeca.mockResolvedValueOnce({ stdout: "<hierarchy/>", stderr: "", exitCode: 0 }); // cat
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rm

    await dumpAndroidUI("emulator-5554");

    const catCall = mockExeca.mock.calls[1];
    expect(catCall[0]).toContain("adb");
    expect(catCall[1]).toContain("-s");
    expect(catCall[1]).toContain("emulator-5554");
    expect(catCall[1]).toContain("exec-out");
    expect(catCall[1]).toContain("cat");
    // dump와 동일한 고유 경로 사용 확인
    const catPath = catCall[1].find((a: string) => a.startsWith("/sdcard/karax_dump_"));
    expect(catPath).toMatch(/^\/sdcard\/karax_dump_[a-z0-9]+\.xml$/);
  });

  it("rm -f로 임시 파일을 정리한다 (best-effort)", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // dump
    mockExeca.mockResolvedValueOnce({ stdout: "<hierarchy/>", stderr: "", exitCode: 0 }); // cat
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rm

    await dumpAndroidUI("emulator-5554");

    const rmCall = mockExeca.mock.calls[2];
    expect(rmCall[0]).toContain("adb");
    expect(rmCall[1]).toContain("rm");
    expect(rmCall[1]).toContain("-f");
    // dump와 동일한 고유 경로 rm 확인
    const rmPath = rmCall[1].find((a: string) => a.startsWith("/sdcard/karax_dump_"));
    expect(rmPath).toMatch(/^\/sdcard\/karax_dump_[a-z0-9]+\.xml$/);
  });

  it("rm 실패해도 XML을 정상 반환한다 (best-effort)", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // dump
    mockExeca.mockResolvedValueOnce({ stdout: "<hierarchy/>", stderr: "", exitCode: 0 }); // cat
    mockExeca.mockRejectedValueOnce(new Error("rm failed")); // rm 실패

    const xml = await dumpAndroidUI("emulator-5554");
    expect(xml).toBe("<hierarchy/>");
  });

  it("adb 경로가 ANDROID_HOME 기반으로 구성된다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    mockExeca.mockResolvedValueOnce({ stdout: "<hierarchy/>", stderr: "", exitCode: 0 });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await dumpAndroidUI("emulator-5554");

    const adbPath = mockExeca.mock.calls[0][0] as string;
    expect(adbPath).toMatch(/platform-tools.*adb/);
  });
});

// ─── deviceId 검증 ───────────────────────────────────────────────────

describe("dumpAndroidUI — deviceId 검증", () => {
  it("유효한 deviceId (emulator-5554) 는 통과한다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    mockExeca.mockResolvedValueOnce({ stdout: "<hierarchy/>", stderr: "", exitCode: 0 });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(dumpAndroidUI("emulator-5554")).resolves.toBeDefined();
  });

  it("유효한 deviceId (192.168.1.100:5555) 는 통과한다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    mockExeca.mockResolvedValueOnce({ stdout: "<hierarchy/>", stderr: "", exitCode: 0 });
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

    await expect(dumpAndroidUI("192.168.1.100:5555")).resolves.toBeDefined();
  });

  it("'-'로 시작하는 deviceId는 INVALID_ARGUMENT 에러를 던진다", async () => {
    await expect(dumpAndroidUI("-bad-id")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("빈 문자열 deviceId는 INVALID_ARGUMENT 에러를 던진다", async () => {
    await expect(dumpAndroidUI("")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("공백 포함 deviceId는 INVALID_ARGUMENT 에러를 던진다", async () => {
    await expect(dumpAndroidUI("emulator 5554")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("세미콜론 포함 deviceId는 INVALID_ARGUMENT 에러를 던진다 (인젝션 방지)", async () => {
    await expect(dumpAndroidUI("emulator;rm -rf /")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("& 포함 deviceId는 INVALID_ARGUMENT 에러를 던진다 (인젝션 방지)", async () => {
    await expect(dumpAndroidUI("emulator&evil")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });
});

// ─── 실패 시 에러 코드 ────────────────────────────────────────────────

describe("dumpAndroidUI — 실패 시 에러 코드", () => {
  it("uiautomator dump 실패 시 DUMP_FAILED 에러를 던진다", async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("adb: device not found"), { stderr: "device not found" })
    );

    await expect(dumpAndroidUI("emulator-5554")).rejects.toMatchObject({
      code: "DUMP_FAILED",
    });
  });

  it("dump 실패 시 디바이스 없음 메시지가 포함된다", async () => {
    mockExeca.mockRejectedValueOnce(
      Object.assign(new Error("device 'emulator-5554' not found"), {
        stderr: "error: device 'emulator-5554' not found",
      })
    );

    const error = await dumpAndroidUI("emulator-5554").catch((e) => e);
    expect(error).toBeInstanceOf(E2eError);
    expect(error.code).toBe("DUMP_FAILED");
    expect(error.message).toMatch(/not found|emulator-5554/i);
  });

  it("exec-out cat 실패 시 DUMP_FAILED 에러를 던진다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // dump ok
    mockExeca.mockRejectedValueOnce(new Error("exec-out cat failed")); // cat fails

    await expect(dumpAndroidUI("emulator-5554")).rejects.toMatchObject({
      code: "DUMP_FAILED",
    });
  });

  it("dump 결과가 빈 문자열이면 DUMP_FAILED를 던진다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // dump
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // cat → 빈 결과
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 }); // rm

    await expect(dumpAndroidUI("emulator-5554")).rejects.toMatchObject({
      code: "DUMP_FAILED",
    });
  });
});
