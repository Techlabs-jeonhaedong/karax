/**
 * scenario/schema.ts — 시나리오 frontmatter v2 Zod 스키마
 *
 * 알 수 없는 키는 무시(미래 호환). strict 아님.
 */

import { z } from "zod";

export const ScenarioStepSchema = z.object({
  action: z.string().min(1),
  expect: z.string().optional(),
});

export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;

export const ScenarioFrontmatterSchema = z.object({
  appId: z.string().optional(),
  platform: z.enum(["android", "ios"]).optional(),
  title: z.string().optional(),
  mode: z.enum(["scenario", "exploratory"]).optional(),
  preconditions: z.array(z.string()).optional(),
  testData: z.record(z.string()).optional(),
  steps: z.array(ScenarioStepSchema).optional(),
  /** 와이어링은 M11 — 스키마만 */
  permissions: z.array(z.string()).optional(),
});

export type ScenarioFrontmatter = z.infer<typeof ScenarioFrontmatterSchema>;
