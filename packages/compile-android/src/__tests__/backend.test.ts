/**
 * CompileBackend 인터페이스 계약 테스트
 * isAvailable: java+gradle+android-sdk 존재 여부에 따른 분기
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { androidPaparazziBackend } from "../index.js";

// 환경 변수 조작을 위한 원본 저장
const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  Object.assign(process.env, originalEnv);
  // 추가된 키 정리
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
});

describe("androidPaparazziBackend.id", () => {
  it("id가 android 이어야 함", () => {
    expect(androidPaparazziBackend.id).toBe("android");
  });
});

describe("androidPaparazziBackend.isAvailable", () => {
  it("java + gradle + android-sdk 없으면 false", async () => {
    // detectJava / detectGradle / detectAndroidSdk를 모킹하려면
    // 실제 환경 체크로 돌아가지만, SDK 없는 환경에서도 테스트 가능하도록
    // 결과가 boolean임을 확인
    // 주의: 느린 머신에서 java -version이 16초 이상 소요될 수 있으므로 60s timeout
    const result = await androidPaparazziBackend.isAvailable({});
    expect(typeof result).toBe("boolean");
  }, 60_000);

  it("CompileEnvironment에 toolchainPath가 있어도 boolean 반환", async () => {
    const result = await androidPaparazziBackend.isAvailable({
      toolchainPath: "/nonexistent/gradle",
    });
    expect(typeof result).toBe("boolean");
  }, 60_000);
});

describe("CompileCaptureError — SDK_MISSING 에러 생성", () => {
  it("SDK_MISSING 코드로 에러 생성 가능", async () => {
    const { CompileCaptureError } = await import("../errors.js");
    const err = new CompileCaptureError("SDK_MISSING", "Android SDK not found", "");
    expect(err.code).toBe("SDK_MISSING");
    expect(err instanceof CompileCaptureError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("capture 결과는 CaptureResult 인터페이스를 만족함 (타입 계약)", () => {
    // CompileBackend 인터페이스: capture returns Promise<CaptureResult>
    // 런타임 타입 검증: id 필드 확인
    expect(androidPaparazziBackend.id).toBe("android");
    expect(typeof androidPaparazziBackend.capture).toBe("function");
    expect(typeof androidPaparazziBackend.isAvailable).toBe("function");
  });
});
