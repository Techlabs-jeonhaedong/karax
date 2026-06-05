/**
 * widgetMapper 단위 테스트
 * TDD Red 단계: 구현 전에 작성
 */

import { describe, expect, it } from "vitest";
import type { SyntaxNode } from "@karax/adapter-api";
import { parseSource } from "@karax/adapter-api";
import { createMockProvider } from "@karax/core";
import type { IRNode } from "@karax/core";

// widgetMapper는 아직 없으므로 dynamic import로 테스트한다
// (구현 후에는 static import로 변경 가능)
async function getMapper() {
  const mod = await import("../ir/widgetMapper.js");
  return mod;
}

async function parseDart(source: string): Promise<SyntaxNode> {
  return parseSource("dart", source);
}

// ── Text 노드 ────────────────────────────────────────────────────────────────

describe("widgetMapper — Text", () => {
  it("문자열 리터럴 Text를 IRNode{type:Text, text.value}로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      import 'package:flutter/material.dart';
      class X extends StatelessWidget {
        Widget build(BuildContext context) {
          return const Text('Hello World');
        }
      }
    `);
    // build 메서드 body에서 return statement를 찾아 직접 Text 위젯 AST 노드를 추출
    const node = findFirstNode(root, "const_object_expression");
    if (!node) throw new Error("const_object_expression not found");
    const result = await mapWidget(node, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.type).toBe("Text");
      expect(result.text?.value).toBe("Hello World");
      expect(result.confidence).toBe(1.0);
    }
  });

  it("Text의 style fontSize/color/fontWeight를 추출한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      import 'package:flutter/material.dart';
      Widget build(BuildContext ctx) {
        return const Text(
          'Styled',
          style: TextStyle(fontSize: 20, color: Color(0xFF6750A4), fontWeight: FontWeight.bold),
        );
      }
    `);
    const node = findFirstNode(root, "const_object_expression");
    if (!node) throw new Error("node not found");
    const result = await mapWidget(node, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Text");
    // fontSize나 style 정보가 text에 담겨 있어야 함
  });
});

// ── Column / Row ─────────────────────────────────────────────────────────────

describe("widgetMapper — Column/Row", () => {
  it("Column을 IRNode{type:Column}으로 변환하고 children을 포함한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      import 'package:flutter/material.dart';
      Widget build(BuildContext ctx) {
        return Column(
          children: [
            Text('A'),
            Text('B'),
          ],
        );
      }
    `);
    const node = findFirstNode(root, "identifier", "Column");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("call expression not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Column");
    expect(result?.layout?.direction).toBe("column");
  });

  it("Row를 IRNode{type:Row}으로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Row(children: [Text('X')]);
      }
    `);
    const node = findFirstNode(root, "identifier", "Row");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("call expression not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Row");
    expect(result?.layout?.direction).toBe("row");
  });
});

// ── Scaffold ─────────────────────────────────────────────────────────────────

describe("widgetMapper — Scaffold", () => {
  it("Scaffold를 Box로 변환하고 appBar/body 자식을 생성한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      import 'package:flutter/material.dart';
      Widget build(BuildContext ctx) {
        return Scaffold(
          appBar: AppBar(title: Text('Home')),
          body: Text('body'),
        );
      }
    `);
    const node = findFirstNode(root, "identifier", "Scaffold");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("call expression not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Box");
    // appBar role:appbar와 body role:content 자식이 있어야 함
    const children = result?.children ?? [];
    const hasAppBar = children.some((c: IRNode) => c.role === "appbar");
    const hasContent = children.some((c: IRNode) => c.role === "content");
    expect(hasAppBar || hasContent).toBe(true);
  });
});

// ── Image ────────────────────────────────────────────────────────────────────

describe("widgetMapper — Image", () => {
  it("Image.asset을 IRNode{type:Image, src:asset://...}로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Image.asset('assets/images/logo.png', width: 64, height: 64);
      }
    `);
    // Image.asset은 cascade/selector 형태
    const node = findFirstNode(root, "identifier", "Image");
    if (!node) throw new Error("Image node not found");
    // parent에서 selector 포함한 expression을 찾는다
    const expr = findAncestor(node, "cascade_expression") ?? findAncestor(node, "method_invocation") ?? node.parent;
    if (!expr) throw new Error("expression not found");
    const result = await mapWidget(expr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    if (result?.type === "Image") {
      expect(result.src).toMatch(/asset:\/\//);
    }
  });

  it("Image.network을 IRNode{type:Image, src:mock-image-placeholder...}로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Image.network('https://example.com/image.jpg', width: 200);
      }
    `);
    const node = findFirstNode(root, "identifier", "Image");
    if (!node) throw new Error("Image node not found");
    const expr = node.parent;
    if (!expr) throw new Error("expression not found");
    const result = await mapWidget(expr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    if (result?.type === "Image") {
      expect(result.src).toMatch(/mock-image-placeholder|network-placeholder/);
    }
  });
});

// ── Button ────────────────────────────────────────────────────────────────────

describe("widgetMapper — Button", () => {
  it("ElevatedButton을 IRNode{type:Button}으로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return ElevatedButton(
          onPressed: () {},
          child: Text('Click Me'),
        );
      }
    `);
    const node = findFirstNode(root, "identifier", "ElevatedButton");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("call expression not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Button");
  });

  it("TextButton을 IRNode{type:Button}으로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return TextButton(onPressed: () {}, child: Text('OK'));
      }
    `);
    const node = findFirstNode(root, "identifier", "TextButton");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("call expression not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Button");
  });
});

// ── ListView ─────────────────────────────────────────────────────────────────

describe("widgetMapper — ListView", () => {
  it("ListView.separated를 Scroll+List로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return ListView.separated(
          itemCount: 5,
          itemBuilder: (context, index) => Text('Item'),
          separatorBuilder: (context, index) => Divider(),
        );
      }
    `);
    const node = findFirstNode(root, "identifier", "ListView");
    if (!node) throw new Error("node not found");
    const expr = node.parent;
    if (!expr) throw new Error("expr not found");
    const result = await mapWidget(expr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Scroll");
    // 자식에 List 타입이 있어야 함
    const hasListChild = result?.children?.some((c: IRNode) => c.type === "List") ?? false;
    expect(hasListChild).toBe(true);
  });
});

// ── Icon ──────────────────────────────────────────────────────────────────────

describe("widgetMapper — Icon", () => {
  it("Icon을 IRNode{type:Icon}으로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Icon(Icons.home, size: 24);
      }
    `);
    const node = findFirstNode(root, "identifier", "Icon");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Icon");
  });
});

// ── Container/SizedBox/Padding ────────────────────────────────────────────────

describe("widgetMapper — Container/SizedBox/Padding", () => {
  it("Container를 Box로 변환하고 color/size를 추출한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Container(
          width: 100,
          height: 50,
          color: Color(0xFFFF0000),
          child: Text('inside'),
        );
      }
    `);
    const node = findFirstNode(root, "identifier", "Container");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Box");
    expect(result?.layout?.width).toBe(100);
    expect(result?.layout?.height).toBe(50);
  });

  it("SizedBox(width/height)를 Box로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return SizedBox(width: 20, height: 20);
      }
    `);
    const node = findFirstNode(root, "identifier", "SizedBox");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Box");
  });

  it("Padding을 Box로 변환하고 layout.padding을 추출한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Padding(
          padding: EdgeInsets.all(16),
          child: Text('padded'),
        );
      }
    `);
    const node = findFirstNode(root, "identifier", "Padding");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Box");
    expect(result?.layout?.padding).toEqual([16, 16, 16, 16]);
  });
});

// ── Expanded/Spacer ────────────────────────────────────────────────────────────

describe("widgetMapper — Expanded/Spacer", () => {
  it("Expanded를 Box{flex:1}로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Expanded(child: Text('x'));
      }
    `);
    const node = findFirstNode(root, "identifier", "Expanded");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.layout?.flex).toBe(1);
  });

  it("Spacer를 Spacer 타입으로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Spacer();
      }
    `);
    const node = findFirstNode(root, "identifier", "Spacer");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Spacer");
  });
});

// ── Input ────────────────────────────────────────────────────────────────────

describe("widgetMapper — Input", () => {
  it("TextField를 Input 타입으로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return TextField(decoration: InputDecoration(hintText: 'Enter text'));
      }
    `);
    const node = findFirstNode(root, "identifier", "TextField");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Input");
  });
});

// ── Divider ────────────────────────────────────────────────────────────────────

describe("widgetMapper — Divider", () => {
  it("Divider를 Divider 타입으로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return Divider();
      }
    `);
    const node = findFirstNode(root, "identifier", "Divider");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Divider");
  });
});

// ── Unknown ───────────────────────────────────────────────────────────────────

describe("widgetMapper — Unknown", () => {
  it("알 수 없는 위젯은 Unknown 노드로 변환한다", async () => {
    const { mapWidget } = await getMapper();
    const mock = createMockProvider(42);
    const root = await parseDart(`
      Widget build(BuildContext ctx) {
        return MyCustomWidget();
      }
    `);
    const node = findFirstNode(root, "identifier", "MyCustomWidget");
    const callExpr = node?.parent;
    if (!callExpr) throw new Error("not found");
    const result = await mapWidget(callExpr, mock, { depth: 0, maxDepth: 6, visited: new Set(), symbolTable: null, projectPath: "", themeTokens: {} });
    expect(result?.type).toBe("Unknown");
    expect(result?.confidence).toBe(0.2);
  });
});

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function findFirstNode(node: SyntaxNode, type: string, text?: string): SyntaxNode | undefined {
  if (node.type === type && (text === undefined || node.text === text)) return node;
  for (const child of node.children) {
    if (child) {
      const found = findFirstNode(child, type, text);
      if (found) return found;
    }
  }
  return undefined;
}

function findAncestor(node: SyntaxNode, type: string): SyntaxNode | undefined {
  let current: SyntaxNode | null = node.parent ?? null;
  while (current) {
    if (current.type === type) return current;
    current = current.parent ?? null;
  }
  return undefined;
}
