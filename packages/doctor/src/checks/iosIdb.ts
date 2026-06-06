/**
 * checks/iosIdb.ts — idb (iOS 입력 주입) 설치 여부 확인
 *
 * 감지 순서:
 * 1. `idb --version` 성공 → ok
 * 2. `idb_companion --version` 성공 → missing (companion만 있는 상태, 클라이언트 설치 안내)
 * 3. 둘 다 실패 → missing
 *
 * non-darwin 플랫폼에서는 즉시 missing.
 */

import { execa } from "execa";
import type { CheckResult } from "./types.js";

const BASE_HINT =
  "iOS 입력 주입(tap/swipe/text)에 idb가 필요합니다: brew install facebook/fb/idb-companion. " +
  "미설치 시 iOS는 관찰 전용.";

const COMPANION_ONLY_HINT =
  "idb_companion은 설치돼 있으나 idb 클라이언트가 없습니다. " +
  "클라이언트 설치: pip install fb-idb (또는 brew install facebook/fb/idb-companion 후 PATH 확인).";

export async function checkIosIdb(): Promise<CheckResult> {
  const base: Pick<CheckResult, "id" | "label" | "autoInstallable" | "hint" | "optional"> = {
    id: "ios-idb",
    label: "idb (iOS input injection)",
    optional: true,
    autoInstallable: true,
    hint: BASE_HINT,
  };

  if (process.platform !== "darwin") {
    return { ...base, status: "missing" };
  }

  // 1. idb 클라이언트 확인
  try {
    const { stdout } = await execa("idb", ["--version"], { timeout: 10_000 });
    const version = stdout.trim() || "unknown";
    return { ...base, status: "ok", version };
  } catch {
    // idb 클라이언트 없음 — companion 확인
  }

  // 2. idb_companion만 있는 상태 확인
  try {
    await execa("idb_companion", ["--version"], { timeout: 10_000 });
    // companion만 있음 → 클라이언트 설치 안내
    return { ...base, status: "missing", hint: COMPANION_ONLY_HINT };
  } catch {
    // 둘 다 없음
  }

  return { ...base, status: "missing" };
}
