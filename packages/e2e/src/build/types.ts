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
  /**
   * 사용자 정의 빌드 커맨드.
   * 지정 시 빌더 기본 커맨드 대신 shell=true로 이 커맨드를 실행한다.
   * 예: "fvm flutter build apk --debug --flavor dev"
   * noBuild=true와 함께 오면 무시된다 (에러 아님).
   */
  buildCommand?: string;
}

export interface AppBuilder {
  readonly framework: string;
  readonly platform: Platform;
  build(projectPath: string, ctx?: BuildContext): Promise<BuildResult>;
}
