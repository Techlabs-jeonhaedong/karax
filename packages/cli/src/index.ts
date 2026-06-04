/**
 * @sfc/cli 공개 모듈
 * bin.ts를 직접 실행하는 경우 이 파일을 거치지 않음.
 * 테스트에서는 commands.ts를 직접 import.
 */

export { EXIT_CODES } from "./commands.js";
export type {
  DetectArgs,
  DoctorArgs,
  ListArgs,
  CaptureArgs,
  McpConfigArgs,
} from "./commands.js";

export const CLI_VERSION = "0.0.1" as const;
