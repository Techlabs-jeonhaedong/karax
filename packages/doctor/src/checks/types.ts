export type CheckStatus = "ok" | "missing" | "outdated";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  version?: string;
  autoInstallable: boolean;
  hint: string;
}
