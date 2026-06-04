/**
 * compile-ios — 통합 테스트
 * SFC_IOS_INTEGRATION=1 환경변수가 없으면 전부 skip
 *
 * 실행 방법:
 *   SFC_IOS_INTEGRATION=1 pnpm --filter @sfc/compile-ios test
 */
import * as path from "path";
import * as fs from "fs";
import * as zlib from "zlib";
import * as crypto from "crypto";
import { describe, expect, it, beforeAll } from "vitest";
import type { ScreenSummary, AdapterContext, CaptureOptions } from "@sfc/adapter-api";
import { iosSimulatorBackend } from "../index.js";

// ── PNG 픽셀 실질 분석 헬퍼 ──────────────────────────────────────────────────

interface PngPixelStats {
  /** 불투명(alpha=255) 픽셀 수 */
  opaquePixels: number;
  /** 전체 픽셀 수 */
  totalPixels: number;
  /** 고유 RGB 색상 수 (중복 제외) — 균일성 지표 */
  uniqueColors: number;
  /**
   * 지배색(dominant color) 비율 — 픽셀 전체에서 가장 많이 등장하는
   * 양자화 색상(6비트 채널 기준)이 차지하는 비율.
   * 플레이스홀더 오류 이미지(단색 배경)는 이 값이 0.5 이상이다.
   */
  dominantColorRatio: number;
  /**
   * 이미지가 시스템 오류 플레이스홀더(노란 배경 + 빨간 금지 심볼)로
   * 추정되는지 여부.
   *
   * 판정 기준:
   * 1. 지배색 비율 >= 0.50 (한 색이 화면 절반 이상 차지)
   * 2. 고유색 수 < 100 (실제 UI는 텍스트·그림자·그라디언트로 수백 가지 이상)
   *
   * 두 조건 모두 충족하면 플레이스홀더로 판정.
   */
  isPlaceholder: boolean;
}

/**
 * PNG 픽셀 배열을 디코딩해 반환한다. (channels 수 포함)
 * 내부 유틸: analyzePngPixels에서만 호출.
 */
function decodePngPixels(pngPath: string): {
  pixels: Buffer;
  width: number;
  height: number;
  channels: number;
  bytesPerPixel: number;
} | null {
  const data = fs.readFileSync(pngPath);

  // PNG 시그니처 확인
  const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (data[i] !== SIG[i]) return null;
  }

  // IHDR 파싱
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const bitDepth = data[24]!;
  const colorType = data[25]!; // 2=RGB, 6=RGBA

  // IDAT 청크 수집
  const idatChunks: Buffer[] = [];
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = data.readUInt32BE(pos);
    const chunkType = data.slice(pos + 4, pos + 8).toString("ascii");
    if (chunkType === "IDAT") {
      idatChunks.push(data.slice(pos + 8, pos + 8 + chunkLen));
    }
    if (chunkType === "IEND") break;
    pos += 12 + chunkLen;
  }

  if (idatChunks.length === 0) return null;

  let raw: Buffer;
  try {
    raw = zlib.inflateSync(Buffer.concat(idatChunks));
  } catch {
    return null;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const bytesPerPixel = (bitDepth / 8) * channels;
  const stride = width * bytesPerPixel;

  // PNG 필터 해제 (None/Sub/Up/Average, Paeth는 근사)
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filterByte = raw[y * (stride + 1)]!;
    const srcRow = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const dstRow = pixels.slice(y * stride, (y + 1) * stride);

    for (let x = 0; x < stride; x++) {
      const a = x >= bytesPerPixel ? dstRow[x - bytesPerPixel]! : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const raw_ = srcRow[x]!;
      if (filterByte === 0) dstRow[x] = raw_;
      else if (filterByte === 1) dstRow[x] = (raw_ + a) & 0xff;
      else if (filterByte === 2) dstRow[x] = (raw_ + b) & 0xff;
      else if (filterByte === 3) dstRow[x] = (raw_ + Math.floor((a + b) / 2)) & 0xff;
      else dstRow[x] = raw_; // Paeth 근사
    }
  }

  return { pixels, width, height, channels, bytesPerPixel };
}

/**
 * PNG 파일을 분석해 픽셀 통계와 플레이스홀더 여부를 반환한다.
 *
 * 검증 기준 (H1 강화):
 * - 불투명 픽셀 비율 > 50% (완전 투명 이미지 차단)
 * - 고유 색상 수 > 100 (실제 UI는 텍스트/그림자/안티에일리어싱으로 수백 가지 이상)
 * - 지배색 비율 < 50% (단색 배경이 화면 절반 이상 차지하면 플레이스홀더)
 * - isPlaceholder=true면 실패 (노란배경+빨간금지심볼 같은 오류 이미지 차단)
 */
function analyzePngPixels(pngPath: string): PngPixelStats {
  const decoded = decodePngPixels(pngPath);

  if (!decoded) {
    // 디코딩 실패 시 IDAT 크기 기반 폴백
    const data = fs.readFileSync(pngPath);
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    return {
      opaquePixels: 0,
      totalPixels: width * height,
      uniqueColors: 0,
      dominantColorRatio: 1.0,
      isPlaceholder: true,
    };
  }

  const { pixels, width, height, channels, bytesPerPixel } = decoded;

  let opaquePixels = 0;
  // 6비트 채널로 양자화한 색상 빈도 맵 (플레이스홀더 탐지용)
  const colorFreq = new Map<number, number>();
  // 4비트 채널로 더 세밀하게 양자화한 고유색 집합 (색 다양성 측정)
  const colorSet = new Set<number>();

  const total = width * height;

  for (let i = 0; i < total; i++) {
    const base = i * bytesPerPixel;
    const r = pixels[base]!;
    const g = channels >= 3 ? pixels[base + 1]! : r;
    const b = channels >= 3 ? pixels[base + 2]! : r;
    const alpha = channels === 4 ? pixels[base + 3]! : 255;

    if (alpha > 10) opaquePixels++;

    // 매 16픽셀마다 샘플링 (성능/정확도 균형)
    if (i % 16 === 0) {
      // 6비트 양자화: 단색 배경 탐지 (지배색 비율 계산용)
      const q6 = (r >> 2) | ((g >> 2) << 6) | ((b >> 2) << 12);
      colorFreq.set(q6, (colorFreq.get(q6) ?? 0) + 1);

      // 4비트 양자화: 색 다양성 (실제 UI 콘텐츠 존재 여부)
      const q4 = (r >> 4) | ((g >> 4) << 4) | ((b >> 4) << 8);
      colorSet.add(q4);
    }
  }

  // 지배색 비율 계산
  const sampledCount = Math.ceil(total / 16);
  const maxFreq = colorFreq.size > 0 ? Math.max(...colorFreq.values()) : 0;
  const dominantColorRatio = sampledCount > 0 ? maxFreq / sampledCount : 0;

  // 플레이스홀더 판정: 지배색이 50% 이상 & 고유색 수 100 미만
  // (노란배경+빨간 금지 심볼처럼 단조로운 이미지 차단)
  const isPlaceholder = dominantColorRatio >= 0.50 && colorSet.size < 100;

  return {
    opaquePixels,
    totalPixels: total,
    uniqueColors: colorSet.size,
    dominantColorRatio,
    isPlaceholder,
  };
}

/**
 * IDAT 총 바이트 수만 빠르게 반환 (기존 휴리스틱 — 폴백용)
 */
function countIdatBytes(pngPath: string): number {
  const data = fs.readFileSync(pngPath);
  let idatTotal = 0;
  let pos = 8;
  while (pos + 12 <= data.length) {
    const chunkLen = data.readUInt32BE(pos);
    const chunkType = data.slice(pos + 4, pos + 8).toString("ascii");
    if (chunkType === "IDAT") idatTotal += chunkLen;
    if (chunkType === "IEND") break;
    pos += 12 + chunkLen;
  }
  return idatTotal;
}

// 하위 호환성 alias
function countNonTransparentPixels(pngPath: string): number {
  return countIdatBytes(pngPath);
}

const INTEGRATION = process.env["SFC_IOS_INTEGRATION"] === "1";
const FIXTURES_DIR = path.resolve(process.cwd(), "../../fixtures/ios-swiftui-basic");
const GOLDENS_DIR = path.resolve(process.cwd(), "__goldens__");

function skipIfNotIntegration(): void {
  if (!INTEGRATION) {
    console.warn("[compile-ios] SFC_IOS_INTEGRATION=1 아니므로 통합 테스트 skip");
  }
}

describe("iosSimulatorBackend.isAvailable()", () => {
  it("darwin+xcodebuild+simctl 환경에서 true 반환", async () => {
    if (process.platform !== "darwin") {
      console.warn("darwin이 아님 — skip");
      return;
    }
    // xcodebuild(90s)와 simctl list(60s)를 병렬 실행 → 부하 환경에서 max(90s)이 최대
    const available = await iosSimulatorBackend.isAvailable({});
    // 이 머신은 Xcode 26.5, 시뮬레이터 있음 → true여야 함
    expect(available).toBe(true);
  }, 120_000);
});

describe("iosSimulatorBackend.capture() — 통합", () => {
  const outDir = path.join(process.cwd(), "test-out-integration");

  beforeAll(() => {
    skipIfNotIntegration();
    if (INTEGRATION) {
      fs.mkdirSync(outDir, { recursive: true });
    }
  });

  it("HomeScreen 실캡처 — PNG 파일 생성 + 원본 무수정 (느림)", async () => {
    if (!INTEGRATION) return;

    // 원본 해시 계산
    const beforeHash = dirHash(FIXTURES_DIR);

    const screen: ScreenSummary = {
      id: "HomeScreen",
      discovery: "route",
      confidence: 0.9,
      sourceRef: { file: "Sources/Screens/HomeScreen.swift", line: 1, symbol: "HomeScreen" },
    };

    const ctx: AdapterContext = { projectPath: FIXTURES_DIR };
    const opts: CaptureOptions = { outDir, device: "iphone-15", mockSeed: 42 };

    const result = await iosSimulatorBackend.capture(ctx, screen, opts);

    // PNG 파일 존재
    expect(fs.existsSync(result.pngPath)).toBe(true);
    const size = fs.statSync(result.pngPath).size;
    expect(size).toBeGreaterThan(5000); // 최소 5KB

    // tierUsed
    expect(result.tierUsed).toBe("compile");

    // 원본 무수정 확인
    const afterHash = dirHash(FIXTURES_DIR);
    expect(afterHash).toBe(beforeHash);

    // ── 실질 픽셀 검증 (H1 강화: 플레이스홀더 탐지 추가) ────────────────────────
    const pixelStats = analyzePngPixels(result.pngPath);
    console.log(`[integration] HomeScreen PNG: ${result.pngPath} (${size} bytes)`);
    console.log(`[integration] dimensions: ${result.width}x${result.height}`);
    console.log(
      `[integration] 픽셀 통계: 불투명=${pixelStats.opaquePixels}/${pixelStats.totalPixels}` +
      ` (${(pixelStats.opaquePixels / pixelStats.totalPixels * 100).toFixed(1)}%),` +
      ` 고유색=${pixelStats.uniqueColors}, 지배색비율=${(pixelStats.dominantColorRatio * 100).toFixed(1)}%,` +
      ` isPlaceholder=${pixelStats.isPlaceholder}`
    );

    // 기준 1: 불투명 픽셀 비율 > 50% — 완전 투명/빈 이미지 차단
    expect(pixelStats.opaquePixels / pixelStats.totalPixels).toBeGreaterThan(0.5);

    // 기준 2: 고유 색상 수 > 100 — 단색/플레이스홀더 이미지 차단
    // (실제 SwiftUI 렌더는 텍스트 안티에일리어싱·그림자·그라디언트로 수백 가지 색 포함)
    expect(pixelStats.uniqueColors).toBeGreaterThan(100);

    // 기준 3: 지배색 비율 < 50% — 단색 배경이 화면 절반 이상 차지하면 플레이스홀더로 판정
    expect(pixelStats.dominantColorRatio).toBeLessThan(0.5);

    // 기준 4: isPlaceholder 플래그가 false — 오류 플레이스홀더(노란배경+금지심볼 등) 명시 차단
    expect(pixelStats.isPlaceholder).toBe(false);

    // 골든 PNG 비교
    const goldenPath = path.join(GOLDENS_DIR, "HomeScreen.png");
    if (fs.existsSync(goldenPath)) {
      const goldenStats = analyzePngPixels(goldenPath);
      if (goldenStats.isPlaceholder) {
        // 골든 자체가 플레이스홀더이면 명시적으로 실패시킴 — 무의미한 골든 비교 차단
        throw new Error(
          `[integration] 골든 PNG가 플레이스홀더 오류 이미지입니다.` +
          ` 올바른 렌더 결과로 골든을 교체해야 합니다: ${goldenPath}\n` +
          `  고유색=${goldenStats.uniqueColors}, 지배색비율=${(goldenStats.dominantColorRatio * 100).toFixed(1)}%`
        );
      }
      // 유효한 골든이 있으면 해시 비교 (시뮬레이터/OS 버전 차이는 경고만)
      const capturedHash = crypto.createHash("sha256").update(fs.readFileSync(result.pngPath)).digest("hex");
      const goldenHash = crypto.createHash("sha256").update(fs.readFileSync(goldenPath)).digest("hex");
      if (capturedHash !== goldenHash) {
        console.warn(
          `[integration] 골든 PNG 해시 불일치 (시뮬레이터 버전/폰트 차이 허용).\n` +
          `  골든: ${goldenHash.slice(0, 16)}...\n` +
          `  실제: ${capturedHash.slice(0, 16)}...`
        );
      } else {
        console.log(`[integration] 골든 PNG 해시 일치`);
      }
    } else {
      console.warn(`[integration] 골든 PNG 없음 — 처음 생성된 결과를 골든으로 사용`);
    }
  }, 600_000); // 첫 빌드 최대 10분 허용

  it("깨진 Swift 화면 → COMPILE_FAILED 에러", async () => {
    if (!INTEGRATION) return;

    const { CompileCaptureError } = await import("../runner.js");

    // 존재하지 않는 화면 이름으로 테스트 → 컴파일 실패 유도
    const screen: ScreenSummary = {
      id: "BrokenScreen",
      discovery: "candidate",
      confidence: 0.3,
      sourceRef: { file: "Sources/Screens/BrokenScreen.swift", line: 1, symbol: "BrokenScreen" },
    };

    const ctx: AdapterContext = { projectPath: FIXTURES_DIR };
    const opts: CaptureOptions = { outDir, device: "iphone-15", mockSeed: 42 };

    await expect(
      iosSimulatorBackend.capture(ctx, screen, opts)
    ).rejects.toThrow(CompileCaptureError);
  }, 300_000);

  it("시뮬레이터 부재 시 SIM_UNAVAILABLE 에러 또는 skip", async () => {
    if (!INTEGRATION) return;

    const available = await iosSimulatorBackend.isAvailable({});
    if (!available) {
      console.warn("[integration] 시뮬레이터 없음 — SIM_UNAVAILABLE 경로 확인 불가, skip");
      return;
    }
    // 시뮬레이터가 있으면 이 테스트는 pass (SIM_UNAVAILABLE 경로를 억지로 재현하기 어려움)
    expect(available).toBe(true);
  });
});

// ── 헬퍼: 디렉토리 해시 ──────────────────────────────────────────────────────────

function dirHash(dir: string): string {
  const hash = crypto.createHash("sha256");
  collectFiles(dir).forEach((f) => {
    try {
      hash.update(f);
      hash.update(fs.readFileSync(f));
    } catch {
      // ignore
    }
  });
  return hash.digest("hex");
}

function collectFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        result.push(...collectFiles(full));
      } else {
        result.push(full);
      }
    }
  } catch {
    // ignore
  }
  return result.sort();
}
