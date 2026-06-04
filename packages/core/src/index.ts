export {
  IRDocumentSchema,
  NodeTypeSchema,
  parseIRDocument,
  safeParseIRDocument,
} from "./ir/schema.js";
export type { IRDocument, IRNode, NodeType } from "./ir/schema.js";

export { detectFramework } from "./detect/detector.js";
export type { DetectResult, FrameworkCandidate, FrameworkId } from "./detect/detector.js";
