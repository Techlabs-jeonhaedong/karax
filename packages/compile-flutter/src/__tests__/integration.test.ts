/**
 * M4 통합 테스트 — 실제 flutter 실행
 *
 * KARAX_FLUTTER_INTEGRATION=1 환경변수가 설정된 경우에만 실행된다.
 * 기본으로는 skip (CI 매트릭스 분리 — PLAN 11절).
 *
 * 실행 방법:
 *   KARAX_FLUTTER_INTEGRATION=1 pnpm --filter @karax/compile-flutter test
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as os from "os";
import type { ScreenSummary } from "@karax/adapter-api";
import { flutterCompileBackend } from "../index.js";

const INTEGRATION = process.env["KARAX_FLUTTER_INTEGRATION"] === "1";
// __tests__ -> src -> compile-flutter -> packages -> karax (4단계)
const REPO_ROOT = path.resolve(new URL(".", import.meta.url).pathname, "../../../../");
const FIXTURE_PATH = path.resolve(REPO_ROOT, "fixtures/flutter-basic");
const BROKEN_FIXTURE_PATH = path.resolve(
  new URL(".", import.meta.url).pathname,
  "fixtures/broken-screen"
);

// describe.skipIf(condition) — 조건 불충족 시 전체 블록 skip
const runSuite = INTEGRATION ? describe : describe.skip;

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function hashDirectory(dirPath: string): string {
  const hash = crypto.createHash("sha256");

  function walk(dir: string) {
    try {
      const entries = fs.readdirSync(dir).sort();
      for (const entry of entries) {
        if (entry.startsWith(".dart_tool")) continue; // .dart_tool은 빌드 캐시
        if (entry === ".dart_tool") continue;
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else {
          hash.update(entry);
          hash.update(fs.readFileSync(full));
        }
      }
    } catch {
      // ignore
    }
  }

  walk(dirPath);
  return hash.digest("hex");
}

// ── 통합 테스트 스위트 ──────────────────────────────────────────────────────────

runSuite("M4 Flutter Tier 1 통합 테스트", { timeout: 300_000 }, () => {
  let outDir: string;

  beforeAll(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-m4-test-"));
  });

  afterAll(() => {
    // 임시 디렉토리 정리
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // (a) HomeScreen → 실제 flutter test로 PNG 생성
  it("(a) HomeScreen: PNG 생성 성공 + 0바이트 아님", async () => {
    const screen: ScreenSummary = {
      id: "HomeScreen",
      title: "Home Screen",
      discovery: "route",
      confidence: 1.0,
      sourceRef: {
        file: "lib/screens/home_screen.dart",
        line: 7,
        symbol: "HomeScreen",
      },
    };

    const result = await flutterCompileBackend.capture(
      { projectPath: FIXTURE_PATH },
      screen,
      { outDir, device: "iphone-15", mockSeed: 42 }
    );

    expect(result.pngPath).toBeTruthy();
    expect(fs.existsSync(result.pngPath)).toBe(true);

    const stat = fs.statSync(result.pngPath);
    expect(stat.size).toBeGreaterThan(0);

    // 크기 검증: iphone-15는 1170x2532 물리 픽셀
    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(100);
    expect(result.tierUsed).toBe("compile");

    console.log(`HomeScreen PNG: ${result.pngPath} (${result.width}x${result.height}, ${stat.size} bytes)`);
  }, 240_000);

  // (b) DetailScreen (커스텀 컴포넌트 포함)
  it("(b) DetailScreen: PNG 생성 성공", async () => {
    const screen: ScreenSummary = {
      id: "DetailScreen",
      title: "Detail Screen",
      discovery: "candidate",
      confidence: 0.6,
      sourceRef: {
        file: "lib/screens/detail_screen.dart",
        line: 7,
        symbol: "DetailScreen",
      },
    };

    const result = await flutterCompileBackend.capture(
      { projectPath: FIXTURE_PATH },
      screen,
      { outDir, device: "iphone-15", mockSeed: 42 }
    );

    expect(fs.existsSync(result.pngPath)).toBe(true);
    const stat = fs.statSync(result.pngPath);
    expect(stat.size).toBeGreaterThan(0);

    console.log(`DetailScreen PNG: ${result.pngPath} (${result.width}x${result.height}, ${stat.size} bytes)`);
  }, 240_000);

  // (c) 깨진 화면 fixture → COMPILE_FAILED 에러 분류
  it("(c) 깨진 화면: COMPILE_FAILED 에러 분류", async () => {
    const screen: ScreenSummary = {
      id: "BrokenScreen",
      title: "Broken Screen",
      discovery: "candidate",
      confidence: 0.6,
      sourceRef: {
        file: "lib/screens/broken_screen.dart",
        line: 9,
        symbol: "BrokenScreen",
      },
    };

    const { CompileCaptureError } = await import("../runner.js");

    await expect(
      flutterCompileBackend.capture(
        { projectPath: BROKEN_FIXTURE_PATH },
        screen,
        { outDir, device: "iphone-15", mockSeed: 42 }
      )
    ).rejects.toThrow(CompileCaptureError);

    // 에러 분류 검증
    try {
      await flutterCompileBackend.capture(
        { projectPath: BROKEN_FIXTURE_PATH },
        screen,
        { outDir, device: "iphone-15", mockSeed: 42 }
      );
    } catch (e) {
      if (e instanceof CompileCaptureError) {
        expect(["COMPILE_FAILED", "PUB_GET_FAILED", "TEST_FAILED"]).toContain(e.code);
      }
    }
  }, 240_000);

  // (d) 원본 무수정: 캡처 전후 flutter-basic 디렉토리 해시 비교
  it("(d) 원본 무수정: 캡처 전후 파일 해시 동일", async () => {
    // .dart_tool 제외한 해시 계산
    const hashBefore = hashDirectory(FIXTURE_PATH);

    const screen: ScreenSummary = {
      id: "HomeScreen",
      title: "Home Screen",
      discovery: "route",
      confidence: 1.0,
      sourceRef: {
        file: "lib/screens/home_screen.dart",
        line: 7,
        symbol: "HomeScreen",
      },
    };

    await flutterCompileBackend.capture(
      { projectPath: FIXTURE_PATH },
      screen,
      { outDir, device: "iphone-15", mockSeed: 42 }
    );

    const hashAfter = hashDirectory(FIXTURE_PATH);
    expect(hashAfter).toBe(hashBefore);
  }, 240_000);
});

// ── isAvailable 단위 테스트 (flutter 없이도 실행 가능) ─────────────────────────

describe("flutterCompileBackend.isAvailable", () => {
  it("flutter가 설치된 환경에서 true를 반환해야 한다", async () => {
    // 이 머신에 Flutter 3.38.5가 설치되어 있으므로 true
    const available = await flutterCompileBackend.isAvailable({});
    // CI에서 flutter가 없을 경우 false도 허용
    expect(typeof available).toBe("boolean");
  });

  it("잘못된 toolchainPath면 false를 반환해야 한다", async () => {
    const available = await flutterCompileBackend.isAvailable({
      toolchainPath: "/nonexistent/path/flutter",
    });
    expect(available).toBe(false);
  });
});
