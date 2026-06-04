/**
 * heuristic — route-graph에 잡히지 않은 화면 후보를 찾는다.
 *
 * 판단 기준:
 * 1. @Composable fun 이름이 Screen/Page/View 접미사로 끝남
 * 2. public (non-private) 함수
 * 3. route-graph에 이미 포함된 함수는 제외
 */

import type { SymbolTable, ComposableInfo, ParsedFile } from "../parse/scanner.js";

const SCREEN_SUFFIXES = ["Screen", "Page", "View"] as const;

function hasScreenSuffix(name: string): boolean {
  return SCREEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isPublic(name: string): boolean {
  // private 함수는 소문자로 시작하거나 파일에서 private 키워드가 붙음
  // 여기서는 이름 기반으로만 판단: 소문자로 시작하면 non-Screen으로 처리
  return name[0] === name[0]?.toUpperCase();
}

export interface HeuristicCandidate {
  composableName: string;
  file: ParsedFile;
  composableInfo: ComposableInfo;
  reason: "name-suffix";
}

export function findHeuristicCandidates(
  symbolTable: SymbolTable,
  routeComposableNames: Set<string>
): HeuristicCandidate[] {
  const results: HeuristicCandidate[] = [];

  for (const [name, composableInfo] of symbolTable.composables) {
    if (routeComposableNames.has(name)) continue;
    if (!isPublic(name)) continue;
    if (!hasScreenSuffix(name)) continue;

    const file = symbolTable.fileByComposable.get(name);
    if (!file) continue;

    results.push({
      composableName: name,
      file,
      composableInfo,
      reason: "name-suffix",
    });
  }

  return results;
}
