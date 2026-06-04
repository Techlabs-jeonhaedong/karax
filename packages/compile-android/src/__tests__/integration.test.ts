/**
 * 통합 테스트 — SFC_ANDROID_INTEGRATION=1 환경변수 가드
 *
 * 실제 Paparazzi + Gradle 실행이 필요하므로 통합 CI 환경에서만 실행.
 * SDK가 없으면 자동 skip.
 */

import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { androidPaparazziBackend } from "../index.js";
import { CompileCaptureError } from "../errors.js";

// __tests__(1) → src(2) → compile-android(3) → packages(4) → screenshot-from-code
const FIXTURE_PATH = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../../../../fixtures/android-compose-basic"
);

const RUN = process.env.SFC_ANDROID_INTEGRATION === "1";

function hashDir(dirPath: string): string {
  try {
    const files = fs.readdirSync(dirPath, { recursive: true }) as string[];
    const sorted = files.sort();
    const hash = crypto.createHash("sha256");
    for (const f of sorted) {
      const full = path.join(dirPath, f);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile()) {
          hash.update(f);
          hash.update(fs.readFileSync(full));
        }
      } catch {
        // ignore
      }
    }
    return hash.digest("hex");
  } catch {
    return "ERROR";
  }
}

describe.skipIf(!RUN)("compile-android 통합 테스트 (SFC_ANDROID_INTEGRATION=1 필요)", () => {
  it("fixture 경로가 존재해야 함", () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
  });

  it("Android SDK가 감지되어야 함 (통합 테스트 전제)", async () => {
    const sdkPath = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? null;
    expect(sdkPath).not.toBeNull();
  });

  it("HomeScreen Paparazzi 캡처 — 원본 무수정", async () => {
    const outDir = path.join("/tmp", `sfc-android-integration-${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });

    // 실행 전 fixture 해시
    const hashBefore = hashDir(FIXTURE_PATH);

    let result;
    try {
      result = await androidPaparazziBackend.capture(
        { projectPath: FIXTURE_PATH, mockSeed: 42 },
        {
          id: "HomeScreen",
          title: "Home Screen",
          discovery: "route",
          confidence: 1.0,
          sourceRef: {
            file: "app/src/main/java/com/example/fixture/screens/HomeScreen.kt",
            line: 58,
            symbol: "HomeScreen",
          },
        },
        { outDir, device: "pixel-8", mockSeed: 42 }
      );
    } catch (e) {
      if (e instanceof CompileCaptureError) {
        // SDK_MISSING이면 skip (환경 미구성)
        if (e.code === "SDK_MISSING") {
          console.warn("[integration] Android SDK 없음 — 테스트 skip");
          return;
        }
      }
      throw e;
    }

    // 실행 후 fixture 해시 — 원본 무수정 확인
    const hashAfter = hashDir(FIXTURE_PATH);
    expect(hashBefore).toBe(hashAfter);

    // 결과 검증
    expect(result.screenId).toBe("HomeScreen");
    expect(result.tierUsed).toBe("compile");
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(fs.existsSync(result.pngPath)).toBe(true);

    // PNG 크기가 합리적인 범위여야 함 (pixel-8 = 1080x2400)
    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(100);

    // 정리
    try { fs.rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }, 600_000); // 600초 타임아웃 (첫 실행 의존성 다운로드)
});

describe("compile-android 단위 검증 (항상 실행)", () => {
  it("fixture 경로 구조 확인", () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
    const manifest = path.join(FIXTURE_PATH, "app", "src", "main", "AndroidManifest.xml");
    expect(fs.existsSync(manifest)).toBe(true);
  });

  it("androidPaparazziBackend.id === android", () => {
    expect(androidPaparazziBackend.id).toBe("android");
  });

  it("isAvailable이 boolean 반환", async () => {
    // 느린 머신에서 java -version이 16초 이상 소요될 수 있으므로 60s timeout
    const result = await androidPaparazziBackend.isAvailable({});
    expect(typeof result).toBe("boolean");
  }, 60_000);
});
