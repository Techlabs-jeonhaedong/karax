/**
 * Kotlin AST 유틸리티
 */

import type { SyntaxNode } from "@sfc/adapter-api";

export function findAllNodes(
  node: SyntaxNode,
  type: string,
  results: SyntaxNode[] = []
): SyntaxNode[] {
  if (node.type === type) results.push(node);
  for (const child of node.children) {
    if (child) findAllNodes(child, type, results);
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

/**
 * Color(0xFF6200EE) → #6200EE
 */
export function parseColorLiteral(text: string): string | undefined {
  const hexMatch = /Color\(\s*0x([0-9A-Fa-f]{6,8})\s*\)/.exec(text);
  if (hexMatch) {
    const hex = hexMatch[1]!;
    return hex.length === 8
      ? `#${hex.slice(2).toUpperCase()}`
      : `#${hex.toUpperCase()}`;
  }
  return undefined;
}

/**
 * MaterialTheme.colorScheme.xxx → token:xxx 또는 실제 색상값
 */
export function resolveThemeColor(
  text: string,
  themeColors: Record<string, string>
): string | undefined {
  const tokenMatch = /MaterialTheme\.colorScheme\.(\w+)/.exec(text);
  if (tokenMatch) {
    const key = tokenMatch[1]!;
    return themeColors[key] ? themeColors[key] : `token:${key}`;
  }
  return parseColorLiteral(text);
}

/**
 * Modifier 체인 텍스트에서 특정 modifier 값을 추출한다.
 * 예: ".padding(16.dp)" → 16
 */
export function extractModifierValue(
  modifierText: string,
  modifierName: string
): number | undefined {
  // .padding(16.dp) → 16
  // .padding(horizontal = 16.dp, vertical = 20.dp)
  const re = new RegExp(`\\.${modifierName}\\(([^)]+)\\)`);
  const m = re.exec(modifierText);
  if (!m) return undefined;

  const inner = m[1]!;
  // 단순 숫자: 16.dp → 16
  const numMatch = /^(\d+(?:\.\d+)?)\.dp/.exec(inner.trim());
  if (numMatch) return parseFloat(numMatch[1]!);

  return undefined;
}

/**
 * 소스 텍스트에서 특정 Composable 함수의 본문 블록을 추출한다.
 * 함수명으로 위치를 찾고 중괄호 카운팅으로 블록 범위 결정.
 */
export function extractFunctionBody(
  source: string,
  funcName: string
): string | undefined {
  // fun FuncName( 패턴으로 위치 찾기
  const funcStart = source.indexOf(`fun ${funcName}(`);
  if (funcStart < 0) return undefined;

  // 첫 번째 { 찾기
  let braceStart = source.indexOf("{", funcStart);
  if (braceStart < 0) return undefined;

  // 중괄호 카운팅
  let depth = 0;
  let i = braceStart;
  while (i < source.length) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
    i++;
  }

  return undefined;
}

/**
 * Composable 호출 텍스트에서 named argument 값을 추출한다.
 * 예: "Text(text = \"Hello\", ...)" → getNamedArgText(node, "text") → "Hello"
 */
export function getNamedArgText(callText: string, argName: string): string | undefined {
  // argName = "..." 패턴
  const stringRe = new RegExp(`${argName}\\s*=\\s*"([^"]+)"`);
  const sm = stringRe.exec(callText);
  if (sm) return sm[1];

  // argName = stringResource(R.string.xxx) 패턴은 별도 처리
  return undefined;
}

/**
 * stringResource(R.string.xxx) → 리소스 키 추출
 */
export function extractStringResourceKey(text: string): string | undefined {
  const m = /stringResource\(\s*R\.string\.(\w+)\s*\)/.exec(text);
  return m ? m[1] : undefined;
}

/**
 * R.color.xxx → 리소스 키 추출
 */
export function extractColorResourceKey(text: string): string | undefined {
  const m = /R\.color\.(\w+)/.exec(text);
  return m ? m[1] : undefined;
}
