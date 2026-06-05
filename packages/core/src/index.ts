export {
  IRDocumentSchema,
  NodeTypeSchema,
  parseIRDocument,
  safeParseIRDocument,
} from "./ir/schema.js";
export type { IRDocument, IRNode, NodeType } from "./ir/schema.js";

export { detectFramework } from "./detect/detector.js";
export type { DetectResult, FrameworkCandidate, FrameworkId } from "./detect/detector.js";

export { createMockProvider } from "./mock/provider.js";
export type { MockProvider } from "./mock/provider.js";

export {
  NODE_CONFIDENCE,
  aggregateScreenConfidence,
  computeProjectConfidence,
} from "./confidence/aggregate.js";
export type { ProjectConfidence } from "./confidence/aggregate.js";

export { captureScreenWithTiers } from "./pipeline/captureEngine.js";
export type {
  CaptureEngineDeps,
  CaptureEngineDiagnostic,
  CaptureEngineOptions,
  CaptureEngineResult,
} from "./pipeline/captureEngine.js";

export { expandVariants } from "./ir/expandVariants.js";
export type { VariantDoc } from "./ir/expandVariants.js";

export {
  AppMapSchema,
  NavigationEdgeSchema,
  NavigationGraphSchema,
  ScreenNodeSchema,
  MapElementSchema,
  TriggerInfoSchema,
  DiagnosticEntrySchema,
  sanitizeAppName,
} from "./appmap/schema.js";
export type {
  AppMap,
  NavigationEdge,
  NavigationGraph,
  ScreenNode,
  MapElement,
  TriggerInfo,
  DiagnosticEntry as AppMapDiagnosticEntry,
} from "./appmap/schema.js";

export { assembleAppMap } from "./appmap/assemble.js";
export type { AssembleOptions, ScreenSummary as AppMapScreenSummary } from "./appmap/assemble.js";

export { renderAppMapMarkdown } from "./appmap/markdown.js";
export type { AppMapDocument, RenderOptions as AppMapRenderOptions } from "./appmap/markdown.js";
