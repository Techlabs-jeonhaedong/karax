/**
 * agent/args.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildAgentInvocation, isPathSafeForReadRule } from "../agent/args.js";

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

    // ── 유니코드/한글 경로 허용 (회귀 방지) ──────────────────────────

    it("한글 경로 — Read 스코프 포함됨 (회귀 방지)", () => {
      const dir = "/tmp/한글/screenshots";
      const result = buildAgentInvocation("claude", {
        prompt: "test",
        screenshotsDir: dir,
      });
      const args = result.args.join(" ");
      expect(args).toContain(`Read(//${dir}/**)`);
      // Bash는 항상 유지돼야 한다
      expect(args).toContain("Bash");
    });

    it("@ 포함 경로 — Read 스코프 포함됨", () => {
      const dir = "/Users/user@domain/screenshots";
      const result = buildAgentInvocation("claude", {
        prompt: "test",
        screenshotsDir: dir,
      });
      expect(result.args).toContain(`Read(//${dir}/**)`);
    });

    it("공백 포함 경로 — Read 미포함, Bash는 유지, throw 안 함", () => {
      const dir = "/Users/user/my screenshots";
      expect(() => {
        const result = buildAgentInvocation("claude", {
          prompt: "test",
          screenshotsDir: dir,
        });
        // throw 안 해야 한다
        // Bash는 반드시 유지
        expect(result.args).toContain("Bash");
        // Read 스코프는 추가되지 않아야 한다
        const argsStr = result.args.join(" ");
        expect(argsStr).not.toContain("Read(");
      }).not.toThrow();
    });

    it(") 포함 경로 — Read 미포함, throw 안 함", () => {
      const dir = "/Users/user/Desktop (2)/screenshots";
      expect(() => {
        const result = buildAgentInvocation("claude", {
          prompt: "test",
          screenshotsDir: dir,
        });
        const argsStr = result.args.join(" ");
        expect(argsStr).not.toContain("Read(");
        // Bash는 유지
        expect(result.args).toContain("Bash");
      }).not.toThrow();
    });

    it("개행 포함 경로 — Read 미포함, throw 안 함", () => {
      const dir = "/tmp/karax\nrm -rf /";
      expect(() => {
        const result = buildAgentInvocation("claude", {
          prompt: "test",
          screenshotsDir: dir,
        });
        const argsStr = result.args.join(" ");
        expect(argsStr).not.toContain("Read(");
        expect(result.args).toContain("Bash");
      }).not.toThrow();
    });

    it("일반 ASCII 경로 — Read 스코프 포함됨 (기존 정상 케이스 회귀)", () => {
      const dir = "/Users/john/Desktop/worktrees/karax-total/out/2026-01-01/screenshots";
      const result = buildAgentInvocation("claude", {
        prompt: "test",
        screenshotsDir: dir,
      });
      expect(result.args).toContain(`Read(//${dir}/**)`);
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
});

// ── isPathSafeForReadRule ────────────────────────────────────────────────

describe("isPathSafeForReadRule", () => {
  // 허용 케이스
  it("일반 ASCII 절대경로는 safe를 반환한다", () => {
    expect(isPathSafeForReadRule("/tmp/karax/screenshots")).toBe(true);
  });

  it("숫자·대소문자·하이픈·점·슬래시·콜론 포함 경로는 safe를 반환한다", () => {
    expect(isPathSafeForReadRule("/Users/john/Desktop/worktrees/karax-total/out/2026-01-01")).toBe(true);
  });

  it("한글 경로는 safe를 반환한다 (유니코드 허용)", () => {
    expect(isPathSafeForReadRule("/tmp/한글/screenshots")).toBe(true);
  });

  it("일본어 포함 경로는 safe를 반환한다 (유니코드 허용)", () => {
    expect(isPathSafeForReadRule("/Users/user/デスクトップ/screenshots")).toBe(true);
  });

  it("@ 포함 경로는 safe를 반환한다", () => {
    expect(isPathSafeForReadRule("/Users/user@domain/screenshots")).toBe(true);
  });

  it("언더스코어·점 포함 경로는 safe를 반환한다", () => {
    expect(isPathSafeForReadRule("/tmp/karax_e2e/session.1/out")).toBe(true);
  });

  // 불허 케이스 — Read 규칙 구문·인자 분리를 깨는 문자들
  it("공백 포함 경로는 false를 반환한다 (--allowedTools 공백 구분 깨짐)", () => {
    expect(isPathSafeForReadRule("/tmp/karax screenshots")).toBe(false);
  });

  it(") 포함 경로는 false를 반환한다 (Read() 구문 조기 종료)", () => {
    expect(isPathSafeForReadRule("/Users/user/Desktop (2)/screenshots")).toBe(false);
  });

  it("( 포함 경로는 false를 반환한다", () => {
    expect(isPathSafeForReadRule("/Users/user/Desktop(work)/screenshots")).toBe(false);
  });

  it("* 포함 경로는 false를 반환한다 (글로브 충돌)", () => {
    expect(isPathSafeForReadRule("/tmp/karax*/screenshots")).toBe(false);
  });

  it(", 포함 경로는 false를 반환한다 (인자 구분자)", () => {
    expect(isPathSafeForReadRule("/tmp/karax,other/screenshots")).toBe(false);
  });

  it("세미콜론 포함 경로는 false를 반환한다 (셸 메타문자)", () => {
    expect(isPathSafeForReadRule("/tmp/karax;rm -rf /")).toBe(false);
  });

  it("백틱 포함 경로는 false를 반환한다 (셸 메타문자)", () => {
    expect(isPathSafeForReadRule("/tmp/`whoami`")).toBe(false);
  });

  it("개행 포함 경로는 false를 반환한다 (제어문자)", () => {
    expect(isPathSafeForReadRule("/tmp/karax\nrm -rf /")).toBe(false);
  });

  it("탭 포함 경로는 false를 반환한다 (제어문자)", () => {
    expect(isPathSafeForReadRule("/tmp/karax\tpath")).toBe(false);
  });

  it("빈 문자열은 false를 반환한다", () => {
    expect(isPathSafeForReadRule("")).toBe(false);
  });

  it("상대경로는 false를 반환한다", () => {
    expect(isPathSafeForReadRule("relative/path/screenshots")).toBe(false);
  });

  it("$ 포함 경로는 false를 반환한다 (변수 치환)", () => {
    expect(isPathSafeForReadRule("/tmp/$HOME/screenshots")).toBe(false);
  });

  it("& 포함 경로는 false를 반환한다 (셸 메타문자)", () => {
    expect(isPathSafeForReadRule("/tmp/karax&other")).toBe(false);
  });

  it("| 포함 경로는 false를 반환한다 (파이프)", () => {
    expect(isPathSafeForReadRule("/tmp/karax|other")).toBe(false);
  });

  it("? 포함 경로는 false를 반환한다 (글로브)", () => {
    expect(isPathSafeForReadRule("/tmp/karax?screenshots")).toBe(false);
  });

  it("! 포함 경로는 false를 반환한다 (히스토리 치환)", () => {
    expect(isPathSafeForReadRule("/tmp/karax!screenshots")).toBe(false);
  });

  it("# 포함 경로는 false를 반환한다 (주석)", () => {
    expect(isPathSafeForReadRule("/tmp/karax#screenshots")).toBe(false);
  });
});
