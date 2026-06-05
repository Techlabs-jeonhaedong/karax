import { describe, it, expect } from "vitest";
import { shouldRespawn, WASM_FLAGS, WASM_MARKER_ENV } from "../wasmFlags.js";

describe("WASM_FLAGS", () => {
  it("3개의 플래그를 포함한다", () => {
    expect(WASM_FLAGS).toHaveLength(3);
    expect(WASM_FLAGS).toContain("--no-wasm-tier-up");
    expect(WASM_FLAGS).toContain("--no-wasm-dynamic-tiering");
    expect(WASM_FLAGS).toContain("--wasm-num-compilation-tasks=1");
  });
});

describe("shouldRespawn", () => {
  // ── 재스폰 필요 케이스 ──────────────────────────────────────────

  it("execArgv가 비어있고 env 마커 없으면 재스폰 필요", () => {
    expect(shouldRespawn([], {})).toBe(true);
  });

  it("execArgv에 관련 없는 플래그만 있고 env 마커 없으면 재스폰 필요", () => {
    expect(shouldRespawn(["--max-old-space-size=4096"], {})).toBe(true);
  });

  it("env 마커가 '1'이 아닌 빈 문자열이면 재스폰 필요", () => {
    expect(shouldRespawn([], { [WASM_MARKER_ENV]: "" })).toBe(true);
  });

  it("env 마커가 'true'이면 재스폰 필요 (엄격 비교)", () => {
    expect(shouldRespawn([], { [WASM_MARKER_ENV]: "true" })).toBe(true);
  });

  it("env 마커가 '0'이면 재스폰 필요", () => {
    expect(shouldRespawn([], { [WASM_MARKER_ENV]: "0" })).toBe(true);
  });

  // ── 재스폰 불필요 케이스 ────────────────────────────────────────

  it("env 마커가 '1'이면 재스폰 불필요 (이중 가드)", () => {
    expect(shouldRespawn([], { [WASM_MARKER_ENV]: "1" })).toBe(false);
  });

  it("execArgv에 --no-wasm-tier-up 있으면 재스폰 불필요", () => {
    expect(shouldRespawn(["--no-wasm-tier-up"], {})).toBe(false);
  });

  it("execArgv에 전체 플래그가 있으면 재스폰 불필요", () => {
    expect(
      shouldRespawn(
        ["--no-wasm-tier-up", "--no-wasm-dynamic-tiering", "--wasm-num-compilation-tasks=1"],
        {}
      )
    ).toBe(false);
  });

  it("env 마커 '1' + execArgv에 플래그 있으면 재스폰 불필요", () => {
    expect(
      shouldRespawn(["--no-wasm-tier-up"], { [WASM_MARKER_ENV]: "1" })
    ).toBe(false);
  });

  // ── 경계값 / 엣지 케이스 ────────────────────────────────────────

  it("env 마커 키가 undefined이면 재스폰 필요", () => {
    expect(shouldRespawn([], { [WASM_MARKER_ENV]: undefined })).toBe(true);
  });

  it("execArgv에 부분 문자열 '--no-wasm'이 있어도 정확히 매칭 안되면 재스폰 필요", () => {
    expect(shouldRespawn(["--no-wasm"], {})).toBe(true);
  });

  it("execArgv에 플래그가 대소문자 다르면 재스폰 필요 (case-sensitive)", () => {
    expect(shouldRespawn(["--NO-WASM-TIER-UP"], {})).toBe(true);
  });

  it("execArgv에 다른 WASM 플래그만 있고 --no-wasm-tier-up 없으면 재스폰 필요", () => {
    expect(
      shouldRespawn(
        ["--no-wasm-dynamic-tiering", "--wasm-num-compilation-tasks=1"],
        {}
      )
    ).toBe(true);
  });
});
