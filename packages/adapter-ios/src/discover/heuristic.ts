/**
 * heuristic — route 미연결 View struct 탐색
 *
 * 조건: public struct X: View 이며 이름이 Screen/Page/View 접미사를 가진 것
 */

import type { SwiftSymbolTable, StructInfo, ParsedFile } from "../parse/scanner.js";

const SCREEN_SUFFIXES = ["Screen", "Page", "View"] as const;

export interface HeuristicCandidate {
  className: string;
  file: ParsedFile;
  structInfo: StructInfo;
  reason: "name-suffix";
}

function hasScreenSuffix(name: string): boolean {
  return SCREEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function findSwiftHeuristicCandidates(
  symbolTable: SwiftSymbolTable,
  routeClassNames: Set<string>
): HeuristicCandidate[] {
  const results: HeuristicCandidate[] = [];

  for (const [name, info] of symbolTable.structs) {
    if (routeClassNames.has(name)) continue;
    if (!info.conformsToView) continue;
    if (info.isPrivate) continue;
    if (info.conformsToApp) continue;
    if (!hasScreenSuffix(name)) continue;

    const file = symbolTable.fileByStruct.get(name);
    if (!file) continue;

    results.push({
      className: name,
      file,
      structInfo: info,
      reason: "name-suffix",
    });
  }

  return results;
}
