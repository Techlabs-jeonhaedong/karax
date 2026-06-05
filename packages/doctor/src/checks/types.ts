export type CheckStatus = "ok" | "missing" | "outdated";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  version?: string;
  autoInstallable: boolean;
  hint: string;
  /** true이면 overallOk 판정에서 제외 (E2E 전용 툴 등 선택적 항목) */
  optional?: boolean;
}
