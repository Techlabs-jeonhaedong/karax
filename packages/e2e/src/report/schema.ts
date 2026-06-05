/**
 * report/schema.ts — E2eReport zod 스키마
 */

import { z } from "zod";
import { AgentStepSchema } from "../agent/resultSchema.js";

export const E2eReportSchema = z.object({
  sessionId: z.string(),
  projectPath: z.string(),
  platform: z.enum(["android", "ios"]),
  agent: z.string(),
  scenarioPath: z.string().optional(),
  outcome: z.enum(["pass", "fail", "error"]),
  summary: z.string(),
  steps: z.array(AgentStepSchema),
  screenshotsDir: z.string(),
  durationMs: z.number().nonnegative(),
  createdAt: z.string(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type E2eReport = z.infer<typeof E2eReportSchema>;
