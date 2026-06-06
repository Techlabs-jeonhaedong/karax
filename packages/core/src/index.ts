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
  AppMapReadSchema,
  NavigationEdgeSchema,
  NavigationGraphSchema,
  ScreenNodeSchema,
  MapElementSchema,
  MapElementRoleSchema,
  TriggerInfoSchema,
  DiagnosticEntrySchema,
  sanitizeAppName,
} from "./appmap/schema.js";
export type {
  AppMap,
  AppMapRead,
  NavigationEdge,
  NavigationGraph,
  ScreenNode,
  MapElement,
  MapElementRole,
  TriggerInfo,
  DiagnosticEntry as AppMapDiagnosticEntry,
} from "./appmap/schema.js";

export { classifyElementRole } from "./appmap/adDetection.js";
export type { ElementRoleInfo } from "./appmap/adDetection.js";

export { assembleAppMap, matchElement, extractElementStyle } from "./appmap/assemble.js";
export type { AssembleOptions, ScreenSummary as AppMapScreenSummary } from "./appmap/assemble.js";

export { renderAppMapMarkdown } from "./appmap/markdown.js";
export type { AppMapDocument, RenderOptions as AppMapRenderOptions } from "./appmap/markdown.js";

export {
  parseUiautomatorXml,
  flattenInteractive,
} from "./runtime/uiautomatorParser.js";
export type {
  RuntimeBounds,
  RuntimeNode,
  RuntimeUITree,
} from "./runtime/uiautomatorParser.js";

export {
  normalizeLabel,
  matchAppMapElement,
  locateLabel,
} from "./runtime/matchRuntime.js";
export type {
  ScaleContext,
  MatchMethod,
  ElementMatch,
} from "./runtime/matchRuntime.js";

export { identifyScreen } from "./runtime/whichScreen.js";
export type { ScreenIdentification } from "./runtime/whichScreen.js";
