/**
 * agent/args.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAgentInvocation } from "../agent/args.js";

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
});
