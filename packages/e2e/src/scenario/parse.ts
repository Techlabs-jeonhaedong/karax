/**
 * scenario/parse.ts — 마크다운 시나리오 파서
 *
 * 선택적 YAML frontmatter(appId, platform) + body 통과
 */

import type { Platform } from "../types.js";

export interface ParsedScenario {
  appId?: string;
  platform?: Platform;
  body: string;
  exploratory: boolean;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)(\r?\n)?---(\r?\n|$)/;

/**
 * 마크다운 시나리오를 파싱한다.
 * frontmatter 없음 또는 파싱 실패 → exploratory: true
 */
export function parseScenario(content: string): ParsedScenario {
  if (!content) {
    return { body: "", exploratory: true };
  }

  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) {
    return { body: content, exploratory: true };
  }

  const frontmatterStr = match[1]!;
  const body = content.slice(match[0].length);

  const parsed = parseYamlFrontmatter(frontmatterStr);

  return {
    appId: parsed.appId,
    platform: parsed.platform as Platform | undefined,
    body: "\n" + body,
    exploratory: false,
  };
}

/** 간단한 YAML 파서 (appId/platform 키만 지원) */
function parseYamlFrontmatter(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}
