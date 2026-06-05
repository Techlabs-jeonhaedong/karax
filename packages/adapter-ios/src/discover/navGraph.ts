/**
 * iOS SwiftUI navGraph 정적 분석
 *
 * 전략:
 * 1. @main App struct → WindowGroup { ContentView() } 에서 entry screen 추출
 *    + typealias 해석 (ContentView = HomeScreen)
 * 2. 각 View struct 소스에서 NavigationLink(destination: TargetScreen()) 패턴 스캔
 * 3. NavigationLink의 label 추출: Text("...") 첫 번째 리터럴
 */

import { readFile } from "fs/promises";
import path from "path";
import type { SwiftSymbolTable } from "../parse/scanner.js";
import type { NavigationGraph, NavigationEdge } from "@karax/core";

/**
 * @main App 소스에서 WindowGroup { XxxView() } 또는 ContentView() 같은 최상위 화면명 추출
 */
function parseRootViewFromAppSource(
  appSource: string,
  aliasMap: Map<string, string>
): string | undefined {
  // WindowGroup { ContentView() } 패턴
  const m = /WindowGroup\s*\{[^}]*?(\w+)\s*\(\s*\)/.exec(appSource);
  if (!m) return undefined;
  const viewName = m[1]!;
  // typealias 해석
  return aliasMap.get(viewName) ?? viewName;
}

interface NavLinkInfo {
  destination: string;
  label: string | undefined;
}

/**
 * Swift 소스에서 NavigationLink(destination: TargetScreen()) 패턴을 모두 추출한다.
 *
 * 지원 패턴:
 * - NavigationLink(destination: TargetScreen()) { Text("label") }
 * - NavigationLink(destination: TargetScreen()) { HStack { Text("label") ... } }
 */
function extractNavigationLinks(source: string): NavLinkInfo[] {
  const results: NavLinkInfo[] = [];

  const linkRe = /NavigationLink\s*\(\s*destination\s*:/g;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(source)) !== null) {
    // destination: XxxScreen(...) 추출
    const afterKeyword = source.slice(m.index + m[0].length);

    // 목적지 struct명 추출
    const destMatch = /^\s*(\w+Screen|\w+View|\w+Page)\s*\(/.exec(afterKeyword);
    if (!destMatch) {
      // 목적지가 Screen/View/Page가 아닌 경우 - 일반 struct도 허용
      const destAny = /^\s*(\w+)\s*\(/.exec(afterKeyword);
      if (!destAny) continue;
      // 소문자로 시작하면 변수명이므로 무시
      const name = destAny[1]!;
      if (/^[a-z]/.test(name)) continue;
    }

    const destName = destMatch
      ? destMatch[1]!
      : (/^\s*(\w+)\s*\(/.exec(afterKeyword) ?? [])[1];
    if (!destName) continue;

    // NavigationLink(...) { ... } 의 body 추출
    // 먼저 ) 를 찾아 파라미터 끝 위치 확정
    let parenDepth = 1;
    let parenPos = m.index + m[0].length;
    while (parenPos < source.length && parenDepth > 0) {
      const ch = source[parenPos];
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
      parenPos++;
    }

    // { ... } body
    const afterParen = source.slice(parenPos);
    const bodyStartRel = afterParen.indexOf("{");
    if (bodyStartRel === -1 || bodyStartRel > 10) {
      results.push({ destination: destName, label: undefined });
      continue;
    }

    const bodyStart = parenPos + bodyStartRel;
    let bdepth = 1;
    let bpos = bodyStart + 1;
    while (bpos < source.length && bdepth > 0) {
      const ch = source[bpos];
      if (ch === "{") bdepth++;
      else if (ch === "}") bdepth--;
      bpos++;
    }
    const bodyText = source.slice(bodyStart + 1, bpos - 1);

    // Text("...") 라벨 추출
    const textMatch = /Text\s*\(\s*"([^"]+)"/.exec(bodyText);
    const label = textMatch ? textMatch[1]! : undefined;

    results.push({ destination: destName, label });
  }

  return results;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

export async function discoverIOSNavGraph(
  projectPath: string,
  symbolTable: SwiftSymbolTable
): Promise<NavigationGraph> {
  const edges: NavigationEdge[] = [];
  const diagnostics: NavigationGraph["diagnostics"] = [];

  // entry screen 결정
  let entryScreenId: string | null = null;

  // @main App 파일에서 root view 추출
  if (symbolTable.mainApp) {
    const mainFile = symbolTable.fileByStruct.get(symbolTable.mainApp);
    if (mainFile) {
      const rootView = parseRootViewFromAppSource(mainFile.source, symbolTable.aliasMap);
      if (rootView && symbolTable.structs.has(rootView)) {
        entryScreenId = rootView;
      } else if (rootView) {
        // aliasMap으로 한번 더 해석
        const resolved = symbolTable.aliasMap.get(rootView);
        entryScreenId = (resolved && symbolTable.structs.has(resolved)) ? resolved : rootView;
      }
    }
  }

  // 각 View struct에서 NavigationLink 스캔
  for (const [structName, structInfo] of symbolTable.structs) {
    if (!structInfo.conformsToView) continue;

    const parsedFile = symbolTable.fileByStruct.get(structName);
    if (!parsedFile) continue;

    const links = extractNavigationLinks(parsedFile.source);

    for (const link of links) {
      // 목적지가 심볼 테이블에 있는지 확인
      const destName = symbolTable.aliasMap.get(link.destination) ?? link.destination;
      const destExists = symbolTable.structs.has(destName);

      edges.push({
        from: structName,
        to: destExists ? destName : null,
        action: "push",
        trigger: {
          kind: "navlink",
          ...(link.label ? { label: link.label } : {}),
        },
        confidence: destExists ? 1.0 : 0.3,
        diagnostics: destExists
          ? []
          : [
              {
                code: "UNRESOLVED_NAV",
                message: `NavigationLink 목적지 '${link.destination}'를 심볼 테이블에서 찾을 수 없음`,
              },
            ],
      });
    }
  }

  return { entryScreenId, edges, diagnostics };
}

export async function readIOSAppName(
  projectPath: string
): Promise<string | undefined> {
  // Info.plist에서 CFBundleDisplayName 또는 CFBundleName 추출
  const plistPath = path.join(projectPath, "Info.plist");
  try {
    const content = await readFile(plistPath, "utf-8");
    // CFBundleDisplayName
    const displayMatch = /<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/.exec(content);
    if (displayMatch) return displayMatch[1]!.trim();

    const nameMatch = /<key>CFBundleName<\/key>\s*<string>([^<]+)<\/string>/.exec(content);
    if (nameMatch) return nameMatch[1]!.trim();
  } catch {
    // Info.plist 없음
  }

  // Package.swift fallback
  const packagePath = path.join(projectPath, "Package.swift");
  try {
    const content = await readFile(packagePath, "utf-8");
    const nameMatch = /name:\s*"([^"]+)"/.exec(content);
    if (nameMatch) return nameMatch[1]!.trim();
  } catch {
    // Package.swift 없음
  }

  return undefined;
}
