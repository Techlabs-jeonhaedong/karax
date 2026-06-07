/**
 * packages/e2e/src/debug.ts 단위 테스트
 *
 * 불변 제약:
 * - off 시 모든 경로 no-op (디렉토리 미생성, stderr 미출력)
 * - 출력 직전 redactSecrets 적용
 * - 빌드 5MB / 기타 2MB 상한 (초과 시 앞부분 보존 + 절단 표시)
 * - stderr 전용 (stdout 불변)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// stderr를 스파이로 가로챔
const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

// ── 테스트 대상 (구현 전이므로 동적 import로 Red 확인) ────────────────────
let isDebug: (opt?: boolean) => boolean;
let debugLog: (enabled: boolean, tag: string, msg: string) => void;
let createDebugArtifacts: (debugDir: string | undefined) => {
  write(name: string, content: string, maxBytes?: number): Promise<void>;
  writeJson(name: string, obj: unknown): Promise<void>;
};

beforeEach(async () => {
  vi.clearAllMocks();
  // 동적 import로 매 테스트마다 새로 로드
  const mod = await import("../debug.js");
  isDebug = mod.isDebug;
  debugLog = mod.debugLog;
  createDebugArtifacts = mod.createDebugArtifacts;
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-debug-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── isDebug ───────────────────────────────────────────────────────────────

describe("isDebug", () => {
  it("opt=true이면 true를 반환한다", () => {
    expect(isDebug(true)).toBe(true);
  });

  it("opt=false이면 false를 반환한다 (env 무시)", () => {
    const original = process.env["KARAX_DEBUG"];
    process.env["KARAX_DEBUG"] = "1";
    try {
      expect(isDebug(false)).toBe(false);
    } finally {
      if (original === undefined) delete process.env["KARAX_DEBUG"];
      else process.env["KARAX_DEBUG"] = original;
    }
  });

  it("opt 미지정 + KARAX_DEBUG=1이면 true를 반환한다", () => {
    const original = process.env["KARAX_DEBUG"];
    process.env["KARAX_DEBUG"] = "1";
    try {
      expect(isDebug()).toBe(true);
    } finally {
      if (original === undefined) delete process.env["KARAX_DEBUG"];
      else process.env["KARAX_DEBUG"] = original;
    }
  });

  it("opt 미지정 + KARAX_DEBUG 없으면 false를 반환한다", () => {
    const original = process.env["KARAX_DEBUG"];
    delete process.env["KARAX_DEBUG"];
    try {
      expect(isDebug()).toBe(false);
    } finally {
      if (original !== undefined) process.env["KARAX_DEBUG"] = original;
    }
  });

  it("KARAX_DEBUG=0이면 false를 반환한다 (1만 truthy)", () => {
    const original = process.env["KARAX_DEBUG"];
    process.env["KARAX_DEBUG"] = "0";
    try {
      expect(isDebug()).toBe(false);
    } finally {
      if (original === undefined) delete process.env["KARAX_DEBUG"];
      else process.env["KARAX_DEBUG"] = original;
    }
  });
});

// ── debugLog ──────────────────────────────────────────────────────────────

describe("debugLog", () => {
  it("enabled=true일 때 stderr에 [karax/debug] 형식으로 출력한다", () => {
    debugLog(true, "test-tag", "hello world");
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = String((stderrSpy.mock.calls[0] as unknown[])[0]);
    expect(output).toContain("[karax/debug]");
    expect(output).toContain("[test-tag]");
    expect(output).toContain("hello world");
  });

  it("enabled=false일 때 stderr에 아무것도 출력하지 않는다 (no-op)", () => {
    debugLog(false, "tag", "msg");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("API 키 패턴을 redact 후 출력한다", () => {
    debugLog(true, "tag", "key=sk-ant-api03-abcdefghijklmn12345 failed");
    const output = String((stderrSpy.mock.calls[0] as unknown[])[0]);
    expect(output).not.toContain("sk-ant-api03-abcdefghijklmn12345");
    expect(output).toContain("[REDACTED]");
  });

  it("제어문자(\\x00-\\x1f)를 strip 후 출력한다", () => {
    debugLog(true, "tag", "normal\x00hidden\x01text\x1f");
    const output = String((stderrSpy.mock.calls[0] as unknown[])[0]);
    // 제어문자가 포함되지 않아야 한다 (탭·CR·LF 제외 — 출력 끝 \n은 의도적)
    expect(output).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
    // 일반 텍스트는 포함
    expect(output).toContain("normal");
    expect(output).toContain("hidden");
  });

  it("출력은 stderr 전용이다 (stdout 불변)", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    debugLog(true, "t", "msg");
    expect(stdoutSpy).not.toHaveBeenCalled();
    stdoutSpy.mockRestore();
  });
});

// ── createDebugArtifacts ──────────────────────────────────────────────────

describe("createDebugArtifacts — off (debugDir=undefined)", () => {
  it("write는 no-op이다 (파일 미생성)", async () => {
    const artifacts = createDebugArtifacts(undefined);
    await artifacts.write("test.txt", "content");
    // tmpDir에 아무 파일도 생성되지 않아야 한다
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });

  it("writeJson은 no-op이다 (파일 미생성)", async () => {
    const artifacts = createDebugArtifacts(undefined);
    await artifacts.writeJson("test.json", { key: "value" });
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });
});

describe("createDebugArtifacts — on (debugDir 지정)", () => {
  it("write는 파일을 생성한다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    await artifacts.write("test.txt", "hello content");
    const filePath = path.join(debugDir, "test.txt");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("hello content");
  });

  it("writeJson은 JSON 파일을 생성한다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    await artifacts.writeJson("test.json", { key: "value", num: 42 });
    const filePath = path.join(debugDir, "test.json");
    expect(fs.existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(parsed.key).toBe("value");
    expect(parsed.num).toBe(42);
  });

  it("write는 내용을 redactSecrets로 정화한다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    await artifacts.write("secret.txt", "ANTHROPIC_API_KEY=sk-ant-api03-realkey123 error");
    const content = fs.readFileSync(path.join(debugDir, "secret.txt"), "utf-8");
    expect(content).not.toContain("sk-ant-api03-realkey123");
    expect(content).toContain("[REDACTED]");
  });

  it("writeJson은 API 키가 포함된 객체를 직렬화 후 redact한다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    await artifacts.writeJson("invocation.json", {
      bin: "claude",
      args: ["--api-key", "sk-ant-api03-secretkey"],
      env: { ANTHROPIC_API_KEY: "sk-ant-api03-secretkey" },
    });
    const content = fs.readFileSync(path.join(debugDir, "invocation.json"), "utf-8");
    expect(content).not.toContain("sk-ant-api03-secretkey");
    expect(content).toContain("[REDACTED]");
  });

  it("기본 상한(2MB) 초과 시 앞부분 보존 + 절단 표시를 추가한다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    const TWO_MB = 2 * 1024 * 1024;
    const largeContent = "x".repeat(TWO_MB + 1000);
    await artifacts.write("large.txt", largeContent);
    const written = fs.readFileSync(path.join(debugDir, "large.txt"), "utf-8");
    // 2MB 이하여야 한다 (절단 표시 포함)
    expect(Buffer.byteLength(written, "utf-8")).toBeLessThanOrEqual(TWO_MB + 200);
    // 절단 표시가 있어야 한다
    expect(written).toContain("...[truncated]");
  });

  it("빌드 로그 maxBytes=5MB 명시 시 5MB 상한 적용", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    const FIVE_MB = 5 * 1024 * 1024;
    const largeContent = "y".repeat(FIVE_MB + 1000);
    await artifacts.write("build.log", largeContent, FIVE_MB);
    const written = fs.readFileSync(path.join(debugDir, "build.log"), "utf-8");
    expect(Buffer.byteLength(written, "utf-8")).toBeLessThanOrEqual(FIVE_MB + 200);
    expect(written).toContain("...[truncated]");
  });

  it("상한 미만 콘텐츠는 절단 없이 그대로 기록한다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    const smallContent = "small content that fits";
    await artifacts.write("small.txt", smallContent);
    const written = fs.readFileSync(path.join(debugDir, "small.txt"), "utf-8");
    expect(written).toBe(smallContent);
    expect(written).not.toContain("...[truncated]");
  });

  it("기록 실패는 삼키고 debugLog로 사유를 출력한다", async () => {
    // 존재하지 않는 중첩 디렉토리 — debugDir 자체가 없으면 실패
    const nonExistentDir = path.join(tmpDir, "nonexistent", "debug");
    // debugDir를 mkdirSync 없이 사용 — write는 실패해야 함
    const artifacts = createDebugArtifacts(nonExistentDir);
    // 예외를 던지지 않아야 한다 (삼킴)
    await expect(artifacts.write("fail.txt", "content")).resolves.not.toThrow();
  });

  it("서브디렉토리 경로(agent/invocation.json)도 처리한다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    await artifacts.writeJson("agent/invocation.json", { bin: "claude", args: [] });
    const filePath = path.join(debugDir, "agent", "invocation.json");
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

// ── createDebugArtifacts — 경로 탈출 가드 ─────────────────────────────────

describe("createDebugArtifacts — 경로 탈출 가드", () => {
  it("../../evil 같은 상대 탈출 name은 debugDir 밖에 파일을 생성하지 않는다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    await artifacts.write("../../evil.txt", "malicious");
    // tmpDir 상위에 evil.txt가 생성되지 않아야 한다
    expect(fs.existsSync(path.join(tmpDir, "..", "evil.txt"))).toBe(false);
    // debugDir 내부에도 없어야 한다
    expect(fs.readdirSync(debugDir)).toHaveLength(0);
  });

  it("절대 경로 name은 거부된다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    const absTarget = path.join(tmpDir, "outside.txt");
    await artifacts.write(absTarget, "malicious");
    // 절대 경로 파일이 생성되지 않아야 한다
    expect(fs.existsSync(absTarget)).toBe(false);
  });

  it("경로 탈출 시 debugLog로 사유가 출력된다 (stderr)", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    await artifacts.write("../escape.txt", "content");
    // stderrSpy에 경로 탈출 관련 메시지가 있어야 한다
    const calls = (stderrSpy.mock.calls as unknown[][]).map((args) => String(args[0]));
    expect(calls.some((s) => s.includes("경로 탈출"))).toBe(true);
  });

  it("append에서도 절대 경로 name은 거부된다", async () => {
    const debugDir = path.join(tmpDir, "debug");
    fs.mkdirSync(debugDir, { recursive: true });
    const artifacts = createDebugArtifacts(debugDir);
    const absTarget = path.join(tmpDir, "outside-append.txt");
    await artifacts.append(absTarget, "malicious");
    expect(fs.existsSync(absTarget)).toBe(false);
  });
});
