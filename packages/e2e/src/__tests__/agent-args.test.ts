/**
 * agent/args.ts 단위 테스트
 */

import { describe, it, expect } from "vitest";
import { buildAgentInvocation } from "../agent/args.js";

describe("buildAgentInvocation", () => {
  // ── claude ────────────────────────────────────────────────────────

  describe("claude", () => {
    it("기본 플래그를 구성한다", () => {
      const result = buildAgentInvocation("claude", { prompt: "test prompt" });
      expect(result.bin).toBe("claude");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("test prompt");
      expect(result.args).toContain("--dangerously-skip-permissions");
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

  // ── 공통 ──────────────────────────────────────────────────────────

  it("env는 process.env를 기반으로 한다", () => {
    const result = buildAgentInvocation("claude", { prompt: "test" });
    // PATH 등 기존 env가 포함되어야 함
    expect(result.env).toHaveProperty("PATH");
  });
});
