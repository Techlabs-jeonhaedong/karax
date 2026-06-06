/**
 * runtime/dumpIos.ts — iOS idb UI 덤프 I/O 어댑터
 *
 * idb가 설치돼 있으면 `idb ui describe-all --udid <id> --json` 출력을 반환한다.
 * idb가 없으면(ENOENT) IDB_UNAVAILABLE 에러를 던진다.
 *
 * deviceId(UDID) 검증은 dumpAndroid.ts의 DEVICE_ID_RE를 재사용한다.
 */

import { execa } from "execa";
import { E2eError } from "../types.js";
import { DEVICE_ID_RE } from "./dumpAndroid.js";

const IDB_PROBE_TIMEOUT = 5_000;
const IDB_DUMP_TIMEOUT = 30_000;

const IDB_UNAVAILABLE_HINT =
  "idb가 설치돼 있지 않거나 실행할 수 없습니다. " +
  "iOS 입력 주입을 사용하려면: brew install facebook/fb/idb-companion";

function validateDeviceId(deviceId: string): void {
  if (!deviceId || !DEVICE_ID_RE.test(deviceId)) {
    throw new E2eError(
      "INVALID_ARGUMENT",
      `유효하지 않은 deviceId: "${deviceId}". 영숫자·'_'·':'·'.'·'-'만 허용, '-'로 시작 불가.`
    );
  }
}

/**
 * idb --version을 실행해 idb 설치 여부를 확인한다.
 * 5초 이내에 응답이 없거나 ENOENT이면 false.
 */
export async function isIdbAvailable(): Promise<boolean> {
  try {
    await execa("idb", ["--version"], { timeout: IDB_PROBE_TIMEOUT });
    return true;
  } catch {
    return false;
  }
}

/**
 * idb ui describe-all --udid <id> --json 을 실행해 raw JSON stdout을 반환한다.
 *
 * - deviceId 유효성 검증 실패 → INVALID_ARGUMENT
 * - idb 미설치(ENOENT 또는 실행 실패) → IDB_UNAVAILABLE (brew 설치 안내 포함)
 */
export async function dumpIosUI(deviceId: string): Promise<string> {
  validateDeviceId(deviceId);

  try {
    const result = await execa("idb", ["ui", "describe-all", "--udid", deviceId, "--json"], {
      timeout: IDB_DUMP_TIMEOUT,
    });
    return String(result.stdout ?? "");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new E2eError(
      "IDB_UNAVAILABLE",
      `idb 실행 실패: ${msg}. ${IDB_UNAVAILABLE_HINT}`
    );
  }
}
