/**
 * packages/core/src/__tests__/redact.test.ts
 *
 * redactSecrets / redactInvocation / formatRespawnCrash 단위 테스트
 * TDD Red 단계: 구현 전에 먼저 작성 (컴파일 에러 = Red)
 */

import { describe, it, expect } from "vitest";
import {
  redactSecrets,
  redactInvocation,
  formatRespawnCrash,
} from "../debug/redact.js";

// ── redactSecrets ──────────────────────────────────────────────────

describe("redactSecrets — Anthropic API 키", () => {
  it("sk-ant-api03- 형태 키를 [REDACTED]로 치환해야 한다", () => {
    const input = "Error: API 키 sk-ant-api03-ABCDEF12345678-suffix가 잘못됨";
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("sk-ant-api03-");
  });

  it("sk-proj- 형태 OpenAI 키를 [REDACTED]로 치환해야 한다", () => {
    const input = "key=sk-proj-AbCdEfGhIjKlMnOp1234567890";
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("sk-proj-");
  });

  it("AIza Google 키를 [REDACTED]로 치환해야 한다 (39자 이상)", () => {
    const key = "AIza" + "A".repeat(34);
    expect(redactSecrets(`token=${key}`)).toContain("[REDACTED]");
  });

  it("GitHub PAT (github_pat_)를 치환해야 한다", () => {
    const input = "GITHUB_TOKEN=github_pat_" + "a".repeat(20);
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("github_pat_");
  });

  it("ghp_ GitHub OAuth 토큰을 치환해야 한다", () => {
    const input = "token ghp_" + "A".repeat(20);
    expect(redactSecrets(input)).toContain("[REDACTED]");
  });

  it("AWS Access Key (AKIA...)를 치환해야 한다", () => {
    const input = "AKIA" + "A".repeat(16);
    expect(redactSecrets(input)).toContain("[REDACTED]");
  });

  it("Bearer 토큰을 치환해야 한다", () => {
    const input = "Authorization: Bearer eyJABCDEFGH";
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("eyJABCDEFGH");
  });

  it("JWT eyJ.eyJ.signature 패턴을 치환해야 한다", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redactSecrets(`token=${jwt}`)).toContain("[REDACTED]");
  });

  it("KEY/TOKEN/SECRET 환경변수 형태를 치환해야 한다", () => {
    expect(redactSecrets("MY_API_KEY=supersecret")).toContain("[REDACTED]");
    expect(redactSecrets("DB_TOKEN=abc123xyz")).toContain("[REDACTED]");
    expect(redactSecrets("APP_SECRET=hunter2")).toContain("[REDACTED]");
  });

  it("URL 쿼리 파라미터 api_key=값을 치환해야 한다", () => {
    const input = "https://api.example.com/v1?api_key=mypassword&other=ok";
    const redacted = redactSecrets(input);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("mypassword");
  });

  it("세션 쿠키 sessionid=값을 치환해야 한다", () => {
    const input = "Cookie: sessionid=abcdef123456";
    expect(redactSecrets(input)).toContain("[REDACTED]");
    expect(redactSecrets(input)).not.toContain("abcdef123456");
  });

  it("민감정보 없는 일반 문자열은 그대로 반환해야 한다", () => {
    const input = "정상적인 에러 메시지입니다. code=404";
    expect(redactSecrets(input)).toBe(input);
  });

  it("빈 문자열은 빈 문자열을 반환해야 한다", () => {
    expect(redactSecrets("")).toBe("");
  });

  it("여러 키가 한 문자열에 있으면 모두 치환해야 한다", () => {
    const input = "key1=sk-proj-ABCDEFGHIJKL1234567890 key2=sk-ant-api03-MNOPQRSTUV";
    const redacted = redactSecrets(input);
    expect(redacted).not.toContain("sk-proj-");
    expect(redacted).not.toContain("sk-ant-api03-");
  });
});

// ── redactInvocation ──────────────────────────────────────────────

describe("redactInvocation — 구조적 env 마스킹", () => {
  it("env 객체의 모든 값을 [REDACTED]로 마스킹하고 키는 보존해야 한다", () => {
    const inv = {
      bin: "claude",
      args: ["--model", "claude-sonnet"],
      env: {
        ANTHROPIC_API_KEY: "sk-ant-api03-secret",
        PATH: "/usr/bin",
        HOME: "/home/user",
      },
    };
    const result = redactInvocation(inv);
    expect(result.env!["ANTHROPIC_API_KEY"]).toBe("[REDACTED]");
    expect(result.env!["PATH"]).toBe("[REDACTED]");
    expect(result.env!["HOME"]).toBe("[REDACTED]");
  });

  it("env 키 이름은 그대로 보존되어야 한다", () => {
    const inv = {
      bin: "node",
      args: [],
      env: { MY_SECRET: "value", DEBUG: "true" },
    };
    const result = redactInvocation(inv);
    expect(Object.keys(result.env!)).toEqual(["MY_SECRET", "DEBUG"]);
  });

  it("--api-key 다음 args 값을 마스킹해야 한다", () => {
    const inv = {
      bin: "claude",
      args: ["--api-key", "sk-secret-key", "--model", "opus"],
    };
    const result = redactInvocation(inv);
    expect(result.args[1]).toBe("[REDACTED]");
    expect(result.args[0]).toBe("--api-key");
    expect(result.args[2]).toBe("--model");
    expect(result.args[3]).toBe("opus");
  });

  it("env가 없으면 env 필드가 없어야 한다", () => {
    const inv = { bin: "node", args: ["script.js"] };
    const result = redactInvocation(inv);
    expect(result.env).toBeUndefined();
  });

  it("원본 객체를 변경하지 않아야 한다 (불변성)", () => {
    const orig = {
      bin: "claude",
      args: ["--api-key", "secret"],
      env: { KEY: "value" },
    };
    const origEnvValue = orig.env.KEY;
    const origArgValue = orig.args[1];
    redactInvocation(orig);
    expect(orig.env.KEY).toBe(origEnvValue);
    expect(orig.args[1]).toBe(origArgValue);
  });

  it("bin은 마스킹하지 않아야 한다", () => {
    const inv = { bin: "claude", args: [] };
    expect(redactInvocation(inv).bin).toBe("claude");
  });
});

// ── formatRespawnCrash ────────────────────────────────────────────

describe("formatRespawnCrash — 자식 프로세스 크래시 포맷", () => {
  it("정상 종료(status=0, signal=null, error 없음)면 null을 반환해야 한다", () => {
    expect(formatRespawnCrash({ status: 0, signal: null })).toBeNull();
  });

  it("정상 종료(status=1)도 signal 없으면 null을 반환해야 한다 (비정상 종료 코드는 다른 계층)", () => {
    // status가 있고 signal이 null이면 정상 exit — signal/error 기반 크래시 판단
    expect(formatRespawnCrash({ status: 1, signal: null })).toBeNull();
  });

  it("SIGKILL 시그널이면 사람이 읽을 수 있는 문자열을 반환해야 한다", () => {
    const result = formatRespawnCrash({ status: null, signal: "SIGKILL" });
    expect(result).not.toBeNull();
    expect(result!).toContain("SIGKILL");
  });

  it("SIGSEGV 시그널이면 사람이 읽을 수 있는 문자열을 반환해야 한다", () => {
    const result = formatRespawnCrash({ status: null, signal: "SIGSEGV" });
    expect(result).not.toBeNull();
    expect(result!).toContain("SIGSEGV");
  });

  it("임의 시그널 이름도 포함해야 한다", () => {
    const result = formatRespawnCrash({ status: null, signal: "SIGTERM" });
    expect(result!).toContain("SIGTERM");
  });

  it("spawn error가 있으면 에러 메시지를 포함해야 한다", () => {
    const err = new Error("spawn ENOENT");
    const result = formatRespawnCrash({ status: null, signal: null, error: err });
    expect(result).not.toBeNull();
    expect(result!).toContain("spawn ENOENT");
  });

  it("status와 signal 모두 null이고 error도 없으면 알 수 없는 크래시로 처리해야 한다", () => {
    const result = formatRespawnCrash({ status: null, signal: null });
    expect(result).not.toBeNull();
  });
});
