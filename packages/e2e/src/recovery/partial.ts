/**
 * recovery/partial.ts — 에이전트 비정상 종료 시 부분 결과 복구
 */

import fs from "fs";
import path from "path";
import { AgentResultSchema } from "../agent/resultSchema.js";
import type { AgentResult, AgentStep } from "../agent/resultSchema.js";

/**
 * screenshotsDir(세션 디렉토리)에서 부분 결과를 복구한다.
 *
 * 복구 우선순위:
 * 1. result.json이 존재하고 스키마 파싱 성공 → 그 결과 반환
 * 2. result.json 실패/부재 → step_<n>.png 스캔 → 합성 스텝 구성
 * 3. 아무것도 없으면 null
 */
export function recoverPartialResult(screenshotsDir: string): AgentResult | null {
  // 디렉토리 존재 확인
  try {
    const stat = fs.statSync(screenshotsDir);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  // ① result.json safeParse 시도 (10MB 초과 시 무시 → png 스캔 폴백)
  const MAX_RESULT_JSON_SIZE = 10 * 1024 * 1024; // 10MB
  const resultJsonPath = path.join(screenshotsDir, "result.json");
  if (fs.existsSync(resultJsonPath)) {
    try {
      const stat = fs.statSync(resultJsonPath);
      if (stat.size > MAX_RESULT_JSON_SIZE) {
        // 10MB 초과: 파일이 너무 크므로 안전하게 무시하고 png 스캔으로 폴백
        // (메모리 OOM 방지)
      } else {
        const raw = fs.readFileSync(resultJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as unknown;
        const result = AgentResultSchema.safeParse(parsed);
        if (result.success) {
          return result.data;
        }
      }
    } catch {
      // 파싱 실패 → 다음 단계로
    }
  }

  // ② step_<n>.png 스캔 → 합성 스텝 복구
  let files: string[];
  try {
    files = fs.readdirSync(screenshotsDir);
  } catch {
    return null;
  }

  // step_<숫자>.png 패턴만 수집
  const STEP_PNG_RE = /^step_(\d+)\.png$/;
  const pngFiles = files
    .filter((f) => STEP_PNG_RE.test(f))
    .sort((a, b) => {
      const na = parseInt(STEP_PNG_RE.exec(a)![1]!, 10);
      const nb = parseInt(STEP_PNG_RE.exec(b)![1]!, 10);
      return na - nb;
    });

  if (pngFiles.length === 0) {
    return null;
  }

  // 합성 스텝 구성
  const steps: AgentStep[] = pngFiles.map((filename, idx) => ({
    index: idx,
    description: "복구된 스크린샷",
    status: "skip" as const,
    screenshot: filename,
  }));

  return {
    outcome: "fail",
    summary: "에이전트 비정상 종료 — 부분 결과 복구",
    steps,
  };
}
