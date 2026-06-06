/**
 * agent/resultSchema.ts — 에이전트가 쓰는 result.json zod 스키마
 *
 * M7 확장 (add-only, default 없는 순수 .optional() — 라운드트립 보존):
 * - FindingSchema: anomaly 분류 체계 기반 발견 사항
 * - AgentStepSchema 확장: expected / actual / screenId
 * - AgentResultSchema 확장: findings / visitedScreens
 */

import { z } from "zod";
import { ANOMALY_CATEGORIES, SEVERITIES } from "../anomaly/taxonomy.js";

// ── FindingSchema ──────────────────────────────────────────────────

export const FindingSchema = z.object({
  /** 발견 사항 고유 식별자 */
  id: z.string().min(1),
  /** 심각도 */
  severity: z.enum(SEVERITIES),
  /** anomaly 카테고리 */
  category: z.enum(ANOMALY_CATEGORIES),
  /** 발견된 화면 id (선택) */
  screenId: z.string().optional(),
  /** 발견 사항 설명 */
  description: z.string().min(1),
  /** 스크린샷 파일명 — sanitizeScreenshotPath 대상 (선택) */
  evidence: z.string().optional(),
  /** 재현 단계 (선택) */
  reproSteps: z.array(z.string()).optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

// ── AgentStepSchema ────────────────────────────────────────────────

export const AgentStepSchema = z.object({
  index: z.number().int().nonnegative(),
  description: z.string(),
  status: z.enum(["pass", "fail", "skip"]),
  screenshot: z.string().optional(),
  note: z.string().optional(),
  /** 기대 동작 (시나리오 expected 필드에서 매핑) */
  expected: z.string().optional(),
  /** 실제 동작 */
  actual: z.string().optional(),
  /** 이 스텝이 수행된 화면 id */
  screenId: z.string().optional(),
});

// ── AgentResultSchema ──────────────────────────────────────────────

export const AgentResultSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  summary: z.string(),
  steps: z.array(AgentStepSchema),
  /** M7: anomaly 발견 사항 목록 (exploratory 모드) */
  findings: z.array(FindingSchema).optional(),
  /** M7: 에이전트가 방문한 화면 id 목록 */
  visitedScreens: z.array(z.string()).optional(),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;
export type AgentStep = z.infer<typeof AgentStepSchema>;
