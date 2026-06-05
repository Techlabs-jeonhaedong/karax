/**
 * inliner — 커스텀 컴포넌트 함수를 반환 JSX로 인라이닝한다.
 *
 * - maxInlineDepth 기본 6, 방문 집합으로 재귀 차단
 * - prop 리터럴은 argBindings로 바인딩
 * - 인라인 노드 confidence = 0.7
 * - 해석 실패 시 Unknown 노드 + UNRESOLVED_COMPONENT diagnostic
 */

import type { SyntaxNode } from "@karax/adapter-api";
import type { IRNode } from "@karax/core";
import { NODE_CONFIDENCE } from "@karax/core";
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

// ── 로컬 변수 pre-compute ──────────────────────────────────────────────────────

/**
 * 컴포넌트 함수 바디에서 JSX return 이전의 const 변수 선언을 파싱하여
 * argBindings로 계산 가능한 것은 계산 결과를 추가한다.
 *
 * 지원 패턴:
 * - const x = condition ? trueLiteral : nullLiteral
 * - const x = identifier (다른 binding 참조)
 * - const x = Math.round(expr)
 * - const x = number literal
 * - const x = string literal
 * - const x = booleanLiteral
 */
function computeLocalVarBindings(
  root: SyntaxNode,
  componentName: string,
  argBindings: Record<string, unknown>
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};

  // 컴포넌트 함수의 statement_block(body) 찾기
  let funcBody: SyntaxNode | undefined;

  for (const decl of findNodes(root, "function_declaration")) {
    const nameId = findChild(decl, "identifier");
    if (nameId?.text !== componentName) continue;
    funcBody = findChild(decl, "statement_block");
    break;
  }
  if (!funcBody) {
    for (const exp of findNodes(root, "export_statement")) {
      const funcDecl = findChild(exp, "function_declaration");
      if (!funcDecl) continue;
      const nameId = findChild(funcDecl, "identifier");
      if (nameId?.text !== componentName) continue;
      funcBody = findChild(funcDecl, "statement_block");
      break;
    }
  }
  if (!funcBody) return extra;

  // body 내 직접 자식 lexical_declaration(const)만 처리 (JSX return 이전)
  for (const child of funcBody.children) {
    if (!child) continue;
    if (child.type === "return_statement") break; // return 이후는 처리 불필요

    if (child.type !== "lexical_declaration") continue;
    const kind = child.children.find(c => c !== null && (c.text === "const" || c.text === "let"));
    if (!kind) continue;

    const varDecl = findChild(child, "variable_declarator");
    if (!varDecl) continue;

    const nameId = findChild(varDecl, "identifier");
    if (!nameId) continue;
    const varName = nameId.text;

    // value 노드 (= 이후)
    const valueNode = varDecl.children.find(
      (c): c is SyntaxNode => c !== null && c.type !== "identifier" && c.type !== "="
    );
    if (!valueNode) continue;

    const computed = evalSimpleExpr(valueNode, { ...argBindings, ...extra });
    if (computed !== undefined) {
      extra[varName] = computed;
    }
  }

  return extra;
}

/**
 * 단순 표현식을 argBindings 기반으로 평가한다.
 * 복잡한 표현식은 null/undefined를 반환해 무시한다.
 */
function evalSimpleExpr(
  node: SyntaxNode,
  bindings: Record<string, unknown>
): unknown {
  // 리터럴
  if (node.type === "number") return parseFloat(node.text);
  if (node.type === "string") {
    const frag = findNodes(node, "string_fragment")[0];
    return frag?.text ?? node.text.replace(/^['"]|['"]$/g, "");
  }
  if (node.type === "true") return true;
  if (node.type === "false") return false;
  if (node.type === "null") return null;

  // identifier → bindings 참조
  if (node.type === "identifier") {
    const val = bindings[node.text];
    return val; // undefined면 undefined 반환
  }

  // member_expression: obj.prop → bindings[obj][prop]
  if (node.type === "member_expression") {
    const children = node.children.filter((c): c is SyntaxNode => c !== null && c.text !== ".");
    if (children.length >= 2) {
      const objName = children[0]!.text;
      const propName = children[children.length - 1]!.text;
      const obj = bindings[objName];
      if (obj && typeof obj === "object") {
        return (obj as Record<string, unknown>)[propName];
      }
    }
    return undefined;
  }

  // ternary_expression: condition ? trueBranch : falseBranch
  if (node.type === "ternary_expression") {
    const children = node.children.filter((c): c is SyntaxNode => c !== null);
    const qIdx = children.findIndex(c => c.type === "?");
    const colonIdx = children.findIndex(c => c.type === ":");
    if (qIdx < 0 || colonIdx < 0) return undefined;

    const condition = children[0];
    const trueBranch = children[qIdx + 1];
    const falseBranch = children[colonIdx + 1];

    if (!condition || !trueBranch || !falseBranch) return undefined;

    const condVal = evalSimpleExpr(condition, bindings);
    const isTruthy = condVal !== null && condVal !== undefined && condVal !== false && condVal !== 0 && condVal !== "";

    return evalSimpleExpr(isTruthy ? trueBranch : falseBranch, bindings);
  }

  // call_expression: Math.round(expr), price.toFixed(2) 등
  if (node.type === "call_expression") {
    const funcNode = node.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "member_expression"
    );
    const argsNode = findChild(node, "arguments");

    if (funcNode && argsNode) {
      const funcChildren = funcNode.children.filter((c): c is SyntaxNode => c !== null && c.text !== ".");
      if (funcChildren.length >= 2) {
        const objName = funcChildren[0]!.text;
        const methodName = funcChildren[funcChildren.length - 1]!.text;

        // Math.round / Math.floor / Math.ceil
        if (objName === "Math" && (methodName === "round" || methodName === "floor" || methodName === "ceil")) {
          const argNodes = argsNode.children.filter((c): c is SyntaxNode => c !== null && c.type !== "(" && c.type !== ")" && c.type !== ",");
          if (argNodes.length >= 1) {
            const argVal = evalSimpleExpr(argNodes[0]!, bindings);
            if (typeof argVal === "number") {
              if (methodName === "round") return Math.round(argVal);
              if (methodName === "floor") return Math.floor(argVal);
              if (methodName === "ceil") return Math.ceil(argVal);
            }
          }
          return undefined;
        }

        // number.toFixed(n)
        if (methodName === "toFixed") {
          const obj = bindings[objName];
          if (typeof obj === "number") {
            const decNode = argsNode.children.find((c): c is SyntaxNode => c !== null && c.type === "number");
            const dec = decNode ? parseInt(decNode.text, 10) : 2;
            return obj.toFixed(dec);
          }
          return undefined;
        }
      }
    }
    return undefined;
  }

  // binary_expression: a / b, a * b, a - b, a + b
  if (node.type === "binary_expression") {
    const children = node.children.filter((c): c is SyntaxNode => c !== null);
    if (children.length >= 3) {
      const left = evalSimpleExpr(children[0]!, bindings);
      const op = children[1]!.text;
      const right = evalSimpleExpr(children[2]!, bindings);

      if (typeof left === "number" && typeof right === "number") {
        if (op === "+") return left + right;
        if (op === "-") return left - right;
        if (op === "*") return left * right;
        if (op === "/" && right !== 0) return left / right;
      }
    }
    return undefined;
  }

  // unary_expression: !expr, -num
  if (node.type === "unary_expression") {
    const children = node.children.filter((c): c is SyntaxNode => c !== null);
    if (children.length >= 2) {
      const op = children[0]!.text;
      const operand = evalSimpleExpr(children[1]!, bindings);
      if (op === "!" ) return !operand;
      if (op === "-" && typeof operand === "number") return -operand;
    }
    return undefined;
  }

  // parenthesized_expression: (expr)
  if (node.type === "parenthesized_expression") {
    const inner = node.children.find(
      (c): c is SyntaxNode => c !== null && c.type !== "(" && c.type !== ")"
    );
    if (inner) return evalSimpleExpr(inner, bindings);
  }

  return undefined;
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

  // 함수 바디의 로컬 const 변수를 pre-compute하여 bindings에 추가
  const localVars = computeLocalVarBindings(parsedFile.root, componentName, mergedBindings);
  const finalBindings: Record<string, unknown> = {
    ...mergedBindings,
    ...localVars,
  };

  const inlineCtx: MapContext = {
    ...ctx,
    currentFile: parsedFile.filePath,
    styleSheet: fileStyleSheet,
    argBindings: finalBindings,
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
