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
