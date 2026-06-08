/**
 * packages/e2e/src/debug.ts
 *
 * 디버그 모드 유틸리티 (Phase B-1).
 *
 * 불변 제약:
 * - 모든 출력은 stderr 전용 (stdout 불변)
 * - 출력 직전 redactSecrets + 제어문자 strip
 * - off 시 모든 경로 no-op
 * - 기록 실패는 삼키되 debugLog로 사유 출력
 * - 크기 상한: 빌드 5MB, 기타 2MB (초과 시 앞부분 보존 + 절단 표시)
 */

import fs from "fs";
import path from "path";
import { redactSecrets } from "@karax/core";

/** 기본 크기 상한 (2MB) */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

/** 제어문자 패턴 (탭·CR·LF 제외 유지) */
const CTRL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * 디버그 모드를 결정한다.
 * 우선순위: 명시 opt > KARAX_DEBUG=1 > false
 */
export function isDebug(opt?: boolean): boolean {
  if (opt !== undefined) return opt;
  return process.env["KARAX_DEBUG"] === "1";
}

/**
 * [karax/debug] 전용 stderr 로거.
 * enabled=false이면 no-op.
 * 출력 직전 redactSecrets + 제어문자 strip.
 */
export function debugLog(enabled: boolean, tag: string, msg: string): void {
  if (!enabled) return;
  const safe = redactSecrets(msg).replace(CTRL_CHARS_RE, "");
  process.stderr.write(`[karax/debug] [${tag}] ${safe}\n`);
}

/**
 * name이 debugDir 밖으로 탈출하는지 검사한다.
 * 절대경로이거나, path.resolve 결과가 debugDir 하위가 아니면 거부.
 *
 * @returns 안전한 절대 파일 경로 | null (탈출 감지 시)
 */
function resolveArtifactPath(debugDir: string, name: string): string | null {
  // 절대경로 즉시 거부
  if (path.isAbsolute(name)) return null;
  const resolved = path.resolve(debugDir, name);
  // debugDir 하위인지 확인 (trailing separator 포함)
  const base = debugDir.endsWith(path.sep) ? debugDir : debugDir + path.sep;
  if (!resolved.startsWith(base) && resolved !== debugDir) return null;
  return resolved;
}

/**
 * 디버그 아티팩트 기록기 팩토리.
 * debugDir=undefined이면 모든 메서드가 no-op.
 *
 * write:     텍스트 파일 기록 (redact + 크기 상한, overwrite)
 * append:    텍스트 파일 추가 기록 (redact, 이어쓰기 — teardown.log 등)
 * writeJson: 객체를 JSON으로 직렬화 후 write 위임 (redact 포함)
 */
export function createDebugArtifacts(debugDir: string | undefined): {
  write(name: string, content: string, maxBytes?: number): Promise<void>;
  append(name: string, content: string): Promise<void>;
  writeJson(name: string, obj: unknown): Promise<void>;
} {
  // enabled 플래그를 팩토리 시점에 캡처 — debugLog 호출 시 하드코딩 방지
  const enabled = debugDir !== undefined;

  const write = async (name: string, content: string, maxBytes?: number): Promise<void> => {
    if (debugDir === undefined) return;
    const limit = maxBytes ?? DEFAULT_MAX_BYTES;
    try {
      // 경로 탈출 가드
      const filePath = resolveArtifactPath(debugDir, name);
      if (filePath === null) {
        debugLog(enabled, "debug-artifacts", `경로 탈출 거부 (${name})`);
        return;
      }
      // redact
      let safe = redactSecrets(content);
      // 크기 상한 적용 (bytes 기준)
      const buf = Buffer.from(safe, "utf-8");
      let finalContent: string;
      if (buf.byteLength > limit) {
        // 앞부분 보존 + 절단 표시
        finalContent = buf.subarray(0, limit).toString("utf-8") + "\n...[truncated]";
      } else {
        finalContent = safe;
      }
      // 서브디렉토리 자동 생성
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, finalContent, "utf-8");
    } catch (e) {
      debugLog(enabled, "debug-artifacts", `기록 실패 (${name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const append = async (name: string, content: string): Promise<void> => {
    if (debugDir === undefined) return;
    try {
      // 경로 탈출 가드
      const filePath = resolveArtifactPath(debugDir, name);
      if (filePath === null) {
        debugLog(enabled, "debug-artifacts", `경로 탈출 거부 — append (${name})`);
        return;
      }
      const safe = redactSecrets(content);
      // 서브디렉토리 자동 생성
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // 이어쓰기 (항목 누적 — teardown.log 등)
      fs.appendFileSync(filePath, safe + "\n", "utf-8");
    } catch (e) {
      debugLog(enabled, "debug-artifacts", `append 실패 (${name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const writeJson = async (name: string, obj: unknown): Promise<void> => {
    if (debugDir === undefined) return;
    try {
      const serialized = JSON.stringify(obj, null, 2);
      await write(name, serialized);
    } catch (e) {
      debugLog(enabled, "debug-artifacts", `JSON 직렬화 실패 (${name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return { write, append, writeJson };
}
