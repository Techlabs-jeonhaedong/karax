/**
 * navGraph — Flutter 화면 간 네비게이션 엣지 추출 (실전 패턴 대응)
 *
 * 전략:
 * 1. 라우트 테이블: main.dart `routes:{}` + 프로젝트 전체 GetPage (getx.ts) 병합
 * 2. 네비 호출 스캔: 파일 전체에서 Navigator.* / Get.* 호출을 위치 무관하게 수집
 *    - Navigator: push/pushReplacement(Named)/pushAndRemoveUntil/popAndPushNamed/
 *      pushNamed(AndRemoveUntil)/pop/maybePop/popUntil + Navigator.of(context) 체인
 *    - GetX: to/off/offAll(빌더), toNamed/offNamed/offAllNamed/offAndToNamed(상수 해석), back
 * 3. 트리거 연결: 호출을 감싸는 핸들러(lexical) → 없으면 호출이 속한 메서드를
 *    참조하는 핸들러(handlerResolver 간접 추적)
 * 4. from 특정: 감싸는 위젯 클래스 → 핸들러의 위젯 클래스 → 컨트롤러→화면 매핑
 *    → "(global)" (엣지를 절대 버리지 않는다)
 */

import path from "path";
import { readFile } from "fs/promises";
import { withParsedSource, type SyntaxNode } from "@karax/adapter-api";
import type {
  NavigationGraph,
  NavigationEdge,
  TriggerInfo,
  AppMapDiagnosticEntry as DiagnosticEntry,
} from "@karax/core";
import type { SymbolTable, ParsedFile } from "../parse/scanner.js";
import { findNodes, findChild, filterChildren } from "../parse/scanner.js";
import { readPackageName } from "../parse/pubspec.js";
import { resolveStringExpr } from "../parse/constResolver.js";
import {
  HANDLER_LABELS,
  WIDGET_SUPERCLASSES,
  resolveWidgetClass,
  enclosingClassName,
  enclosingMethodName,
  nearestEnclosingHandler,
  chainPairs,
  scanHandlerSites,
  handlerSiteOf,
  type HandlerSite,
} from "../parse/handlerResolver.js";
import {
  findByIdentifier,
  getNamedArg,
  extractWidgetClassFromBuilder,
} from "./routeGraph.js";
import { discoverGetxRoutes } from "./getx.js";

// ── 네비 메서드 분류 테이블 ───────────────────────────────────────────────────

type NavAction = "push" | "replace" | "pop";
type NavMode = "builder" | "named" | "pop" | "builder-get";

const NAVIGATOR_METHODS: ReadonlyMap<string, { action: NavAction; mode: NavMode }> = new Map([
  ["push", { action: "push", mode: "builder" }],
  ["pushReplacement", { action: "replace", mode: "builder" }],
  ["pushAndRemoveUntil", { action: "replace", mode: "builder" }],
  ["pushNamed", { action: "push", mode: "named" }],
  ["pushReplacementNamed", { action: "replace", mode: "named" }],
  ["popAndPushNamed", { action: "replace", mode: "named" }],
  ["pushNamedAndRemoveUntil", { action: "replace", mode: "named" }],
  ["pop", { action: "pop", mode: "pop" }],
  ["maybePop", { action: "pop", mode: "pop" }],
  ["popUntil", { action: "pop", mode: "pop" }],
]);

const GET_METHODS: ReadonlyMap<string, { action: NavAction; mode: NavMode }> = new Map([
  ["to", { action: "push", mode: "builder-get" }],
  ["off", { action: "replace", mode: "builder-get" }],
  ["offAll", { action: "replace", mode: "builder-get" }],
  ["toNamed", { action: "push", mode: "named" }],
  ["offNamed", { action: "replace", mode: "named" }],
  ["offAllNamed", { action: "replace", mode: "named" }],
  ["offAndToNamed", { action: "replace", mode: "named" }],
  ["back", { action: "pop", mode: "pop" }],
]);

// ── routes 테이블 파싱 (main.dart, 기존 로직 유지) ───────────────────────────

interface RouteMapEntry {
  route: string;
  className: string;
}

function parseRoutesMapWithKeys(routesValue: SyntaxNode): RouteMapEntry[] {
  const result: RouteMapEntry[] = [];
  const pairs = findNodes(routesValue, "pair");
  for (const pair of pairs) {
    const keyNode = pair.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "string_literal"
    );
    const route = keyNode?.text.replace(/^['"]|['"]$/g, "") ?? "";
    if (!route) continue;

    const funcExpr = pair.children.find(
      (c): c is SyntaxNode =>
        c !== null &&
        (c.type === "function_expression" || c.type === "const_object_expression")
    );
    if (!funcExpr) continue;

    let className: string | undefined;
    if (funcExpr.type === "const_object_expression") {
      className = findChild(funcExpr, "type_identifier")?.text;
    } else {
      className = extractWidgetClassFromBuilder(funcExpr);
    }

    if (className) result.push({ route, className });
  }
  return result;
}

interface MainDartInfo {
  routeMap: Map<string, string>;
  homeClass?: string;
}

async function extractMainDartInfo(projectPath: string): Promise<MainDartInfo> {
  const mainPath = path.join(projectPath, "lib", "main.dart");
  let source: string;
  try {
    source = await readFile(mainPath, "utf-8");
  } catch {
    return { routeMap: new Map() };
  }

  return withParsedSource("dart", source, (root) => {
    const routeMap = new Map<string, string>();
    let homeClass: string | undefined;

    for (const appName of ["MaterialApp", "CupertinoApp"]) {
      const appIds = findByIdentifier(root, appName);
      for (const appId of appIds) {
        if (!appId.parent) continue;
        let args: SyntaxNode | undefined;
        const selectors = filterChildren(appId.parent, "selector");
        for (const sel of selectors) {
          const ap = findChild(sel, "argument_part");
          if (ap) {
            args = findChild(ap, "arguments");
            break;
          }
        }
        if (!args) continue;

        // routes: (중복 라우트는 첫 값 유지 — 결정론)
        const routesArg = getNamedArg(args, "routes");
        if (routesArg) {
          for (const entry of parseRoutesMapWithKeys(routesArg)) {
            if (!routeMap.has(entry.route)) routeMap.set(entry.route, entry.className);
          }
        }

        // home:
        const homeArg = getNamedArg(args, "home");
        if (homeArg && !homeClass) {
          if (homeArg.type === "const_object_expression") {
            homeClass = findChild(homeArg, "type_identifier")?.text;
          } else if (homeArg.type === "identifier") {
            homeClass = homeArg.text;
          }
        }
      }
    }

    return { routeMap, homeClass };
  });
}

// ── 네비 호출 사이트 스캔 ─────────────────────────────────────────────────────

interface NavCallSite {
  action: NavAction;
  mode: NavMode;
  /** builder 기반 호출에서 추출한 대상 클래스 */
  targetClass?: string;
  /** named 호출에서 해석된 라우트 */
  routeName?: string;
  /** 라우트 미해석 시 원문 */
  routeRaw?: string;
  /** 호출 식별자(Navigator/Get) 노드 */
  node: SyntaxNode;
  /** 호출 1-based 라인 */
  line: number;
}

/** MaterialPageRoute/CupertinoPageRoute/PageRouteBuilder에서 대상 위젯 클래스 추출 */
function extractNavigatorTarget(args: SyntaxNode): string | undefined {
  const routeBuilders: Array<[string, string]> = [
    ["MaterialPageRoute", "builder"],
    ["CupertinoPageRoute", "builder"],
    ["PageRouteBuilder", "pageBuilder"],
  ];
  for (const [routeClass, builderLabel] of routeBuilders) {
    for (const id of findByIdentifier(args, routeClass)) {
      const sel = id.nextSibling as SyntaxNode | null;
      if (!sel || sel.type !== "selector") continue;
      const ap = findChild(sel, "argument_part");
      const a = ap ? findChild(ap, "arguments") : undefined;
      if (!a) continue;
      const builderArg = getNamedArg(a, builderLabel);
      if (!builderArg) continue;
      const cls = extractWidgetClassFromBuilder(builderArg);
      if (cls) return cls;
    }
  }
  return undefined;
}

/** argument 노드를 문자열로 해석 (리터럴 또는 ClassName.MEMBER 상수) */
function resolveArgString(argNode: SyntaxNode, table: SymbolTable): string | undefined {
  const direct = resolveStringExpr(argNode, table);
  if (direct !== undefined) return direct;
  for (const c of argNode.children) {
    if (!c) continue;
    const v = resolveStringExpr(c, table);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** named 호출 인자에서 라우트명 추출 (context 인자는 건너뜀) */
function extractRouteNameArg(
  args: SyntaxNode,
  table: SymbolTable
): { route?: string; raw?: string } {
  const argNodes = filterChildren(args, "argument");
  for (const a of argNodes) {
    if (a.text === "context") continue;
    const v = resolveArgString(a, table);
    if (v !== undefined) return { route: v };
  }
  const first = argNodes.find((a) => a.text !== "context");
  return first ? { raw: first.text } : {};
}

/** 파일 전체에서 Navigator.* / Get.* 네비 호출을 수집한다. */
function scanNavCallSites(parsedFile: ParsedFile, table: SymbolTable): NavCallSite[] {
  const sites: NavCallSite[] = [];

  const scan = (base: "Navigator" | "Get", methods: ReadonlyMap<string, { action: NavAction; mode: NavMode }>) => {
    for (const idNode of findByIdentifier(parsedFile.root, base)) {
      const pairs = chainPairs(idNode);
      for (const pair of pairs) {
        if (!pair.method) continue;
        const spec = methods.get(pair.method);
        if (!spec) continue; // .of(context) 등 통과

        const site: NavCallSite = {
          action: spec.action,
          mode: spec.mode,
          node: idNode,
          line: idNode.startPosition.row + 1,
        };

        if (spec.mode === "builder" && pair.args) {
          const target = extractNavigatorTarget(pair.args);
          if (target) site.targetClass = target;
        } else if (spec.mode === "builder-get" && pair.args) {
          const target = extractWidgetClassFromBuilder(pair.args);
          if (target) site.targetClass = target;
        } else if (spec.mode === "named" && pair.args) {
          const { route, raw } = extractRouteNameArg(pair.args, table);
          if (route !== undefined) site.routeName = route;
          else if (raw) site.routeRaw = raw;
        }

        sites.push(site);
        break; // 체인당 첫 네비 메서드만 (pushNamed(...).then(...) 등)
      }
    }
  };

  scan("Navigator", NAVIGATOR_METHODS);
  scan("Get", GET_METHODS);
  return sites;
}

// ── 컨트롤러 → 화면 매핑 (from 특정 폴백) ────────────────────────────────────

const CONTROLLER_SUFFIX_RE = /(Controller|ViewModel|Bloc|Cubit|Notifier|Manager)$/;
const SCREEN_SUFFIXES = ["Screen", "Page", "View", "Main"];

/**
 * 컨트롤러/매니저 클래스를 화면 위젯 클래스로 매핑한다 (결정론적).
 * ① GetView<C>/GetWidget<C> 역색인 (이름 사전순 첫째)
 * ② 네이밍: XController → X{Screen,Page,View,Main}
 * ③ feature 디렉토리: 컨트롤러 파일의 상위 디렉토리 아래 위젯 화면이 정확히 1개면 채택
 */
export function mapControllerToScreen(
  className: string,
  table: SymbolTable
): string | undefined {
  // ① GetView<C> 역색인
  const views = [...table.classes.values()]
    .filter(
      (ci) =>
        (ci.superclass === "GetView" || ci.superclass === "GetWidget") &&
        ci.superTypeArg === className
    )
    .map((ci) => ci.name)
    .sort();
  if (views.length > 0) return views[0];

  // ② 네이밍 매칭
  const base = className.replace(CONTROLLER_SUFFIX_RE, "");
  if (base && base !== className) {
    for (const suffix of SCREEN_SUFFIXES) {
      const widget = resolveWidgetClass(`${base}${suffix}`, table);
      if (widget) return widget;
    }
  }

  // ③ feature 디렉토리 유일 화면
  const file = table.classes.get(className)?.file;
  if (file) {
    const dir = path.posix.dirname(file.split(path.sep).join("/"));
    const featureDir = path.posix.dirname(dir);
    if (featureDir && featureDir !== "." && featureDir !== "lib") {
      const widgets = [...table.classes.values()]
        .filter(
          (ci) =>
            WIDGET_SUPERCLASSES.has(ci.superclass) &&
            ci.file.split(path.sep).join("/").startsWith(featureDir + "/")
        )
        .map((ci) => ci.name)
        .sort();
      if (widgets.length === 1) return widgets[0];
    }
  }

  return undefined;
}

// ── 엣지 조립 ────────────────────────────────────────────────────────────────

const GLOBAL_FROM_ID = "(global)";

interface FromResolution {
  from: string;
  fromKind: "screen" | "controller" | "global";
  conf: number;
  triggerSite?: HandlerSite;
}

function resolveFrom(
  call: NavCallSite,
  parsedFile: ParsedFile,
  table: SymbolTable,
  handlersByMethod: Map<string, HandlerSite[]>,
  methodDeclCount: Map<string, number>
): FromResolution {
  // lexical 핸들러 (호출을 직접 감싸는 onPressed/onTap)
  const na = nearestEnclosingHandler(call.node);
  const lexical = na ? handlerSiteOf(na, parsedFile, table) : undefined;

  const enclosingCls = enclosingClassName(call.node);
  const widget = enclosingCls ? resolveWidgetClass(enclosingCls, table) : undefined;

  // ① lexical 핸들러 + 감싸는 위젯 클래스
  if (lexical && widget) {
    return { from: widget, fromKind: "screen", conf: 1.0, triggerSite: lexical };
  }

  // ② 메서드 간접 참조: 호출이 속한 메서드를 참조하는 핸들러
  const methodName = enclosingMethodName(call.node);
  let picked: HandlerSite | undefined;
  if (methodName) {
    const candidates = handlersByMethod.get(methodName) ?? [];
    picked =
      candidates.find((h) => h.enclosingClass && h.enclosingClass === enclosingCls) ??
      ((methodDeclCount.get(methodName) ?? 0) <= 1 ? candidates[0] : undefined);
  }
  if (picked?.widgetClass) {
    return {
      from: picked.widgetClass,
      fromKind: "screen",
      conf: picked.enclosingClass === enclosingCls ? 1.0 : 0.9,
      ...(lexical ? { triggerSite: lexical } : { triggerSite: picked }),
    };
  }

  // ③ 감싸는 위젯 클래스 (핸들러 없는 호출 — initState 등)
  if (widget) {
    return {
      from: widget,
      fromKind: "screen",
      conf: 0.9,
      ...(lexical ? { triggerSite: lexical } : {}),
    };
  }

  // ④ 컨트롤러 → 화면 매핑
  if (enclosingCls) {
    const mapped = mapControllerToScreen(enclosingCls, table);
    if (mapped) {
      return {
        from: mapped,
        fromKind: "controller",
        conf: 0.6,
        ...(lexical ? { triggerSite: lexical } : {}),
      };
    }
  }

  // ⑤ 전역 (엣지를 버리지 않는다)
  return {
    from: GLOBAL_FROM_ID,
    fromKind: "global",
    conf: 0.4,
    ...(lexical ? { triggerSite: lexical } : {}),
  };
}

interface ToResolution {
  to: string | null;
  toRouteName?: string;
  conf: number;
  diagnostics: DiagnosticEntry[];
}

function resolveTo(
  call: NavCallSite,
  table: SymbolTable,
  routeMap: Map<string, string>
): ToResolution {
  if (call.mode === "pop") {
    return { to: null, conf: 1.0, diagnostics: [] };
  }

  if (call.mode === "builder" || call.mode === "builder-get") {
    if (call.targetClass && table.classes.has(call.targetClass)) {
      return { to: call.targetClass, conf: 1.0, diagnostics: [] };
    }
    return {
      to: null,
      conf: 0.3,
      diagnostics: [
        {
          code: "UNRESOLVED_NAV",
          message: call.targetClass
            ? `네비게이션 대상 '${call.targetClass}'를 찾을 수 없음`
            : "네비게이션 빌더에서 대상 위젯을 추출하지 못함",
        },
      ],
    };
  }

  // named
  if (call.routeName !== undefined) {
    const cls = routeMap.get(call.routeName);
    if (cls) {
      return { to: cls, toRouteName: call.routeName, conf: 1.0, diagnostics: [] };
    }
    return {
      to: null,
      toRouteName: call.routeName,
      conf: 0.6,
      diagnostics: [
        {
          code: "UNRESOLVED_NAV",
          message: `라우트 '${call.routeName}'를 라우트 테이블에서 찾을 수 없음`,
        },
      ],
    };
  }
  return {
    to: null,
    ...(call.routeRaw ? { toRouteName: call.routeRaw } : {}),
    conf: 0.3,
    diagnostics: [
      {
        code: "UNRESOLVED_NAV",
        message: `동적 라우트 인자를 해석할 수 없음${call.routeRaw ? `: ${call.routeRaw}` : ""}`,
      },
    ],
  };
}

function makeTrigger(site: HandlerSite | undefined, action: NavAction): TriggerInfo {
  const kind: TriggerInfo["kind"] =
    action === "pop" ? "back" : site?.kind ?? "system";
  return {
    kind,
    ...(site?.label ? { label: site.label } : {}),
    ...(site
      ? { elementRef: { file: site.file, line: site.line } }
      : {}),
  };
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * Flutter 프로젝트에서 화면 간 네비게이션 그래프를 추출한다.
 */
export async function discoverFlutterNavGraph(
  projectPath: string,
  symbolTable: SymbolTable
): Promise<NavigationGraph> {
  const diagnostics: NavigationGraph["diagnostics"] = [];

  // 1. 라우트 테이블: main.dart routes + GetX GetPage 병합
  const mainInfo = await extractMainDartInfo(projectPath);
  const getx = discoverGetxRoutes(symbolTable);

  const routeMap = new Map<string, string>(mainInfo.routeMap);
  for (const [route, cls] of getx.routeMap) {
    if (!routeMap.has(route)) routeMap.set(route, cls);
  }

  // 진입점: GetX initialRoute > home: > '/' 라우트
  const entryScreenId =
    getx.entryClass ??
    mainInfo.homeClass ??
    routeMap.get("/") ??
    null;

  // 2. 핸들러/메서드 인덱스 (간접 참조 추적용)
  const handlersByMethod = new Map<string, HandlerSite[]>();
  const methodDeclCount = new Map<string, number>();

  for (const [, parsedFile] of symbolTable.files) {
    for (const sig of findNodes(parsedFile.root, "function_signature")) {
      const name = findChild(sig, "identifier")?.text;
      if (name) methodDeclCount.set(name, (methodDeclCount.get(name) ?? 0) + 1);
    }
    for (const site of scanHandlerSites(parsedFile, symbolTable)) {
      for (const m of site.refMethodNames) {
        const list = handlersByMethod.get(m) ?? [];
        list.push(site);
        handlersByMethod.set(m, list);
      }
    }
  }
  // 결정론: 핸들러 후보를 (file, line) 사전순 정렬
  for (const list of handlersByMethod.values()) {
    list.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  }

  // 3. 네비 호출 스캔 → 엣지 조립
  const edges: NavigationEdge[] = [];

  for (const [, parsedFile] of symbolTable.files) {
    for (const call of scanNavCallSites(parsedFile, symbolTable)) {
      const fromRes = resolveFrom(call, parsedFile, symbolTable, handlersByMethod, methodDeclCount);
      const toRes = resolveTo(call, symbolTable, routeMap);

      const enclosingCls = enclosingClassName(call.node);
      edges.push({
        from: fromRes.from,
        to: toRes.to,
        ...(toRes.toRouteName !== undefined ? { toRouteName: toRes.toRouteName } : {}),
        action: call.action,
        trigger: makeTrigger(fromRes.triggerSite, call.action),
        confidence: Math.min(fromRes.conf, toRes.conf),
        diagnostics: toRes.diagnostics,
        fromKind: fromRes.fromKind,
        fromRef: {
          file: parsedFile.filePath,
          line: call.line,
          ...(enclosingCls ? { symbol: enclosingCls } : {}),
        },
      });
    }
  }

  return { entryScreenId, edges, diagnostics };
}

/**
 * pubspec.yaml에서 앱 이름을 읽는다.
 */
export async function readFlutterAppName(
  projectPath: string
): Promise<string | undefined> {
  try {
    const pkgName = await readPackageName(projectPath);
    return pkgName;
  } catch {
    return undefined;
  }
}

// HANDLER_LABELS 재노출 (테스트/외부 진단용)
export { HANDLER_LABELS };
