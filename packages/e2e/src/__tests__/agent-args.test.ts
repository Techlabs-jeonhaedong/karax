/**
 * agent/args.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAgentInvocation, assertSafePathArg } from "../agent/args.js";

describe("buildAgentInvocation", () => {
  // ── claude ────────────────────────────────────────────────────────

  describe("claude", () => {
    it("기본 플래그를 구성한다 (-p, output-format, allowedTools)", () => {
      const result = buildAgentInvocation("claude", { prompt: "test prompt" });
      expect(result.bin).toBe("claude");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("test prompt");
    });

    it("--dangerously-skip-permissions가 없고 --allowedTools Bash만 포함된다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      expect(result.args).not.toContain("--dangerously-skip-permissions");
      expect(result.args).toContain("--allowedTools");
    });

    it("output-format json 플래그가 포함된다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      expect(result.args).toContain("--output-format");
      expect(result.args).toContain("json");
    });

    it("apiKey가 있으면 ANTHROPIC_API_KEY를 env에 주입한다", () => {
      const result = buildAgentInvocation("claude", {
        prompt: "test",
        apiKey: "sk-test-key",
      });
      expect(result.env["ANTHROPIC_API_KEY"]).toBe("sk-test-key");
    });

    it("apiKey 없으면 ANTHROPIC_API_KEY를 env에 주입하지 않는다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      expect(result.env["ANTHROPIC_API_KEY"]).toBeUndefined();
    });

    it("allowedTools에 Bash가 포함된다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      const toolsIdx = result.args.indexOf("--allowedTools");
      expect(toolsIdx).toBeGreaterThan(-1);
      const toolsValue = result.args[toolsIdx + 1];
      expect(toolsValue).toContain("Bash");
    });
  });

  // ── codex ─────────────────────────────────────────────────────────

  describe("codex", () => {
    it("codex exec --full-auto 구성", () => {
      const result = buildAgentInvocation("codex", { prompt: "run test" });
      expect(result.bin).toBe("codex");
      expect(result.args[0]).toBe("exec");
      expect(result.args).toContain("--full-auto");
      expect(result.args).toContain("run test");
    });

    it("apiKey가 있으면 OPENAI_API_KEY를 env에 주입한다", () => {
      const result = buildAgentInvocation("codex", {
        prompt: "test",
        apiKey: "sk-openai-key",
      });
      expect(result.env["OPENAI_API_KEY"]).toBe("sk-openai-key");
    });

    it("apiKey 없으면 OPENAI_API_KEY를 env에 주입하지 않는다", () => {
      const result = buildAgentInvocation("codex", { prompt: "test" });
      expect(result.env["OPENAI_API_KEY"]).toBeUndefined();
    });
  });

  // ── gemini ────────────────────────────────────────────────────────

  describe("gemini", () => {
    it("gemini -p --yolo 구성", () => {
      const result = buildAgentInvocation("gemini", { prompt: "explore app" });
      expect(result.bin).toBe("gemini");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("explore app");
      expect(result.args).toContain("--yolo");
    });

    it("apiKey가 있으면 GEMINI_API_KEY를 env에 주입한다", () => {
      const result = buildAgentInvocation("gemini", {
        prompt: "test",
        apiKey: "gemini-test-key",
      });
      expect(result.env["GEMINI_API_KEY"]).toBe("gemini-test-key");
    });

    it("apiKey 없으면 GEMINI_API_KEY를 env에 주입하지 않는다", () => {
      const result = buildAgentInvocation("gemini", { prompt: "test" });
      expect(result.env["GEMINI_API_KEY"]).toBeUndefined();
    });
  });

  // ── env 최소화 (보안) ─────────────────────────────────────────────

  describe("env 최소화", () => {
    const FAKE_SECRETS = {
      GITHUB_TOKEN: "ghp_faketoken123",
      ANTHROPIC_API_KEY: "sk-ant-fake",
      OPENAI_API_KEY: "sk-openai-fake",
      GEMINI_API_KEY: "gemini-fake",
      AWS_ACCESS_KEY_ID: "AKIAFAKEKEY",
      AWS_SECRET_ACCESS_KEY: "fake-aws-secret",
    };

    beforeEach(() => {
      for (const [k, v] of Object.entries(FAKE_SECRETS)) {
        process.env[k] = v;
      }
    });

    afterEach(() => {
      for (const k of Object.keys(FAKE_SECRETS)) {
        delete process.env[k];
      }
    });

    it("claude: GITHUB_TOKEN이 env에 포함되지 않는다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      expect(result.env["GITHUB_TOKEN"]).toBeUndefined();
    });

    it("claude: AWS_ACCESS_KEY_ID가 env에 포함되지 않는다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      expect(result.env["AWS_ACCESS_KEY_ID"]).toBeUndefined();
    });

    it("claude: AWS_SECRET_ACCESS_KEY가 env에 포함되지 않는다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      expect(result.env["AWS_SECRET_ACCESS_KEY"]).toBeUndefined();
    });

    it("claude apiKey 주입 시 타사 API 키(OPENAI_API_KEY)가 env에 포함되지 않는다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test", apiKey: "sk-my-key" });
      expect(result.env["OPENAI_API_KEY"]).toBeUndefined();
      expect(result.env["GEMINI_API_KEY"]).toBeUndefined();
    });

    it("codex: GITHUB_TOKEN이 env에 포함되지 않는다", () => {
      const result = buildAgentInvocation("codex", { prompt: "test" });
      expect(result.env["GITHUB_TOKEN"]).toBeUndefined();
    });

    it("codex apiKey 주입 시 타사 API 키(ANTHROPIC_API_KEY)가 env에 포함되지 않는다", () => {
      const result = buildAgentInvocation("codex", { prompt: "test", apiKey: "sk-my-openai" });
      expect(result.env["ANTHROPIC_API_KEY"]).toBeUndefined();
      expect(result.env["GEMINI_API_KEY"]).toBeUndefined();
    });

    it("gemini: GITHUB_TOKEN이 env에 포함되지 않는다", () => {
      const result = buildAgentInvocation("gemini", { prompt: "test" });
      expect(result.env["GITHUB_TOKEN"]).toBeUndefined();
    });

    it("gemini apiKey 주입 시 타사 API 키(ANTHROPIC_API_KEY)가 env에 포함되지 않는다", () => {
      const result = buildAgentInvocation("gemini", { prompt: "test", apiKey: "gemini-mykey" });
      expect(result.env["ANTHROPIC_API_KEY"]).toBeUndefined();
      expect(result.env["OPENAI_API_KEY"]).toBeUndefined();
    });

    it("PATH가 env에 포함된다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      expect(result.env["PATH"]).toBeDefined();
    });
  });

  // ── screenshotsDir — 스코프 Read 허용 ────────────────────────────────

  describe("claude: screenshotsDir 전달 시 스코프 Read 허용", () => {
    it("screenshotsDir 전달 시 argv에 Bash와 Read 스코프가 모두 포함된다", () => {
      const result = buildAgentInvocation("claude", {
        prompt: "test",
        screenshotsDir: "/tmp/karax-e2e/screenshots",
      });
      const args = result.args.join(" ");
      expect(args).toContain("Bash");
      expect(args).toContain("Read(///tmp/karax-e2e/screenshots/**)");
    });

    it("screenshotsDir 전달 시 Read 패턴이 정확히 Read(//<dir>/**) 형식이다", () => {
      const dir = "/tmp/karax/session-1/screenshots";
      const result = buildAgentInvocation("claude", {
        prompt: "test",
        screenshotsDir: dir,
      });
      const readPattern = `Read(//${dir}/**)`;
      // --allowedTools 뒤 argv 요소들 중 하나에 정확히 포함돼야 한다
      expect(result.args).toContain(readPattern);
    });

    it("screenshotsDir 미전달 시 기존 argv와 동일하다 (회귀)", () => {
      const withoutDir = buildAgentInvocation("claude", { prompt: "test" });
      const withDir = buildAgentInvocation("claude", { prompt: "test", screenshotsDir: undefined });
      expect(withDir.args).toEqual(withoutDir.args);
    });

    it("screenshotsDir 미전달 시 Read 관련 패턴이 argv에 없다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test" });
      const argsStr = result.args.join(" ");
      expect(argsStr).not.toContain("Read(");
    });

    it("--allowedTools가 두 번 등장한다 (Bash용, Read용 각각 별도 argv)", () => {
      const result = buildAgentInvocation("claude", {
        prompt: "test",
        screenshotsDir: "/tmp/screenshots",
      });
      const count = result.args.filter((a) => a === "--allowedTools").length;
      expect(count).toBe(2);
    });
  });

  describe("codex: screenshotsDir 전달해도 argv 불변", () => {
    it("screenshotsDir 전달 시 codex argv가 바뀌지 않는다", () => {
      const without = buildAgentInvocation("codex", { prompt: "test" });
      const with_ = buildAgentInvocation("codex", {
        prompt: "test",
        screenshotsDir: "/tmp/screenshots",
      });
      expect(with_.args).toEqual(without.args);
    });
  });

  describe("gemini: screenshotsDir 전달해도 argv 불변", () => {
    it("screenshotsDir 전달 시 gemini argv가 바뀌지 않는다", () => {
      const without = buildAgentInvocation("gemini", { prompt: "test" });
      const with_ = buildAgentInvocation("gemini", {
        prompt: "test",
        screenshotsDir: "/tmp/screenshots",
      });
      expect(with_.args).toEqual(without.args);
    });
  });

  // ── assertSafePathArg ────────────────────────────────────────────────

  describe("assertSafePathArg", () => {
    it("유효한 절대경로는 통과한다", () => {
      expect(() => assertSafePathArg("/tmp/karax/screenshots")).not.toThrow();
    });

    it("숫자·대소문자·하이픈·점·슬래시·콜론 포함 경로는 통과한다", () => {
      expect(() => assertSafePathArg("/Users/john/Desktop/worktrees/karax-total/out/2026-01-01/screenshots")).not.toThrow();
    });

    it("공백이 포함된 경로는 INVALID_ARGUMENT를 throw한다", () => {
      expect(() => assertSafePathArg("/tmp/karax screenshots")).toThrow();
    });

    it("세미콜론이 포함된 경로는 INVALID_ARGUMENT를 throw한다", () => {
      expect(() => assertSafePathArg("/tmp/karax;rm -rf /")).toThrow();
    });

    it("백틱이 포함된 경로는 INVALID_ARGUMENT를 throw한다", () => {
      expect(() => assertSafePathArg("/tmp/`whoami`")).toThrow();
    });

    it("상대경로(절대경로 아님)는 INVALID_ARGUMENT를 throw한다", () => {
      expect(() => assertSafePathArg("relative/path/screenshots")).toThrow();
    });

    it("빈 문자열은 INVALID_ARGUMENT를 throw한다", () => {
      expect(() => assertSafePathArg("")).toThrow();
    });

    it("개행 문자가 포함된 경로는 INVALID_ARGUMENT를 throw한다", () => {
      expect(() => assertSafePathArg("/tmp/karax\nrm -rf /")).toThrow();
    });
  });
});

// ── assertSafePathArg throw 에러 타입 검증 ───────────────────────────────

describe("assertSafePathArg E2eError 타입", () => {
  it("위반 경로에서 E2eError(INVALID_ARGUMENT)를 throw한다", async () => {
    const { E2eError } = await import("../types.js");
    expect(() => assertSafePathArg("/tmp/bad path")).toThrowError(E2eError);
  });

  it("INVALID_ARGUMENT 코드를 갖는다", async () => {
    const { E2eError } = await import("../types.js");
    try {
      assertSafePathArg("/tmp/bad;path");
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
      if (e instanceof E2eError) {
        expect(e.code).toBe("INVALID_ARGUMENT");
      }
    }
  });
});
