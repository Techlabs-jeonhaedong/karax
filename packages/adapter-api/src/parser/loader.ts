import { createRequire } from "module";
import { resolve } from "path";
import { Parser, Language } from "web-tree-sitter";
import type { Node as SyntaxNode, Tree } from "web-tree-sitter";

export type { SyntaxNode };

export type SupportedLanguage = "dart" | "typescript" | "tsx" | "swift" | "kotlin";

const WASM_FILE_MAP: Record<SupportedLanguage, string> = {
  dart: "tree-sitter-dart.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  swift: "tree-sitter-swift.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
};

/**
 * Parser 초기화 in-flight promise.
 * null이면 미초기화, 진행 중이거나 완료된 경우 Promise 객체.
 * 동시 호출 시 같은 Promise를 공유해 Parser.init() 중복 실행을 방지한다.
 */
let initPromise: Promise<void> | null = null;

async function ensureParserInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  return initPromise;
}

function resolveWasmPath(lang: SupportedLanguage): string {
  const require = createRequire(import.meta.url);
  const pkgDir = resolve(require.resolve("tree-sitter-wasms/package.json"), "..");
  return resolve(pkgDir, "out", WASM_FILE_MAP[lang]);
}

const languageCache = new Map<SupportedLanguage, Language>();

/**
 * 언어별 Parser 인스턴스 캐시.
 * web-tree-sitter Parser는 Emscripten 힙의 네이티브 객체라 호출마다 new Parser()를 하면
 * JS GC로 회수되지 않아 힙 고갈이 발생한다. 언어별 1개 인스턴스를 재사용해 누수를 방지한다.
 *
 * 동시성 주의: parse()는 동기 호출이고 JS는 단일 스레드라 현재는 안전하다.
 * 그러나 Worker 등으로 병렬 parse를 도입할 경우 언어별 Parser 풀 또는 큐가 필요하다.
 */
const parserCache = new Map<SupportedLanguage, Parser>();

/**
 * 언어별 Parser 로딩 in-flight promise.
 * 동시 loadParser 호출 시 같은 Promise를 공유해 Parser 인스턴스 중복 생성을 방지한다.
 */
const parserLoadingCache = new Map<SupportedLanguage, Promise<Parser>>();

/**
 * 지정한 언어에 대한 tree-sitter 파서 인스턴스를 반환한다.
 * 언어당 1개의 Parser를 캐시하고 재사용한다.
 * 최초 호출 시 wasm 로딩이 발생하므로 약간의 지연이 있다.
 */
export async function loadParser(lang: SupportedLanguage): Promise<Parser> {
  await ensureParserInit();

  const cached = parserCache.get(lang);
  if (cached) return cached;

  // 동시 호출 시 in-flight promise 공유
  const inFlight = parserLoadingCache.get(lang);
  if (inFlight) return inFlight;

  const loadingPromise = (async () => {
    if (!languageCache.has(lang)) {
      const wasmPath = resolveWasmPath(lang);
      const language = await Language.load(wasmPath);
      languageCache.set(lang, language);
    }

    const parser = new Parser();
    parser.setLanguage(languageCache.get(lang)!);
    parserCache.set(lang, parser);
    return parser;
  })().finally(() => {
    parserLoadingCache.delete(lang);
  });

  parserLoadingCache.set(lang, loadingPromise);
  return loadingPromise;
}

/**
 * 리셋 in-flight promise.
 * 동시 호출 시 같은 리셋을 공유하거나 순차화해 중복 리셋을 방지한다.
 */
let resetPromise: Promise<void> | null = null;

/**
 * 파서 상태를 초기화한다.
 * Emscripten WASM 힙 고갈 등으로 파서가 비정상 상태가 된 경우 호출해
 * 다음 요청이 새 Parser 인스턴스로 회복될 수 있게 한다.
 *
 * 동시 다중 호출 시 진행 중인 리셋이 있으면 해당 리셋이 완료될 때까지 대기한다.
 */
export async function resetParserState(): Promise<void> {
  if (resetPromise) {
    return resetPromise;
  }

  resetPromise = (async () => {
    for (const parser of parserCache.values()) {
      try { parser.delete(); } catch { /* 이미 해제된 경우 무시 */ }
    }
    parserCache.clear();
    parserLoadingCache.clear();
    languageCache.clear();
    // 새 초기화 Promise로 교체
    initPromise = Parser.init();
    await initPromise;
  })().finally(() => {
    resetPromise = null;
  });

  return resetPromise;
}

// ── 테스트용 수명 추적 훅 (프로덕션에서는 no-op) ──────────────────────────────

type TreeLifecycleHook = {
  onParseWithTree: () => void;
  onDisposeTree: () => void;
};

let _lifecycleHook: TreeLifecycleHook | undefined;

/**
 * parseWithTree/disposeTree 호출 수를 추적하는 훅을 등록한다.
 *
 * @internal 테스트 전용. 프로덕션 코드에서 호출 금지.
 *
 * 사용 시 반드시 afterEach에서 `_setTreeLifecycleHook(undefined)`로 해제해야 한다.
 * 훅에서 던진 예외는 파싱 흐름에 영향을 주지 않도록 내부적으로 보호된다.
 *
 * 다른 패키지의 테스트(adapter-flutter 등 symbolTableDispose.test.ts)가 import해야 하므로
 * export는 유지하되 sdk 패키지의 공개 API 표면에서는 제외한다.
 */
export function _setTreeLifecycleHook(hook: TreeLifecycleHook | undefined): void {
  _lifecycleHook = hook;
}

/**
 * 지정한 언어로 소스코드를 파싱하고 tree와 dispose 함수를 반환한다.
 *
 * ParsedFile.root처럼 SyntaxNode를 장기 보관해야 할 때 사용한다.
 * disposeTree()를 반드시 호출해 Emscripten 힙을 해제해야 한다.
 * disposeTree는 멱등(idempotent)이므로 여러 번 호출해도 안전하다.
 */
export async function parseWithTree(
  lang: SupportedLanguage,
  source: string
): Promise<{ rootNode: SyntaxNode; disposeTree: () => void }> {
  const parser = await loadParser(lang);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`Failed to parse source for language: ${lang}`);

  try { _lifecycleHook?.onParseWithTree(); } catch { /* 훅 예외는 파싱 흐름에 영향 없음 */ }

  let disposed = false;
  const disposeTree = () => {
    if (disposed) return;
    disposed = true;
    try { tree.delete(); } catch { /* 이미 해제된 경우 무시 */ }
    try { _lifecycleHook?.onDisposeTree(); } catch { /* 훅 예외는 dispose 흐름에 영향 없음 */ }
  };

  return { rootNode: tree.rootNode, disposeTree };
}

/**
 * 스코프드 콜백 API. 콜백 종료 후(정상/예외 모두) tree를 자동 해제한다.
 * SyntaxNode를 콜백 밖으로 들고 나가서는 안 된다.
 */
export async function withParsedSource<T>(
  lang: SupportedLanguage,
  source: string,
  callback: (rootNode: SyntaxNode) => T | Promise<T>
): Promise<T> {
  const { rootNode, disposeTree } = await parseWithTree(lang, source);
  try {
    return await callback(rootNode);
  } finally {
    disposeTree();
  }
}

/**
 * 지정한 언어로 소스코드를 파싱해 루트 노드를 반환한다.
 *
 * @deprecated
 * 이 함수는 tree를 해제하지 않은 채 rootNode만 반환하므로 Emscripten 힙 누수가 발생한다.
 * 단기 탐색(즉시 소비)에만 사용하고, 장기 보관이 필요하면 parseWithTree를 사용할 것.
 * tree-sitter 객체를 콜백 안에서만 쓰는 경우라면 withParsedSource를 사용하라.
 *
 * @internal 기존 어댑터 코드와의 하위 호환을 위해 유지. 신규 코드에서는 사용하지 말 것.
 */
export async function parseSource(
  lang: SupportedLanguage,
  source: string
): Promise<SyntaxNode> {
  const { rootNode } = await parseWithTree(lang, source);
  // tree를 해제하지 않음 — 하위 호환. ParsedFile 패턴은 parseWithTree로 마이그레이션 필요.
  return rootNode;
}
