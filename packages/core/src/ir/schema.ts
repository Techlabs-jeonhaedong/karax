import { z } from "zod";

// ── 공유 프리미티브 ──────────────────────────────────────────────

const SourceRefSchema = z
  .object({
    file: z.string(),
    line: z.number().int().nonnegative().optional(),
    symbol: z.string().optional(),
  })
  .strict();

const Padding4Schema = z
  .tuple([
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
    z.number().nonnegative(),
  ])
  .describe("[top, right, bottom, left]");

const SizeValueSchema = z.union([
  z.literal("fill"),
  z.literal("wrap"),
  z.number().nonnegative(),
]);

// ── Layout ─────────────────────────────────────────────────────

const LayoutSchema = z
  .object({
    direction: z.enum(["row", "column"]).optional(),
    mainAxis: z
      .enum(["start", "center", "end", "spaceBetween", "spaceAround"])
      .optional(),
    crossAxis: z.enum(["start", "center", "end", "stretch"]).optional(),
    flex: z.number().nonnegative().optional(),
    width: SizeValueSchema.optional(),
    height: SizeValueSchema.optional(),
    padding: Padding4Schema.optional(),
    margin: Padding4Schema.optional(),
    gap: z.number().nonnegative().optional(),
  })
  .strict()
  .optional();

// ── Style ──────────────────────────────────────────────────────

const BorderSchema = z
  .object({
    width: z.number().nonnegative().optional(),
    color: z.string().optional(),
  })
  .strict()
  .optional();

const ShadowSchema = z
  .object({
    offsetX: z.number().optional(),
    offsetY: z.number().optional(),
    blur: z.number().nonnegative().optional(),
    spread: z.number().optional(),
    color: z.string().optional(),
  })
  .strict()
  .optional();

const StyleSchema = z
  .object({
    background: z.string().optional(),
    borderRadius: z.number().nonnegative().optional(),
    border: BorderSchema,
    shadow: ShadowSchema,
    opacity: z.number().min(0).max(1).optional(),
  })
  .strict()
  .optional();

// ── Text / Image 전용 속성 ──────────────────────────────────────

const TextPropSchema = z
  .object({
    value: z.string().optional(),
    token: z.string().optional(),
    color: z.string().optional(),
    maxLines: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

// ── 노드 타입 열거 ──────────────────────────────────────────────

export const NodeTypeSchema = z.enum([
  // 레이아웃
  "Box",
  "Row",
  "Column",
  "Stack",
  "Scroll",
  "Grid",
  "List",
  "Spacer",
  // 콘텐츠
  "Text",
  "Image",
  "Icon",
  "Button",
  "Input",
  "Divider",
  // 메타
  "Unknown",
  "Branch",
  "Slot",
]);

export type NodeType = z.infer<typeof NodeTypeSchema>;

// ── IRNode (재귀) ──────────────────────────────────────────────

export type IRNode = {
  type: NodeType;
  role?: string | null;
  layout?: z.infer<typeof LayoutSchema>;
  style?: z.infer<typeof StyleSchema>;
  text?: z.infer<typeof TextPropSchema>;
  src?: string;
  confidence: number;
  sourceRef?: z.infer<typeof SourceRefSchema>;
  children?: IRNode[];
};

const IRNodeSchemaBase = z
  .object({
    type: NodeTypeSchema,
    role: z.string().nullish(),
    layout: LayoutSchema,
    style: StyleSchema,
    text: TextPropSchema,
    src: z.string().optional(),
    confidence: z.number().min(0).max(1),
    sourceRef: SourceRefSchema.optional(),
  })
  .strict();

// lazy 재귀 처리 — strict()를 extend 후 다시 적용
const IRNodeSchema: z.ZodType<IRNode> = IRNodeSchemaBase.extend({
  children: z.lazy(() => IRNodeSchema.array()).optional(),
}).strict();

// ── Diagnostics ────────────────────────────────────────────────

const DiagnosticLevelSchema = z.enum(["info", "warn", "error"]);

const DiagnosticSchema = z
  .object({
    level: DiagnosticLevelSchema,
    code: z.string(),
    message: z.string(),
    sourceRef: SourceRefSchema.optional(),
  })
  .strict();

// ── DesignTokens ───────────────────────────────────────────────

const DesignTokensSchema = z
  .object({
    colors: z.record(z.string()).optional(),
    spacing: z.record(z.number()).optional(),
    typography: z.record(z.unknown()).optional(),
  })
  .strict()
  .optional();

// ── IRDocument ─────────────────────────────────────────────────

export const IRDocumentSchema = z
  .object({
    schemaVersion: z.string(),
    screen: z
      .object({
        id: z.string(),
        sourceRef: SourceRefSchema.optional(),
        device: z.string().optional(),
        discovery: z.enum(["route", "candidate"]),
        confidence: z.number().min(0).max(1),
        root: IRNodeSchema,
      })
      .strict(),
    designTokens: DesignTokensSchema,
    diagnostics: DiagnosticSchema.array().optional().default([]),
  })
  .strict();

export type IRDocument = z.infer<typeof IRDocumentSchema>;

// ── 헬퍼 ───────────────────────────────────────────────────────

export function parseIRDocument(input: unknown): IRDocument {
  return IRDocumentSchema.parse(input);
}

export function safeParseIRDocument(input: unknown):
  | { success: true; data: IRDocument }
  | { success: false; error: z.ZodError } {
  const result = IRDocumentSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
