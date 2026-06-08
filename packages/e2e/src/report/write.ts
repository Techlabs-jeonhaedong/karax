/**
 * report/write.ts — report.json + report.md 작성
 *
 * M8 확장:
 * - 섹션별 순수 함수 export (개별 테스트 가능)
 * - findings(severity 정렬·이스케이프·이미지 임베드) / coverage / crashes / videos / qualityWarnings 섹션
 * - 스텝 표에 expected/actual 컬럼
 * - 에이전트/앱 유래 모든 문자열에 escapeMarkdownCell 적용
 */

import fs from "fs";
import path from "path";
import type { E2eReport } from "./schema.js";
import type { Finding } from "../agent/resultSchema.js";
import type { CrashEvent } from "../crash/detect.js";
import type { Coverage } from "./schema.js";
import { sanitizeScreenshotPath } from "./sanitize.js";

export interface WriteReportResult {
  reportJsonPath: string;
  reportMdPath: string;
}

// ── escapeMarkdownCell ─────────────────────────────────────────────

/**
 * 마크다운 테이블 셀 값에서 파이프(|)·개행·백틱을 이스케이프/치환한다.
 * T3 요건: 에이전트/앱 유래 문자열의 인젝션 완화.
 *
 * 주의: core의 sanitize 함수와 독립적으로 구현 (import 금지).
 */
export function escapeMarkdownCell(value: string): string {
  return value
    .replace(/\r\n/g, " ")   // CRLF → 공백 2개 (CRLF → CR+LF 각각 처리하지 않도록 먼저)
    .replace(/\n/g, " ")     // LF → 공백
    .replace(/\r/g, " ")     // CR → 공백
    .replace(/\|/g, "\\|")   // 파이프 이스케이프
    .replace(/`/g, "\\`");   // 백틱 이스케이프
}

// ── 섹션별 순수 함수 ────────────────────────────────────────────────

const SEVERITY_ORDER: Record<string, number> = { critical: 0, major: 1, minor: 2 };

/**
 * 요약 섹션 (기본 표 + title + findings 건수 + coverage 한 줄 + reportVersion)
 */
export function buildSummarySection(report: E2eReport): string {
  const outcomeEmoji =
    report.outcome === "pass" ? "✓" :
    report.outcome === "fail" ? "✗" :
    report.outcome === "partial" ? "~" : "!";
  const duration = (report.durationMs / 1000).toFixed(1);

  const lines: string[] = [
    `# E2E 테스트 리포트`,
    ``,
    `| 항목 | 값 |`,
    `|---|---|`,
    `| 결과 | ${outcomeEmoji} ${report.outcome} |`,
    `| 요약 | ${escapeMarkdownCell(report.summary)} |`,
    `| 플랫폼 | ${report.platform} |`,
    `| 에이전트 | ${report.agent} |`,
    `| 소요 시간 | ${duration}s |`,
    `| 생성 시각 | ${report.createdAt} |`,
    `| 세션 ID | ${report.sessionId} |`,
  ];

  if (report.reportVersion) {
    lines.push(`| 리포트 버전 | v${report.reportVersion} |`);
  }

  if (report.title) {
    lines.push(`| 제목 | ${escapeMarkdownCell(report.title)} |`);
  }

  if (report.findings && report.findings.length > 0) {
    lines.push(`| 발견사항 | ${report.findings.length}건 |`);
  }

  if (report.coverage) {
    const c = report.coverage;
    const pct = (c.coverageRatio * 100).toFixed(0);
    lines.push(`| 커버리지 | ${c.visitedScreens}/${c.totalScreens} (${pct}%) |`);
  }

  lines.push(``);
  return lines.join("\n");
}

/**
 * 시나리오 결과 섹션 (스텝 표 + expected/actual 컬럼)
 */
export function buildScenarioResultSection(
  steps: E2eReport["steps"]
): string {
  if (steps.length === 0) {
    return `## 스텝 목록\n\n(스텝 없음)\n\n`;
  }

  const lines: string[] = [
    `## 스텝 목록`,
    ``,
    `| # | 설명 | 상태 | 스크린샷 | expected | actual | 메모 |`,
    `|---|---|---|---|---|---|---|`,
  ];

  for (const step of steps) {
    const statusIcon =
      step.status === "pass" ? "✓" :
      step.status === "fail" ? "✗" : "-";
    const screenshot = step.screenshot ? escapeMarkdownCell(step.screenshot) : "-";
    const expected = step.expected ? escapeMarkdownCell(step.expected) : "-";
    const actual = step.actual ? escapeMarkdownCell(step.actual) : "-";
    const note = step.note ? escapeMarkdownCell(step.note) : "-";
    const desc = escapeMarkdownCell(step.description);
    lines.push(
      `| ${step.index} | ${desc} | ${statusIcon} ${step.status} | ${screenshot} | ${expected} | ${actual} | ${note} |`
    );
  }

  lines.push(``);
  return lines.join("\n");
}

/**
 * 발견사항 섹션 (severity 정렬 critical→major→minor, category 그룹, 스크린샷 임베드)
 */
export function buildFindingsSection(
  findings: Finding[] | undefined,
  screenshotsDir: string
): string {
  if (!findings || findings.length === 0) return "";

  const sorted = [...findings].sort(
    (a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  );

  const lines: string[] = [`## 발견사항`, ``];

  for (const f of sorted) {
    lines.push(`### [${f.severity.toUpperCase()}] ${escapeMarkdownCell(f.description)}`);
    lines.push(``);
    lines.push(`- **카테고리**: ${f.category}`);
    lines.push(`- **ID**: ${f.id}`);
    if (f.screenId) {
      lines.push(`- **화면**: ${escapeMarkdownCell(f.screenId)}`);
    }
    if (f.reproSteps && f.reproSteps.length > 0) {
      lines.push(`- **재현 단계**:`);
      for (const step of f.reproSteps) {
        lines.push(`  - ${escapeMarkdownCell(step)}`);
      }
    }
    // 스크린샷 임베드 — sanitize 통과분만
    if (f.evidence) {
      const safe = sanitizeScreenshotPath(screenshotsDir, f.evidence);
      if (safe !== null) {
        lines.push(``);
        lines.push(`![](screenshots/${f.evidence})`);
      }
    }
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * 커버리지 섹션 (N/M %, 미방문 목록)
 */
export function buildCoverageSection(coverage: Coverage | undefined): string {
  if (!coverage) return "";

  const pct = (coverage.coverageRatio * 100).toFixed(1);
  const lines: string[] = [
    `## 커버리지`,
    ``,
    `방문 화면: **${coverage.visitedScreens} / ${coverage.totalScreens}** (${pct}%)`,
    ``,
  ];

  if (coverage.unvisitedScreenIds.length > 0) {
    lines.push(`### 미방문 화면`);
    lines.push(``);
    for (const id of coverage.unvisitedScreenIds) {
      lines.push(`- ${escapeMarkdownCell(id)}`);
    }
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * 코드 펜스(```) 안에 삽입될 텍스트에서 ``` 연속을 무해한 문자로 치환한다.
 * 백틱 3개 이상 연속을 "ʼʼʼ" (U+02BC MODIFIER LETTER APOSTROPHE)로 교체해 펜스 탈출을 방지한다.
 */
function escapeCodeFence(text: string): string {
  return text.replace(/`{3,}/g, "ʼʼʼ");
}

/**
 * 크래시 섹션 (type·발췌 — 코드 블록)
 * excerpt 내 ``` 3개 이상 연속을 치환해 코드 펜스 탈출을 방지한다.
 */
export function buildCrashesSection(crashes: CrashEvent[] | undefined): string {
  if (!crashes || crashes.length === 0) return "";

  const lines: string[] = [`## 크래시 감지`, ``];

  for (let i = 0; i < crashes.length; i++) {
    const c = crashes[i]!;
    lines.push(`### 크래시 ${i + 1}: ${c.type}`);
    if (c.appId) lines.push(`- **앱**: ${c.appId}`);
    if (c.timestamp) lines.push(`- **시각**: ${c.timestamp}`);
    lines.push(``);
    lines.push("```");
    lines.push(escapeCodeFence(c.excerpt));
    lines.push("```");
    lines.push(``);
  }

  return lines.join("\n");
}

/**
 * 녹화 섹션 (videos 링크)
 * 링크 URL을 `videos/<basename>` 형태로 강제 — 절대경로·`..` 차단 (basename만 사용).
 */
export function buildVideosSection(videos: string[] | undefined): string {
  if (!videos || videos.length === 0) return "";

  const lines: string[] = [`## 녹화 영상`, ``];
  for (const v of videos) {
    const basename = path.basename(v);
    lines.push(`- [${basename}](videos/${basename})`);
  }
  lines.push(``);
  return lines.join("\n");
}

/**
 * 품질 경고 섹션
 */
export function buildQualityWarningsSection(
  warnings: string[] | undefined
): string {
  if (!warnings || warnings.length === 0) return "";

  const lines: string[] = [`## 품질 경고`, ``];
  for (const w of warnings) {
    lines.push(`- ${escapeMarkdownCell(w)}`);
  }
  lines.push(``);
  return lines.join("\n");
}

// ── writeReport ────────────────────────────────────────────────────

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
  const sections: string[] = [];

  // 1. 요약
  sections.push(buildSummarySection(report));

  // 2. 시나리오 결과
  sections.push(buildScenarioResultSection(report.steps));

  // 3. 발견사항
  const findingsSection = buildFindingsSection(report.findings, report.screenshotsDir);
  if (findingsSection) sections.push(findingsSection);

  // 4. 커버리지
  const coverageSection = buildCoverageSection(report.coverage);
  if (coverageSection) sections.push(coverageSection);

  // 5. 크래시
  const crashesSection = buildCrashesSection(report.crashes);
  if (crashesSection) sections.push(crashesSection);

  // 6. 녹화
  const videosSection = buildVideosSection(report.videos);
  if (videosSection) sections.push(videosSection);

  // 7. 품질 경고
  const warningsSection = buildQualityWarningsSection(report.qualityWarnings);
  if (warningsSection) sections.push(warningsSection);

  // 8. 에러 정보 (기존 v1 호환)
  if (report.errorCode) {
    const errLines = [`## 에러 정보`, ``, `- 코드: \`${report.errorCode}\``];
    if (report.errorMessage) {
      errLines.push(`- 메시지: ${escapeMarkdownCell(report.errorMessage)}`);
    }
    sections.push(errLines.join("\n") + "\n");
  }

  return sections.join("\n");
}
