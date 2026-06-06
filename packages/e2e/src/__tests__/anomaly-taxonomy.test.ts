/**
 * anomaly/taxonomy.ts 단위 테스트
 *
 * - 카테고리 enum과 TAXONOMY 키 일치 (드리프트 가드)
 * - 모든 엔트리에 description / defaultSeverity / checklistHint 존재
 * - SEVERITIES enum 검증
 */

import { describe, it, expect } from "vitest";
import {
  ANOMALY_CATEGORIES,
  SEVERITIES,
  TAXONOMY,
} from "../anomaly/taxonomy.js";
import type { AnomalyCategory, Severity, TaxonomyEntry } from "../anomaly/taxonomy.js";

describe("ANOMALY_CATEGORIES", () => {
  it("배열이며 비어있지 않다", () => {
    expect(Array.isArray(ANOMALY_CATEGORIES)).toBe(true);
    expect(ANOMALY_CATEGORIES.length).toBeGreaterThan(0);
  });

  it("필수 카테고리 10종이 모두 포함된다", () => {
    const required = [
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
    for (const cat of required) {
      expect(ANOMALY_CATEGORIES).toContain(cat);
    }
  });
});

describe("SEVERITIES", () => {
  it("critical / major / minor 세 값이 있다", () => {
    expect(SEVERITIES).toContain("critical");
    expect(SEVERITIES).toContain("major");
    expect(SEVERITIES).toContain("minor");
    expect(SEVERITIES.length).toBe(3);
  });
});

describe("TAXONOMY 드리프트 가드", () => {
  it("TAXONOMY의 키 집합과 ANOMALY_CATEGORIES 집합이 정확히 일치한다", () => {
    const taxonomyKeys = new Set(Object.keys(TAXONOMY));
    const categorySet = new Set(ANOMALY_CATEGORIES as readonly string[]);
    expect(taxonomyKeys).toEqual(categorySet);
  });

  it("ANOMALY_CATEGORIES의 모든 항목이 TAXONOMY에 있다", () => {
    for (const cat of ANOMALY_CATEGORIES) {
      expect(TAXONOMY).toHaveProperty(cat);
    }
  });
});

describe("TAXONOMY 엔트리 완전성", () => {
  it("모든 엔트리에 description 문자열이 있다", () => {
    for (const [cat, entry] of Object.entries(TAXONOMY)) {
      expect(typeof (entry as TaxonomyEntry).description).toBe("string");
      expect((entry as TaxonomyEntry).description.length).toBeGreaterThan(0);
    }
  });

  it("모든 엔트리에 defaultSeverity가 SEVERITIES 범위 안에 있다", () => {
    for (const [cat, entry] of Object.entries(TAXONOMY)) {
      expect(SEVERITIES as readonly string[]).toContain((entry as TaxonomyEntry).defaultSeverity);
    }
  });

  it("모든 엔트리에 checklistHint 문자열이 있다", () => {
    for (const [cat, entry] of Object.entries(TAXONOMY)) {
      expect(typeof (entry as TaxonomyEntry).checklistHint).toBe("string");
      expect((entry as TaxonomyEntry).checklistHint.length).toBeGreaterThan(0);
    }
  });

  it("crash 카테고리의 defaultSeverity는 critical이다", () => {
    expect(TAXONOMY["crash"].defaultSeverity).toBe("critical");
  });

  it("layout-overflow 카테고리의 defaultSeverity는 major이다", () => {
    expect(TAXONOMY["layout-overflow"].defaultSeverity).toBe("major");
  });

  it("other 카테고리의 defaultSeverity는 minor이다", () => {
    expect(TAXONOMY["other"].defaultSeverity).toBe("minor");
  });
});

describe("타입 안전성", () => {
  it("AnomalyCategory 타입이 컴파일 시 사용 가능하다 (타입 guard)", () => {
    const testCategory: AnomalyCategory = "crash";
    expect(ANOMALY_CATEGORIES as readonly string[]).toContain(testCategory);
  });

  it("Severity 타입이 컴파일 시 사용 가능하다 (타입 guard)", () => {
    const testSeverity: Severity = "major";
    expect(SEVERITIES as readonly string[]).toContain(testSeverity);
  });
});
