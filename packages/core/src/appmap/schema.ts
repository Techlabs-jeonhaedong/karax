import { z } from "zod";

// ── 공유 프리미티브 ──────────────────────────────────────────────────

export const DiagnosticEntrySchema = z
  .object({
    code: z.string(),
    message: z.string(),
  })
  .strict();

export type DiagnosticEntry = z.infer<typeof DiagnosticEntrySchema>;

// ── TriggerInfo ──────────────────────────────────────────────────────

export const TriggerInfoSchema = z
  .object({
    kind: z.enum(["button", "navlink", "tap", "back", "system"]),
    label: z.string().optional(),
    sourceRef: z
      .object({
        file: z.string(),
        line: z.number().int().nonnegative().optional(),
        symbol: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type TriggerInfo = z.infer<typeof TriggerInfoSchema>;

// ── NavigationEdge ───────────────────────────────────────────────────

export const NavigationEdgeSchema = z
  .object({
    from: z.string(),
    to: z.string().nullable(),
    toRouteName: z.string().optional(),
    action: z.enum(["push", "replace", "pop", "navigate", "present", "unknown"]),
    trigger: TriggerInfoSchema,
    confidence: z.number().min(0).max(1),
    diagnostics: DiagnosticEntrySchema.array(),
  })
  .strict();

export type NavigationEdge = z.infer<typeof NavigationEdgeSchema>;

// ── MapElement ───────────────────────────────────────────────────────

export const MapElementSchema = z
  .object({
    type: z.enum([
      "Box", "Row", "Column", "Stack", "Scroll", "Grid", "List", "Spacer",
      "Text", "Image", "Icon", "Button", "Input", "Divider",
      "Unknown", "Branch", "Slot",
    ]),
    label: z.string().optional(),
    sourceRef: z
      .object({
        file: z.string(),
        line: z.number().int().nonnegative().optional(),
        symbol: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type MapElement = z.infer<typeof MapElementSchema>;

// ── ScreenNode ───────────────────────────────────────────────────────

export const ScreenNodeSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    discovery: z.enum(["route", "candidate"]),
    isEntry: z.boolean(),
    confidence: z.number().min(0).max(1),
    sourceRef: z
      .object({
        file: z.string(),
        line: z.number().int().nonnegative().optional(),
        symbol: z.string().optional(),
      })
      .strict()
      .optional(),
    elements: MapElementSchema.array(),
    outgoing: NavigationEdgeSchema.array(),
  })
  .strict();

export type ScreenNode = z.infer<typeof ScreenNodeSchema>;

// ── AppMap ───────────────────────────────────────────────────────────

export const AppMapSchema = z
  .object({
    schemaVersion: z.literal("appmap/1"),
    appName: z.string(),
    framework: z.enum(["flutter", "react-native", "android", "ios"]),
    entryScreenId: z.string().nullable(),
    screens: ScreenNodeSchema.array(),
    edges: NavigationEdgeSchema.array(),
    diagnostics: DiagnosticEntrySchema.array(),
    overallConfidence: z.number().min(0).max(1),
  })
  .strict();

export type AppMap = z.infer<typeof AppMapSchema>;

// ── NavigationGraph (어댑터 반환용 중간 타입) ─────────────────────────

export const NavigationGraphSchema = z
  .object({
    entryScreenId: z.string().nullable(),
    edges: NavigationEdgeSchema.array(),
    diagnostics: DiagnosticEntrySchema.array(),
  })
  .strict();

export type NavigationGraph = z.infer<typeof NavigationGraphSchema>;

// ── sanitizeAppName ───────────────────────────────────────────────────

/**
 * 앱 이름에서 파일 경로 위험 문자를 제거하고 공백을 언더스코어로 치환한다.
 * 빈 문자열이 되면 "unnamed"를 반환한다.
 */
export function sanitizeAppName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "unnamed";

  return trimmed
    .replace(/[\\/]/g, "_")   // 경로 구분자 → _
    .replace(/:/g, "_")        // 콜론 → _
    .replace(/\s+/g, "_");     // 공백 → _
}
