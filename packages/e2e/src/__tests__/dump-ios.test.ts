/**
 * packages/e2e/src/runtime/dumpIos.ts 단위 테스트
 *
 * execa mock으로 idb 호출 없이 순수 동작 검증.
 * 실제 디바이스/idb 불필요.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { E2eError } from "../types.js";

// execa mock
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { isIdbAvailable, dumpIosUI } from "../runtime/dumpIos.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── isIdbAvailable ───────────────────────────────────────────────────────

describe("isIdbAvailable", () => {
  it("idb --version 성공 시 true를 반환한다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "1.1.8", stderr: "", exitCode: 0 });
    const result = await isIdbAvailable();
    expect(result).toBe(true);
  });

  it("idb --version 호출 인자가 정확하다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "1.1.8", stderr: "", exitCode: 0 });
    await isIdbAvailable();
    expect(mockExeca).toHaveBeenCalledWith("idb", ["--version"], expect.objectContaining({ timeout: 5000 }));
  });

  it("idb 미설치(ENOENT) 시 false를 반환한다", async () => {
    const err = Object.assign(new Error("spawn idb ENOENT"), { code: "ENOENT" });
    mockExeca.mockRejectedValueOnce(err);
    const result = await isIdbAvailable();
    expect(result).toBe(false);
  });

  it("idb 실행 실패(timeout 등) 시 false를 반환한다", async () => {
    mockExeca.mockRejectedValueOnce(new Error("Command timed out"));
    const result = await isIdbAvailable();
    expect(result).toBe(false);
  });

  it("idb --version 출력이 없어도(빈 string) true를 반환한다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });
    const result = await isIdbAvailable();
    expect(result).toBe(true);
  });
});

// ─── dumpIosUI — 정상 흐름 ────────────────────────────────────────────────

describe("dumpIosUI — 정상 흐름", () => {
  const UDID = "00008020-001A2B3C4D5E6F70";
  const SAMPLE_JSON = JSON.stringify([{ type: "Button", AXLabel: "확인", frame: { x: 0, y: 0, width: 100, height: 44 }, AXEnabled: true }]);

  it("idb ui describe-all --udid <id> --json 형식으로 호출한다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: SAMPLE_JSON, stderr: "", exitCode: 0 });
    await dumpIosUI(UDID);
    const call = mockExeca.mock.calls[0];
    expect(call[0]).toBe("idb");
    expect(call[1]).toEqual(["ui", "describe-all", "--udid", UDID, "--json"]);
  });

  it("idb stdout을 그대로 반환한다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: SAMPLE_JSON, stderr: "", exitCode: 0 });
    const result = await dumpIosUI(UDID);
    expect(result).toBe(SAMPLE_JSON);
  });

  it("5초 이상 타임아웃 옵션이 설정된다", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: SAMPLE_JSON, stderr: "", exitCode: 0 });
    await dumpIosUI(UDID);
    const opts = mockExeca.mock.calls[0][2] as { timeout: number };
    expect(opts.timeout).toBeGreaterThanOrEqual(5000);
  });
});

// ─── dumpIosUI — deviceId 검증 ───────────────────────────────────────────

describe("dumpIosUI — deviceId(UDID) 검증", () => {
  it("유효한 UDID (16진수) 는 통과한다", async () => {
    const udid = "00008020-001A2B3C4D5E6F70";
    mockExeca.mockResolvedValueOnce({ stdout: "[]", stderr: "", exitCode: 0 });
    await expect(dumpIosUI(udid)).resolves.toBeDefined();
  });

  it("빈 문자열 UDID는 INVALID_ARGUMENT 에러를 던진다", async () => {
    await expect(dumpIosUI("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("공백 포함 UDID는 INVALID_ARGUMENT 에러를 던진다", async () => {
    await expect(dumpIosUI("0000 8020")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("세미콜론 포함 UDID는 INVALID_ARGUMENT 에러를 던진다 (인젝션 방지)", async () => {
    await expect(dumpIosUI("udid;rm -rf /")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("& 포함 UDID는 INVALID_ARGUMENT 에러를 던진다", async () => {
    await expect(dumpIosUI("udid&evil")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});

// ─── dumpIosUI — idb 미설치 ───────────────────────────────────────────────

describe("dumpIosUI — idb 미설치(ENOENT)", () => {
  it("ENOENT 에러 발생 시 IDB_UNAVAILABLE 코드를 던진다", async () => {
    const err = Object.assign(new Error("spawn idb ENOENT"), { code: "ENOENT" });
    mockExeca.mockRejectedValueOnce(err);
    const error = await dumpIosUI("00008020-001A2B3C4D5E6F70").catch((e) => e);
    expect(error).toBeInstanceOf(E2eError);
    expect(error.code).toBe("IDB_UNAVAILABLE");
  });

  it("IDB_UNAVAILABLE 에러 메시지에 brew 설치 안내가 포함된다", async () => {
    const err = Object.assign(new Error("spawn idb ENOENT"), { code: "ENOENT" });
    mockExeca.mockRejectedValueOnce(err);
    const error = await dumpIosUI("00008020-001A2B3C4D5E6F70").catch((e) => e);
    expect(error.message).toMatch(/brew/i);
  });

  it("비ENOENT 에러(타임아웃 등)는 IDB_UNAVAILABLE로 반환한다", async () => {
    mockExeca.mockRejectedValueOnce(new Error("Command timed out"));
    const error = await dumpIosUI("00008020-001A2B3C4D5E6F70").catch((e) => e);
    expect(error).toBeInstanceOf(E2eError);
    expect(error.code).toBe("IDB_UNAVAILABLE");
  });

  // ─── M10 검수: 에러 메시지에 원본 err.message 노출 금지 ─────────────────
  // 시스템 경로, 내부 정보 등이 노출되면 안 된다.

  it("IDB_UNAVAILABLE 메시지에 원본 시스템 에러 경로가 포함되지 않는다 (ENOENT)", async () => {
    const sensitiveMsg = "/usr/local/bin/idb: spawn ENOENT /private/var/folders/secret-path";
    const err = Object.assign(new Error(sensitiveMsg), { code: "ENOENT" });
    mockExeca.mockRejectedValueOnce(err);
    const error = await dumpIosUI("00008020-001A2B3C4D5E6F70").catch((e) => e);
    expect(error.code).toBe("IDB_UNAVAILABLE");
    // 원본 메시지(시스템 경로 포함)가 그대로 노출되면 안 됨
    expect(error.message).not.toContain(sensitiveMsg);
    // brew 안내만 포함해야 한다
    expect(error.message).toMatch(/brew/i);
  });

  it("IDB_UNAVAILABLE 메시지에 원본 타임아웃 상세 정보가 포함되지 않는다", async () => {
    const sensitiveMsg = "Command timed out after 30000ms at /private/tmp/karax/internal/idb_helper";
    mockExeca.mockRejectedValueOnce(new Error(sensitiveMsg));
    const error = await dumpIosUI("00008020-001A2B3C4D5E6F70").catch((e) => e);
    expect(error.code).toBe("IDB_UNAVAILABLE");
    expect(error.message).not.toContain(sensitiveMsg);
    expect(error.message).toMatch(/brew/i);
  });

  it("IDB_UNAVAILABLE 메시지는 고정 힌트만 포함한다 (내용 계약)", async () => {
    const err = Object.assign(new Error("any error"), { code: "ENOENT" });
    mockExeca.mockRejectedValueOnce(err);
    const error = await dumpIosUI("00008020-001A2B3C4D5E6F70").catch((e) => e);
    // 고정 힌트 문자열만 포함해야 함: idb 관련 + brew 설치 안내
    expect(error.message).toContain("idb");
    expect(error.message).toMatch(/brew install/i);
    // 원본 "any error" 문자열이 노출되면 안 됨
    expect(error.message).not.toContain("any error");
  });
});
