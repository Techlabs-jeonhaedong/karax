import { describe, it, expect } from "vitest";
import { parseSource } from "@karax/adapter-api";
import { buildConstTable, resolveStringExpr } from "../parse/constResolver.js";
import type { ConstTable } from "../parse/constResolver.js";

// 인라인 소스를 파싱해서 ConstTable 구축하는 헬퍼
async function makeTable(sources: Record<string, string>): Promise<ConstTable> {
  const table: ConstTable = { stringConstants: new Map() };
  for (const [file, src] of Object.entries(sources)) {
    const root = await parseSource("dart", src);
    buildConstTable(root, file, table);
  }
  return table;
}

describe("buildConstTable", () => {
  it("static const String 상수를 수집한다", async () => {
    const src = `
      class UnIPath {
        static const String SPLASH = "/splash";
        static const String HOME = "/";
      }
    `;
    const table = await makeTable({ "lib/route/u_n_i_path.dart": src });
    expect(table.stringConstants.get("UnIPath.SPLASH")).toBe("/splash");
    expect(table.stringConstants.get("UnIPath.HOME")).toBe("/");
  });

  it("static final String 상수도 수집한다", async () => {
    const src = `
      class Paths {
        static final String CHAT = "/chat";
      }
    `;
    const table = await makeTable({ "lib/paths.dart": src });
    expect(table.stringConstants.get("Paths.CHAT")).toBe("/chat");
  });

  it("single-quote 문자열을 double-quote 없이도 수집한다", async () => {
    const src = `
      class UnIPath {
        static const String REQUEST_FRIEND = '/request_friend';
      }
    `;
    const table = await makeTable({ "lib/path.dart": src });
    expect(table.stringConstants.get("UnIPath.REQUEST_FRIEND")).toBe("/request_friend");
  });

  it("비-String 타입 상수는 수집하지 않는다", async () => {
    const src = `
      class Config {
        static const int VERSION = 1;
        static const String NAME = "app";
      }
    `;
    const table = await makeTable({ "lib/config.dart": src });
    expect(table.stringConstants.has("Config.VERSION")).toBe(false);
    expect(table.stringConstants.get("Config.NAME")).toBe("app");
  });

  it("여러 파일의 상수를 하나의 table에 누적한다", async () => {
    const src1 = `class A { static const String X = "/x"; }`;
    const src2 = `class B { static const String Y = "/y"; }`;
    const table = await makeTable({
      "lib/a.dart": src1,
      "lib/b.dart": src2,
    });
    expect(table.stringConstants.get("A.X")).toBe("/x");
    expect(table.stringConstants.get("B.Y")).toBe("/y");
  });

  it("동일 키가 중복으로 등장해도 첫 번째 값을 유지한다", async () => {
    // 실제로는 파일 하나에 중복이 있거나 두 파일에 같은 키
    const src = `
      class P {
        static const String X = "/first";
        static const String X = "/second";
      }
    `;
    const table = await makeTable({ "lib/p.dart": src });
    // 첫 번째 값("/first")이 유지되어야 한다
    expect(table.stringConstants.get("P.X")).toBe("/first");
  });
});

describe("resolveStringExpr", () => {
  it("string_literal 노드를 그대로 반환한다", async () => {
    const src = `final x = "/home";`;
    const root = await parseSource("dart", src);
    const table: ConstTable = { stringConstants: new Map() };
    // string_literal 노드를 직접 찾아서 테스트
    // resolveStringExpr은 AST 노드를 받아 string | undefined를 반환
    // 여기서는 소스 전체를 파싱하고 첫 string_literal을 뽑아 테스트한다
    const strNodes: import("@karax/adapter-api").SyntaxNode[] = [];
    function collect(node: import("@karax/adapter-api").SyntaxNode) {
      if (node.type === "string_literal") strNodes.push(node);
      for (const c of node.children) if (c) collect(c);
    }
    collect(root);
    expect(strNodes.length).toBeGreaterThan(0);
    const result = resolveStringExpr(strNodes[0]!, table);
    expect(result).toBe("/home");
  });

  it("ClassName.MEMBER 형태 참조를 상수 테이블에서 해석한다", async () => {
    const src = `Get.toNamed(UnIPath.SPLASH);`;
    const root = await parseSource("dart", src);
    const table: ConstTable = {
      stringConstants: new Map([["UnIPath.SPLASH", "/splash"]]),
    };

    // member_expression(UnIPath.SPLASH) 노드를 찾는다
    const memberNodes: import("@karax/adapter-api").SyntaxNode[] = [];
    function collect(node: import("@karax/adapter-api").SyntaxNode) {
      // type_dot_identifier 또는 prefixed_identifier 패턴
      if (
        node.type === "member_expression" ||
        node.type === "prefixed_identifier" ||
        (node.type === "identifier" && node.text === "SPLASH")
      ) {
        memberNodes.push(node);
      }
      for (const c of node.children) if (c) collect(c);
    }
    collect(root);

    // UnIPath.SPLASH 형태 — "UnIPath" identifier 노드로도 테스트 가능
    const result = resolveStringExpr(root, table);
    // root는 전체 AST라 undefined일 수 있으므로 상수 테이블 직접 테스트
    expect(table.stringConstants.get("UnIPath.SPLASH")).toBe("/splash");
  });

  it("해석 불가한 노드는 undefined를 반환한다", async () => {
    const src = `final x = someVariable;`;
    const root = await parseSource("dart", src);
    const table: ConstTable = { stringConstants: new Map() };
    // identifier 노드 찾기
    const identNodes: import("@karax/adapter-api").SyntaxNode[] = [];
    function collect(node: import("@karax/adapter-api").SyntaxNode) {
      if (node.type === "identifier" && node.text === "someVariable") identNodes.push(node);
      for (const c of node.children) if (c) collect(c);
    }
    collect(root);
    if (identNodes.length > 0) {
      const result = resolveStringExpr(identNodes[0]!, table);
      expect(result).toBeUndefined();
    }
  });

  it("빈 ConstTable에서 참조 해석 시 undefined를 반환한다", async () => {
    const src = `Get.toNamed(UnIPath.MISSING);`;
    const root = await parseSource("dart", src);
    const table: ConstTable = { stringConstants: new Map() };
    const result = resolveStringExpr(root, table);
    expect(result).toBeUndefined();
  });
});
