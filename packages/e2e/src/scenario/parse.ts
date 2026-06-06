/**
 * scenario/parse.ts — 마크다운 시나리오 파서 v2
 *
 * 하위호환 유지:
 *   - frontmatter 없음 → exploratory: true
 *   - frontmatter 있음 → exploratory: false (mode 명시 없는 경우)
 *   - mode 명시 시 명시값 우선
 *   - 기존 8개 테스트 무수정 통과
 *
 * v2 신규:
 *   - yaml 패키지로 YAML 파싱 (안전한 기본 스키마)
 *   - title / mode / preconditions / testData / steps / permissions 지원
 *   - {{SECRET:NAME}} 플레이스홀더 해석 없이 보존
 *   - 알 수 없는 키 무시 (미래 호환)
 *   - YAML 파싱 실패 → exploratory: true (graceful 폴백)
 */

import { parse as parseYaml } from "yaml";
import type { Platform } from "../types.js";
import { ScenarioFrontmatterSchema } from "./schema.js";
import type { ScenarioStep } from "./schema.js";

export type { ScenarioStep };

export interface ParsedScenario {
  appId?: string;
  platform?: Platform;
  body: string;
  exploratory: boolean;
  // v2 신규 필드 (전부 optional)
  title?: string;
  mode?: "scenario" | "exploratory";
  preconditions?: string[];
  testData?: Record<string, string>;
  steps?: ScenarioStep[];
  permissions?: string[];
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

  // YAML 파싱 — 실패 시 graceful 폴백
  let frontmatter: ReturnType<typeof ScenarioFrontmatterSchema.safeParse>["data"];
  try {
    const raw = parseYaml(frontmatterStr, { schema: "failsafe" }) as unknown;
    // null / 빈 문서 허용 (빈 frontmatter)
    if (raw === null || raw === undefined) {
      frontmatter = {};
    } else if (typeof raw !== "object" || Array.isArray(raw)) {
      // 스칼라나 배열이 최상위인 경우 → 파싱 실패로 취급
      return { body: content, exploratory: true };
    } else {
      const parsed = ScenarioFrontmatterSchema.safeParse(raw);
      if (parsed.success) {
        frontmatter = parsed.data;
      } else {
        // zod 검증 실패 — known 필드만 pick해서 최대한 구조 보존
        frontmatter = pickKnownFields(raw as Record<string, unknown>);
      }
    }
  } catch {
    // YAML 파싱 자체 실패 → exploratory 폴백
    return { body: content, exploratory: true };
  }

  // mode 우선순위: frontmatter에 mode 명시 → 그대로
  // 미명시 → 기존 추론(frontmatter 있으면 scenario, 없으면 exploratory)
  const explicitMode = frontmatter?.mode;
  const exploratory = explicitMode === "exploratory" ? true : explicitMode === "scenario" ? false : false;

  return {
    appId: frontmatter?.appId,
    platform: frontmatter?.platform as Platform | undefined,
    body: "\n" + body,
    exploratory,
    ...(frontmatter?.title !== undefined ? { title: frontmatter.title } : {}),
    ...(explicitMode !== undefined ? { mode: explicitMode } : {}),
    ...(frontmatter?.preconditions !== undefined ? { preconditions: frontmatter.preconditions } : {}),
    ...(frontmatter?.testData !== undefined ? { testData: frontmatter.testData } : {}),
    ...(frontmatter?.steps !== undefined ? { steps: frontmatter.steps } : {}),
    ...(frontmatter?.permissions !== undefined ? { permissions: frontmatter.permissions } : {}),
  };
}

/**
 * zod 검증 실패 시 known 필드만 안전하게 pick한다.
 * 빈 action step 등 일부 필드 검증 실패 케이스를 최대한 처리.
 */
function pickKnownFields(raw: Record<string, unknown>): {
  appId?: string;
  platform?: "android" | "ios";
  title?: string;
  mode?: "scenario" | "exploratory";
  preconditions?: string[];
  testData?: Record<string, string>;
  steps?: ScenarioStep[];
  permissions?: string[];
} {
  const result: ReturnType<typeof pickKnownFields> = {};

  if (typeof raw.appId === "string") result.appId = raw.appId;
  if (raw.platform === "android" || raw.platform === "ios") result.platform = raw.platform;
  if (typeof raw.title === "string") result.title = raw.title;
  if (raw.mode === "scenario" || raw.mode === "exploratory") result.mode = raw.mode;

  if (Array.isArray(raw.preconditions)) {
    result.preconditions = raw.preconditions.filter((x): x is string => typeof x === "string");
  }

  if (raw.testData !== null && typeof raw.testData === "object" && !Array.isArray(raw.testData)) {
    const td: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.testData as Record<string, unknown>)) {
      if (typeof v === "string") td[k] = v;
    }
    result.testData = td;
  }

  if (Array.isArray(raw.steps)) {
    const validSteps = raw.steps
      .filter((s): s is Record<string, unknown> => s !== null && typeof s === "object" && !Array.isArray(s))
      .map((s) => {
        const action = typeof s.action === "string" ? s.action.trim() : "";
        const expect = typeof s.expect === "string" ? s.expect : undefined;
        return action.length > 0 ? { action, ...(expect !== undefined ? { expect } : {}) } : null;
      })
      .filter((s): s is ScenarioStep => s !== null);
    if (validSteps.length > 0) result.steps = validSteps;
  }

  if (Array.isArray(raw.permissions)) {
    result.permissions = raw.permissions.filter((x): x is string => typeof x === "string");
  }

  return result;
}
