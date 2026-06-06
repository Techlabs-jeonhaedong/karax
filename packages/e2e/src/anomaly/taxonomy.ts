/**
 * anomaly/taxonomy.ts — anomaly 분류 체계 단일 소스 상수
 *
 * 프롬프트와 resultSchema가 이 상수를 공유해 드리프트를 방지한다.
 */

export const ANOMALY_CATEGORIES = [
  "crash",
  "layout-overflow",
  "untranslated-text",
  "dead-button",
  "navigation-inconsistency",
  "slow-response",
  "accessibility",
  "visual-glitch",
  "error-state",
  "other",
] as const;

export type AnomalyCategory = (typeof ANOMALY_CATEGORIES)[number];

export const SEVERITIES = ["critical", "major", "minor"] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface TaxonomyEntry {
  /** 한국어 설명 */
  description: string;
  /** 기본 심각도 */
  defaultSeverity: Severity;
  /** 화면 점검 체크리스트 힌트 */
  checklistHint: string;
}

export const TAXONOMY: Record<AnomalyCategory, TaxonomyEntry> = {
  crash: {
    description: "앱이 강제 종료되거나 응답 불가(ANR) 상태가 됨",
    defaultSeverity: "critical",
    checklistHint:
      "앱이 강제 종료되면 즉시 기록. 크래시 발생 직전 화면과 재현 단계를 스크린샷과 함께 첨부할 것",
  },
  "layout-overflow": {
    description: "텍스트·요소가 잘리거나 화면 경계를 넘침",
    defaultSeverity: "major",
    checklistHint:
      "각 화면에서 텍스트 잘림·요소 겹침·화면 경계 초과 확인. 긴 텍스트·다국어·소형 화면 크기에서 특히 주의",
  },
  "untranslated-text": {
    description: "번역되지 않은 원문(키 문자열, 영문 등)이 UI에 그대로 노출됨",
    defaultSeverity: "major",
    checklistHint:
      "버튼·라벨·토스트·다이얼로그에서 원문 키 문자열(예: 'button.ok')이나 번역 누락 텍스트 확인",
  },
  "dead-button": {
    description: "탭해도 반응이 없는 버튼이나 터치 영역",
    defaultSeverity: "major",
    checklistHint:
      "클릭 가능한 요소(버튼·링크·탭)를 탭 후 변화가 없으면 기록. 로딩 중 중복 탭 방지와 구분할 것",
  },
  "navigation-inconsistency": {
    description: "뒤로가기 동작이 예상과 다르거나 화면 전환이 비일관적임",
    defaultSeverity: "major",
    checklistHint:
      "뒤로가기 버튼/제스처 동작, 딥링크 진입 후 스택 정상 여부, 탭 전환 시 상태 보존 확인",
  },
  "slow-response": {
    description: "UI 조작 후 3초 이상 응답이 없거나 인지 가능한 지연이 있음",
    defaultSeverity: "minor",
    checklistHint:
      "버튼 탭·화면 전환·데이터 로딩 시 체감 지연 측정. 로딩 인디케이터 미표시 여부도 확인",
  },
  accessibility: {
    description: "접근성 요소(레이블·대비·포커스 순서)가 부적절함",
    defaultSeverity: "minor",
    checklistHint:
      "이미지·아이콘에 콘텐츠 설명(contentDescription) 누락, 터치 영역 48dp 미만, 색상 대비 불충분 확인",
  },
  "visual-glitch": {
    description: "깜빡임·잔상·렌더링 아티팩트 등 시각적 결함",
    defaultSeverity: "minor",
    checklistHint:
      "화면 전환·스크롤·애니메이션 중 깜빡임·이미지 깨짐·레이어 잔상 등 시각적 이상 관찰",
  },
  "error-state": {
    description: "에러 메시지·빈 상태(empty state)·실패 화면이 비정상적으로 표시됨",
    defaultSeverity: "major",
    checklistHint:
      "네트워크 오류·빈 목록·데이터 없음 상태에서 에러 UI 적절성 확인. 재시도 버튼 동작 여부도 점검",
  },
  other: {
    description: "위 분류에 해당하지 않는 기타 부자연스러운 동작",
    defaultSeverity: "minor",
    checklistHint:
      "위 카테고리에 맞지 않는 이상 동작 발견 시 'other'로 기록하고 구체적인 상황을 description에 상세히 작성",
  },
};
