/**
 * report/schema.ts — E2eReport zod 스키마
 *
 * M8 확장 (add-only, 순수 optional — D10):
 * - outcome: "partial" 추가
 * - reportVersion: 2 명시 (optional)
 * - title, findings, coverage, crashes, videos, qualityWarnings, visitedScreens
 * 기존 v1 report.json은 신규 필드 없이도 파싱됨(하위호환).
 */

import { z } from "zod";
import { AgentStepSchema, FindingSchema } from "../agent/resultSchema.js";
import { CrashEventSchema } from "../crash/detect.js";

// ── coverage 스키마 ────────────────────────────────────────────────

export const CoverageSchema = z.object({
  totalScreens: z.number().int().nonnegative(),
  visitedScreens: z.number().int().nonnegative(),
  visitedScreenIds: z.array(z.string()),
  unvisitedScreenIds: z.array(z.string()),
  coverageRatio: z.number().min(0).max(1),
});

export type Coverage = z.infer<typeof CoverageSchema>;

// ── E2eReport 스키마 ───────────────────────────────────────────────

export const E2eReportSchema = z.object({
  sessionId: z.string(),
  projectPath: z.string(),
  platform: z.enum(["android", "ios"]),
  agent: z.string(),
  scenarioPath: z.string().optional(),
  // M8: "partial" 추가
  outcome: z.enum(["pass", "fail", "error", "partial"]),
  summary: z.string(),
  steps: z.array(AgentStepSchema),
  screenshotsDir: z.string(),
  durationMs: z.number().nonnegative(),
  createdAt: z.string(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  // M8: 신규 선택 필드 (add-only, default 없는 순수 optional — D10)
  reportVersion: z.literal(2).optional(),
  title: z.string().optional(),
  findings: z.array(FindingSchema).max(500).optional(),
  coverage: CoverageSchema.optional(),
  crashes: z.array(CrashEventSchema).max(100).optional(),
  videos: z.array(z.string()).max(100).optional(),
  qualityWarnings: z.array(z.string()).max(500).optional(),
  visitedScreens: z.array(z.string()).max(1000).optional(),
});

export type E2eReport = z.infer<typeof E2eReportSchema>;
