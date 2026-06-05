/**
 * agent/resultSchema.ts — 에이전트가 쓰는 result.json zod 스키마
 */

import { z } from "zod";

export const AgentStepSchema = z.object({
  index: z.number().int().nonnegative(),
  description: z.string(),
  status: z.enum(["pass", "fail", "skip"]),
  screenshot: z.string().optional(),
  note: z.string().optional(),
});

export const AgentResultSchema = z.object({
  outcome: z.enum(["pass", "fail"]),
  summary: z.string(),
  steps: z.array(AgentStepSchema),
});

export type AgentResult = z.infer<typeof AgentResultSchema>;
export type AgentStep = z.infer<typeof AgentStepSchema>;
