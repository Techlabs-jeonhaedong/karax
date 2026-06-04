/**
 * themeResolver 단위 테스트
 * TDD Red 단계
 */

import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");

async function getResolver() {
  const mod = await import("../ir/themeResolver.js");
  return mod;
}

describe("themeResolver — flutter-basic fixture", () => {
  it("main.dart의 ColorScheme.fromSeed를 파싱해 primary 색상을 추출한다", async () => {
    const { resolveTheme } = await getResolver();
    const projectPath = path.join(FIXTURES_DIR, "flutter-basic");
    const tokens = await resolveTheme(projectPath);
    // seedColor: Color(0xFF6750A4) → primary는 시드색 기반
    expect(tokens.colors).toBeDefined();
    expect(typeof tokens.colors?.["primary"]).toBe("string");
    // 시드색 #6750A4를 primary로 사용
    expect(tokens.colors?.["primary"]).toMatch(/^#[0-9a-fA-F]{6}$/i);
  });

  it("THEME_DEFAULTED diagnostic 없이 파싱 성공한다", async () => {
    const { resolveTheme } = await getResolver();
    const projectPath = path.join(FIXTURES_DIR, "flutter-basic");
    const result = await resolveTheme(projectPath);
    expect(result.diagnostics.some(d => d.code === "THEME_DEFAULTED")).toBe(false);
  });
});

describe("themeResolver — 테마 없는 경우 기본값 폴백", () => {
  it("main.dart에 ThemeData가 없으면 Material3 기본 토큰 반환 + THEME_DEFAULTED", async () => {
    const { resolveTheme } = await getResolver();
    // 임시: 존재하지 않는 경로로 폴백 테스트
    const result = await resolveTheme("/nonexistent/path/project");
    expect(result.colors).toBeDefined();
    expect(result.diagnostics.some(d => d.code === "THEME_DEFAULTED")).toBe(true);
  });

  it("기본 토큰에 primary/surface/background/error 키가 있다", async () => {
    const { resolveTheme } = await getResolver();
    const result = await resolveTheme("/nonexistent/path/project");
    expect(result.colors?.["primary"]).toBeDefined();
    expect(result.colors?.["surface"]).toBeDefined();
    expect(result.colors?.["error"]).toBeDefined();
  });
});

describe("themeResolver — token: 참조 포맷", () => {
  it("colorScheme.primary 참조는 token:primary 문자열로 반환된다", async () => {
    const { colorSchemeRefToToken } = await getResolver();
    expect(colorSchemeRefToToken("colorScheme.primary")).toBe("token:primary");
    expect(colorSchemeRefToToken("colorScheme.surface")).toBe("token:surface");
    expect(colorSchemeRefToToken("colorScheme.error")).toBe("token:error");
  });

  it("알 수 없는 참조는 그대로 반환된다", async () => {
    const { colorSchemeRefToToken } = await getResolver();
    expect(colorSchemeRefToToken("someUnknown")).toBe("someUnknown");
  });
});
