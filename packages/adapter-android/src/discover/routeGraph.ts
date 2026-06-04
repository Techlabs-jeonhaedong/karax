/**
 * routeGraph — AndroidManifest.xml → LAUNCHER Activity → setContent → NavHost 파싱
 *
 * 탐색 경로:
 * 1. AndroidManifest.xml에서 LAUNCHER Activity 클래스명 추출 (MainActivity 등)
 * 2. MainActivity.kt에서 setContent { ... } 블록 찾기
 * 3. setContent 블록에서 NavHost 찾기
 * 4. NavHost 내 composable("route") { XScreen(...) } 파싱 → route 목록
 */

import type { SyntaxNode } from "@sfc/adapter-api";
import type { SymbolTable, ParsedFile } from "../parse/scanner.js";
import { parseManifest } from "../parse/manifest.js";

// ── 결과 타입 ─────────────────────────────────────────────────────────────────

export interface RouteEntry {
  /** composable 함수명 (예: HomeScreen) */
  composableName: string;
  /** NavHost route 경로 (예: "home") */
  route: string;
  /** startDestination 여부 */
  isStart: boolean;
}

export interface RouteGraphResult {
  routes: RouteEntry[];
  diagnostics: Array<{ code: string; message: string }>;
}

// ── 소스 기반 파싱 ─────────────────────────────────────────────────────────────

/**
 * Kotlin 소스 텍스트에서 NavHost composable 블록을 파싱한다.
 *
 * 찾는 패턴:
 * composable(route = AppRoutes.HOME) { HomeScreen(...) }
 * composable("home") { HomeScreen(...) }
 * composable(route = "home") { ... }
 */
function parseNavHostFromSource(source: string): RouteEntry[] {
  const routes: RouteEntry[] = [];

  // startDestination 추출 (예: startDestination = AppRoutes.HOME 또는 startDestination = "home")
  let startDestination: string | undefined;
  const startMatch = /startDestination\s*=\s*(?:AppRoutes\.\w+|"([^"]+)")/.exec(source);
  if (startMatch) {
    startDestination = startMatch[1];
  }

  // AppRoutes 상수 맵 구성 (object AppRoutes { const val HOME = "home" ... })
  const routeConstants = new Map<string, string>();
  const constRegex = /const\s+val\s+(\w+)\s*=\s*"([^"]+)"/g;
  let cm: RegExpExecArray | null;
  while ((cm = constRegex.exec(source)) !== null) {
    routeConstants.set(cm[1]!, cm[2]!);
  }

  // startDestination이 AppRoutes.XXX 형식이면 상수 맵으로 해석
  if (!startDestination) {
    const startMatchConst = /startDestination\s*=\s*AppRoutes\.(\w+)/.exec(source);
    if (startMatchConst) {
      startDestination = routeConstants.get(startMatchConst[1]!) ?? startMatchConst[1]!.toLowerCase();
    }
  }

  // composable(...) { ... } 블록 파싱
  // 단순 정규식: composable(route = AppRoutes.XXX) { YYYScreen(...)
  //              composable("route") { YYYScreen(...)
  //              composable(route = "route") { YYYScreen(...)
  const composableRegex =
    /composable\(\s*(?:route\s*=\s*)?(?:AppRoutes\.(\w+)|"([^"]+)")\s*\)[^{]*\{[^}]*?(\w+Screen|\w+Page|\w+View)\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = composableRegex.exec(source)) !== null) {
    const routeConst = m[1]; // AppRoutes.HOME → HOME
    const routeLiteral = m[2]; // "home"
    const screenName = m[3]!;

    let route: string;
    if (routeConst) {
      route = routeConstants.get(routeConst) ?? routeConst.toLowerCase();
    } else {
      route = routeLiteral ?? screenName.toLowerCase();
    }

    const isStart =
      startDestination !== undefined && (route === startDestination);

    // 중복 방지
    if (!routes.find((r) => r.composableName === screenName)) {
      routes.push({ composableName: screenName, route, isStart });
    }
  }

  // startDestination이 AppRoutes 형식이고 아직 isStart가 없으면
  // AppRoutes.HOME → routeConstants["HOME"] = "home" 로 매핑하여 HomeScreen 찾기
  if (startDestination && !routes.some((r) => r.isStart)) {
    for (const r of routes) {
      if (r.route === startDestination) {
        r.isStart = true;
        break;
      }
    }
  }

  return routes;
}

/**
 * NavHost 함수를 포함하는 Kotlin 파일에서 route를 파싱한다.
 * AppNavHost 함수 또는 NavHost 호출을 포함하는 파일을 탐색한다.
 */
function findNavHostFile(symbolTable: SymbolTable): ParsedFile | undefined {
  for (const [, parsedFile] of symbolTable.files) {
    if (
      parsedFile.source.includes("NavHost") &&
      parsedFile.source.includes("composable(")
    ) {
      return parsedFile;
    }
  }
  return undefined;
}

// ── setContent 파싱 ───────────────────────────────────────────────────────────

/**
 * MainActivity.kt에서 setContent { ... } 블록의 최상위 Composable 호출을 찾는다.
 * AppNavHost() 같은 단일 화면 진입점도 찾는다.
 */
function parseSetContent(source: string): string | undefined {
  const m = /setContent\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/.exec(source);
  if (!m) return undefined;

  const block = m[1]!;
  // FixtureAppTheme { AppNavHost() } → AppNavHost 추출
  const innerComposable = /(\w+)\s*\(/.exec(block.replace(/\w+Theme\s*\{[^}]*\}/g, ""));
  return innerComposable ? innerComposable[1] : undefined;
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

export async function discoverRouteGraph(
  projectPath: string,
  symbolTable: SymbolTable
): Promise<RouteGraphResult> {
  const diagnostics: Array<{ code: string; message: string }> = [];
  const routes: RouteEntry[] = [];

  // 1. AndroidManifest.xml에서 LAUNCHER Activity 찾기
  const manifest = await parseManifest(projectPath);

  // 2. NavHost를 포함하는 파일 탐색
  const navHostFile = findNavHostFile(symbolTable);

  if (!navHostFile) {
    // NavHost 없는 프로젝트 (단일 Activity setContent에 직접 화면)
    // MainActivity에서 setContent 파싱
    for (const [, parsedFile] of symbolTable.files) {
      if (
        parsedFile.source.includes("setContent") &&
        (parsedFile.source.includes("ComponentActivity") ||
          parsedFile.source.includes("Activity"))
      ) {
        const screenName = parseSetContent(parsedFile.source);
        if (
          screenName &&
          symbolTable.composables.has(screenName)
        ) {
          routes.push({
            composableName: screenName,
            route: screenName.toLowerCase(),
            isStart: true,
          });
        }
      }
    }

    if (routes.length === 0) {
      diagnostics.push({
        code: "NO_NAV_HOST",
        message: "NavHost를 찾을 수 없어 route-graph 발견이 제한됩니다",
      });
    }

    return { routes, diagnostics };
  }

  // 3. NavHost 파일에서 composable 블록 파싱
  const parsed = parseNavHostFromSource(navHostFile.source);
  for (const entry of parsed) {
    if (symbolTable.composables.has(entry.composableName)) {
      routes.push(entry);
    } else {
      diagnostics.push({
        code: "UNRESOLVED_COMPOSABLE",
        message: `route '${entry.route}'에 참조된 '${entry.composableName}'을 심볼 테이블에서 찾을 수 없음`,
      });
    }
  }

  return { routes, diagnostics };
}
