/**
 * Android Compose navGraph 정적 분석
 *
 * 2단계 간접 추적:
 * 1. NavHost 파일에서 콜백→목적지 맵 구축
 *    composable(route = AppRoutes.DETAIL) { DetailScreen(onBackClick = { navController.popBackStack() }) }
 *    → { "DetailScreen" → { "onBackClick" → { type: "pop" } } }
 *    composable(route = AppRoutes.HOME) { HomeScreen(onExploreClick = { navController.navigate(AppRoutes.DETAIL) }) }
 *    → { "HomeScreen" → { "onExploreClick" → { type: "push", destination: "detail" } } }
 * 2. 화면 함수 본문에서 Button(onClick = onX) 검색 → 콜백 파라미터 매칭
 *    → 라벨: stringResource(R.string.*) → resources.ts 해석 또는 리터럴 Text
 */

import type { SymbolTable } from "../parse/scanner.js";
import { loadResources } from "../parse/resources.js";
import type { NavigationGraph, NavigationEdge, TriggerInfo } from "@karax/core";

interface CallbackAction {
  type: "push" | "pop";
  /** push 시 목적지 라우트 문자열 (AppRoutes 상수 해석 후) */
  destination?: string;
}

/** AppRoutes object 상수 맵 구축 */
function buildRouteConstMap(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /const\s+val\s+(\w+)\s*=\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    map.set(m[1]!, m[2]!);
  }
  return map;
}

/**
 * 라우트 토큰(AppRoutes.HOME 또는 "home")을 실제 라우트 문자열로 해석한다.
 */
function resolveRoute(token: string, routeConstMap: Map<string, string>): string {
  const constMatch = /^AppRoutes\.(\w+)$/.exec(token.trim());
  if (constMatch) {
    return routeConstMap.get(constMatch[1]!) ?? constMatch[1]!.toLowerCase();
  }
  const litMatch = /^"([^"]+)"$/.exec(token.trim());
  if (litMatch) return litMatch[1]!;
  return token.trim();
}

/**
 * NavHost 소스에서 각 화면 composable 블록에 전달된 콜백 파라미터명 → 액션 맵을 추출한다.
 *
 * 반환: Map<screenName, Map<callbackParamName, CallbackAction>>
 */
function buildCallbackDestMap(
  navHostSource: string,
  routeConstMap: Map<string, string>
): Map<string, Map<string, CallbackAction>> {
  const screenCallbacks = new Map<string, Map<string, CallbackAction>>();

  /** composable 블록 하나에서 Screen 함수 호출의 named argument를 추출한다. */
  function extractScreenCallbackArgs(
    blockText: string
  ): { paramName: string; action: CallbackAction }[] {
    const results: { paramName: string; action: CallbackAction }[] = [];

    const navCallRe =
      /(\w+)\s*=\s*\{\s*navController\.(navigate|popBackStack)\s*\(([^)]*)\)\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = navCallRe.exec(blockText)) !== null) {
      const paramName = m[1]!;
      const method = m[2]!;
      const arg = m[3]!.trim();

      if (method === "popBackStack") {
        results.push({ paramName, action: { type: "pop" } });
      } else {
        const destination = resolveRoute(arg, routeConstMap);
        results.push({ paramName, action: { type: "push", destination } });
      }
    }

    return results;
  }

  const composableStartRe =
    /composable\(\s*(?:route\s*=\s*)?(?:AppRoutes\.\w+|"[^"]*")\s*\)\s*\{/g;
  let startMatch: RegExpExecArray | null;

  while ((startMatch = composableStartRe.exec(navHostSource)) !== null) {
    const openBracePos = startMatch.index + startMatch[0].length - 1;

    let depth = 1;
    let pos = openBracePos + 1;
    while (pos < navHostSource.length && depth > 0) {
      const ch = navHostSource[pos];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      pos++;
    }
    const blockText = navHostSource.slice(openBracePos + 1, pos - 1);

    const screenCallMatch = /(\w+Screen|\w+Page|\w+View)\s*\(/.exec(blockText);
    if (!screenCallMatch) continue;
    const screenName = screenCallMatch[1]!;

    const cbArgs = extractScreenCallbackArgs(blockText);
    if (cbArgs.length === 0) continue;

    const cbMap = screenCallbacks.get(screenName) ?? new Map<string, CallbackAction>();
    for (const { paramName, action } of cbArgs) {
      cbMap.set(paramName, action);
    }
    screenCallbacks.set(screenName, cbMap);
  }

  return screenCallbacks;
}

/**
 * 소스 문자열에서 특정 인덱스까지의 1-based 라인 번호를 계산한다.
 */
function indexToLine(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * @Composable 함수 시그니처에서 람다 타입 파라미터명을 추출한다.
 * 예: fun HomeScreen(onNavigate: () -> Unit = {}) → ["onNavigate"]
 *
 * 네비게이션 관련 오탐 방지: 파라미터로 전달받은 콜백만 대상
 * (로컬 val lambda = {...} 은 extractButtonClickLabels에서 처리)
 */
function extractLambdaParamNames(source: string, screenName: string): Set<string> {
  const params = new Set<string>();
  // fun ScreenName( ... ) 시그니처 추출
  const funRe = new RegExp(`fun\\s+${screenName}\\s*\\(`, "g");
  const m = funRe.exec(source);
  if (!m) return params;

  // 파라미터 목록 범위 추출
  const parenOpen = m.index + m[0].length - 1;
  let depth = 1;
  let pos = parenOpen + 1;
  while (pos < source.length && depth > 0) {
    const ch = source[pos];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    pos++;
  }
  const paramsText = source.slice(parenOpen + 1, pos - 1);

  // 람다 타입 파라미터 패턴: `paramName: (...) -> ...` 또는 `paramName: () -> ...`
  const lambdaParamRe = /(\w+)\s*:\s*\([^)]*\)\s*->/g;
  let pm: RegExpExecArray | null;
  while ((pm = lambdaParamRe.exec(paramsText)) !== null) {
    params.add(pm[1]!);
  }
  return params;
}

/**
 * 화면 함수 소스에서 Button/OutlinedButton의 onClick 파라미터명, Text 라벨, 1-based 라인을 추출한다.
 */
function extractButtonClickLabels(
  screenSource: string,
  stringResources: Map<string, string>
): { callbackParamName: string; label: string | undefined; line: number }[] {
  const results: { callbackParamName: string; label: string | undefined; line: number }[] = [];

  const buttonBlockRe = /(?:OutlinedButton|Button)\s*\(/g;
  let bMatch: RegExpExecArray | null;

  while ((bMatch = buttonBlockRe.exec(screenSource)) !== null) {
    const buttonLine = indexToLine(screenSource, bMatch.index);
    const parenOpen = bMatch.index + bMatch[0].length - 1;
    let depth = 1;
    let pos = parenOpen + 1;
    while (pos < screenSource.length && depth > 0) {
      const ch = screenSource[pos];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      pos++;
    }
    const argsText = screenSource.slice(parenOpen + 1, pos - 1);

    const onClickMatch = /onClick\s*=\s*(\w+)/.exec(argsText);
    if (!onClickMatch) continue;
    const callbackParamName = onClickMatch[1]!;

    const bodyStart = screenSource.indexOf("{", pos - 1);
    if (bodyStart === -1 || bodyStart > pos + 50) {
      results.push({ callbackParamName, label: undefined, line: buttonLine });
      continue;
    }

    let bdepth = 1;
    let bpos = bodyStart + 1;
    while (bpos < screenSource.length && bdepth > 0) {
      const ch = screenSource[bpos];
      if (ch === "{") bdepth++;
      else if (ch === "}") bdepth--;
      bpos++;
    }
    const bodyText = screenSource.slice(bodyStart + 1, bpos - 1);

    let label: string | undefined;

    const strResMatch = /text\s*=\s*stringResource\s*\(\s*R\.string\.(\w+)\s*\)/.exec(bodyText);
    if (strResMatch) {
      label = stringResources.get(strResMatch[1]!) ?? strResMatch[1]!;
    } else {
      const literalMatch = /text\s*=\s*"([^"]+)"/.exec(bodyText) ??
        /Text\s*\(\s*"([^"]+)"/.exec(bodyText);
      if (literalMatch) {
        label = literalMatch[1]!;
      }
    }

    results.push({ callbackParamName, label, line: buttonLine });
  }

  return results;
}

/**
 * 라우트 문자열 → composable 함수명 역조회 맵
 */
function buildRouteToScreenMap(
  navHostSource: string,
  routeConstMap: Map<string, string>
): Map<string, string> {
  const map = new Map<string, string>();

  const re =
    /composable\(\s*(?:route\s*=\s*)?(?:AppRoutes\.(\w+)|"([^"]*)")\s*\)[^{]*\{[^}]*?(\w+Screen|\w+Page|\w+View)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(navHostSource)) !== null) {
    const routeConst = m[1];
    const routeLiteral = m[2];
    const screenName = m[3]!;

    let route: string;
    if (routeConst) {
      route = routeConstMap.get(routeConst) ?? routeConst.toLowerCase();
    } else {
      route = routeLiteral ?? screenName.toLowerCase();
    }
    map.set(route, screenName);
  }

  return map;
}

/** startDestination 라우트 추출 */
function parseStartDestination(
  navHostSource: string,
  routeConstMap: Map<string, string>
): string | undefined {
  const m =
    /startDestination\s*=\s*(AppRoutes\.(\w+)|"([^"]+)")/.exec(navHostSource);
  if (!m) return undefined;
  if (m[2]) {
    return routeConstMap.get(m[2]) ?? m[2].toLowerCase();
  }
  return m[3];
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

export async function discoverAndroidNavGraph(
  projectPath: string,
  symbolTable: SymbolTable
): Promise<NavigationGraph> {
  const edges: NavigationEdge[] = [];
  const diagnostics: NavigationGraph["diagnostics"] = [];

  const resources = await loadResources(projectPath);

  let navHostSource: string | undefined;
  for (const [, parsedFile] of symbolTable.files) {
    if (
      parsedFile.source.includes("NavHost") &&
      parsedFile.source.includes("composable(")
    ) {
      navHostSource = parsedFile.source;
      break;
    }
  }

  if (!navHostSource) {
    diagnostics.push({ code: "NAV_UNSUPPORTED", message: "NavHost를 찾을 수 없음" });
    return { entryScreenId: null, edges, diagnostics };
  }

  const routeConstMap = buildRouteConstMap(navHostSource);
  const startRoute = parseStartDestination(navHostSource, routeConstMap);
  const routeToScreen = buildRouteToScreenMap(navHostSource, routeConstMap);
  const entryScreenId = (startRoute ? routeToScreen.get(startRoute) : undefined) ?? null;

  const screenCallbackMap = buildCallbackDestMap(navHostSource, routeConstMap);

  for (const [screenName, callbackActionMap] of screenCallbackMap) {
    let screenSource: string | undefined;
    let screenFilePath: string | undefined;
    for (const [, parsedFile] of symbolTable.files) {
      if (
        parsedFile.source.includes(`fun ${screenName}(`) &&
        parsedFile.composables.some((c) => c.name === screenName)
      ) {
        screenSource = parsedFile.source;
        screenFilePath = parsedFile.filePath;
        break;
      }
    }

    const labelByCallback = new Map<string, { label: string | undefined; line: number }>();
    if (screenSource) {
      const buttonLabels = extractButtonClickLabels(screenSource, resources.strings);
      for (const { callbackParamName, label, line } of buttonLabels) {
        labelByCallback.set(callbackParamName, { label, line });
      }
    }

    for (const [callbackParam, action] of callbackActionMap) {
      const callbackInfo = labelByCallback.get(callbackParam);
      const label = callbackInfo?.label;

      // elementRef: Button 위젯의 위치 (screenFilePath + line)
      const elementRef: TriggerInfo["elementRef"] =
        screenFilePath && callbackInfo?.line !== undefined
          ? { file: screenFilePath, line: callbackInfo.line }
          : undefined;

      if (action.type === "pop") {
        edges.push({
          from: screenName,
          to: null,
          action: "pop",
          trigger: {
            kind: "back",
            ...(label ? { label } : {}),
            ...(elementRef ? { elementRef } : {}),
          },
          confidence: 0.9,
          diagnostics: [],
        });
      } else if (action.destination) {
        const toScreen = routeToScreen.get(action.destination) ?? null;
        edges.push({
          from: screenName,
          to: toScreen,
          action: "push",
          trigger: {
            kind: "button",
            ...(label ? { label } : {}),
            ...(elementRef ? { elementRef } : {}),
          },
          confidence: toScreen ? 1.0 : 0.3,
          diagnostics: toScreen
            ? []
            : [
                {
                  code: "UNRESOLVED_NAV",
                  message: `${screenName}의 navigate('${action.destination}') 목적지를 화면으로 매핑할 수 없음`,
                },
              ],
        });
      }
    }
  }

  // ── 3단계+ 간접 전달 콜백 감지 ────────────────────────────────────────────
  // NavHost에 등록된 화면인데 screenCallbackMap에 없는 경우 = NavHost가 콜백을 직접 주입하지 않음.
  // 해당 화면의 함수 시그니처에서 람다 파라미터를 추출하고,
  // 그 파라미터가 Button onClick에 연결됐으면 DYNAMIC_NAV diagnostic emit.
  const navHostScreenNames = new Set(routeToScreen.values());
  let dynamicNavCount = 0;

  for (const screenName of navHostScreenNames) {
    // screenCallbackMap에 있으면 이미 정상 처리됨 → 스킵
    if (screenCallbackMap.has(screenName)) continue;

    // 화면 소스 탐색
    let screenSource: string | undefined;
    for (const [, parsedFile] of symbolTable.files) {
      if (
        parsedFile.source.includes(`fun ${screenName}(`) &&
        parsedFile.composables.some((c) => c.name === screenName)
      ) {
        screenSource = parsedFile.source;
        break;
      }
    }
    if (!screenSource) continue;

    // 람다 파라미터 추출
    const lambdaParams = extractLambdaParamNames(screenSource, screenName);
    if (lambdaParams.size === 0) continue;

    // Button onClick에서 파라미터로 받은 콜백 사용 여부 확인
    const buttonLabels = extractButtonClickLabels(screenSource, resources.strings);
    for (const { callbackParamName } of buttonLabels) {
      if (lambdaParams.has(callbackParamName)) {
        dynamicNavCount++;
        break; // 화면 당 한 번만 카운트
      }
    }
  }

  if (dynamicNavCount > 0) {
    diagnostics.push({
      code: "DYNAMIC_NAV",
      message: `콜백 간접 전달 깊이 한계로 추적 포기 (${dynamicNavCount}개 화면)`,
    });
  }

  return { entryScreenId, edges, diagnostics };
}

export async function readAndroidAppName(
  projectPath: string
): Promise<string | undefined> {
  try {
    const resources = await loadResources(projectPath);
    return resources.strings.get("app_name");
  } catch {
    return undefined;
  }
}
