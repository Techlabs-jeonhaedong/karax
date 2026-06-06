/**
 * scenario/discover.ts — 시나리오 파일 탐색
 *
 * - 파일이면 [path]
 * - 디렉토리이면 직속(1단계) *.md 사전순 정렬
 * - 상한 50개 초과 시 SCENARIO_PARSE_ERROR
 * - 빈 디렉토리 / *.md 없음 → SCENARIO_PARSE_ERROR
 */

import fs from "fs";
import path from "path";
import { E2eError } from "../types.js";

const MAX_SCENARIOS = 50;

/**
 * scenarioPath가 파일이면 [path], 디렉토리이면 직속 *.md 파일 목록(사전순)을 반환한다.
 */
export function discoverScenarioFiles(scenarioPath: string): string[] {
  if (!fs.existsSync(scenarioPath)) {
    throw new E2eError(
      "SCENARIO_PARSE_ERROR",
      `시나리오 경로를 찾을 수 없습니다: ${scenarioPath}`
    );
  }

  const stat = fs.statSync(scenarioPath);

  if (stat.isFile()) {
    return [scenarioPath];
  }

  if (!stat.isDirectory()) {
    throw new E2eError(
      "SCENARIO_PARSE_ERROR",
      `시나리오 경로가 파일도 디렉토리도 아닙니다: ${scenarioPath}`
    );
  }

  // 디렉토리: 직속 1단계 *.md 파일만 수집
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(scenarioPath, { withFileTypes: true });
  } catch (e) {
    throw new E2eError(
      "SCENARIO_PARSE_ERROR",
      `시나리오 디렉토리를 읽을 수 없습니다: ${scenarioPath} — ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const mdFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(scenarioPath, entry.name))
    .sort(); // 사전순 정렬

  if (mdFiles.length === 0) {
    throw new E2eError(
      "SCENARIO_PARSE_ERROR",
      `시나리오 디렉토리에 *.md 파일이 없습니다: ${scenarioPath}`
    );
  }

  if (mdFiles.length > MAX_SCENARIOS) {
    throw new E2eError(
      "SCENARIO_PARSE_ERROR",
      `시나리오 파일이 상한(${MAX_SCENARIOS}개)을 초과했습니다: ${mdFiles.length}개 발견`
    );
  }

  return mdFiles;
}
