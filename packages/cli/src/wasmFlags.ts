/**
 * WASM Turboshaft 크래시 워크어라운드 플래그.
 *
 * Node v24 V8 Turboshaft가 tree-sitter-swift.wasm을 백그라운드 컴파일할 때
 * Zone OOM으로 프로세스가 즉사하는 알려진 이슈.
 * packages/adapter-ios/vitest.config.ts에 동일한 execArgv 워크어라운드 적용돼 있음.
 *
 * V8 플래그는 NODE_OPTIONS 허용 목록에 없어 환경 변수로 전달 불가.
 * execArgv / 명령행으로만 전달 가능.
 */

export const WASM_FLAGS = [
  "--no-wasm-tier-up",
  "--no-wasm-dynamic-tiering",
  "--wasm-num-compilation-tasks=1",
] as const;

/** 재스폰 마커 환경 변수 키 */
export const WASM_MARKER_ENV = "KARAX_WASM_FLAGS_APPLIED";

/**
 * 현재 프로세스가 WASM 플래그 없이 실행됐는지 판단해 재스폰이 필요한지 반환한다.
 *
 * 조건: execArgv에 플래그가 없고, env 마커도 없을 때 재스폰 필요.
 * 이중 가드로 무한 재귀를 방지한다.
 *
 * @param execArgv - process.execArgv
 * @param env - process.env
 */
export function shouldRespawn(
  execArgv: readonly string[],
  env: Record<string, string | undefined>
): boolean {
  // env 마커가 있으면 이미 재스폰된 자식 프로세스 → 재스폰 불필요
  if (env[WASM_MARKER_ENV] === "1") return false;
  // execArgv에 플래그가 이미 있으면 재스폰 불필요
  if (execArgv.includes("--no-wasm-tier-up")) return false;
  return true;
}
