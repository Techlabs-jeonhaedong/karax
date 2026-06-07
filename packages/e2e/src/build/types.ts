/**
 * build/types.ts — 빌드 레이어 타입
 */

import type { Platform } from "../types.js";

export interface BuildResult {
  artifactPath: string;
  appId: string;
}

/**
 * AppBuilder.build에 전달할 옵셔널 컨텍스트.
 * 기존 호출자(build 없이 호출하는 곳)는 영향 없음.
 */
export interface BuildContext {
  /** 디버그 모드 활성 여부. true이면 빌드 로그를 debugDir에 기록한다. */
  debug?: boolean;
  /** 디버그 아티팩트 저장 디렉토리. debug=true일 때만 유효. */
  debugDir?: string;
}

export interface AppBuilder {
  readonly framework: string;
  readonly platform: Platform;
  build(projectPath: string, ctx?: BuildContext): Promise<BuildResult>;
}
