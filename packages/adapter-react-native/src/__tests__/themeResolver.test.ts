import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { resolveTheme } from "../ir/themeResolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../..", "fixtures/react-native-basic");

describe("themeResolver — src/theme.ts 파싱", () => {
  it("colors 토큰을 파싱한다", async () => {
    const result = await resolveTheme(FIXTURE_PATH);
    expect(result.colors["primary"]).toBe("#6200EE");
    expect(result.colors["secondary"]).toBe("#03DAC6");
    expect(result.colors["error"]).toBe("#B00020");
    expect(result.colors["surface"]).toBe("#FFFFFF");
  });

  it("spacing 토큰을 파싱한다", async () => {
    const result = await resolveTheme(FIXTURE_PATH);
    expect(result.spacing["xs"]).toBe(4);
    expect(result.spacing["sm"]).toBe(8);
    expect(result.spacing["md"]).toBe(16);
  });

  it("typography 토큰을 파싱한다", async () => {
    const result = await resolveTheme(FIXTURE_PATH);
    expect(result.typography["h1"]).toBeDefined();
    expect(result.typography["body1"]).toBeDefined();
  });

  it("diagnostics가 비어있다 (테마 정상 파싱)", async () => {
    const result = await resolveTheme(FIXTURE_PATH);
    const themeErrors = result.diagnostics.filter(d => d.code === "THEME_DEFAULTED");
    expect(themeErrors).toHaveLength(0);
  });

  it("테마 파일 없는 경우 THEME_DEFAULTED 진단 반환", async () => {
    const noThemeFixture = path.resolve(__dirname, "fixtures/empty-src");
    const result = await resolveTheme(noThemeFixture);
    expect(result.diagnostics.some(d => d.code === "THEME_DEFAULTED")).toBe(true);
    expect(result.colors).toEqual({});
  });
});
