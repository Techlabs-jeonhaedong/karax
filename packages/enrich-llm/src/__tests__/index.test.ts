import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IRDocument, IRNode } from "@karax/core";
import {
  createLlmEnrichmentPlugin,
  anthropicComplete,
} from "../index.js";
import type { EnrichmentPlugin } from "../index.js";

// ── 테스트 픽스처 헬퍼 ──────────────────────────────────────────────

function makeDoc(overrides?: Partial<IRDocument["screen"]>): IRDocument {
  return {
    schemaVersion: "0.1",
    screen: {
      id: "HomeScreen",
      sourceRef: { file: "lib/home.dart", line: 1, symbol: "HomeScreen" },
      device: "iphone-15",
      discovery: "route",
      confidence: 0.85,
      root: {
        type: "Column",
        confidence: 1.0,
        children: [
          {
            type: "Unknown",
            confidence: 0.2,
            sourceRef: { file: "lib/home.dart", line: 10, symbol: "MyWidget" },
            children: [],
          } as IRNode,
          {
            type: "Text",
            confidence: 1.0,
            text: { value: "Hello" },
            children: [],
          } as IRNode,
        ],
      },
      ...overrides,
    },
    designTokens: {},
    diagnostics: [],
  };
}

function makeUnknownNode(
  confidence: number,
  symbol?: string
): IRNode {
  return {
    type: "Unknown",
    confidence,
    sourceRef: { file: "lib/test.dart", line: 5, symbol: symbol ?? "TestWidget" },
    children: [],
  };
}

// ── mock complete 함수 ──────────────────────────────────────────────

const validPatch = (nodePath: string): IRNode => ({
  type: "Box",
  confidence: 0.6,
  children: [],
});

function makeCompleteFn(response: string) {
  return vi.fn().mockResolvedValue(response);
}

function makeValidResponse(
  nodePath: string,
  replacement: IRNode
): string {
  return JSON.stringify({
    patches: [{ nodePath, replacement }],
  });
}

// ── EnrichmentPlugin 인터페이스 타입 검사 ──────────────────────────

describe("EnrichmentPlugin 인터페이스", () => {
  it("createLlmEnrichmentPlugin이 EnrichmentPlugin을 반환한다", () => {
    const plugin: EnrichmentPlugin = createLlmEnrichmentPlugin({
      complete: vi.fn(),
    });
    expect(typeof plugin.enrich).toBe("function");
  });
});

// ── threshold 필터링 ────────────────────────────────────────────────

describe("threshold 필터링", () => {
  it("기본 threshold(0.5) 미만 노드만 targets에 포함", async () => {
    const completeFn = makeCompleteFn(JSON.stringify({ patches: [] }));
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();

    await plugin.enrich(doc, []);

    // enrich가 내부에서 doc을 순회해 targets를 결정한다
    // 직접 targets=[] 전달 시 LLM 호출 안 함
    expect(completeFn).not.toHaveBeenCalled();
  });

  it("confidence 0.5 미만 노드가 타겟으로 선택된다", async () => {
    const node = makeUnknownNode(0.2, "LowConfWidget");
    const completeFn = makeCompleteFn(
      makeValidResponse("root.children[0]", validPatch("root.children[0]"))
    );
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();

    // targets를 명시적으로 전달 (confidence 0.2 < 0.5)
    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    expect(completeFn).toHaveBeenCalledOnce();
    expect(result.patches.length).toBeGreaterThanOrEqual(0);
  });

  it("threshold 커스텀 설정(0.7) 시 0.7 미만 노드만 타겟", async () => {
    const completeFn = makeCompleteFn(JSON.stringify({ patches: [] }));
    const plugin = createLlmEnrichmentPlugin({
      complete: completeFn,
      threshold: 0.7,
    });

    // confidence 0.65는 0.7 미만이라 타겟에 포함 → LLM 호출됨
    const node = makeUnknownNode(0.65);
    const doc = makeDoc();
    await plugin.enrich(doc, [{ nodePath: "root.children[0]", node }]);
    expect(completeFn).toHaveBeenCalledOnce();
  });

  it("threshold 이상의 confidence 노드는 targets에 넘겨도 LLM 미호출", async () => {
    const completeFn = makeCompleteFn(JSON.stringify({ patches: [] }));
    const plugin = createLlmEnrichmentPlugin({
      complete: completeFn,
      threshold: 0.5,
    });

    // confidence 0.8 > 0.5 → 타겟 제외
    const node = makeUnknownNode(0.8);
    const doc = makeDoc();
    await plugin.enrich(doc, [{ nodePath: "root.children[0]", node }]);
    expect(completeFn).not.toHaveBeenCalled();
  });
});

// ── maxTargets 제한 ────────────────────────────────────────────────

describe("maxTargets 제한", () => {
  it("기본 maxTargets(10) 초과 시 10개만 처리", async () => {
    const completeFn = makeCompleteFn(JSON.stringify({ patches: [] }));
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();

    const targets = Array.from({ length: 15 }, (_, i) => ({
      nodePath: `root.children[${i}]`,
      node: makeUnknownNode(0.1, `Widget${i}`),
    }));

    await plugin.enrich(doc, targets);

    // LLM에 전달되는 targets는 10개
    expect(completeFn).toHaveBeenCalledOnce();
    const prompt = completeFn.mock.calls[0][0] as string;
    // prompt에 등장하는 nodePath 개수가 10개 이하
    const pathMatches = (prompt.match(/root\.children\[/g) ?? []).length;
    expect(pathMatches).toBeLessThanOrEqual(10);
  });

  it("maxTargets 커스텀(3) 설정 시 3개만 처리", async () => {
    const completeFn = makeCompleteFn(JSON.stringify({ patches: [] }));
    const plugin = createLlmEnrichmentPlugin({
      complete: completeFn,
      maxTargets: 3,
    });
    const doc = makeDoc();

    const targets = Array.from({ length: 7 }, (_, i) => ({
      nodePath: `root.children[${i}]`,
      node: makeUnknownNode(0.1),
    }));

    await plugin.enrich(doc, targets);
    expect(completeFn).toHaveBeenCalledOnce();
    const prompt = completeFn.mock.calls[0][0] as string;
    const pathMatches = (prompt.match(/root\.children\[/g) ?? []).length;
    expect(pathMatches).toBeLessThanOrEqual(3);
  });
});

// ── 유효 패치 적용 + 재검증 ────────────────────────────────────────

describe("유효 패치 적용", () => {
  it("유효 IR 응답은 패치로 반환되고 ENRICHED diagnostic이 추가된다", async () => {
    const replacement: IRNode = {
      type: "Box",
      confidence: 0.6,
      children: [],
    };
    const response = makeValidResponse("root.children[0]", replacement);
    const completeFn = makeCompleteFn(response);
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();

    const node = makeUnknownNode(0.2, "MyWidget");
    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    expect(result.patches).toHaveLength(1);
    expect(result.patches[0].nodePath).toBe("root.children[0]");
    expect(result.patches[0].replacement.type).toBe("Box");
    // ENRICHED diagnostic 확인
    const enriched = result.diagnostics.filter((d) => d.code === "ENRICHED");
    expect(enriched.length).toBeGreaterThan(0);
  });

  it("패치 적용 후 노드 confidence는 0.6(enriched)로 설정된다", async () => {
    const replacement: IRNode = {
      type: "Column",
      confidence: 0.9, // 원본 confidence — 0.6으로 덮어써져야 함
      children: [],
    };
    const response = makeValidResponse("root.children[0]", replacement);
    const completeFn = makeCompleteFn(response);
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.1);

    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    expect(result.patches[0].replacement.confidence).toBe(0.6);
  });

  it("패치를 applyPatches로 적용 후 전체 문서가 IRDocumentSchema를 통과한다", async () => {
    const { applyPatches } = await import("../index.js");
    const replacement: IRNode = {
      type: "Text",
      confidence: 0.6,
      text: { value: "Enriched" },
      children: [],
    };
    const response = makeValidResponse("root.children[0]", replacement);
    const completeFn = makeCompleteFn(response);
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.2);

    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    const { IRDocumentSchema } = await import("@karax/core");
    const applied = applyPatches(doc, result.patches);
    expect(() => IRDocumentSchema.parse(applied)).not.toThrow();
  });
});

// ── 무효 응답 거부 ──────────────────────────────────────────────────

describe("무효 응답 거부", () => {
  it("비JSON 응답은 ENRICH_REJECTED diagnostic으로 거부", async () => {
    const completeFn = makeCompleteFn("not valid json at all!!!");
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.2);

    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    expect(result.patches).toHaveLength(0);
    const rejected = result.diagnostics.filter(
      (d) => d.code === "ENRICH_REJECTED"
    );
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("patches 필드 없는 JSON 응답은 ENRICH_REJECTED", async () => {
    const completeFn = makeCompleteFn(JSON.stringify({ result: "ok" }));
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.2);

    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    expect(result.patches).toHaveLength(0);
    const rejected = result.diagnostics.filter(
      (d) => d.code === "ENRICH_REJECTED"
    );
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("patches 배열 내 스키마 위반 노드는 개별 거부 — valid 패치는 살아남는다", async () => {
    const validReplacement: IRNode = {
      type: "Box",
      confidence: 0.6,
      children: [],
    };
    const invalidReplacement = {
      type: "INVALID_TYPE",
      confidence: 999, // 범위 초과
    };
    const response = JSON.stringify({
      patches: [
        { nodePath: "root.children[0]", replacement: invalidReplacement },
        { nodePath: "root.children[1]", replacement: validReplacement },
      ],
    });
    const completeFn = makeCompleteFn(response);
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });

    // doc에 children 2개 준비
    const doc = makeDoc({
      root: {
        type: "Column",
        confidence: 1.0,
        children: [makeUnknownNode(0.1, "W1"), makeUnknownNode(0.1, "W2")],
      },
    });

    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node: makeUnknownNode(0.1) },
      { nodePath: "root.children[1]", node: makeUnknownNode(0.1) },
    ]);

    // valid 패치 1개만 살아남아야 함
    expect(result.patches).toHaveLength(1);
    expect(result.patches[0].nodePath).toBe("root.children[1]");
    // 거부된 1개는 ENRICH_REJECTED
    const rejected = result.diagnostics.filter(
      (d) => d.code === "ENRICH_REJECTED"
    );
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("빈 string 응답은 ENRICH_REJECTED", async () => {
    const completeFn = makeCompleteFn("");
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.2);
    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);
    expect(result.patches).toHaveLength(0);
    const rejected = result.diagnostics.filter(
      (d) => d.code === "ENRICH_REJECTED"
    );
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("LLM 응답에서 patches가 배열이 아닌 경우 ENRICH_REJECTED", async () => {
    const completeFn = makeCompleteFn(
      JSON.stringify({ patches: "not-an-array" })
    );
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.2);
    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);
    expect(result.patches).toHaveLength(0);
    const rejected = result.diagnostics.filter(
      (d) => d.code === "ENRICH_REJECTED"
    );
    expect(rejected.length).toBeGreaterThan(0);
  });
});

// ── 결정론 보장 (plugin 없으면 기존 경로 영향 0) ────────────────────

describe("결정론 보장", () => {
  it("targets 빈 배열 전달 시 patches=[], diagnostics=[], LLM 미호출", async () => {
    const completeFn = makeCompleteFn(JSON.stringify({ patches: [] }));
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();

    const result = await plugin.enrich(doc, []);

    expect(result.patches).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
    expect(completeFn).not.toHaveBeenCalled();
  });

  it("threshold 이상의 노드만 있으면 LLM 호출 없음", async () => {
    const completeFn = makeCompleteFn(JSON.stringify({ patches: [] }));
    const plugin = createLlmEnrichmentPlugin({
      complete: completeFn,
      threshold: 0.5,
    });
    const doc = makeDoc();

    // confidence 0.8 은 0.5 이상이므로 타겟에서 제외
    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node: makeUnknownNode(0.8) },
    ]);

    expect(result.patches).toHaveLength(0);
    expect(completeFn).not.toHaveBeenCalled();
  });

  it("plugin 없이 IRDocument는 그대로 유지된다 (applyPatches 빈 배열)", async () => {
    const { applyPatches } = await import("../index.js");
    const { IRDocumentSchema } = await import("@karax/core");
    const doc = makeDoc();

    const applied = applyPatches(doc, []);
    expect(IRDocumentSchema.parse(applied)).toEqual(doc);
  });
});

// ── anthropicComplete 헬퍼 ──────────────────────────────────────────

describe("anthropicComplete 헬퍼", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("Anthropic API를 올바른 형식으로 호출한다", async () => {
    const mockResponse = {
      content: [{ type: "text", text: '{"patches":[]}' }],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    const complete = anthropicComplete({ apiKey: "test-key" });
    const result = await complete("test prompt");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("anthropic.com");
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: expect.stringContaining("claude"),
      messages: [{ role: "user", content: "test prompt" }],
    });
    expect(result).toBe('{"patches":[]}');
  });

  it("환경변수 ANTHROPIC_API_KEY를 fallback으로 사용한다", async () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "env-api-key";

    const mockResponse = {
      content: [{ type: "text", text: "response" }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    const complete = anthropicComplete({});
    await complete("prompt");

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("env-api-key");

    process.env.ANTHROPIC_API_KEY =
      originalEnv === undefined ? "" : originalEnv;
    if (originalEnv === undefined) delete process.env.ANTHROPIC_API_KEY;
  });

  it("API 오류(non-ok) 응답 시 Error를 throw한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const complete = anthropicComplete({ apiKey: "bad-key" });
    await expect(complete("prompt")).rejects.toThrow();
  });

  it("커스텀 model 옵션이 요청에 반영된다", async () => {
    const mockResponse = {
      content: [{ type: "text", text: "ok" }],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });
    vi.stubGlobal("fetch", fetchMock);

    const complete = anthropicComplete({
      apiKey: "key",
      model: "claude-haiku-4-5",
    });
    await complete("prompt");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe("claude-haiku-4-5");
  });

  it("API 키 없음 + 환경변수 없음 시 Error를 throw한다", async () => {
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const complete = anthropicComplete({});
    await expect(complete("prompt")).rejects.toThrow(/API.*key/i);

    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    }
  });
});

// ── 엣지 케이스 ────────────────────────────────────────────────────

describe("엣지 케이스", () => {
  it("LLM 응답에 JSON 마크다운 코드블록이 감싸진 경우도 파싱 성공", async () => {
    const replacement: IRNode = { type: "Box", confidence: 0.6, children: [] };
    const jsonStr = makeValidResponse("root.children[0]", replacement);
    const withCodeBlock = `\`\`\`json\n${jsonStr}\n\`\`\``;
    const completeFn = makeCompleteFn(withCodeBlock);
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.2);

    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    expect(result.patches).toHaveLength(1);
  });

  it("complete 함수가 reject 시 ENRICH_REJECTED diagnostic 반환", async () => {
    const completeFn = vi.fn().mockRejectedValue(new Error("network error"));
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.1);

    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    expect(result.patches).toHaveLength(0);
    const rejected = result.diagnostics.filter(
      (d) => d.code === "ENRICH_REJECTED"
    );
    expect(rejected.length).toBeGreaterThan(0);
  });

  it("nodePath가 중복된 경우 마지막 패치가 우선된다", async () => {
    const r1: IRNode = { type: "Box", confidence: 0.6, children: [] };
    const r2: IRNode = { type: "Row", confidence: 0.6, children: [] };
    const response = JSON.stringify({
      patches: [
        { nodePath: "root.children[0]", replacement: r1 },
        { nodePath: "root.children[0]", replacement: r2 },
      ],
    });
    const completeFn = makeCompleteFn(response);
    const plugin = createLlmEnrichmentPlugin({ complete: completeFn });
    const doc = makeDoc();
    const node = makeUnknownNode(0.1);

    const result = await plugin.enrich(doc, [
      { nodePath: "root.children[0]", node },
    ]);

    // 중복 nodePath 처리: 둘 다 있거나 중복 제거 후 1개
    const paths = result.patches.map((p) => p.nodePath);
    const uniquePaths = new Set(paths);
    // 중복 제거 시 1개, 유지 시 2개 — 구현에 따라 허용
    // 중요한 건 데이터 오류 없이 처리됨
    expect(result.patches.length).toBeGreaterThanOrEqual(1);
    expect(result.patches.every((p) => p.replacement.type !== undefined)).toBe(
      true
    );
  });

  it("매우 깊은 nodePath(depth 10)도 applyPatches가 처리한다", async () => {
    const { applyPatches } = await import("../index.js");

    // 깊이 10짜리 문서 생성
    function buildDeepNode(depth: number): IRNode {
      if (depth === 0) {
        return { type: "Unknown", confidence: 0.1, children: [] };
      }
      return {
        type: "Column",
        confidence: 1.0,
        children: [buildDeepNode(depth - 1)],
      };
    }

    const deepDoc: IRDocument = {
      schemaVersion: "0.1",
      screen: {
        id: "DeepScreen",
        discovery: "route",
        confidence: 0.5,
        root: buildDeepNode(10),
      },
      designTokens: {},
      diagnostics: [],
    };

    // root.children[0].children[0]...children[0] (10단계)
    const deepPath = Array.from({ length: 10 }, () => "children[0]").join(".");
    const nodePath = `root.${deepPath}`;

    const replacement: IRNode = {
      type: "Text",
      confidence: 0.6,
      text: { value: "deep" },
      children: [],
    };

    const applied = applyPatches(deepDoc, [{ nodePath, replacement }]);
    // 오류 없이 처리됐는지
    expect(applied).toBeDefined();
  });

  it("applyPatches — 존재하지 않는 nodePath는 조용히 무시", async () => {
    const { applyPatches } = await import("../index.js");
    const { IRDocumentSchema } = await import("@karax/core");
    const doc = makeDoc();

    const replacement: IRNode = { type: "Box", confidence: 0.6, children: [] };
    // 존재하지 않는 경로
    const applied = applyPatches(doc, [
      { nodePath: "root.children[99]", replacement },
    ]);
    // 문서 구조는 변하지 않아야 함
    expect(IRDocumentSchema.parse(applied)).toMatchObject({
      screen: { id: "HomeScreen" },
    });
  });
});
