/**
 * appmap/appmapCache.ts — AppMap 세션 간 영속 캐시
 *
 * build/cache.ts 패턴을 그대로 참고해 구현한다.
 * 캐시 저장 위치: os.tmpdir()/karax-appmap-cache/<sha256(projectPath)>-<platform>-<device>.json
 * 원본 무수정 원칙 — 분석 대상 프로젝트에는 아무것도 쓰지 않는다.
 *
 * 설계 변경 (검수 항목 반영):
 * - markdownPaths 제거: 캐시 히트 시 호출부(sessionAppMap.ts)가 마크다운을 직접 재생성한다.
 *   이렇게 하면 stale 경로 주입(항목 1, 5)이 구조적으로 불가능해진다.
 * - device 파라미터를 캐시 키에 포함 (항목 3): device가 다르면 다른 슬롯.
 * - zod 스키마 검증 (항목 4): 역직렬화 시 AppMapReadSchema로 safeParse 검증.
 * - 디렉토리 권한 재적용 (항목 6): mkdirSync 후 chmodSync로 0o700 강제.
 * - 원자적 write (항목 7): 임시 파일에 쓴 뒤 renameSync로 원자적 교체.
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { AppMapReadSchema } from "@karax/core";
import type { AppMap } from "@karax/core";

// ── 타입 ──────────────────────────────────────────────────────────────

export interface AppMapCacheEntry {
  appMap: AppMap;
  sourceHash: string;
  cachedAtMs: number;
  platform: string;
  deviceProfileId: string;
}

// ── 캐시 파일 경로 ────────────────────────────────────────────────────

/**
 * build/cache.ts getCacheFilePath와 동일한 패턴:
 * realpathSync로 정규화 → sha256 해시 → tmpdir/karax-appmap-cache/<hash>-<platform>-<device>.json
 *
 * device를 키에 포함해 device가 다르면 다른 슬롯을 사용한다 (항목 3).
 */
function getCacheFilePath(projectPath: string, platform: string, device: string): string {
  let normalizedPath: string;
  try {
    normalizedPath = fs.realpathSync(projectPath);
  } catch {
    normalizedPath = path.resolve(projectPath);
  }
  const projectHash = crypto.createHash("sha256").update(normalizedPath).digest("hex");
  // device 식별자도 해시에 포함해 파일명 길이를 일정하게 유지
  const deviceSlug = device.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cacheDir = path.join(os.tmpdir(), "karax-appmap-cache");
  return path.join(cacheDir, `${projectHash}-${platform}-${deviceSlug}.json`);
}

// ── readAppMapCache ───────────────────────────────────────────────────

/**
 * 캐시 파일에서 AppMapCacheEntry를 읽는다.
 *
 * 다음 경우 null 반환 (graceful):
 * - 파일 없음
 * - 손상된 JSON
 * - 필수 필드 누락
 * - sourceHash 불일치
 * - AppMap zod 스키마 검증 실패 (항목 4)
 */
export function readAppMapCache(
  projectPath: string,
  platform: string,
  device: string,
  sourceHash: string
): AppMapCacheEntry | null {
  const filePath = getCacheFilePath(projectPath, platform, device);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = String(fs.readFileSync(filePath, "utf-8"));
    const parsed = JSON.parse(raw) as Partial<AppMapCacheEntry>;

    // 필수 필드 검증
    if (
      parsed.appMap === null ||
      parsed.appMap === undefined ||
      typeof parsed.sourceHash !== "string" ||
      typeof parsed.platform !== "string" ||
      typeof parsed.deviceProfileId !== "string" ||
      typeof parsed.cachedAtMs !== "number"
    ) {
      return null;
    }

    // sourceHash 불일치 → 캐시 무효화
    if (parsed.sourceHash !== sourceHash) {
      return null;
    }

    // AppMap zod 스키마 검증 (항목 4) — 손상/stale 캐시를 안전하게 무효화
    const zodResult = AppMapReadSchema.safeParse(parsed.appMap);
    if (!zodResult.success) {
      return null;
    }

    return {
      appMap: zodResult.data as AppMap,
      sourceHash: parsed.sourceHash,
      cachedAtMs: parsed.cachedAtMs,
      platform: parsed.platform,
      deviceProfileId: parsed.deviceProfileId,
    };
  } catch {
    return null;
  }
}

// ── writeAppMapCache ──────────────────────────────────────────────────

/**
 * AppMapCacheEntry를 캐시 파일에 저장한다.
 *
 * - 캐시 디렉토리는 0o700으로 생성 및 권한 재적용 (항목 6):
 *   mkdirSync는 기존 디렉토리 권한을 변경하지 않으므로 chmodSync를 추가 호출.
 * - 원자적 write (항목 7): 임시 파일에 쓴 뒤 renameSync로 원자적 교체.
 *   동시 실행 시 부분 기록 파일 읽기를 방지한다.
 */
export function writeAppMapCache(
  projectPath: string,
  platform: string,
  device: string,
  entry: AppMapCacheEntry
): void {
  const filePath = getCacheFilePath(projectPath, platform, device);
  const cacheDir = path.dirname(filePath);

  // 디렉토리 생성 후 권한 재적용 (항목 6)
  // mkdirSync의 mode 옵션은 새 디렉토리에만 적용되므로 chmodSync로 기존 디렉토리도 커버
  fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(cacheDir, 0o700);
  } catch {
    // chmodSync 실패 시 무시 (권한 없는 환경 — 보안 best-effort)
  }

  // 원자적 write (항목 7): tmpFile → renameSync
  const tmpFile = `${filePath}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(entry, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    // 임시 파일 정리 (best-effort)
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    throw err;
  }
}
