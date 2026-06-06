/**
 * iOS 체크 단위 테스트 — checkIosSimulator / checkIosIdb
 *
 * Red → Green → Refactor 사이클
 * execa 및 process.platform을 mock으로 격리한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import { checkIosSimulator } from "../checks/iosSimulator.js";
import { checkIosIdb } from "../checks/iosIdb.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockExeca = execa as any as ReturnType<typeof vi.fn>;

// process.platform을 mock하는 헬퍼
function setPlatform(platform: string) {
  Object.defineProperty(process, "platform", {
    value: platform,
    writable: true,
    configurable: true,
  });
}

const originalPlatform = process.platform;

beforeEach(() => {
  vi.clearAllMocks();
  // 기본은 darwin
  setPlatform("darwin");
  mockExeca.mockRejectedValue(Object.assign(new Error("not found"), { exitCode: 1 }));
});

afterEach(() => {
  setPlatform(originalPlatform);
});

// ─── checkIosSimulator ────────────────────────────────────────────────────────

describe("checkIosSimulator", () => {
  const SIMCTL_OUT_DEVICES = [
    "== Devices ==",
    "-- iOS 17.5 --",
    "    iPhone 15 (A1B2C3D4-...) (Shutdown)",
    "    iPhone 15 Pro (E5F6A7B8-...) (Booted)",
    "-- iOS 16.4 --",
    "    iPhone 14 (C9D0E1F2-...) (Shutdown)",
  ].join("\n");

  it("non-darwin이면 즉시 missing 반환", async () => {
    setPlatform("linux");
    const result = await checkIosSimulator();
    expect(result.id).toBe("ios-simulator");
    expect(result.status).toBe("missing");
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("simctl 성공 + 디바이스 N개 → ok, version에 '(N devices)' 표기", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: SIMCTL_OUT_DEVICES,
      stderr: "",
      exitCode: 0,
    });
    const result = await checkIosSimulator();
    expect(result.id).toBe("ios-simulator");
    expect(result.status).toBe("ok");
    expect(result.version).toMatch(/\d+ device/);
  });

  it("simctl 성공 + 디바이스 0개 → missing", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "== Devices ==\n",
      stderr: "",
      exitCode: 0,
    });
    const result = await checkIosSimulator();
    expect(result.status).toBe("missing");
  });

  it("simctl 실패 → missing", async () => {
    mockExeca.mockRejectedValueOnce(new Error("xcrun: not found"));
    const result = await checkIosSimulator();
    expect(result.status).toBe("missing");
  });

  it("optional=true, autoInstallable=false", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkIosSimulator();
    expect(result.optional).toBe(true);
    expect(result.autoInstallable).toBe(false);
  });

  it("hint 문자열이 비어있지 않음", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkIosSimulator();
    expect(result.hint).toBeTruthy();
    expect(result.hint.length).toBeGreaterThan(0);
  });

  it("label이 비어있지 않음", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkIosSimulator();
    expect(result.label).toBeTruthy();
  });

  it("simctl 커맨드에 'available' 인자를 사용해 사용 가능 디바이스만 조회", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: SIMCTL_OUT_DEVICES,
      stderr: "",
      exitCode: 0,
    });
    await checkIosSimulator();
    expect(mockExeca).toHaveBeenCalledWith(
      "xcrun",
      expect.arrayContaining(["simctl", "list", "devices", "available"]),
      expect.anything()
    );
  });
});

// ─── checkIosIdb ──────────────────────────────────────────────────────────────

describe("checkIosIdb", () => {
  it("non-darwin이면 즉시 missing 반환", async () => {
    setPlatform("linux");
    const result = await checkIosIdb();
    expect(result.id).toBe("ios-idb");
    expect(result.status).toBe("missing");
    expect(mockExeca).not.toHaveBeenCalled();
  });

  it("idb --version 성공 → ok, version 세팅", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: "1.1.7",
      stderr: "",
      exitCode: 0,
    });
    const result = await checkIosIdb();
    expect(result.id).toBe("ios-idb");
    expect(result.status).toBe("ok");
    expect(result.version).toBeTruthy();
  });

  it("idb 실패 + idb_companion 성공 → missing (companion만 있는 상태, hint에 클라이언트 안내)", async () => {
    // idb --version 실패
    mockExeca.mockRejectedValueOnce(new Error("idb: not found"));
    // idb_companion --version 성공
    mockExeca.mockResolvedValueOnce({
      stdout: "idb_companion: 1.1.7",
      stderr: "",
      exitCode: 0,
    });
    const result = await checkIosIdb();
    expect(result.status).toBe("missing");
    // hint에 클라이언트 설치 안내가 포함돼야 함
    expect(result.hint).toMatch(/companion|client|pip|brew/i);
  });

  it("idb 실패 + idb_companion 실패 → missing", async () => {
    mockExeca.mockRejectedValueOnce(new Error("idb: not found"));
    mockExeca.mockRejectedValueOnce(new Error("idb_companion: not found"));
    const result = await checkIosIdb();
    expect(result.status).toBe("missing");
  });

  it("optional=true, autoInstallable=true", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkIosIdb();
    expect(result.optional).toBe(true);
    expect(result.autoInstallable).toBe(true);
  });

  it("hint 문자열이 비어있지 않음", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkIosIdb();
    expect(result.hint).toBeTruthy();
  });

  it("label이 비어있지 않음", async () => {
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    mockExeca.mockRejectedValueOnce(new Error("not found"));
    const result = await checkIosIdb();
    expect(result.label).toBeTruthy();
  });
});
