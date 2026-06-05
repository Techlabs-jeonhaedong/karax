import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { parseSource, type SyntaxNode } from "@karax/adapter-api";
import { buildConstTable } from "./constResolver.js";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface ClassInfo {
  name: string;
  file: string;       // 프로젝트 루트 기준 상대 경로 (lib/...)
  line: number;       // 1-based
  superclass: string; // 단순 이름 (type_arguments 제외)
  stateOf?: string;   // State<X> 패턴인 경우 X의 클래스명
}

export interface ImportInfo {
  raw: string;        // import 원문 (따옴표 포함)
  resolved?: string;  // 프로젝트 루트 기준 상대 경로
}

export interface ParsedFile {
  filePath: string;   // 프로젝트 루트 기준 상대 경로
  classes: ClassInfo[];
  imports: ImportInfo[];
  root: SyntaxNode;
  source: string;
}

// ── dart 파일 수집 ─────────────────────────────────────────────────────────────

export async function collectDartFiles(projectPath: string): Promise<string[]> {
  const libDir = path.join(projectPath, "lib");
  const results: string[] = [];

  async function walk(dir: string) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) {
        await walk(full);
      } else if (entry.endsWith(".dart")) {
        results.push(full);
      }
    }
  }

  await walk(libDir);
  return results;
}

// ── import uri 파싱 ──────────────────────────────────────────────────────────

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, "");
}

/**
 * import uri를 프로젝트 루트 기준 상대 경로로 변환한다.
 */
function resolveImport(
  rawUri: string,
  packageName: string,
  fileDir: string,
  projectPath: string
): string | undefined {
  const uri = stripQuotes(rawUri);

  // package:자신/경로 형태
  const pkgPrefix = `package:${packageName}/`;
  if (uri.startsWith(pkgPrefix)) {
    return `lib/${uri.slice(pkgPrefix.length)}`;
  }

  // 외부 패키지 — 해석 불필요
  if (uri.startsWith("package:")) return undefined;

  // dart: 내장 — 해석 불필요
  if (uri.startsWith("dart:")) return undefined;

  // 상대 경로
  if (!uri.startsWith("/")) {
    const resolved = path.resolve(fileDir, uri);
    const rel = path.relative(projectPath, resolved);
    return rel.startsWith("..") ? undefined : rel;
  }

  return undefined;
}

// ── AST 유틸 ────────────────────────────────────────────────────────────────

export function findNodes(node: SyntaxNode, type: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type) results.push(node);
  for (const child of node.children) {
    if (child) findNodes(child, type, results);
  }
  return results;
}

/** children 배열에서 null을 제외하고 타입으로 찾는다 */
export function findChild(node: SyntaxNode, type: string): SyntaxNode | undefined {
  return node.children.find((c): c is SyntaxNode => c !== null && c.type === type) ?? undefined;
}

/** children 배열에서 null을 제외하고 모든 타입으로 필터링 */
export function filterChildren(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.children.filter((c): c is SyntaxNode => c !== null && c.type === type);
}

// ── 단일 파일 파싱 ────────────────────────────────────────────────────────────

export async function parseDartFile(
  absolutePath: string,
  projectPath: string,
  packageName: string
): Promise<ParsedFile> {
  const source = await readFile(absolutePath, "utf-8");
  const relPath = path.relative(projectPath, absolutePath);
  const fileDir = path.dirname(absolutePath);
  return parseDartSource(source, relPath, { packageName, fileDir, projectPath });
}

/**
 * 소스 문자열을 직접 파싱해 ParsedFile을 만든다. (fs 비의존 — 테스트에서 재사용)
 * resolveCtx가 없으면 import는 resolved 없이 raw만 기록한다.
 */
export async function parseDartSource(
  source: string,
  relPath: string,
  resolveCtx?: { packageName: string; fileDir: string; projectPath: string }
): Promise<ParsedFile> {
  const root = await parseSource("dart", source);

  // 클래스 선언 파싱
  const classDefs = findNodes(root, "class_definition");
  const classes: ClassInfo[] = classDefs.map((cls) => {
    const name = findChild(cls, "identifier")?.text ?? "";
    const superclassNode = findChild(cls, "superclass");
    const superclass = superclassNode ? findChild(superclassNode, "type_identifier")?.text ?? "" : "";
    const line = cls.startPosition.row + 1;

    // State<ScreenClassName> 패턴에서 stateOf 추출
    let stateOf: string | undefined;
    if (superclass === "State" && superclassNode) {
      const typeArgs = findChild(superclassNode, "type_arguments");
      if (typeArgs) {
        const typeId = findNodes(typeArgs, "type_identifier")[0];
        stateOf = typeId?.text;
      }
    }

    return { name, file: relPath, line, superclass, stateOf };
  });

  // import 파싱
  const importSpecs = findNodes(root, "import_specification");
  const imports: ImportInfo[] = importSpecs.map((imp) => {
    const strLit = findNodes(imp, "string_literal")[0];
    const raw = strLit?.text ?? "";
    const resolved = resolveCtx
      ? resolveImport(raw, resolveCtx.packageName, resolveCtx.fileDir, resolveCtx.projectPath)
      : undefined;
    return { raw, resolved };
  });

  return { filePath: relPath, classes, imports, root, source };
}

// ── 프로젝트 전체 심볼 테이블 ────────────────────────────────────────────────

export interface SymbolTable {
  /** 클래스명 → ClassInfo */
  classes: Map<string, ClassInfo>;
  /** 클래스명 → 해당 클래스가 정의된 파일의 ParsedFile */
  fileByClass: Map<string, ParsedFile>;
  /** 파일 상대경로 → ParsedFile */
  files: Map<string, ParsedFile>;
  /** "ClassName.MEMBER" → 정적 문자열 상수 값 (constResolver가 채움) */
  stringConstants: Map<string, string>;
}

/** 빈 SymbolTable을 생성한다. */
export function createSymbolTable(): SymbolTable {
  return {
    classes: new Map(),
    fileByClass: new Map(),
    files: new Map(),
    stringConstants: new Map(),
  };
}

/** ParsedFile을 테이블에 등록한다 (클래스 색인 + 문자열 상수 수집). */
export function addParsedFile(table: SymbolTable, parsed: ParsedFile): void {
  table.files.set(parsed.filePath, parsed);
  for (const cls of parsed.classes) {
    table.classes.set(cls.name, cls);
    table.fileByClass.set(cls.name, parsed);
  }
  buildConstTable(parsed.root, parsed.filePath, table);
}

export async function buildSymbolTable(
  projectPath: string,
  packageName: string
): Promise<SymbolTable> {
  const dartFiles = await collectDartFiles(projectPath);
  const table = createSymbolTable();

  for (const absPath of dartFiles) {
    const parsed = await parseDartFile(absPath, projectPath, packageName);
    addParsedFile(table, parsed);
  }

  return table;
}
