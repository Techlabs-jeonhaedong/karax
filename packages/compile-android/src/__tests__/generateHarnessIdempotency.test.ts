/**
 * generateHarness 멱등성 테스트 (중간-8 회귀)
 *
 * 동일 workDir hash로 재실행 시 이전 소스가 혼입되지 않고
 * 최신 소스가 항상 반영되는지 검증한다.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateHarness } from "../harness/generator.js";

const TMP_ROOTS: string[] = [];

function makeFakeProject(dir: string, screenContent: string): void {
  const kotlinSrc = path.join(dir, "app", "src", "main", "kotlin");
  fs.mkdirSync(kotlinSrc, { recursive: true });
  fs.writeFileSync(path.join(kotlinSrc, "HomeScreen.kt"), screenContent, "utf-8");

  // gradlew stub
  fs.writeFileSync(path.join(dir, "gradlew"), "#!/bin/sh\necho stub", "utf-8");
  fs.writeFileSync(path.join(dir, "gradlew.bat"), "@echo stub", "utf-8");
}

afterEach(() => {
  for (const d of TMP_ROOTS) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  TMP_ROOTS.length = 0;
});

describe("generateHarness — 멱등성 (중간-8 회귀)", () => {
  it("재실행 시 최신 소스가 반영됨 (구버전 잔존 없음)", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-android-proj-"));
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-android-work-"));
    TMP_ROOTS.push(projectDir, workDir);

    const screen = {
      id: "HomeScreen",
      title: "Home",
      discovery: "route" as const,
      confidence: 1.0,
    };

    // 1차: "version=1" 내용으로 하니스 생성
    makeFakeProject(projectDir, "// version=1\nclass HomeScreen {}");
    await generateHarness({
      projectPath: projectDir,
      screen,
      device: "iphone-15",
      mockSeed: 0,
      workDir,
    });

    // 2차: "version=2"로 소스 변경 후 동일 workDir로 재실행
    const kotlinSrc = path.join(projectDir, "app", "src", "main", "kotlin");
    fs.writeFileSync(path.join(kotlinSrc, "HomeScreen.kt"), "// version=2\nclass HomeScreen {}", "utf-8");

    await generateHarness({
      projectPath: projectDir,
      screen,
      device: "iphone-15",
      mockSeed: 0,
      workDir,
    });

    // workDir 내 복사된 소스에 "version=2"가 반영돼야 한다
    const copiedKt = path.join(workDir, "app", "src", "main", "kotlin", "HomeScreen.kt");
    expect(fs.existsSync(copiedKt)).toBe(true);
    const content = fs.readFileSync(copiedKt, "utf-8");
    expect(content).toContain("version=2");
    expect(content).not.toContain("version=1");
  });

  it("최초 실행 시 workDir이 생성됨", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-android-proj2-"));
    const workDir = path.join(os.tmpdir(), `sfc-android-new-${Date.now()}`);
    TMP_ROOTS.push(projectDir, workDir);

    makeFakeProject(projectDir, "class HomeScreen {}");

    const screen = {
      id: "HomeScreen",
      title: "Home",
      discovery: "route" as const,
      confidence: 1.0,
    };

    await generateHarness({
      projectPath: projectDir,
      screen,
      device: "iphone-15",
      mockSeed: 0,
      workDir,
    });

    expect(fs.existsSync(workDir)).toBe(true);
  });
});
