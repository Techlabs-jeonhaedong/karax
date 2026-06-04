/**
 * heuristic — Screen/Page 접미사 또는 src/screens/ 경로 기반 화면 후보 발견
 */

import path from "path";
import type { SymbolTable, ComponentInfo, ParsedFile } from "../parse/scanner.js";

// ── 상수 ─────────────────────────────────────────────────────────────────────

const SCREEN_SUFFIXES = ["Screen", "Page"] as const;
const SCREEN_DIRS = ["screens", "pages", "views"] as const;

// ── 판별 유틸 ─────────────────────────────────────────────────────────────────

function hasScreenSuffix(name: string): boolean {
  return SCREEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isInScreenDir(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  return parts.some((part) => (SCREEN_DIRS as readonly string[]).includes(part));
}

function isPublicComponent(name: string): boolean {
  return /^[A-Z]/.test(name);
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

export interface HeuristicCandidate {
  componentName: string;
  file: ParsedFile;
  componentInfo: ComponentInfo;
  reason: "name-suffix" | "screen-dir" | "both";
}

export function findHeuristicCandidates(
  symbolTable: SymbolTable,
  routeComponentNames: Set<string>
): HeuristicCandidate[] {
  const results: HeuristicCandidate[] = [];

  for (const [componentName, componentInfo] of symbolTable.components) {
    if (!isPublicComponent(componentName)) continue;
    if (routeComponentNames.has(componentName)) continue;

    const parsedFile = symbolTable.fileByComponent.get(componentName);
    if (!parsedFile) continue;

    const hasSuffix = hasScreenSuffix(componentName);
    const inScreenDir = isInScreenDir(parsedFile.filePath);

    // screen-dir 기준으로 잡을 때는 반드시 default export이어야 함
    // (파일 내 helper 컴포넌트 오탐 방지)
    const isDefault = componentInfo.isDefaultExport;

    const qualifies = hasSuffix || (inScreenDir && isDefault);

    if (qualifies) {
      const reason: HeuristicCandidate["reason"] =
        hasSuffix && inScreenDir ? "both" : hasSuffix ? "name-suffix" : "screen-dir";
      results.push({ componentName, file: parsedFile, componentInfo, reason });
    }
  }

  return results;
}
