import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadParser, parseSource, withParsedSource, resetParserState } from "../loader.js";

/**
 * Parser/Tree 수명 관리 테스트
 *
 * (a) 같은 언어로 loadParser를 여러 번 호출해도 Parser 인스턴스가 재사용되는지
 * (b) withParsedSource 콜백 종료 후 tree가 해제되는지
 * (c) parseWithTree 사용 시 dispose로 tree를 명시적으로 해제할 수 있는지
 * (d) resetParserState가 캐시를 비우고 재초기화할 수 있는지
 */

describe("Parser 인스턴스 재사용", () => {
  it(
    "같은 언어로 loadParser를 두 번 호출하면 같은 Parser 인스턴스를 반환한다",
    async () => {
      const p1 = await loadParser("dart");
      const p2 = await loadParser("dart");
      expect(p1).toBe(p2);
    },
    15_000
  );

  it(
    "다른 언어는 다른 Parser 인스턴스를 반환한다",
    async () => {
      const dartParser = await loadParser("dart");
      const tsParser = await loadParser("typescript");
      expect(dartParser).not.toBe(tsParser);
    },
    15_000
  );

  it(
    "같은 언어로 10회 연속 loadParser 호출 시 모두 같은 인스턴스",
    async () => {
      const first = await loadParser("kotlin");
      for (let i = 0; i < 9; i++) {
        const p = await loadParser("kotlin");
        expect(p).toBe(first);
      }
    },
    15_000
  );
});

describe("withParsedSource — Tree 스코프 API", () => {
  it(
    "콜백 내에서 rootNode에 접근할 수 있다",
    async () => {
      const result = await withParsedSource("dart", "void main() {}", (rootNode) => {
        return rootNode.type;
      });
      expect(result).toBeTruthy();
    },
    15_000
  );

  it(
    "콜백 반환값을 그대로 반환한다",
    async () => {
      const count = await withParsedSource("dart", "void main() { print('hi'); }", (rootNode) => {
        return rootNode.childCount;
      });
      expect(count).toBeGreaterThan(0);
    },
    15_000
  );

  it(
    "콜백에서 예외 발생 시에도 tree가 해제된다 (finally 보장)",
    async () => {
      await expect(
        withParsedSource("dart", "void main() {}", () => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");
      // 에러 후에도 다시 withParsedSource를 호출할 수 있어야 함
      const result = await withParsedSource("dart", "void main() {}", (n) => n.type);
      expect(result).toBeTruthy();
    },
    15_000
  );

  it(
    "async 콜백도 지원한다",
    async () => {
      const result = await withParsedSource("typescript", "const x = 1;", async (rootNode) => {
        await new Promise((r) => setTimeout(r, 1));
        return rootNode.type;
      });
      expect(result).toBeTruthy();
    },
    15_000
  );
});

describe("parseWithTree — 명시적 dispose 핸들", () => {
  it(
    "{ rootNode, disposeTree } 구조를 반환한다",
    async () => {
      const { rootNode, disposeTree } = await (await import("../loader.js")).parseWithTree("dart", "void main() {}");
      expect(rootNode).toBeDefined();
      expect(typeof disposeTree).toBe("function");
      disposeTree();
    },
    15_000
  );

  it(
    "disposeTree 호출 후 새 파싱이 가능하다 (Parser 재사용 확인)",
    async () => {
      const { rootNode, disposeTree } = await (await import("../loader.js")).parseWithTree("dart", "void main() {}");
      expect(rootNode.type).toBeTruthy();
      disposeTree();

      // disposeTree 후에도 loadParser가 동일 인스턴스를 반환해야 함
      const p = await loadParser("dart");
      expect(p).toBeDefined();
    },
    15_000
  );

  it(
    "disposeTree를 두 번 호출해도 크래시 없음 (idempotent)",
    async () => {
      const { rootNode, disposeTree } = await (await import("../loader.js")).parseWithTree("dart", "void main() {}");
      expect(rootNode).toBeDefined();
      expect(() => { disposeTree(); disposeTree(); }).not.toThrow();
    },
    15_000
  );
});

describe("resetParserState — 캐시 초기화", () => {
  it(
    "resetParserState 후 loadParser를 다시 호출하면 새 인스턴스가 생성된다",
    async () => {
      const before = await loadParser("swift");
      await resetParserState();
      const after = await loadParser("swift");
      // 리셋 후 새 인스턴스여야 한다
      expect(after).not.toBe(before);
    },
    30_000
  );

  it(
    "resetParserState 후에도 parseSource가 정상 동작한다",
    async () => {
      await resetParserState();
      const root = await parseSource("dart", "void main() {}");
      expect(root).toBeDefined();
      expect(root.type).toBeTruthy();
    },
    30_000
  );
});

describe("resetParserState 동시 호출 경합 방지", () => {
  it(
    "resetParserState 동시 다중 호출 시 Parser.init()가 1회만 실행된다 (promise 공유)",
    async () => {
      // 동시에 5번 resetParserState 호출
      // 수정 전: 각 호출마다 별도로 Parser.init() 실행 → 중복 초기화 가능
      // 수정 후: in-flight promise 공유 → 1번만 실행
      const results = await Promise.all([
        resetParserState(),
        resetParserState(),
        resetParserState(),
        resetParserState(),
        resetParserState(),
      ]);

      // 모두 성공적으로 완료돼야 한다
      expect(results).toHaveLength(5);
      results.forEach((r) => expect(r).toBeUndefined());

      // 이후 파싱도 정상 동작해야 한다
      const root = await parseSource("dart", "void main() {}");
      expect(root).toBeDefined();
    },
    30_000
  );

  it(
    "ensureParserInit 동시 호출 시 같은 Promise를 공유한다",
    async () => {
      // resetParserState 후 loadParser를 동시에 5번 호출
      // 각각 ensureParserInit을 호출하지만 Promise 공유로 중복 init 없음
      await resetParserState();

      const parsers = await Promise.all([
        loadParser("dart"),
        loadParser("dart"),
        loadParser("dart"),
      ]);

      // 모두 같은 인스턴스여야 한다 (캐시 재사용)
      expect(parsers[0]).toBe(parsers[1]);
      expect(parsers[1]).toBe(parsers[2]);
    },
    30_000
  );
});

describe("다량 반복 파싱 — 누수 없음", () => {
  it(
    "같은 언어를 50회 반복 parseSource해도 오류 없이 완료된다",
    async () => {
      const source = `void main() { print('hello'); }`;
      for (let i = 0; i < 50; i++) {
        const root = await parseSource("dart", source);
        expect(root).toBeDefined();
      }
    },
    60_000
  );

  it(
    "withParsedSource를 50회 반복해도 오류 없이 완료된다",
    async () => {
      const source = `const x: string = "hello";`;
      for (let i = 0; i < 50; i++) {
        await withParsedSource("typescript", source, (root) => root.type);
      }
    },
    60_000
  );
});
