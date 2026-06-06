/**
 * crash/detect.ts — logcat 텍스트에서 크래시 이벤트를 파싱하는 순수 함수
 */

import { z } from "zod";
import { sanitizeStderr } from "../agent/sanitize.js";

// ── 스키마 ────────────────────────────────────────────────────────

export const CrashEventSchema = z.object({
  type: z.enum(["fatal-exception", "anr", "process-death", "native-crash"]),
  timestamp: z.string().optional(),
  /** 발췌 — 최대 2000자, sanitizeStderr로 시크릿 redact */
  excerpt: z.string(),
  appId: z.string().optional(),
});

export type CrashEvent = z.infer<typeof CrashEventSchema>;

// ── 상수 ────────────────────────────────────────────────────────

const MAX_INPUT_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_EXCERPT_LEN = 2000;
const CONTEXT_LINES = 30; // FATAL EXCEPTION 이후 발췌 줄 수

// ── 헬퍼 ─────────────────────────────────────────────────────────

function truncateExcerpt(text: string): string {
  const redacted = sanitizeStderr(text);
  return redacted.length > MAX_EXCERPT_LEN ? redacted.slice(0, MAX_EXCERPT_LEN) : redacted;
}

function extractTimestamp(line: string): string | undefined {
  const m = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)/);
  return m ? m[1] : undefined;
}

/**
 * 현재 줄(i)부터 maxLines줄까지 수집한다.
 * 빈 줄(앞뒤 공백만인 줄)을 만나면 블록 끊김으로 간주한다.
 * 단, 최소 1줄은 항상 포함(첫 줄).
 */
function collectBlock(lines: string[], startIdx: number, maxLines: number): string[] {
  const end = Math.min(startIdx + maxLines + 1, lines.length);
  const result: string[] = [];
  for (let j = startIdx; j < end; j++) {
    const l = lines[j]!;
    // 첫 줄은 무조건 포함
    if (j === startIdx) {
      result.push(l);
      continue;
    }
    // 빈 줄이면 블록 종료
    if (l.trim() === "") break;
    result.push(l);
  }
  return result;
}

/**
 * 블록 내 실제 로그 줄(타임스탬프 패턴 있는 줄) 수를 세어 건너뜀 수를 결정한다.
 * 비어있는 블록이라도 최소 1을 반환(현재 줄 처리 완료 표시).
 */
function countBlockLines(contextLines: string[]): number {
  const logLineRe = /^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/;
  const logCount = contextLines.filter((l) => logLineRe.test(l)).length;
  return Math.max(logCount, 1);
}

// ── parseLogcatForCrashes ─────────────────────────────────────────

/**
 * logcatText에서 우리 앱(appId)과 관련된 크래시 이벤트를 파싱한다.
 *
 * 감지 패턴:
 * 1. FATAL EXCEPTION (AndroidRuntime) — Process 줄에서 appId 확인
 * 2. ANR in <pkg> — pkg === appId
 * 3. Process <pkg> has died / Force finishing activity <pkg> — pkg === appId
 * 4. *** *** *** native crash + signal N + backtrace: — appId가 블록에 포함된 경우
 */
export function parseLogcatForCrashes(logcatText: string, appId: string): CrashEvent[] {
  // 5MB 상한: 초과하면 뒷부분만 처리
  let text = logcatText;
  if (Buffer.byteLength(text, "utf-8") > MAX_INPUT_BYTES) {
    // 뒷부분 5MB를 바이트 단위로 자름
    const buf = Buffer.from(text, "utf-8");
    text = buf.slice(buf.length - MAX_INPUT_BYTES).toString("utf-8");
    // 첫 줄은 잘릴 수 있으므로 첫 번째 줄바꿈 이후부터 사용
    const nlIdx = text.indexOf("\n");
    if (nlIdx !== -1) text = text.slice(nlIdx + 1);
  }

  const lines = text.split("\n");
  const crashes: CrashEvent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // ── 1. FATAL EXCEPTION ──────────────────────────────────────
    if (line.includes("FATAL EXCEPTION")) {
      // 다음 CONTEXT_LINES줄 내에서 Process: <appId> 확인
      const contextLines = collectBlock(lines, i, CONTEXT_LINES);
      const hasAppId = contextLines.some((l) =>
        l.includes(`Process: ${appId}`) || l.includes(`Process:${appId}`)
      );
      if (!hasAppId) continue;

      const timestamp = extractTimestamp(line);
      const excerpt = truncateExcerpt(contextLines.join("\n"));
      crashes.push({ type: "fatal-exception", timestamp, excerpt, appId });
      // 이 블록의 실제 AndroidRuntime 줄 수만큼 건너뜀
      i += countBlockLines(contextLines) - 1;
      continue;
    }

    // ── 2. ANR ──────────────────────────────────────────────────
    {
      const anrMatch = line.match(/ANR in (\S+)/);
      if (anrMatch) {
        const pkg = anrMatch[1]!.replace(/\s.*$/, "").split("(")[0]!.trim();
        if (pkg !== appId) continue;

        const timestamp = extractTimestamp(line);
        const contextLines = collectBlock(lines, i, CONTEXT_LINES);
        const excerpt = truncateExcerpt(contextLines.join("\n"));
        crashes.push({ type: "anr", timestamp, excerpt, appId });
        i += countBlockLines(contextLines) - 1;
        continue;
      }
    }

    // ── 3. Process has died ──────────────────────────────────────
    {
      const deathMatch =
        line.match(/Process (\S+) \(pid \d+\) has died/) ||
        line.match(/Force finishing activity (\S+)\//);
      if (deathMatch) {
        const pkg = deathMatch[1]!;
        if (pkg !== appId) continue;

        const timestamp = extractTimestamp(line);
        const contextLines = collectBlock(lines, i, CONTEXT_LINES);
        const excerpt = truncateExcerpt(contextLines.join("\n"));
        crashes.push({ type: "process-death", timestamp, excerpt, appId });
        i += countBlockLines(contextLines) - 1;
        continue;
      }
    }

    // ── 4. Native crash (*** *** *** / signal N / backtrace:) ────
    if (
      line.includes("*** *** *** *** *** *** ***") ||
      line.match(/Fatal signal \d+/)
    ) {
      const contextLines = collectBlock(lines, i, CONTEXT_LINES);
      const blockText = contextLines.join("\n");

      // appId 필터: 블록에 appId가 등장하는지 확인 (느슨하게)
      const hasAppId = blockText.includes(appId);
      if (!hasAppId) continue;

      const timestamp = extractTimestamp(line);
      const excerpt = truncateExcerpt(blockText);
      crashes.push({ type: "native-crash", timestamp, excerpt, appId });
      i += countBlockLines(contextLines) - 1;
      continue;
    }
  }

  return crashes;
}
