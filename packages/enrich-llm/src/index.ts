/**
 * @sfc/enrich-llm — LLM 보강 플러그인 (PLAN.md 2절 [6], 8절)
 *
 * - 코어는 LLM 없이 결정론적으로 동작 (이 패키지는 optional plugin)
 * - 특정 벤더 SDK 미의존: LLM 호출 함수는 주입형 (complete 인자)
 * - 응답은 zod로 검증, 스키마 위반 시 ENRICH_REJECTED diagnostic
 */

import { z } from "zod";
import { IRDocumentSchema } from "@sfc/core";
import type { IRDocument, IRNode } from "@sfc/core";

export const ENRICH_VERSION = "0.0.1" as const;

// ── 타입 정의 ─────────────────────────────────────────────────────

export interface EnrichTarget {
  nodePath: string;
  node: IRNode;
}

export interface EnrichPatch {
  nodePath: string;
  replacement: IRNode;
}

export interface EnrichDiagnostic {
  level: "info" | "warn" | "error";
  code: "ENRICHED" | "ENRICH_REJECTED";
  message: string;
  nodePath?: string;
}

export interface EnrichResult {
  patches: EnrichPatch[];
  diagnostics: EnrichDiagnostic[];
}

export interface EnrichmentPlugin {
  enrich(
    doc: IRDocument,
    targets: EnrichTarget[]
  ): Promise<EnrichResult>;
}

// ── LLM 응답 zod 스키마 ─────────────────────────────────────────────

/**
 * IRNode를 느슨하게 검증하는 스키마.
 * 완전한 strict 검증은 IRDocumentSchema에서 수행한다.
 */
const IRNodeLaxSchema: z.ZodType<IRNode> = z.lazy(() =>
  z
    .object({
      type: z.enum([
        "Box", "Row", "Column", "Stack", "Scroll", "Grid", "List", "Spacer",
        "Text", "Image", "Icon", "Button", "Input", "Divider",
        "Unknown", "Branch", "Slot",
      ]),
      role: z.string().nullish(),
      layout: z.any().optional(),
      style: z.any().optional(),
      text: z.any().optional(),
      src: z.string().optional(),
      confidence: z.number().min(0).max(1),
      sourceRef: z.any().optional(),
      children: z.array(IRNodeLaxSchema).optional(),
    })
    .passthrough()
);

/**
 * 개별 패치 항목 스키마 — replacement는 느슨하게(unknown)으로 받고
 * 이후 IRNodeLaxSchema로 개별 검증한다.
 */
const LlmPatchRawSchema = z.object({
  nodePath: z.string(),
  replacement: z.unknown(),
});

const LlmResponseSchema = z.object({
  patches: z.array(LlmPatchRawSchema),
});

// ── JSON 추출 헬퍼 ─────────────────────────────────────────────────

/**
 * 마크다운 코드블록으로 감싸진 JSON도 추출한다.
 * ```json ... ``` 또는 ``` ... ``` 형태 지원.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  // 코드블록 추출
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  return trimmed;
}

// ── nodePath 파서 / 적용기 ─────────────────────────────────────────

/**
 * nodePath 세그먼트 파싱.
 * "root.children[0].children[2]" → ["root", "children", 0, "children", 2]
 */
function parsePath(nodePath: string): Array<string | number> {
  const segments: Array<string | number> = [];
  for (const part of nodePath.split(".")) {
    const bracketMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (bracketMatch) {
      if (bracketMatch[1]) segments.push(bracketMatch[1]);
      segments.push(parseInt(bracketMatch[2], 10));
    } else {
      segments.push(part);
    }
  }
  return segments;
}

/**
 * IRDocument 내 nodePath에 해당하는 위치에 replacement 노드를 설치한다.
 * 경로가 유효하지 않으면 조용히 원본 반환.
 *
 * - "root"는 screen.root를 가리킨다.
 * - "root.children[0]"는 screen.root.children[0]을 가리킨다.
 */
export function applyPatches(
  doc: IRDocument,
  patches: EnrichPatch[]
): IRDocument {
  if (patches.length === 0) return doc;

  // deep clone (structuredClone은 Node 17+에서 사용 가능)
  let current: IRDocument = JSON.parse(JSON.stringify(doc)) as IRDocument;

  for (const patch of patches) {
    current = applySinglePatch(current, patch);
  }

  return current;
}

function applySinglePatch(doc: IRDocument, patch: EnrichPatch): IRDocument {
  const segments = parsePath(patch.nodePath);
  if (segments.length === 0) return doc;

  // "root"가 첫 세그먼트면 screen.root에서 시작
  if (segments[0] !== "root") return doc;

  const remaining = segments.slice(1);
  if (remaining.length === 0) {
    // root 자체를 교체
    return {
      ...doc,
      screen: { ...doc.screen, root: patch.replacement },
    };
  }

  // 불변 깊은 교체
  const newRoot = replaceAtPath(
    doc.screen.root as unknown as Record<string, unknown>,
    remaining,
    patch.replacement as unknown
  );

  if (newRoot === null) return doc; // 경로 유효하지 않음 → 원본 유지

  return {
    ...doc,
    screen: { ...doc.screen, root: newRoot as unknown as IRNode },
  };
}

/**
 * 재귀적 불변 경로 교체. 경로가 유효하지 않으면 null 반환.
 */
function replaceAtPath(
  obj: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown
): Record<string, unknown> | null {
  const [head, ...tail] = path;

  if (tail.length === 0) {
    // 리프: 교체
    if (typeof head === "string") {
      return { ...obj, [head]: value };
    }
    // head가 숫자 = 부모가 배열이어야 하는데 여기선 obj가 객체 → 처리 불가
    return null;
  }

  if (typeof head === "string") {
    const child = obj[head];

    if (Array.isArray(child)) {
      const newArr = replaceInArray(child, tail, value);
      if (newArr === null) return null;
      return { ...obj, [head]: newArr };
    }

    if (child !== null && typeof child === "object") {
      const replaced = replaceAtPath(
        child as Record<string, unknown>,
        tail,
        value
      );
      if (replaced === null) return null;
      return { ...obj, [head]: replaced };
    }

    return null;
  }

  return null;
}

function replaceInArray(
  arr: unknown[],
  path: Array<string | number>,
  value: unknown
): unknown[] | null {
  const [head, ...tail] = path;

  if (typeof head !== "number" || head < 0 || head >= arr.length) {
    return null;
  }

  if (tail.length === 0) {
    const newArr = [...arr];
    newArr[head] = value;
    return newArr;
  }

  const child = arr[head];
  if (child !== null && typeof child === "object" && !Array.isArray(child)) {
    const replaced = replaceAtPath(
      child as Record<string, unknown>,
      tail,
      value
    );
    if (replaced === null) return null;
    const newArr = [...arr];
    newArr[head] = replaced;
    return newArr;
  }

  if (Array.isArray(child)) {
    const replaced = replaceInArray(child, tail, value);
    if (replaced === null) return null;
    const newArr = [...arr];
    newArr[head] = replaced;
    return newArr;
  }

  return null;
}

// ── 프롬프트 생성 ─────────────────────────────────────────────────

function buildPrompt(targets: EnrichTarget[]): string {
  const targetDescriptions = targets
    .map(({ nodePath, node }) => {
      const srcRef = node.sourceRef
        ? `${node.sourceRef.file}:${node.sourceRef.line ?? "?"}${node.sourceRef.symbol ? ` (${node.sourceRef.symbol})` : ""}`
        : "unknown";
      return `- nodePath: ${nodePath}\n  sourceRef: ${srcRef}\n  currentType: ${node.type}\n  confidence: ${node.confidence}`;
    })
    .join("\n");

  return `You are analyzing a UI component tree (IR) extracted from mobile app source code.
The following nodes have low confidence and need to be enriched.
For each node, provide a replacement IRNode that best represents the UI component.

Nodes to enrich:
${targetDescriptions}

Requirements:
- Return ONLY valid JSON, no markdown, no explanation
- Response format: {"patches": [{"nodePath": "<path>", "replacement": <IRNode>}]}
- IRNode must have: type (one of: Box|Row|Column|Stack|Scroll|Grid|List|Spacer|Text|Image|Icon|Button|Input|Divider|Unknown|Branch|Slot), confidence (0.0-1.0)
- Optional IRNode fields: role, layout, style, text, src, sourceRef, children
- Set confidence to 0.6 for enriched nodes
- If you cannot determine the component, use type "Unknown" with confidence 0.2`;
}

// ── createLlmEnrichmentPlugin ─────────────────────────────────────

export interface LlmEnrichmentPluginOptions {
  /** LLM 완성 함수 — 특정 벤더 SDK 비의존 */
  complete: (prompt: string) => Promise<string>;
  /** 이 confidence 미만 노드만 LLM 보강 대상 (기본 0.5) */
  threshold?: number;
  /** 한 번 호출에 처리할 최대 타겟 수 (기본 10) */
  maxTargets?: number;
}

export function createLlmEnrichmentPlugin(
  opts: LlmEnrichmentPluginOptions
): EnrichmentPlugin {
  const threshold = opts.threshold ?? 0.5;
  const maxTargets = opts.maxTargets ?? 10;

  return {
    async enrich(
      _doc: IRDocument,
      targets: EnrichTarget[]
    ): Promise<EnrichResult> {
      // threshold 필터링
      const filtered = targets.filter((t) => t.node.confidence < threshold);

      // targets 없으면 LLM 미호출
      if (filtered.length === 0) {
        return { patches: [], diagnostics: [] };
      }

      // maxTargets 제한
      const limited = filtered.slice(0, maxTargets);

      // LLM 호출
      const prompt = buildPrompt(limited);
      let rawResponse: string;
      try {
        rawResponse = await opts.complete(prompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          patches: [],
          diagnostics: [
            {
              level: "warn",
              code: "ENRICH_REJECTED",
              message: `LLM 호출 실패: ${msg}`,
            },
          ],
        };
      }

      // JSON 추출 및 파싱
      const jsonStr = extractJson(rawResponse);
      if (!jsonStr) {
        return {
          patches: [],
          diagnostics: [
            {
              level: "warn",
              code: "ENRICH_REJECTED",
              message: "LLM 응답이 비어있습니다",
            },
          ],
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        return {
          patches: [],
          diagnostics: [
            {
              level: "warn",
              code: "ENRICH_REJECTED",
              message: `LLM 응답 JSON 파싱 실패: ${jsonStr.slice(0, 100)}`,
            },
          ],
        };
      }

      // 최상위 스키마 검증
      const topLevel = LlmResponseSchema.safeParse(parsed);
      if (!topLevel.success) {
        return {
          patches: [],
          diagnostics: [
            {
              level: "warn",
              code: "ENRICH_REJECTED",
              message: `LLM 응답 스키마 위반: ${topLevel.error.message.slice(0, 200)}`,
            },
          ],
        };
      }

      // 개별 패치 검증
      const patches: EnrichPatch[] = [];
      const diagnostics: EnrichDiagnostic[] = [];

      for (const raw of topLevel.data.patches) {
        // 개별 replacement를 IRNodeLaxSchema로 검증
        const nodeCheck = IRNodeLaxSchema.safeParse(raw.replacement);
        if (!nodeCheck.success) {
          diagnostics.push({
            level: "warn",
            code: "ENRICH_REJECTED",
            message: `패치 노드 스키마 위반 (${raw.nodePath}): ${nodeCheck.error.message.slice(0, 150)}`,
            nodePath: raw.nodePath,
          });
          continue;
        }

        // confidence를 0.6(enriched)으로 강제
        const replacement: IRNode = {
          ...nodeCheck.data,
          confidence: 0.6,
        } as IRNode;

        // IRDocumentSchema로 전체 문서 재검증 (패치 적용 후)
        const testDoc = applyPatches(_doc, [
          { nodePath: raw.nodePath, replacement },
        ]);

        const docCheck = IRDocumentSchema.safeParse(testDoc);
        if (!docCheck.success) {
          diagnostics.push({
            level: "warn",
            code: "ENRICH_REJECTED",
            message: `패치 적용 후 문서 검증 실패 (${raw.nodePath}): ${docCheck.error.message.slice(0, 150)}`,
            nodePath: raw.nodePath,
          });
          continue;
        }

        patches.push({ nodePath: raw.nodePath, replacement });
        diagnostics.push({
          level: "info",
          code: "ENRICHED",
          message: `노드 보강 완료: ${raw.nodePath} → ${replacement.type}`,
          nodePath: raw.nodePath,
        });
      }

      return { patches, diagnostics };
    },
  };
}

// ── anthropicComplete 헬퍼 ─────────────────────────────────────────

export interface AnthropicCompleteOptions {
  /** Anthropic API 키. 미지정 시 ANTHROPIC_API_KEY 환경변수 사용. */
  apiKey?: string;
  /** 사용할 모델 (기본: claude-opus-4-8) */
  model?: string;
  /** max_tokens (기본: 2048) */
  maxTokens?: number;
}

/**
 * fetch 기반 Anthropic Messages API 호출 함수를 반환한다.
 * 별도 SDK 설치 없이 동작. 네트워크 테스트는 vi.mock으로 처리할 것.
 */
export function anthropicComplete(
  opts: AnthropicCompleteOptions
): (prompt: string) => Promise<string> {
  const model = opts.model ?? "claude-opus-4-8";
  const maxTokens = opts.maxTokens ?? 2048;

  return async function complete(prompt: string): Promise<string> {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Anthropic API key가 없습니다. anthropicComplete({ apiKey }) 또는 ANTHROPIC_API_KEY 환경변수를 설정하세요."
      );
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Anthropic API 오류 (${response.status}): ${errText.slice(0, 200)}`
      );
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    const textBlock = data.content.find((b) => b.type === "text");
    if (!textBlock) {
      throw new Error("Anthropic API 응답에 text content가 없습니다");
    }

    return textBlock.text;
  };
}
