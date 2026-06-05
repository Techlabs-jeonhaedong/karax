/**
 * scanner — React Native 프로젝트의 TSX/TS 파일을 수집하고
 * 컴포넌트 심볼 테이블을 구축한다.
 *
 * Flutter adapter의 scanner.ts 패턴을 RN 환경에 맞게 복제.
 */

import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { parseSource, type SyntaxNode } from "@karax/adapter-api";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface ComponentInfo {
  name: string;
  /** 프로젝트 루트 기준 상대 경로 */
  file: string;
  line: number;
  /** export default function / export default class 여부 */
  isDefaultExport: boolean;
}

export interface ImportInfo {
  raw: string;
  resolved?: string;
  specifiers: string[];
}

export interface ParsedFile {
  filePath: string;
  components: ComponentInfo[];
  imports: ImportInfo[];
  root: SyntaxNode;
  source: string;
}

// ── TSX/TS 파일 수집 ────────────────────────────────────────────────────────────

const TS_EXTS = new Set([".tsx", ".ts"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "android", "ios", "__tests__", "dist", "build"]);

export async function collectTsxFiles(projectPath: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) {
        await walk(full);
      } else if (TS_EXTS.has(path.extname(entry))) {
        results.push(full);
      }
    }
  }

  await walk(projectPath);
  return results;
}

// ── AST 유틸 ────────────────────────────────────────────────────────────────

export function findNodes(node: SyntaxNode, type: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type) results.push(node);
  for (const child of node.children) {
    if (child) findNodes(child, type, results);
  }
  return results;
}

export function findChild(node: SyntaxNode, type: string): SyntaxNode | undefined {
  return node.children.find((c): c is SyntaxNode => c !== null && c.type === type) ?? undefined;
}

export function filterChildren(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.children.filter((c): c is SyntaxNode => c !== null && c.type === type);
}

export function findByText(node: SyntaxNode, type: string, text: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type && node.text === text) results.push(node);
  for (const child of node.children) {
    if (child) findByText(child, type, text, results);
  }
  return results;
}

// ── Import 파싱 ──────────────────────────────────────────────────────────────

/**
 * import 경로를 프로젝트 루트 기준 상대 경로로 변환한다.
 */
function resolveImport(
  rawPath: string,
  fileDir: string,
  projectPath: string
): string | undefined {
  // 상대 경로만 처리 (./ 또는 ../)
  if (!rawPath.startsWith(".")) return undefined;

  // 확장자 없으면 .tsx / .ts / /index.tsx 순으로 시도 (심볼 탐색용이라 실제 존재 여부는 런타임에)
  const abs = path.resolve(fileDir, rawPath);
  const rel = path.relative(projectPath, abs);
  if (rel.startsWith("..")) return undefined;
  return rel;
}

function parseImports(root: SyntaxNode, fileDir: string, projectPath: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  // import_statement 수집
  const importNodes = findNodes(root, "import_statement");
  for (const imp of importNodes) {
    // import_clause 안의 identifier(default) 또는 named_imports
    const clause = findChild(imp, "import_clause");
    const specifiers: string[] = [];

    if (clause) {
      // default import: import Foo from '...'
      const defaultId = clause.children.find(
        (c): c is SyntaxNode => c !== null && c.type === "identifier"
      );
      if (defaultId) specifiers.push(defaultId.text);

      // named imports: import { Foo, Bar } from '...'
      const namedImports = findChild(clause, "named_imports");
      if (namedImports) {
        const importSpecifiers = findNodes(namedImports, "import_specifier");
        for (const spec of importSpecifiers) {
          const id = findChild(spec, "identifier") ?? spec.children.find(
            (c): c is SyntaxNode => c !== null && c.type === "identifier"
          );
          if (id) specifiers.push(id.text);
        }
      }

      // namespace: import * as Foo from '...'
      const namespaceImport = findChild(clause, "namespace_import");
      if (namespaceImport) {
        const id = findChild(namespaceImport, "identifier");
        if (id) specifiers.push(id.text);
      }
    }

    // 모듈 경로 추출
    const strNode = findNodes(imp, "string_fragment")[0] ?? findNodes(imp, "string")[0];
    const rawPath = strNode?.text ?? "";
    const resolved = resolveImport(rawPath, fileDir, projectPath);

    if (rawPath) {
      imports.push({ raw: rawPath, resolved, specifiers });
    }
  }
  return imports;
}

// ── 컴포넌트 파싱 ────────────────────────────────────────────────────────────

/**
 * TSX 파일에서 export default function / export default class 컴포넌트를 파싱한다.
 * 또한 export function XxxScreen 형태도 포함한다.
 */
function parseComponents(root: SyntaxNode, relPath: string): ComponentInfo[] {
  const results: ComponentInfo[] = [];
  const seen = new Set<string>();

  function addComponent(name: string, line: number, isDefaultExport: boolean) {
    if (seen.has(name)) return;
    seen.add(name);
    results.push({ name, file: relPath, line, isDefaultExport });
  }

  // export_statement 순회
  const exportStmts = findNodes(root, "export_statement");
  for (const exp of exportStmts) {
    const isDefault = exp.children.some(
      (c): c is SyntaxNode => c !== null && c.type === "default"
    );

    // export default function Foo / export function Foo
    const funcDecl = findChild(exp, "function_declaration")
      ?? findChild(exp, "lexical_declaration")
      ?? findChild(exp, "class_declaration");

    if (funcDecl) {
      const nameId = findChild(funcDecl, "identifier") ?? findChild(funcDecl, "type_identifier");
      if (nameId && /^[A-Z]/.test(nameId.text)) {
        addComponent(nameId.text, nameId.startPosition.row + 1, isDefault);
      }
    }

    // export default identifier
    if (isDefault) {
      const idNode = exp.children.find(
        (c): c is SyntaxNode => c !== null && c.type === "identifier" && /^[A-Z]/.test(c.text)
      );
      if (idNode) {
        addComponent(idNode.text, idNode.startPosition.row + 1, true);
      }
    }
  }

  // function_declaration / arrow_function at top level (non-export, 파일 내 사용 컴포넌트)
  // 여기서는 대문자로 시작하는 함수만 포함
  const topLevelFuncs = root.children.filter(
    (c): c is SyntaxNode =>
      c !== null &&
      (c.type === "function_declaration" || c.type === "lexical_declaration")
  );
  for (const decl of topLevelFuncs) {
    const nameId = findChild(decl, "identifier");
    if (nameId && /^[A-Z]/.test(nameId.text) && !seen.has(nameId.text)) {
      addComponent(nameId.text, nameId.startPosition.row + 1, false);
    }
  }

  return results;
}

// ── 단일 파일 파싱 ────────────────────────────────────────────────────────────

export async function parseTsxFile(
  absolutePath: string,
  projectPath: string
): Promise<ParsedFile> {
  const source = await readFile(absolutePath, "utf-8");
  const root = await parseSource("tsx", source);
  const relPath = path.relative(projectPath, absolutePath);
  const fileDir = path.dirname(absolutePath);

  const components = parseComponents(root, relPath);
  const imports = parseImports(root, fileDir, projectPath);

  return { filePath: relPath, components, imports, root, source };
}

// ── 심볼 테이블 ──────────────────────────────────────────────────────────────

export interface SymbolTable {
  /** 컴포넌트명 → ComponentInfo */
  components: Map<string, ComponentInfo>;
  /** 컴포넌트명 → ParsedFile */
  fileByComponent: Map<string, ParsedFile>;
  /** 파일 상대경로 → ParsedFile */
  files: Map<string, ParsedFile>;
}

export async function buildSymbolTable(projectPath: string): Promise<SymbolTable> {
  const tsxFiles = await collectTsxFiles(projectPath);
  const table: SymbolTable = {
    components: new Map(),
    fileByComponent: new Map(),
    files: new Map(),
  };

  for (const absPath of tsxFiles) {
    let parsed: ParsedFile;
    try {
      parsed = await parseTsxFile(absPath, projectPath);
    } catch {
      continue;
    }
    table.files.set(parsed.filePath, parsed);
    for (const comp of parsed.components) {
      table.components.set(comp.name, comp);
      table.fileByComponent.set(comp.name, parsed);
    }
  }

  return table;
}
