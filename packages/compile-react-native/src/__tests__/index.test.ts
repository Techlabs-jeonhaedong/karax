/**
 * compile-react-native 통합 테스트
 *
 * Playwright Chromium은 항상 사용 가능하므로 가드 없이 실행.
 * fixtures/react-native-basic HomeScreen·DetailScreen 실캡처 검증.
 */
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { fileURLToPath } from "url";
import { describe, expect, it, afterEach } from "vitest";
import { rnWebCompileBackend, CompileCaptureError } from "../index.js";
import type { AdapterContext, ScreenSummary } from "@karax/adapter-api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __tests__ → src → compile-react-native → packages → karax → fixtures
const FIXTURE_PATH = path.resolve(
  __dirname,
  "../../../../fixtures/react-native-basic"
);

const BASE_CTX: AdapterContext = {
  projectPath: FIXTURE_PATH,
  framework: "react-native",
  device: "pixel-8",
  mockSeed: 42,
};

// isAvailable는 esbuild 내장이라 항상 true
describe("isAvailable", () => {
  it("esbuild 내장이므로 항상 true를 반환한다", async () => {
    const available = await rnWebCompileBackend.isAvailable({});
    expect(available).toBe(true);
  });
});

// id 검증
describe("백엔드 id", () => {
  it("id가 react-native다", () => {
    expect(rnWebCompileBackend.id).toBe("react-native");
  });
});

// 실 캡처 테스트
describe("capture — 실 렌더링", () => {
  const outDirs: string[] = [];

  afterEach(() => {
    for (const d of outDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
    outDirs.length = 0;
  });

  function makeOutDir(): string {
    const d = path.join(os.tmpdir(), `karax-rn-test-${Date.now()}`);
    fs.mkdirSync(d, { recursive: true });
    outDirs.push(d);
    return d;
  }

  it("HomeScreen PNG를 생성한다 (존재·PNG 시그니처·크기 검증)", async () => {
    const outDir = makeOutDir();
    const screen: ScreenSummary = {
      id: "HomeScreen",
      discovery: "route",
      confidence: 1.0,
      sourceRef: { file: "src/screens/HomeScreen.tsx", symbol: "HomeScreen" },
    };

    const result = await rnWebCompileBackend.capture(BASE_CTX, screen, {
      outDir,
      device: "pixel-8",
      mockSeed: 42,
    });

    expect(fs.existsSync(result.pngPath)).toBe(true);
    // PNG 시그니처 검증
    const buf = Buffer.alloc(8);
    const fd = fs.openSync(result.pngPath, "r");
    fs.readSync(fd, buf, 0, 8, 0);
    fs.closeSync(fd);
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x4e); // N
    expect(buf[3]).toBe(0x47); // G

    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.tierUsed).toBe("compile");
    expect(result.screenId).toBe("HomeScreen");
  }, 60_000);

  it("DetailScreen PNG를 생성한다", async () => {
    const outDir = makeOutDir();
    const screen: ScreenSummary = {
      id: "DetailScreen",
      discovery: "route",
      confidence: 0.95,
      sourceRef: { file: "src/screens/DetailScreen.tsx", symbol: "DetailScreen" },
    };

    const result = await rnWebCompileBackend.capture(BASE_CTX, screen, {
      outDir,
      device: "pixel-8",
      mockSeed: 42,
    });

    expect(fs.existsSync(result.pngPath)).toBe(true);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.tierUsed).toBe("compile");
  }, 60_000);

  it("동일 mockSeed·화면에서 같은 이름의 PNG가 생성된다 (결정론 확인)", async () => {
    const outDir1 = makeOutDir();
    const outDir2 = makeOutDir();
    const screen: ScreenSummary = {
      id: "HomeScreen",
      discovery: "route",
      confidence: 1.0,
      sourceRef: { file: "src/screens/HomeScreen.tsx" },
    };
    const opts = { device: "pixel-8" as const, mockSeed: 42 };

    const r1 = await rnWebCompileBackend.capture(BASE_CTX, screen, { outDir: outDir1, ...opts });
    const r2 = await rnWebCompileBackend.capture(BASE_CTX, screen, { outDir: outDir2, ...opts });

    // 파일 이름이 동일해야 함
    expect(path.basename(r1.pngPath)).toBe(path.basename(r2.pngPath));
    // 크기가 동일해야 함 (결정론)
    expect(r1.width).toBe(r2.width);
    expect(r1.height).toBe(r2.height);
  }, 120_000);

  it("존재하지 않는 화면 파일은 BUNDLE_FAILED를 던진다", async () => {
    const outDir = makeOutDir();
    const screen: ScreenSummary = {
      id: "BrokenScreen",
      discovery: "candidate",
      confidence: 0.3,
      sourceRef: { file: "src/screens/BrokenScreen.tsx" },
    };

    await expect(
      rnWebCompileBackend.capture(BASE_CTX, screen, { outDir, mockSeed: 42 })
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof CompileCaptureError && e.code === "BUNDLE_FAILED"
    );
  }, 30_000);

  it("BUNDLE_FAILED(소스 없음) 시 임시 workDir이 정리된다", async () => {
    const outDir = makeOutDir();
    const screen: ScreenSummary = {
      id: "GhostScreen",
      discovery: "candidate",
      confidence: 0.1,
      sourceRef: { file: "src/screens/GhostScreen.tsx" },
    };

    // 캡처 전 tmpdir 파일 목록 기록
    const tmpDir = os.tmpdir();
    const beforeEntries = new Set(fs.readdirSync(tmpDir).filter(e => e.startsWith("karax-rn-")));

    try {
      await rnWebCompileBackend.capture(BASE_CTX, screen, { outDir, mockSeed: 42 });
    } catch {
      // 에러는 예상됨
    }

    // 캡처 후 karax-rn-* 디렉토리가 증가하지 않아야 함
    const afterEntries = new Set(fs.readdirSync(tmpDir).filter(e => e.startsWith("karax-rn-")));
    const leaked = [...afterEntries].filter(e => !beforeEntries.has(e));
    expect(leaked).toHaveLength(0);
  }, 30_000);
});

// 원본 무수정 테스트
describe("원본 무수정 보장", () => {
  it("캡처 전후 fixture 디렉토리 내용이 변경되지 않는다", async () => {
    function hashDir(dir: string): string {
      const entries: string[] = [];
      function walk(d: string) {
        for (const entry of fs.readdirSync(d).sort()) {
          if (entry === "node_modules" || entry === "__goldens__") continue;
          const full = path.join(d, entry);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) {
            walk(full);
          } else {
            const content = fs.readFileSync(full);
            entries.push(`${full}:${content.length}`);
          }
        }
      }
      walk(dir);
      return entries.join("|");
    }

    const before = hashDir(FIXTURE_PATH);

    const outDir = path.join(os.tmpdir(), `karax-rn-hash-${Date.now()}`);
    const screen: ScreenSummary = {
      id: "HomeScreen",
      discovery: "route",
      confidence: 1.0,
      sourceRef: { file: "src/screens/HomeScreen.tsx" },
    };
    try {
      await rnWebCompileBackend.capture(BASE_CTX, screen, {
        outDir,
        device: "pixel-8",
        mockSeed: 42,
      });
    } finally {
      try { fs.rmSync(outDir, { recursive: true, force: true }); } catch {}
    }

    const after = hashDir(FIXTURE_PATH);
    expect(after).toBe(before);
  }, 60_000);
});
