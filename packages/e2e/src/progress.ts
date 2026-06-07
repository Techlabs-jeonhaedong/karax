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
 * detail 문자열에서 민감 정보를 마스킹한다.
 *
 * KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL 류 `이름=값` 패턴을 `이름=***`으로 대체한다.
 * 대소문자 무관, 여러 패턴이 한 문자열에 있어도 모두 마스킹한다.
 */
export function redactDetail(detail: string): string;
export function redactDetail(detail: undefined): undefined;
export function redactDetail(detail: string | undefined): string | undefined;
export function redactDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  // 민감 키워드가 단어 일부로 포함된 경우(APIKEYSTORE 등)도 포함, 값 부분은 `=` 뒤 공백이 아닌 문자열
  return detail.replace(
    /(\b\w*(?:KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL)\w*)=(\S+)/gi,
    "$1=***"
  );
}

/**
 * 진행 이벤트를 안전하게 발행한다.
 * 콜백이 throw해도 무시하고 파이프라인에 영향을 주지 않는다.
 * detail은 발행 전에 민감 정보가 마스킹된다.
 */
export async function emitProgress(
  callback: E2eProgressCallback | undefined,
  event: E2eProgressEvent
): Promise<void> {
  if (!callback) return;
  // detail redaction: 단일 지점 처리 — CLI/MCP 모두 자동으로 redacted detail 수신
  const safeEvent: E2eProgressEvent = event.detail !== undefined
    ? { ...event, detail: redactDetail(event.detail) }
    : event;
  try {
    await Promise.resolve(callback(safeEvent));
  } catch {
    // 콜백 오류는 무시 — 파이프라인을 죽이지 않는다
  }
}
