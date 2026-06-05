/**
 * constResolver — 정적 문자열 상수 수집·해석
 *
 * GetX 라우팅처럼 라우트 이름이 `UnIPath.SPLASH` 같은 클래스 정적 상수 참조로
 * 쓰이는 경우를 해석하기 위해, 프로젝트 전체의 `static const/final String` 멤버를
 * "ClassName.MEMBER" → 값 형태로 수집한다.
 *
 * 결정론 보장: 동일 키 중복 시 첫 번째 값을 유지한다.
 */

import type { SyntaxNode } from "@karax/adapter-api";
import { findNodes, findChild, filterChildren } from "./scanner.js";

export interface ConstTable {
  /** "ClassName.MEMBER" → 문자열 값 (예: "UnIPath.SPLASH" → "/splash") */
  stringConstants: Map<string, string>;
}

function stripQuotes(s: string): string {
  return s.replace(/^['"]|['"]$/g, "");
}

/**
 * 파싱된 파일 AST에서 `static const/final String X = "..."` 멤버를 수집해
 * table.stringConstants에 누적한다. 동일 키가 이미 있으면 첫 값을 유지한다.
 *
 * AST 구조 (tree-sitter-dart):
 *   class_definition > identifier(클래스명)
 *   class_body > declaration[static, const_builtin|final_builtin, type_identifier?,
 *     static_final_declaration_list > static_final_declaration[identifier, string_literal]]
 */
export function buildConstTable(
  root: SyntaxNode,
  _filePath: string,
  table: ConstTable
): void {
  const classDefs = findNodes(root, "class_definition");

  for (const cls of classDefs) {
    const className = findChild(cls, "identifier")?.text;
    if (!className) continue;

    const body = findChild(cls, "class_body");
    if (!body) continue;

    for (const decl of filterChildren(body, "declaration")) {
      // static 멤버만
      if (!findChild(decl, "static")) continue;

      // 타입 표기가 있으면 String이어야 함 (없으면 값으로 판정)
      const typeId = findChild(decl, "type_identifier");
      if (typeId && typeId.text !== "String") continue;

      const declList = findChild(decl, "static_final_declaration_list");
      if (!declList) continue;

      for (const sfd of filterChildren(declList, "static_final_declaration")) {
        const name = findChild(sfd, "identifier")?.text;
        const strLit = findChild(sfd, "string_literal");
        if (!name || !strLit) continue;

        const key = `${className}.${name}`;
        if (!table.stringConstants.has(key)) {
          table.stringConstants.set(key, stripQuotes(strLit.text));
        }
      }
    }
  }
}

/**
 * 문자열 표현식 노드를 해석한다.
 * - string_literal → 따옴표 제거 후 그대로 반환
 * - `ClassName.MEMBER` 참조 (identifier + selector(.identifier)) → 상수 테이블 룩업
 * - 그 외 / 미등록 → undefined (동적 값은 정직하게 미해석 처리)
 */
export function resolveStringExpr(
  node: SyntaxNode,
  table: ConstTable
): string | undefined {
  if (node.type === "string_literal") {
    return stripQuotes(node.text);
  }

  // ClassName.MEMBER 패턴: [identifier, selector > unconditional_assignable_selector > identifier]
  const baseId = findChild(node, "identifier");
  if (baseId) {
    const selector = node.children.find(
      (c): c is SyntaxNode => c !== null && c.type === "selector"
    );
    if (selector) {
      const uas = findChild(selector, "unconditional_assignable_selector");
      const memberId = uas ? findChild(uas, "identifier") : undefined;
      if (memberId) {
        return table.stringConstants.get(`${baseId.text}.${memberId.text}`);
      }
    }
  }

  return undefined;
}
