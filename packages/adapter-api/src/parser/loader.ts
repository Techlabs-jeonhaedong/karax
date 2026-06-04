import { createRequire } from "module";
import { resolve } from "path";
import { Parser, Language } from "web-tree-sitter";
import type { Node as SyntaxNode } from "web-tree-sitter";

export type { SyntaxNode };

export type SupportedLanguage = "dart" | "typescript" | "tsx" | "swift" | "kotlin";

const WASM_FILE_MAP: Record<SupportedLanguage, string> = {
  dart: "tree-sitter-dart.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  swift: "tree-sitter-swift.wasm",
  kotlin: "tree-sitter-kotlin.wasm",
};

let parserInitialized = false;

async function ensureParserInit(): Promise<void> {
  if (parserInitialized) return;
  await Parser.init();
  parserInitialized = true;
}

function resolveWasmPath(lang: SupportedLanguage): string {
  const require = createRequire(import.meta.url);
  const pkgDir = resolve(require.resolve("tree-sitter-wasms/package.json"), "..");
  return resolve(pkgDir, "out", WASM_FILE_MAP[lang]);
}

const languageCache = new Map<SupportedLanguage, Language>();

/**
 * 지정한 언어에 대한 tree-sitter 파서 인스턴스를 반환한다.
 * 최초 호출 시 wasm 로딩이 발생하므로 약간의 지연이 있다.
 */
export async function loadParser(lang: SupportedLanguage): Promise<Parser> {
  await ensureParserInit();
  const parser = new Parser();

  if (!languageCache.has(lang)) {
    const wasmPath = resolveWasmPath(lang);
    const language = await Language.load(wasmPath);
    languageCache.set(lang, language);
  }

  parser.setLanguage(languageCache.get(lang)!);
  return parser;
}

/**
 * 지정한 언어로 소스코드를 파싱해 루트 노드를 반환한다.
 */
export async function parseSource(
  lang: SupportedLanguage,
  source: string
): Promise<SyntaxNode> {
  const parser = await loadParser(lang);
  const tree = parser.parse(source);
  if (!tree) throw new Error(`Failed to parse source for language: ${lang}`);
  return tree.rootNode;
}
