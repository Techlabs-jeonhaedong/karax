/**
 * report/write.ts — report.json + report.md 작성
 */

import fs from "fs";
import path from "path";
import type { E2eReport } from "./schema.js";

export interface WriteReportResult {
  reportJsonPath: string;
  reportMdPath: string;
}

/**
 * sessionDir에 report.json과 report.md를 작성한다.
 */
export function writeReport(sessionDir: string, report: E2eReport): WriteReportResult {
  const reportJsonPath = path.join(sessionDir, "report.json");
  const reportMdPath = path.join(sessionDir, "report.md");

  fs.mkdirSync(sessionDir, { recursive: true });

  // report.json
  fs.writeFileSync(reportJsonPath, JSON.stringify(report, null, 2), "utf-8");

  // report.md
  const mdContent = buildReportMarkdown(report);
  fs.writeFileSync(reportMdPath, mdContent, "utf-8");

  return { reportJsonPath, reportMdPath };
}

function buildReportMarkdown(report: E2eReport): string {
  const outcomeEmoji = report.outcome === "pass" ? "✓" : report.outcome === "fail" ? "✗" : "!";
  const duration = (report.durationMs / 1000).toFixed(1);

  const lines: string[] = [
    `# E2E 테스트 리포트`,
    ``,
    `| 항목 | 값 |`,
    `|---|---|`,
    `| 결과 | ${outcomeEmoji} ${report.outcome} |`,
    `| 요약 | ${report.summary} |`,
    `| 플랫폼 | ${report.platform} |`,
    `| 에이전트 | ${report.agent} |`,
    `| 소요 시간 | ${duration}s |`,
    `| 생성 시각 | ${report.createdAt} |`,
    `| 세션 ID | ${report.sessionId} |`,
    ``,
    `## 스텝 목록`,
    ``,
    `| # | 설명 | 상태 | 스크린샷 | 메모 |`,
    `|---|---|---|---|---|`,
  ];

  for (const step of report.steps) {
    const statusIcon = step.status === "pass" ? "✓" : step.status === "fail" ? "✗" : "-";
    const screenshot = step.screenshot ? step.screenshot : "-";
    const note = step.note ?? "-";
    lines.push(`| ${step.index} | ${step.description} | ${statusIcon} ${step.status} | ${screenshot} | ${note} |`);
  }

  if (report.errorCode) {
    lines.push(``, `## 에러 정보`, ``, `- 코드: \`${report.errorCode}\``);
    if (report.errorMessage) {
      lines.push(`- 메시지: ${report.errorMessage}`);
    }
  }

  return lines.join("\n") + "\n";
}
