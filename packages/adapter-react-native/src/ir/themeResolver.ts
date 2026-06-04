/**
 * themeResolver — src/theme.ts의 colors/spacing/typography 객체를 파싱해
 * designTokens를 생성한다.
 */

import path from "path";
import { readFile } from "fs/promises";
import { parseSource, type SyntaxNode } from "@sfc/adapter-api";
import { findNodes, findChild } from "../parse/scanner.js";

// ── 결과 타입 ─────────────────────────────────────────────────────────────────

export interface ThemeDiagnostic {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
}

export interface ThemeResult {
  colors: Record<string, string>;
  spacing: Record<string, number>;
  typography: Record<string, unknown>;
  diagnostics: ThemeDiagnostic[];
}

// ── 문자열 / 숫자 리터럴 추출 ─────────────────────────────────────────────────

function extractStringValue(node: SyntaxNode): string | undefined {
  if (node.type === "string") {
    const frag = findNodes(node, "string_fragment")[0];
    return frag?.text ?? node.text.replace(/^['"]|['"]$/g, "");
  }
  if (node.type === "template_string") {
    return node.text.replace(/^`|`$/g, "");
  }
  return undefined;
}

function extractNumberValue(node: SyntaxNode): number | undefined {
  if (node.type === "number") {
    return parseFloat(node.text);
  }
  return undefined;
}

// ── export const colors = { ... } 파싱 ──────────────────────────────────────

/**
 * export const TOKEN_NAME = { key: value, ... } 형태의 객체를 파싱한다.
 * value가 문자열이면 string 맵으로, 숫자면 number 맵으로 반환한다.
 */
function parseExportedObject(
  root: SyntaxNode,
  exportName: string
): { strings: Record<string, string>; numbers: Record<string, number> } {
  const strResult: Record<string, string> = {};
  const numResult: Record<string, number> = {};

  // export_statement → lexical_declaration → variable_declarator
  const exportStmts = findNodes(root, "export_statement");
  for (const exp of exportStmts) {
    const lexDecl = findChild(exp, "lexical_declaration");
    if (!lexDecl) continue;

    const varDeclarator = findNodes(lexDecl, "variable_declarator")[0];
    if (!varDeclarator) continue;

    const nameId = findChild(varDeclarator, "identifier");
    if (nameId?.text !== exportName) continue;

    // = 오른쪽 object
    const objExpr = findNodes(varDeclarator, "object")[0];
    if (!objExpr) continue;

    // pair: key: value
    const pairs = findNodes(objExpr, "pair");
    for (const pair of pairs) {
      const keyNode = pair.children.find(
        (c): c is SyntaxNode =>
          c !== null &&
          (c.type === "property_identifier" || c.type === "string" || c.type === "identifier")
      );
      if (!keyNode) continue;
      const key = keyNode.text.replace(/^['"]|['"]$/g, "");

      // value: 오른쪽 노드
      const valueNode = pair.children.find(
        (c): c is SyntaxNode =>
          c !== null &&
          c !== keyNode &&
          c.type !== ":" &&
          c.type !== ","
      );
      if (!valueNode) continue;

      const strVal = extractStringValue(valueNode);
      if (strVal !== undefined) {
        strResult[key] = strVal;
        continue;
      }
      const numVal = extractNumberValue(valueNode);
      if (numVal !== undefined) {
        numResult[key] = numVal;
      }
    }

    break; // 첫 번째 매칭에서 종료
  }

  return { strings: strResult, numbers: numResult };
}

/**
 * typography 객체: 값이 중첩 객체 (h1: { fontSize: 32, ... })
 * 중첩 객체를 Record<string, unknown>으로 수집한다.
 */
function parseTypographyObject(root: SyntaxNode): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  const exportStmts = findNodes(root, "export_statement");
  for (const exp of exportStmts) {
    const lexDecl = findChild(exp, "lexical_declaration");
    if (!lexDecl) continue;

    const varDeclarator = findNodes(lexDecl, "variable_declarator")[0];
    if (!varDeclarator) continue;

    const nameId = findChild(varDeclarator, "identifier");
    if (nameId?.text !== "typography") continue;

    const objExpr = findNodes(varDeclarator, "object")[0];
    if (!objExpr) continue;

    const pairs = findNodes(objExpr, "pair");
    for (const pair of pairs) {
      const keyNode = pair.children.find(
        (c): c is SyntaxNode =>
          c !== null &&
          (c.type === "property_identifier" || c.type === "identifier")
      );
      if (!keyNode) continue;

      const nestedObj = findNodes(pair, "object")[0];
      if (!nestedObj) continue;

      const nestedResult: Record<string, unknown> = {};
      const nestedPairs = findNodes(nestedObj, "pair");
      for (const np of nestedPairs) {
        const nKey = np.children.find(
          (c): c is SyntaxNode => c !== null && c.type === "property_identifier"
        );
        const nVal = np.children.find(
          (c): c is SyntaxNode => c !== null && c.type !== "property_identifier" && c.type !== ":"
        );
        if (nKey && nVal) {
          const strV = extractStringValue(nVal);
          const numV = extractNumberValue(nVal);
          nestedResult[nKey.text] = strV ?? numV ?? nVal.text;
        }
      }

      result[keyNode.text] = nestedResult;
    }

    break;
  }

  return result;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

const THEME_CANDIDATES = [
  "src/theme.ts",
  "src/theme.tsx",
  "src/styles/theme.ts",
  "theme.ts",
  "theme.tsx",
];

export async function resolveTheme(projectPath: string): Promise<ThemeResult> {
  const diagnostics: ThemeDiagnostic[] = [];

  // theme 파일 탐색
  let themeSource: string | undefined;
  let themePath: string | undefined;
  for (const candidate of THEME_CANDIDATES) {
    const absPath = path.join(projectPath, candidate);
    try {
      themeSource = await readFile(absPath, "utf-8");
      themePath = candidate;
      break;
    } catch {
      // 다음 후보 시도
    }
  }

  if (!themeSource || !themePath) {
    diagnostics.push({
      level: "warn",
      code: "THEME_DEFAULTED",
      message: "theme.ts 파일을 찾을 수 없음 — 빈 designTokens 사용",
    });
    return { colors: {}, spacing: {}, typography: {}, diagnostics };
  }

  let root: SyntaxNode;
  try {
    root = await parseSource("tsx", themeSource);
  } catch {
    diagnostics.push({
      level: "warn",
      code: "THEME_DEFAULTED",
      message: `theme.ts 파싱 실패 (${themePath})`,
    });
    return { colors: {}, spacing: {}, typography: {}, diagnostics };
  }

  const { strings: colors } = parseExportedObject(root, "colors");
  const { numbers: spacing } = parseExportedObject(root, "spacing");
  const typography = parseTypographyObject(root);

  return {
    colors,
    spacing,
    typography,
    diagnostics,
  };
}
