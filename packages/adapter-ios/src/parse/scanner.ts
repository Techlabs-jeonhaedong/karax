/**
 * scanner — Swift 파일 수집 + 심볼 테이블 구축
 *
 * 심볼 테이블:
 * - structs: struct 이름 → StructInfo (View 상속 여부, 소스 위치)
 * - fileByStruct: struct 이름 → ParsedFile
 * - files: 파일 상대경로 → ParsedFile
 * - aliasMap: typealias 원본명 → 대상명
 * - mainApp: @main App struct 이름
 */

import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { parseSource } from "@karax/adapter-api";
import type { SyntaxNode } from "@karax/adapter-api";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface StructInfo {
  name: string;
  file: string;       // 프로젝트 루트 기준 상대 경로
  line: number;       // 1-based
  conformsToView: boolean;
  conformsToApp: boolean;
  isMain: boolean;
  isPrivate: boolean;
}

export interface ParsedFile {
  filePath: string;   // 프로젝트 루트 기준 상대 경로
  structs: StructInfo[];
  root: SyntaxNode;
  source: string;
}

export interface SwiftSymbolTable {
  structs: Map<string, StructInfo>;
  fileByStruct: Map<string, ParsedFile>;
  files: Map<string, ParsedFile>;
  aliasMap: Map<string, string>;   // typealias 원본 → 대상
  mainApp: string | undefined;     // @main App struct 이름
}

// ── Swift 파일 수집 ───────────────────────────────────────────────────────────

export async function collectSwiftFiles(projectPath: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      // build 디렉토리 무시
      if (entry === ".build" || entry === "build" || entry === "DerivedData") continue;
      const full = path.join(dir, entry);
      const s = await stat(full).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) {
        await walk(full);
      } else if (entry.endsWith(".swift")) {
        results.push(full);
      }
    }
  }

  await walk(projectPath);
  return results;
}

// ── AST 유틸 ─────────────────────────────────────────────────────────────────

export function findAllNodes(node: SyntaxNode, type: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type) results.push(node);
  for (const child of node.children) {
    if (child) findAllNodes(child, type, results);
  }
  return results;
}

export function findChild(node: SyntaxNode, type: string): SyntaxNode | undefined {
  return node.children.find((c): c is SyntaxNode => c !== null && c.type === type) ?? undefined;
}

export function filterChildren(node: SyntaxNode, type: string): SyntaxNode[] {
  return node.children.filter((c): c is SyntaxNode => c !== null && c.type === type);
}

// ── 단일 파일 파싱 ─────────────────────────────────────────────────────────────

export async function parseSwiftFile(
  absolutePath: string,
  projectPath: string
): Promise<ParsedFile> {
  const source = await readFile(absolutePath, "utf-8");
  const root = await parseSource("swift", source);
  const relPath = path.relative(projectPath, absolutePath);

  // struct 선언 파싱
  const classDefs = findAllNodes(root, "class_declaration");
  const structs: StructInfo[] = [];

  for (const cls of classDefs) {
    // struct 키워드가 있는 것만 (class 키워드 제외)
    const hasStruct = cls.children.some(c => c !== null && c.type === "struct");
    if (!hasStruct) continue;

    const typeId = findChild(cls, "type_identifier");
    const name = typeId?.text ?? "";
    if (!name) continue;

    const line = cls.startPosition.row + 1;

    // 상속 목록 확인
    const inheritSpec = filterChildren(cls, "inheritance_specifier");
    let conformsToView = false;
    let conformsToApp = false;

    for (const spec of inheritSpec) {
      const userTypes = findAllNodes(spec, "type_identifier");
      for (const ut of userTypes) {
        if (ut.text === "View") conformsToView = true;
        if (ut.text === "App") conformsToApp = true;
      }
    }

    // @main 어트리뷰트 확인
    const modifiers = findChild(cls, "modifiers");
    const isMain = modifiers
      ? findAllNodes(modifiers, "user_type").some(n => n.text === "main")
      : false;

    // private struct 확인 (modifier에 private 키워드)
    const isPrivate = modifiers
      ? modifiers.children.some(c => c !== null && c.text === "private")
      : false;

    structs.push({ name, file: relPath, line, conformsToView, conformsToApp, isMain, isPrivate });
  }

  return { filePath: relPath, structs, root, source };
}

// ── 심볼 테이블 구축 ──────────────────────────────────────────────────────────

export async function buildSwiftSymbolTable(
  projectPath: string
): Promise<SwiftSymbolTable> {
  const swiftFiles = await collectSwiftFiles(projectPath);
  const table: SwiftSymbolTable = {
    structs: new Map(),
    fileByStruct: new Map(),
    files: new Map(),
    aliasMap: new Map(),
    mainApp: undefined,
  };

  for (const absPath of swiftFiles) {
    const parsed = await parseSwiftFile(absPath, projectPath);
    table.files.set(parsed.filePath, parsed);

    for (const s of parsed.structs) {
      table.structs.set(s.name, s);
      table.fileByStruct.set(s.name, parsed);
      if (s.isMain && s.conformsToApp) {
        table.mainApp = s.name;
      }
    }

    // typealias 파싱
    const typealiasDecls = findAllNodes(parsed.root, "typealias_declaration");
    for (const ta of typealiasDecls) {
      // typealias_declaration: [typealias, type_identifier(alias), =, user_type(target)]
      const typeIds = filterChildren(ta, "type_identifier");
      const userTypes = filterChildren(ta, "user_type");
      const alias = typeIds[0]?.text;
      // user_type 내의 type_identifier
      const targetTypeId = userTypes[0] ? findChild(userTypes[0], "type_identifier") : undefined;
      const target = targetTypeId?.text;
      if (alias && target) {
        table.aliasMap.set(alias, target);
      }
    }
  }

  return table;
}
