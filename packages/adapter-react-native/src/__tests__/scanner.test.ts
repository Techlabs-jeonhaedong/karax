import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { buildSymbolTable, collectTsxFiles } from "../parse/scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../..", "fixtures/react-native-basic");

describe("scanner — TSX 파일 수집", () => {
  it("react-native-basic fixture의 TSX 파일을 수집한다", async () => {
    const files = await collectTsxFiles(FIXTURE_PATH);
    // App.tsx + 5 screens + 2 components + theme.ts = 9개 이상
    expect(files.length).toBeGreaterThanOrEqual(9);
    // node_modules 제외
    expect(files.every(f => !f.includes("node_modules"))).toBe(true);
    // ios/android 제외
    expect(files.every(f => !f.includes("/ios/") && !f.includes("/android/"))).toBe(true);
  });

  it("심볼 테이블에 모든 화면 컴포넌트가 등록된다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    expect(table.components.has("HomeScreen")).toBe(true);
    expect(table.components.has("DetailScreen")).toBe(true);
    expect(table.components.has("ListScreen")).toBe(true);
    expect(table.components.has("SettingsScreen")).toBe(true);
    expect(table.components.has("OrphanScreen")).toBe(true);
  });

  it("커스텀 컴포넌트도 심볼 테이블에 등록된다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    expect(table.components.has("ProductCard")).toBe(true);
    expect(table.components.has("PriceTag")).toBe(true);
  });

  it("fileByComponent 맵이 올바르게 구성된다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    const homeFile = table.fileByComponent.get("HomeScreen");
    expect(homeFile).toBeDefined();
    expect(homeFile!.filePath).toContain("HomeScreen");
  });

  it("빈 src 폴더에서도 오류 없이 동작한다", async () => {
    const emptyFixture = path.resolve(__dirname, "fixtures/empty-src");
    const table = await buildSymbolTable(emptyFixture);
    expect(table.components.size).toBeGreaterThanOrEqual(0);
  });
});
