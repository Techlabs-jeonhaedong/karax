/**
 * inliner — 커스텀 컴포넌트 함수를 반환 JSX로 인라이닝한다.
 *
 * - maxInlineDepth 기본 6, 방문 집합으로 재귀 차단
 * - prop 리터럴은 argBindings로 바인딩
 * - 인라인 노드 confidence = 0.7
 * - 해석 실패 시 Unknown 노드 + UNRESOLVED_COMPONENT diagnostic
 */

import type { SyntaxNode } from "@sfc/adapter-api";
import type { IRNode } from "@sfc/core";
import { NODE_CONFIDENCE } from "@sfc/core";
import type { SymbolTable, ParsedFile } from "../parse/scanner.js";
import { findNodes, findChild } from "../parse/scanner.js";
import { parseStyleSheet } from "./componentMapper.js";
import { mapComponent, type MapContext } from "./componentMapper.js";

// ── 함수 컴포넌트의 return JSX 추출 ──────────────────────────────────────────

/**
 * function_declaration 또는 export default function의 return 노드를 찾는다.
 */
function findFunctionReturnJsx(
  root: SyntaxNode,
  componentName: string
): SyntaxNode | undefined {
  // function_declaration
  const funcDecls = findNodes(root, "function_declaration");
  for (const decl of funcDecls) {
    const nameId = findChild(decl, "identifier");
    if (nameId?.text !== componentName) continue;
    const body = findChild(decl, "statement_block");
    if (!body) continue;
    return extractFirstReturn(body);
  }

  // export_statement → function_declaration
  const exportStmts = findNodes(root, "export_statement");
  for (const exp of exportStmts) {
    const funcDecl = findChild(exp, "function_declaration");
    if (!funcDecl) continue;
    const nameId = findChild(funcDecl, "identifier");
    if (nameId?.text !== componentName) continue;
    const body = findChild(funcDecl, "statement_block");
    if (!body) continue;
    return extractFirstReturn(body);
  }

  // lexical_declaration: const Foo = () => <JSX />
  const lexDecls = findNodes(root, "lexical_declaration");
  for (const decl of lexDecls) {
    const varDecl = findChild(decl, "variable_declarator");
    if (!varDecl) continue;
    const nameId = findChild(varDecl, "identifier");
    if (nameId?.text !== componentName) continue;

    // arrow_function
    const arrowFunc = findNodes(varDecl, "arrow_function")[0];
    if (!arrowFunc) continue;

    const children = arrowFunc.children.filter((c): c is SyntaxNode => c !== null);
    const arrowIdx = children.findIndex(c => c.type === "=>");
    if (arrowIdx < 0) continue;

    const body = children[arrowIdx + 1];
    if (!body) continue;

    if (body.type === "jsx_element" || body.type === "jsx_self_closing_element") return body;
    if (body.type === "parenthesized_expression") {
      const inner = body.children.find(
        (c): c is SyntaxNode => c !== null && (c.type === "jsx_element" || c.type === "jsx_self_closing_element")
      );
      if (inner) return inner;
    }
    if (body.type === "statement_block") {
      return extractFirstReturn(body);
    }
  }

  return undefined;
}

function extractFirstReturn(stmtBlock: SyntaxNode): SyntaxNode | undefined {
  const retStmts = findNodes(stmtBlock, "return_statement");
  if (retStmts.length === 0) return undefined;

  const ret = retStmts[0]!;
  for (const c of ret.children) {
    if (!c || c.type === "return" || c.type === ";") continue;
    // parenthesized_expression 벗기기
    if (c.type === "parenthesized_expression") {
      const inner = c.children.find(
        (ch): ch is SyntaxNode =>
          ch !== null &&
          ch.type !== "(" &&
          ch.type !== ")"
      );
      return inner;
    }
    return c;
  }
  return undefined;
}

// ── 함수 시그니처 기본 파라미터 값 추출 ──────────────────────────────────────

/**
 * 컴포넌트 함수 시그니처에서 기본값을 가진 파라미터를 추출한다.
 * function Foo({ price, currency = 'USD' }: Props) → { currency: 'USD' }
 */
function extractDefaultProps(
  root: SyntaxNode,
  componentName: string
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};

  function processParams(formalParams: SyntaxNode): void {
    // 구조분해 객체 패턴은 required_parameter 내부에 있거나 직접 children에 있을 수 있음
    let objPattern = formalParams.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "object_pattern"
    );
    if (!objPattern) {
      // required_parameter 내부 탐색
      for (const child of formalParams.children) {
        if (!child) continue;
        if (child.type === "required_parameter" || child.type === "optional_parameter") {
          const inner = child.children.find(
            (c): c is SyntaxNode => c !== null && c.type === "object_pattern"
          );
          if (inner) { objPattern = inner; break; }
        }
      }
    }
    if (!objPattern) return;

    for (const child of objPattern.children) {
      if (!child) continue;
      // assignment_pattern (top-level) or object_assignment_pattern (within object destructuring)
      if (child.type === "assignment_pattern" || child.type === "object_assignment_pattern") {
        const kids = child.children.filter((c): c is SyntaxNode => c !== null);
        const keyNode = kids.find(c =>
          c.type === "identifier" ||
          c.type === "shorthand_property_identifier_pattern"
        );
        const valueNode = kids.find(c => c !== keyNode && c.type !== "=");
        if (keyNode && valueNode) {
          const key = keyNode.text;
          if (valueNode.type === "string") {
            const frag = findNodes(valueNode, "string_fragment")[0];
            defaults[key] = frag?.text ?? valueNode.text.replace(/^['"]|['"]$/g, "");
          } else if (valueNode.type === "number") {
            defaults[key] = parseFloat(valueNode.text);
          } else if (valueNode.type === "true") {
            defaults[key] = true;
          } else if (valueNode.type === "false") {
            defaults[key] = false;
          } else if (valueNode.type === "null") {
            defaults[key] = null;
          }
        }
      }
    }
  }

  // function_declaration
  for (const decl of findNodes(root, "function_declaration")) {
    const nameId = findChild(decl, "identifier");
    if (nameId?.text !== componentName) continue;
    const params = findChild(decl, "formal_parameters");
    if (params) processParams(params);
  }

  // export_statement → function_declaration
  for (const exp of findNodes(root, "export_statement")) {
    const funcDecl = findChild(exp, "function_declaration");
    if (!funcDecl) continue;
    const nameId = findChild(funcDecl, "identifier");
    if (nameId?.text !== componentName) continue;
    const params = findChild(funcDecl, "formal_parameters");
    if (params) processParams(params);
  }

  return defaults;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

export async function tryInlineComponent(
  componentName: string,
  symbolTable: SymbolTable,
  projectPath: string,
  ctx: MapContext
): Promise<IRNode | null> {
  const parsedFile = symbolTable.fileByComponent.get(componentName);
  if (!parsedFile) {
    ctx.diagnostics?.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `커스텀 컴포넌트 '${componentName}'의 소스 파일을 찾을 수 없음`,
    });
    return {
      type: "Unknown",
      confidence: NODE_CONFIDENCE.unknown,
      role: `component:${componentName}`,
    };
  }

  const returnNode = findFunctionReturnJsx(parsedFile.root, componentName);
  if (!returnNode) {
    ctx.diagnostics?.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `컴포넌트 '${componentName}'의 JSX return을 찾을 수 없음`,
    });
    return {
      type: "Unknown",
      confidence: NODE_CONFIDENCE.unknown,
      role: `component:${componentName}`,
    };
  }

  // 해당 파일의 StyleSheet 파싱
  const fileStyleSheet = parseStyleSheet(parsedFile.root);

  // 함수 기본 파라미터 값을 argBindings에 병합 (call-site 바인딩이 우선)
  const defaultProps = extractDefaultProps(parsedFile.root, componentName);
  const mergedBindings: Record<string, unknown> = {
    ...defaultProps,
    ...ctx.argBindings,
  };

  const inlineCtx: MapContext = {
    ...ctx,
    currentFile: parsedFile.filePath,
    styleSheet: fileStyleSheet,
    argBindings: mergedBindings,
  };

  const result = await mapComponent(returnNode, ctx.mockProvider, inlineCtx);
  if (!result) return null;

  // 인라인 confidence 조정
  const withInlineConf: IRNode = {
    ...result,
    confidence: Math.min(result.confidence, NODE_CONFIDENCE.inlined),
  };

  return withInlineConf;
}
