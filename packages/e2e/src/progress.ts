/**
 * @karax/e2e — E2E 파이프라인 진행 이벤트 타입
 *
 * RunE2eTestOptions.onProgress 콜백의 페이로드.
 * 파이프라인 각 단계의 시작/완료/오류를 전달한다.
 */

/**
 * 파이프라인 단계 식별자.
 * 실제 파이프라인 순서: scenario → detect → device → appmap → build → install → launch → agent → crash-scan → report
 */
export type E2eProgressPhase =
  | "scenario"
  | "detect"
  | "device"
  | "appmap"
  | "build"
  | "install"
  | "launch"
  | "agent"
  | "crash-scan"
  | "report";

/** 단계 상태 */
export type E2eProgressStatus = "start" | "done" | "error";

/**
 * E2E 파이프라인 진행 이벤트.
 *
 * - `phase`: 현재 파이프라인 단계
 * - `status`: "start" (시작), "done" (완료), "error" (오류)
 * - `timestamp`: Unix epoch ms (Date.now())
 * - `detail`: 사람이 읽을 수 있는 상태 메시지 (optional)
 * - `stepIndex`: suite 모드에서 현재 시나리오 인덱스 (0-based, optional)
 * - `totalSteps`: suite 모드에서 전체 시나리오 수 (optional)
 */
export interface E2eProgressEvent {
  phase: E2eProgressPhase;
  status: E2eProgressStatus;
  timestamp: number;
  detail?: string;
  stepIndex?: number;
  totalSteps?: number;
}

/** onProgress 콜백 타입 — 동기 또는 비동기 모두 허용 */
export type E2eProgressCallback = (event: E2eProgressEvent) => void | Promise<void>;

/**
 * 진행 이벤트를 안전하게 발행한다.
 * 콜백이 throw해도 무시하고 파이프라인에 영향을 주지 않는다.
 */
export async function emitProgress(
  callback: E2eProgressCallback | undefined,
  event: E2eProgressEvent
): Promise<void> {
  if (!callback) return;
  try {
    await Promise.resolve(callback(event));
  } catch {
    // 콜백 오류는 무시 — 파이프라인을 죽이지 않는다
  }
}
