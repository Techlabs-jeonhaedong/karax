/**
 * inliner — 커스텀 StatelessWidget/StatefulWidget 호출을 build() 본문으로 인라이닝한다.
 *
 * - maxInlineDepth 기본 6, 방문 집합으로 재귀 차단
 * - 생성자 인자: 리터럴은 바인딩, 비리터럴은 MockProvider로
 * - 인라인 노드 confidence = 0.7
 * - 해석 실패 시 Unknown 노드 + UNRESOLVED_COMPONENT diagnostic
 */

import type { SyntaxNode } from "@sfc/adapter-api";
import type { IRNode } from "@sfc/core";
import { NODE_CONFIDENCE } from "@sfc/core";
import type { MockProvider } from "@sfc/core";
import type { SymbolTable } from "../parse/scanner.js";
import { findAllNodes, findChild, filterChildren } from "./astUtils.js";
import { mapWidget } from "./widgetMapper.js";
import type { MapContext } from "./widgetMapper.js";

// ── diagnostic 타입 ───────────────────────────────────────────────────────────

export interface InlineDiagnostic {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
  sourceRef?: { file?: string; line?: number };
}

// ── InlineResult ──────────────────────────────────────────────────────────────

export interface InlineResult {
  node: IRNode;
  diagnostics: InlineDiagnostic[];
}

// ── 인라이너 옵션 ─────────────────────────────────────────────────────────────

export interface InlinerOptions {
  maxDepth?: number;
  mockProvider?: MockProvider;
  themeTokens?: Record<string, string>;
  existingDiagnostics?: InlineDiagnostic[];
}

// ── build() 메서드 본문 찾기 ──────────────────────────────────────────────────

function findBuildMethod(classNode: SyntaxNode): SyntaxNode | undefined {
  // Dart tree-sitter: class_body 내에 method_signature + function_body 쌍
  // class_body children: [..., method_signature, function_body, ...]
  const classBody = findChild(classNode, "class_body");
  if (!classBody) return classNode; // 클래스 전체에서 탐색

  const children = classBody.children.filter(c => c !== null);
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (child.type === "method_signature") {
      // method_signature 안에 function_signature → identifier = "build"
      const funcSigs = findAllNodes(child, "function_signature");
      const isBuild = funcSigs.some(fs => {
        const id = findAllNodes(fs, "identifier").find(n => n.text === "build");
        return !!id;
      });
      if (isBuild) {
        // 다음 형제가 function_body인지 확인
        const nextSibling = children[i + 1];
        if (nextSibling && nextSibling.type === "function_body") {
          return nextSibling;
        }
        return child;
      }
    }
    // method_declaration 패턴
    if (child.type === "method_declaration") {
      const nameNodes = findAllNodes(child, "identifier");
      const isBuild = nameNodes.some(n => n.text === "build");
      if (isBuild) return child;
    }
  }

  // fallback: 전체에서 function_signature 탐색
  const funcSigs = findAllNodes(classNode, "function_signature");
  for (const sig of funcSigs) {
    const ids = findAllNodes(sig, "identifier");
    if (ids.some(n => n.text === "build")) {
      // 다음 형제 function_body 탐색
      const parent = sig.parent;
      if (!parent) continue;
      const parentChildren = parent.parent?.children ?? [];
      const sigParentIdx = parentChildren.indexOf(parent);
      if (sigParentIdx >= 0 && sigParentIdx + 1 < parentChildren.length) {
        const nextSib = parentChildren[sigParentIdx + 1];
        if (nextSib && nextSib.type === "function_body") return nextSib;
      }
      return sig.parent ?? sig;
    }
  }

  return undefined;
}

/**
 * build() 메서드에서 return하는 위젯 노드를 추출한다.
 */
function extractBuildReturn(buildMethod: SyntaxNode): SyntaxNode | undefined {
  const returnStmts = findAllNodes(buildMethod, "return_statement");
  if (returnStmts.length === 0) return undefined;

  // 첫 번째 return statement의 반환 표현식
  const ret = returnStmts[0]!;
  for (const child of ret.children) {
    if (!child || child.type === "return" || child.type === ";") continue;
    return child;
  }
  return undefined;
}

// ── 파라미터 바인딩 ───────────────────────────────────────────────────────────

/**
 * 클래스 생성자의 named parameter 목록을 추출한다.
 */
function extractConstructorParams(classNode: SyntaxNode): string[] {
  const params: string[] = [];
  // constructor_signature 탐색
  const constructors = findAllNodes(classNode, "constructor_signature");
  for (const ctor of constructors) {
    const formalParams = findAllNodes(ctor, "formal_parameter");
    for (const fp of formalParams) {
      const id = findChild(fp, "identifier");
      if (id) params.push(id.text);
    }
    // named_formal_parameters
    const namedFps = findAllNodes(ctor, "named_formal_parameter");
    for (const nfp of namedFps) {
      const id = findChild(nfp, "identifier");
      if (id && !params.includes(id.text)) params.push(id.text);
    }
  }
  return params;
}

// ── 신뢰도 하향 조정 ─────────────────────────────────────────────────────────

function downgradeConfidence(node: IRNode, factor: number): IRNode {
  return {
    ...node,
    confidence: Math.max(0, node.confidence * factor),
    children: node.children?.map(c => downgradeConfidence(c, factor)),
  };
}

// ── InlinerInstance 클래스 ────────────────────────────────────────────────────

class InlinerInstance {
  private readonly symbolTable: SymbolTable;
  private readonly projectPath: string;
  private readonly maxDepth: number;
  private readonly mockProvider: MockProvider | undefined;
  private readonly themeTokens: Record<string, string>;
  private readonly sharedDiagnostics: InlineDiagnostic[];

  constructor(
    symbolTable: SymbolTable,
    projectPath: string,
    options: InlinerOptions
  ) {
    this.symbolTable = symbolTable;
    this.projectPath = projectPath;
    this.maxDepth = options.maxDepth ?? 6;
    this.mockProvider = options.mockProvider;
    this.themeTokens = options.themeTokens ?? {};
    this.sharedDiagnostics = options.existingDiagnostics ?? [];
  }

  /**
   * 클래스명과 생성자 인자 바인딩으로 위젯을 인라이닝한다.
   * 각 inlineClass 호출은 독립적인 방문 집합을 사용한다.
   */
  async inlineClass(
    className: string,
    args: Record<string, unknown>,
    visitedChain: Set<string> = new Set()
  ): Promise<InlineResult> {
    const diagnostics: InlineDiagnostic[] = [];

    // 심볼 테이블 조회
    const classInfo = this.symbolTable.classes.get(className);
    if (!classInfo) {
      const diag: InlineDiagnostic = {
        level: "warn",
        code: "UNRESOLVED_COMPONENT",
        message: `커스텀 위젯 '${className}'를 심볼 테이블에서 찾을 수 없음`,
      };
      diagnostics.push(diag);
      this.sharedDiagnostics.push(diag);
      return {
        node: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${className}`,
        },
        diagnostics,
      };
    }

    // 재귀 차단
    if (visitedChain.has(className)) {
      return {
        node: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${className}`,
        },
        diagnostics: [],
      };
    }

    // 깊이 제한
    if (visitedChain.size >= this.maxDepth) {
      return {
        node: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${className}`,
        },
        diagnostics: [],
      };
    }

    // 파일에서 클래스 AST 찾기
    const parsedFile = this.symbolTable.fileByClass.get(className);
    if (!parsedFile) {
      return {
        node: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${className}`,
        },
        diagnostics: [],
      };
    }

    // class_definition 찾기
    const classDefs = findAllNodes(parsedFile.root, "class_definition");
    const classNode = classDefs.find(c => {
      const id = findChild(c, "identifier");
      return id?.text === className;
    });

    if (!classNode) {
      return {
        node: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${className}`,
        },
        diagnostics: [],
      };
    }

    // build() 메서드 추출
    const buildMethod = findBuildMethod(classNode);
    if (!buildMethod) {
      return {
        node: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${className}`,
        },
        diagnostics: [],
      };
    }

    const returnNode = extractBuildReturn(buildMethod);
    if (!returnNode) {
      return {
        node: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${className}`,
        },
        diagnostics: [],
      };
    }

    // 방문 집합 갱신
    const newVisited = new Set(visitedChain);
    newVisited.add(className);

    // mapWidget으로 변환
    const mapCtx: MapContext = {
      depth: newVisited.size,
      maxDepth: this.maxDepth,
      visited: newVisited,
      symbolTable: this.symbolTable,
      projectPath: this.projectPath,
      themeTokens: this.themeTokens,
      mockProvider: this.mockProvider,
      diagnostics: this.sharedDiagnostics as Array<{ level: string; code: string; message: string }>,
      // 인라이닝된 클래스 파일 경로를 currentFile로 설정 (sourceRef.file용)
      currentFile: parsedFile.filePath,
      // call-site에서 바인딩된 인자 값 주입 (Text(name) 같은 변수 참조 치환용)
      argBindings: args,
      // 인라이닝된 클래스 파일의 root AST를 currentFileRoot로 설정
      currentFileRoot: parsedFile.root,
    };

    const node = await mapWidget(returnNode, this.mockProvider, mapCtx);
    if (!node) {
      return {
        node: {
          type: "Unknown",
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${className}`,
        },
        diagnostics,
      };
    }

    // 인라인 노드의 confidence를 inlined(0.7)로 조정
    const downgraded = downgradeConfidence(node, NODE_CONFIDENCE.inlined);

    return { node: { ...downgraded, confidence: NODE_CONFIDENCE.inlined }, diagnostics };
  }
}

// ── 공개 팩토리 ───────────────────────────────────────────────────────────────

export interface InlinerHandle {
  inlineClass(className: string, args: Record<string, unknown>): Promise<InlineResult>;
  getDiagnostics(): InlineDiagnostic[];
}

// SymbolTableBuilder는 테스트 편의를 위해 export (실제로는 buildSymbolTable 사용)
export const SymbolTableBuilder = null;

/**
 * 커스텀 위젯 인라이너를 생성한다.
 */
export function createInliner(
  symbolTable: SymbolTable,
  projectPath: string,
  options: InlinerOptions = {}
): InlinerHandle {
  const sharedDiagnostics: InlineDiagnostic[] = [];
  const instance = new InlinerInstance(symbolTable, projectPath, {
    ...options,
    existingDiagnostics: sharedDiagnostics,
  });

  return {
    async inlineClass(className: string, args: Record<string, unknown>): Promise<InlineResult> {
      return instance.inlineClass(className, args);
    },
    getDiagnostics(): InlineDiagnostic[] {
      return sharedDiagnostics;
    },
  };
}

/**
 * mapWidget 컨텍스트에서 커스텀 위젯을 인라이닝하는 헬퍼.
 * mapWidget 내부에서 Unknown 대신 인라이닝을 시도할 때 사용.
 */
export async function tryInlineWidget(
  className: string,
  symbolTable: SymbolTable,
  projectPath: string,
  ctx: MapContext
): Promise<IRNode> {
  const sharedDiags = ctx.diagnostics as InlineDiagnostic[];
  const instance = new InlinerInstance(symbolTable, projectPath, {
    maxDepth: ctx.maxDepth,
    mockProvider: ctx.mockProvider,
    themeTokens: ctx.themeTokens,
    existingDiagnostics: sharedDiags,
  });

  const result = await instance.inlineClass(className, ctx.argBindings ?? {}, ctx.visited);
  return result.node;
}
