/**
 * build/types.ts — 빌드 레이어 타입
 */

import type { Platform } from "../types.js";

export interface BuildResult {
  artifactPath: string;
  appId: string;
}

export interface AppBuilder {
  readonly framework: string;
  readonly platform: Platform;
  build(projectPath: string): Promise<BuildResult>;
}
