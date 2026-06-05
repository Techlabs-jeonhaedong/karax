/**
 * Kotlin 파일 스캐너 — tree-sitter kotlin 그래머 기반
 *
 * 제공:
 * - collectKotlinFiles: app/src/main/java 재귀 수집
 * - ParsedFile: 파싱된 파일 (root AST, 함수/클래스 목록)
 * - buildSymbolTable: 프로젝트 전체 심볼 테이블
 */

import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { parseWithTree, type SyntaxNode } from "@karax/adapter-api";

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface ComposableInfo {
  /** @Composable fun 이름 */
  name: string;
  /** 프로젝트 루트 기준 상대 경로 (app/src/...) */
  file: string;
  /** 1-based 줄 번호 */
  line: number;
  /** 최상위 레벨 여부 (탑레벨 함수 or 클래스 밖 함수) */
  isTopLevel: boolean;
}

export interface ImportInfo {
  raw: string;
  /** 패키지 경로 (예: com.example.fixture.screens.HomeScreen) */
  packagePath: string;
}

export interface ParsedFile {
  filePath: string; // 프로젝트 루트 기준 상대 경로
  composables: ComposableInfo[];
  imports: ImportInfo[];
  root: SyntaxNode;
  source: string;
  /** Emscripten 힙의 tree-sitter Tree를 해제한다. ParsedFile이 더 이상 필요 없을 때 호출해야 한다. */
  disposeTree: () => void;
}

// ── 기본 AST 유틸 ─────────────────────────────────────────────────────────────

export function findNodes(
  node: SyntaxNode,
  type: string,
  results: SyntaxNode[] = []
): SyntaxNode[] {
  if (node.type === type) results.push(node);
  for (const child of node.children) {
    if (child) findNodes(child, type, results);
  }
  return results;
}

export function findChild(
  node: SyntaxNode,
  type: string
): SyntaxNode | undefined {
  return (
    node.children.find(
      (c): c is SyntaxNode => c !== null && c.type === type
    ) ?? undefined
  );
}

export function filterChildren(
  node: SyntaxNode,
  type: string
): SyntaxNode[] {
  return node.children.filter(
    (c): c is SyntaxNode => c !== null && c.type === type
  );
}

export function findByText(
  node: SyntaxNode,
  type: string,
  text: string,
  results: SyntaxNode[] = []
): SyntaxNode[] {
  if (node.type === type && node.text === text) results.push(node);
  for (const child of node.children) {
    if (child) findByText(child, type, text, results);
  }
  return results;
}

// ── Kotlin 파일 수집 ─────────────────────────────────────────────────────────

export async function collectKotlinFiles(
  projectPath: string
): Promise<string[]> {
  const results: string[] = [];

  // Android 프로젝트: app/src/main/java 또는 app/src/main/kotlin 탐색
  const mainDirs = [
    path.join(projectPath, "app", "src", "main", "java"),
    path.join(projectPath, "app", "src", "main", "kotlin"),
    // 다중 모듈 대응: 프로젝트 루트 수준의 src/main/java 탐색
    path.join(projectPath, "src", "main", "java"),
    path.join(projectPath, "src", "main", "kotlin"),
  ];

  async function walk(dir: string): Promise<void> {
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
      } else if (entry.endsWith(".kt")) {
        results.push(full);
      }
    }
  }

  for (const dir of mainDirs) {
    await walk(dir);
  }

  return results;
}

// ── Kotlin 어노테이션 파싱 ───────────────────────────────────────────────────

/**
 * 함수 선언 바로 앞에 @Composable 어노테이션이 있는지 확인한다.
 * Kotlin tree-sitter 그래머에서 function_declaration의 modifiers를 검사한다.
 */
function hasComposableAnnotation(funcNode: SyntaxNode): boolean {
  // tree-sitter kotlin에서 modifiers는 function_declaration의 첫 번째 자식이거나
  // 독립 annotation 노드로 나타남
  const modifiers = findChild(funcNode, "modifiers");
  if (modifiers) {
    const annotations = findNodes(modifiers, "annotation");
    if (annotations.some((a) => a.text.includes("Composable"))) return true;

    const userTypes = findNodes(modifiers, "user_type");
    if (userTypes.some((u) => u.text === "Composable")) return true;

    // simple_identifier 체크 (일부 tree-sitter 버전)
    const simpleIds = findNodes(modifiers, "simple_identifier");
    if (simpleIds.some((id) => id.text === "Composable")) return true;
  }

  // function_declaration 바로 앞 형제 노드에서 annotation 탐색 (flat 구조)
  const parent = funcNode.parent;
  if (parent) {
    const siblings = parent.children.filter((c): c is SyntaxNode => c !== null);
    const idx = siblings.findIndex(
      (s) =>
        s.type === funcNode.type &&
        s.startPosition.row === funcNode.startPosition.row &&
        s.startPosition.column === funcNode.startPosition.column
    );
    if (idx > 0) {
      for (let i = idx - 1; i >= 0; i--) {
        const sib = siblings[i]!;
        if (
          sib.type === "annotation" ||
          sib.type === "multi_annotation" ||
          (sib.type === "simple_identifier" && sib.text === "Composable")
        ) {
          if (sib.text.includes("Composable")) return true;
        }
        // modifiers 노드
        if (sib.type === "modifiers") {
          const anns = findNodes(sib, "annotation");
          if (anns.some((a) => a.text.includes("Composable"))) return true;
          break;
        }
        break;
      }
    }
  }

  // 전체 텍스트에서 @Composable 어노테이션 확인 (fallback)
  const funcText = funcNode.text;
  if (funcText.startsWith("@Composable") || funcText.includes("\n@Composable\n")) {
    return true;
  }

  return false;
}

// ── 단일 파일 파싱 ────────────────────────────────────────────────────────────

export async function parseKotlinFile(
  absolutePath: string,
  projectPath: string
): Promise<ParsedFile> {
  const source = await readFile(absolutePath, "utf-8");
  const { rootNode: root, disposeTree } = await parseWithTree("kotlin", source);
  const relPath = path.relative(projectPath, absolutePath);

  // import 파싱
  const importNodes = findNodes(root, "import_header");
  const imports: ImportInfo[] = importNodes.map((imp) => {
    const identifier = findChild(imp, "identifier");
    const packagePath = identifier?.text ?? imp.text.replace(/^import\s+/, "").trim();
    return { raw: imp.text.trim(), packagePath };
  });

  // @Composable fun 파싱
  // Kotlin tree-sitter에서 function_declaration을 찾고 @Composable 어노테이션 확인
  const composables: ComposableInfo[] = [];

  // 파일 소스에서 @Composable fun 패턴을 직접 탐지 (tree-sitter fallback 포함)
  // 방법 1: 소스 텍스트 라인 기반 파싱 (신뢰도 높음)
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // @Composable 어노테이션 라인
    if (trimmed === "@Composable" || trimmed.startsWith("@Composable ") || trimmed.startsWith("@Composable\n")) {
      // 다음 줄에서 fun 선언 찾기
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j]!.trim();
        if (nextLine.startsWith("fun ") || nextLine.startsWith("private fun ") || nextLine.startsWith("internal fun ")) {
          const match = nextLine.match(/(?:private\s+|internal\s+)?fun\s+(\w+)\s*[(<]/);
          if (match) {
            const name = match[1]!;
            // 최상위 레벨 여부 판단 (들여쓰기 0)
            const isTopLevel = !lines[j]!.match(/^\s+/);
            composables.push({
              name,
              file: relPath,
              line: j + 1,
              isTopLevel,
            });
          }
          break;
        }
        if (nextLine.startsWith("@") || nextLine === "" || nextLine.startsWith("//")) {
          j++;
          continue;
        }
        break;
      }
    }

    // @OptIn(...) @Composable 패턴 — 같은 줄에 @Composable 포함
    if (trimmed.includes("@Composable") && (trimmed.startsWith("@OptIn") || trimmed.includes("@"))) {
      // 이미 fun이 같은 줄에 있는 경우
      const funMatch = trimmed.match(/fun\s+(\w+)\s*[(<]/);
      if (funMatch) {
        const name = funMatch[1]!;
        const isTopLevel = !line.match(/^\s+/);
        if (!composables.find((c) => c.name === name && c.line === i + 1)) {
          composables.push({ name, file: relPath, line: i + 1, isTopLevel });
        }
      } else {
        // 다음 줄에 fun
        let j = i + 1;
        while (j < lines.length) {
          const nextLine = lines[j]!.trim();
          if (nextLine.startsWith("fun ") || nextLine.startsWith("private fun ")) {
            const match = nextLine.match(/(?:private\s+|internal\s+)?fun\s+(\w+)\s*[(<]/);
            if (match) {
              const name = match[1]!;
              const isTopLevel = !lines[j]!.match(/^\s+/);
              if (!composables.find((c) => c.name === name && c.line === j + 1)) {
                composables.push({ name, file: relPath, line: j + 1, isTopLevel });
              }
            }
            break;
          }
          if (nextLine.startsWith("@") || nextLine === "") { j++; continue; }
          break;
        }
      }
    }

    i++;
  }

  return { filePath: relPath, composables, imports, root, source, disposeTree };
}

// ── 프로젝트 전체 심볼 테이블 ────────────────────────────────────────────────

export interface SymbolTable {
  /** @Composable 함수명 → ComposableInfo */
  composables: Map<string, ComposableInfo>;
  /** @Composable 함수명 → ParsedFile */
  fileByComposable: Map<string, ParsedFile>;
  /** 파일 상대경로 → ParsedFile */
  files: Map<string, ParsedFile>;
  /** 모든 ParsedFile의 tree-sitter Tree를 해제한다. SymbolTable이 더 이상 필요 없을 때 호출. */
  dispose: () => void;
}

export async function buildSymbolTable(
  projectPath: string
): Promise<SymbolTable> {
  const kotlinFiles = await collectKotlinFiles(projectPath);
  const table: SymbolTable = {
    composables: new Map(),
    fileByComposable: new Map(),
    files: new Map(),
    dispose: () => {
      for (const parsed of table.files.values()) {
        parsed.disposeTree();
      }
    },
  };

  try {
    for (const absPath of kotlinFiles) {
      const parsed = await parseKotlinFile(absPath, projectPath);
      table.files.set(parsed.filePath, parsed);
      for (const comp of parsed.composables) {
        if (!table.composables.has(comp.name)) {
          table.composables.set(comp.name, comp);
          table.fileByComposable.set(comp.name, parsed);
        }
      }
    }
  } catch (e) {
    // 루프 도중 파싱 실패 시 지금까지 파싱된 모든 Tree를 해제하고 재던진다.
    table.dispose();
    throw e;
  }

  return table;
}
