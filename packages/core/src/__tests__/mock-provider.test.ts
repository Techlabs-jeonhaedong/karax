import { describe, expect, it } from "vitest";
import { createMockProvider } from "../mock/provider.js";

// ── 결정론 테스트 ───────────────────────────────────────────────────

describe("createMockProvider — 결정론성", () => {
  it("같은 seed + 같은 호출 순서 → 같은 출력", () => {
    const p1 = createMockProvider(42);
    const p2 = createMockProvider(42);
    expect(p1.text()).toBe(p2.text());
    expect(p1.text()).toBe(p2.text());
    expect(p1.integer()).toBe(p2.integer());
    expect(p1.boolean()).toBe(p2.boolean());
  });

  it("seed가 다르면 출력이 달라질 수 있음 (확률적으로 다름)", () => {
    const p1 = createMockProvider(1);
    const p2 = createMockProvider(999);
    // 10번 중 적어도 하나는 달라야 함
    const results1 = Array.from({ length: 10 }, () => p1.text());
    const results2 = Array.from({ length: 10 }, () => p2.text());
    const allSame = results1.every((v, i) => v === results2[i]);
    expect(allSame).toBe(false);
  });

  it("seed 없으면 기본 42를 사용 — 두 인스턴스가 일치", () => {
    const p1 = createMockProvider();
    const p2 = createMockProvider();
    expect(p1.text()).toBe(p2.text());
    expect(p1.integer()).toBe(p2.integer());
  });

  it("호출 순서가 다르면 결과가 달라짐", () => {
    const p1 = createMockProvider(42);
    const p2 = createMockProvider(42);
    const first = p1.text();
    p1.integer(); // 중간에 다른 호출 삽입
    const afterInt = p1.text();
    const directSecond = p2.text(); // p2는 integer 없이 바로 text
    const p2Second = p2.text();
    // first === directSecond (같은 호출 순서), afterInt !== p2Second
    expect(first).toBe(directSecond);
    expect(afterInt).not.toBe(p2Second);
  });
});

// ── text() 힌트 매칭 ──────────────────────────────────────────────

describe("createMockProvider — text()", () => {
  it("힌트 없으면 lorem 단어 2-4개 반환", () => {
    const p = createMockProvider(42);
    const result = p.text();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    const words = result.split(" ");
    expect(words.length).toBeGreaterThanOrEqual(2);
    expect(words.length).toBeLessThanOrEqual(4);
  });

  it("name 힌트 → 사람이름 형태", () => {
    const p = createMockProvider(42);
    const result = p.text("name");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    // 단일 단어 또는 성+이름 형태 (공백 포함 가능)
    expect(result.trim()).not.toBe("");
  });

  it("userName 힌트 → name 매칭 (부분 문자열 + 대소문자 무시)", () => {
    const p1 = createMockProvider(42);
    const p2 = createMockProvider(42);
    const r1 = p1.text("userName");
    const r2 = p2.text("name");
    // 둘 다 name 카테고리에서 나와야 함
    expect(r1).toBe(r2);
  });

  it("TITLE 힌트 → 대소문자 무시 매칭", () => {
    const p1 = createMockProvider(42);
    const p2 = createMockProvider(42);
    const r1 = p1.text("TITLE");
    const r2 = p2.text("title");
    expect(r1).toBe(r2);
  });

  it("email 힌트 → @가 포함된 이메일 형태", () => {
    const p = createMockProvider(42);
    const result = p.text("email");
    expect(result).toContain("@");
  });

  it("userEmail 힌트 → email 매칭", () => {
    const p = createMockProvider(42);
    const result = p.text("userEmail");
    expect(result).toContain("@");
  });

  it("price 힌트 → 금액 형태", () => {
    const p = createMockProvider(42);
    const result = p.text("price");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("amount 힌트 → 금액 형태", () => {
    const p = createMockProvider(42);
    const result = p.text("amount");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("description 힌트 → 문장 형태 (여러 단어)", () => {
    const p = createMockProvider(42);
    const result = p.text("description");
    expect(typeof result).toBe("string");
    const words = result.split(" ");
    expect(words.length).toBeGreaterThanOrEqual(3);
  });

  it("subtitle 힌트 → 문장 형태", () => {
    const p = createMockProvider(42);
    const result = p.text("subtitle");
    expect(typeof result).toBe("string");
    const words = result.split(" ");
    expect(words.length).toBeGreaterThanOrEqual(3);
  });

  it("date 힌트 → 날짜 형태 문자열", () => {
    const p = createMockProvider(42);
    const result = p.text("date");
    expect(typeof result).toBe("string");
    // YYYY-MM-DD 또는 슬래시 형태
    expect(result).toMatch(/\d{4}[-/]\d{2}[-/]\d{2}/);
  });

  it("createdAt 힌트 → date 매칭", () => {
    const p1 = createMockProvider(42);
    const p2 = createMockProvider(42);
    const r1 = p1.text("createdAt");
    const r2 = p2.text("date");
    expect(r1).toBe(r2);
  });

  it("title 힌트 → 짧은 제목 형태", () => {
    const p = createMockProvider(42);
    const result = p.text("title");
    expect(typeof result).toBe("string");
    // 제목은 보통 1~5 단어
    const words = result.split(" ");
    expect(words.length).toBeGreaterThanOrEqual(1);
    expect(words.length).toBeLessThanOrEqual(6);
  });
});

// ── integer() ─────────────────────────────────────────────────────

describe("createMockProvider — integer()", () => {
  it("기본 범위에서 정수 반환", () => {
    const p = createMockProvider(42);
    const result = p.integer();
    expect(Number.isInteger(result)).toBe(true);
  });

  it("min/max 범위 내 값 반환", () => {
    const p = createMockProvider(42);
    for (let i = 0; i < 20; i++) {
      const result = p.integer(undefined, 10, 20);
      expect(result).toBeGreaterThanOrEqual(10);
      expect(result).toBeLessThanOrEqual(20);
    }
  });

  it("min === max이면 항상 그 값 반환", () => {
    const p = createMockProvider(42);
    expect(p.integer(undefined, 5, 5)).toBe(5);
    expect(p.integer(undefined, 100, 100)).toBe(100);
  });

  it("결정론적 — 같은 seed, 같은 호출 순서", () => {
    const p1 = createMockProvider(7);
    const p2 = createMockProvider(7);
    const r1 = Array.from({ length: 5 }, () => p1.integer(undefined, 0, 100));
    const r2 = Array.from({ length: 5 }, () => p2.integer(undefined, 0, 100));
    expect(r1).toEqual(r2);
  });
});

// ── boolean() ─────────────────────────────────────────────────────

describe("createMockProvider — boolean()", () => {
  it("true 또는 false 반환", () => {
    const p = createMockProvider(42);
    const result = p.boolean();
    expect(typeof result).toBe("boolean");
  });

  it("결정론적", () => {
    const p1 = createMockProvider(42);
    const p2 = createMockProvider(42);
    const r1 = Array.from({ length: 5 }, () => p1.boolean());
    const r2 = Array.from({ length: 5 }, () => p2.boolean());
    expect(r1).toEqual(r2);
  });

  it("isActive 힌트 — boolean 반환 (힌트 무시해도 무방, 형태만 확인)", () => {
    const p = createMockProvider(42);
    expect(typeof p.boolean("isActive")).toBe("boolean");
  });
});

// ── listCount() ───────────────────────────────────────────────────

describe("createMockProvider — listCount()", () => {
  it("기본 3 반환", () => {
    const p = createMockProvider(42);
    expect(p.listCount()).toBe(3);
  });

  it("항상 양수 정수", () => {
    const p = createMockProvider(42);
    const result = p.listCount();
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });
});

// ── imageUrl() ────────────────────────────────────────────────────

describe("createMockProvider — imageUrl()", () => {
  it("문자열 반환", () => {
    const p = createMockProvider(42);
    const result = p.imageUrl();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("placeholder 식별자 포함 (placeholder 또는 이미지 관련 경로)", () => {
    const p = createMockProvider(42);
    const result = p.imageUrl();
    // placeholder 또는 URL 형태
    expect(result).toMatch(/placeholder|image|img|mock/i);
  });

  it("결정론적", () => {
    const p1 = createMockProvider(42);
    const p2 = createMockProvider(42);
    expect(p1.imageUrl()).toBe(p2.imageUrl());
  });
});

// ── color() ───────────────────────────────────────────────────────

describe("createMockProvider — color()", () => {
  it("#RRGGBB 형태 반환", () => {
    const p = createMockProvider(42);
    const result = p.color();
    expect(result).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("결정론적", () => {
    const p1 = createMockProvider(42);
    const p2 = createMockProvider(42);
    expect(p1.color()).toBe(p2.color());
  });

  it("여러 호출에서 다양한 색상 생성", () => {
    const p = createMockProvider(42);
    const colors = Array.from({ length: 10 }, () => p.color());
    const unique = new Set(colors);
    // 10개 중 적어도 3개는 달라야 함
    expect(unique.size).toBeGreaterThanOrEqual(3);
  });
});
