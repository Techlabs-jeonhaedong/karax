import type { SyntaxNode } from "@karax/adapter-api";
import type { SymbolTable, ClassInfo, ParsedFile } from "../parse/scanner.js";
import { findNodes, findChild } from "../parse/scanner.js";

// ── 상수 ─────────────────────────────────────────────────────────────────────

const SCREEN_SUFFIXES = ["Screen", "Page", "View"] as const;
const SCAFFOLD_WIDGETS = new Set(["Scaffold", "CupertinoPageScaffold"]);
const WIDGET_SUPERCLASSES = new Set([
  "StatelessWidget",
  "StatefulWidget",
  "State",
  "Widget",
]);

// ── 판별 유틸 ─────────────────────────────────────────────────────────────────

function isPublic(name: string): boolean {
  return !name.startsWith("_");
}

function hasScreenSuffix(name: string): boolean {
  return SCREEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * 클래스의 build() 메서드에서 Scaffold/CupertinoPageScaffold를 반환하는지 확인한다.
 */
function buildReturnsScaffold(cls: SyntaxNode): boolean {
  const classBody = findChild(cls, "class_body");
  if (!classBody) return false;

  const methodSigs = findNodes(classBody, "method_signature");
  for (const sig of methodSigs) {
    const funcSig = findChild(sig, "function_signature");
    if (!funcSig) continue;
    const methodName = findChild(funcSig, "identifier")?.text;
    if (methodName !== "build") continue;

    // sig의 다음 형제 function_body 탐색
    const parent = sig.parent;
    if (!parent) continue;
    const siblings = parent.children.filter((c): c is SyntaxNode => c !== null);
    const idx = siblings.indexOf(sig);
    let funcBody: SyntaxNode | undefined;
    for (let i = idx + 1; i < siblings.length; i++) {
      if (siblings[i].type === "function_body") {
        funcBody = siblings[i];
        break;
      }
    }

    if (!funcBody) continue;

    // function_body 내 return_statement 탐색
    const retStmts = findNodes(funcBody, "return_statement");
    for (const ret of retStmts) {
      const constObj = findNodes(ret, "const_object_expression")[0];
      if (constObj) {
        const typeName = findChild(constObj, "type_identifier")?.text;
        if (typeName && SCAFFOLD_WIDGETS.has(typeName)) return true;
      }
      const firstId = ret.children.find(
        (c): c is SyntaxNode => c !== null && c.type === "identifier"
      );
      if (firstId && SCAFFOLD_WIDGETS.has(firstId.text)) return true;
    }
  }

  return false;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

export interface HeuristicCandidate {
  className: string;
  file: ParsedFile;
  classInfo: ClassInfo;
  reason: "scaffold-return" | "name-suffix" | "both";
}

export function findHeuristicCandidates(
  symbolTable: SymbolTable,
  routeClassNames: Set<string>
): HeuristicCandidate[] {
  const results: HeuristicCandidate[] = [];

  for (const [className, classInfo] of symbolTable.classes) {
    if (!isPublic(className)) continue;
    if (routeClassNames.has(className)) continue;
    if (!WIDGET_SUPERCLASSES.has(classInfo.superclass)) continue;
    if (classInfo.stateOf) continue;

    const parsedFile = symbolTable.fileByClass.get(className);
    if (!parsedFile) continue;

    const ast = findNodes(parsedFile.root, "class_definition").find(
      (cls) => findChild(cls, "identifier")?.text === className
    );
    if (!ast) continue;

    const returnsScaffold = buildReturnsScaffold(ast);
    const hasSuffix = hasScreenSuffix(className);

    if (returnsScaffold || hasSuffix) {
      const reason: HeuristicCandidate["reason"] =
        returnsScaffold && hasSuffix ? "both" : returnsScaffold ? "scaffold-return" : "name-suffix";
      results.push({ className, file: parsedFile, classInfo, reason });
    }
  }

  return results;
}
