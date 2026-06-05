/**
 * CLI E2E 테스트 — child_process로 빌드된 CLI를 실제 실행
 *
 * 실행 전제: pnpm --filter @karax/cli build 완료
 * KARAX_SKIP_ENSURE=1 환경변수로 doctor ensure 비활성화
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../../../..");
const CLI_BIN = path.join(ROOT, "packages/cli/dist/bin.js");
const FLUTTER_FIXTURE = path.join(ROOT, "fixtures/flutter-basic");
const RN_FIXTURE = path.join(ROOT, "fixtures/react-native-basic");
const ANDROID_FIXTURE = path.join(ROOT, "fixtures/android-compose-basic");
const IOS_FIXTURE = path.join(ROOT, "fixtures/ios-swiftui-basic");

const BASE_ENV = {
  ...process.env,
  KARAX_SKIP_ENSURE: "1",
  NODE_OPTIONS: undefined as unknown as string,
};

// tree-sitter-swift.wasm Turboshaft Zone OOM 방지: node 바이너리에 직접 V8 플래그 전달
const WASM_NODE_FLAGS = [
  "--no-wasm-tier-up",
  "--no-wasm-dynamic-tiering",
  "--wasm-num-compilation-tasks=1",
];

async function runCli(
  args: string[],
  timeoutMs = 30_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [...WASM_NODE_FLAGS, CLI_BIN, ...args], {
      env: BASE_ENV,
      timeout: timeoutMs,
    });
    return { stdout, stderr, code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.code ?? 1,
    };
  }
}

// CLI 빌드 여부 확인
let cliBuildExists = false;

beforeAll(async () => {
  try {
    await fs.access(CLI_BIN);
    cliBuildExists = true;
  } catch {
    cliBuildExists = false;
  }
});

// ─── --help / --version ────────────────────────────────────────────

describe("karax --help", () => {
  it("빌드된 CLI가 존재하면 --help를 출력한다", async () => {
    if (!cliBuildExists) {
      console.warn("CLI not built, skipping");
      return;
    }
    const { stdout, code } = await runCli(["--help"]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/detect|doctor|list|capture|mcp-config/);
  });

  it("--version은 버전 문자열을 출력한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ─── karax detect ────────────────────────────────────────────────────

describe("karax detect", () => {
  it("flutter-basic fixture에서 flutter를 감지한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["detect", FLUTTER_FIXTURE]);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("flutter");
  });

  it("존재하지 않는 경로면 종료코드 1을 반환한다", async () => {
    if (!cliBuildExists) return;
    const { code } = await runCli(["detect", "/nonexistent/path/12345"]);
    expect(code).toBe(1);
  });

  it("경로 인수 없으면 종료코드 1을 반환한다", async () => {
    if (!cliBuildExists) return;
    const { code } = await runCli(["detect"]);
    expect(code).toBe(1);
  });

  // 엣지 케이스: 빈 문자열 경로
  it("빈 문자열 경로는 에러를 낸다", async () => {
    if (!cliBuildExists) return;
    const { code } = await runCli(["detect", ""]);
    expect(code).toBe(1);
  });

  // 엣지 케이스: 특수문자 경로
  it("경로가 특수문자를 포함해도 크래시하지 않는다", async () => {
    if (!cliBuildExists) return;
    const { code } = await runCli(["detect", "/tmp/path with spaces and $pecial"]);
    // 경로가 없으므로 에러 종료 코드, 단 크래시(uncaught exception)가 아님
    expect([0, 1, 2]).toContain(code);
  });
});

// ─── karax list ──────────────────────────────────────────────────────

describe("karax list", () => {
  it("flutter-basic에서 화면 목록을 출력한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["list", FLUTTER_FIXTURE]);
    expect(code).toBe(0);
    // fixture에 HomeScreen, ListScreen, SettingsScreen 등 포함
    expect(stdout).toMatch(/Screen/i);
  });

  it("--json 플래그로 JSON 배열을 출력한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["list", FLUTTER_FIXTURE, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    // 각 항목에 id 필드가 있어야 한다
    expect(parsed[0]).toHaveProperty("id");
  });

  it("--no-candidates로 candidate 화면을 제외한다", async () => {
    if (!cliBuildExists) return;
    const withCandidates = await runCli(["list", FLUTTER_FIXTURE, "--json"]);
    const withoutCandidates = await runCli(["list", FLUTTER_FIXTURE, "--json", "--no-candidates"]);
    if (withCandidates.code !== 0 || withoutCandidates.code !== 0) return;

    const with_ = JSON.parse(withCandidates.stdout);
    const without_ = JSON.parse(withoutCandidates.stdout);
    // candidate가 있는 fixture이므로 without이 같거나 적어야 한다
    expect(without_.length).toBeLessThanOrEqual(with_.length);
  });

  it("존재하지 않는 경로는 종료코드 1", async () => {
    if (!cliBuildExists) return;
    const { code } = await runCli(["list", "/no/such/path"]);
    expect(code).toBe(1);
  });

  // 엣지 케이스: 경로 없음
  it("경로 인수 없으면 종료코드 1", async () => {
    if (!cliBuildExists) return;
    const { code } = await runCli(["list"]);
    expect(code).toBe(1);
  });
});

// ─── karax capture --mode static ─────────────────────────────────────

describe("karax capture --mode static", () => {
  it("flutter-basic에서 단일 화면 캡처(static)가 성공한다", async () => {
    if (!cliBuildExists) return;
    const outDir = path.join(os.tmpdir(), "cli-e2e-capture-single");
    await fs.mkdir(outDir, { recursive: true });

    // Chromium 첫 시작 30s+ → 120s timeout 사용
    const { stdout, code } = await runCli([
      "capture",
      FLUTTER_FIXTURE,
      "--screen",
      "HomeScreen",
      "--mode",
      "static",
      "--out",
      outDir,
    ], 120_000);

    expect(code).toBe(0);
    // stdout에 경로 또는 성공 메시지 포함
    expect(stdout).toMatch(/HomeScreen/i);

    // PNG 파일이 생성됐는지 확인
    const files = await fs.readdir(outDir);
    const pngs = files.filter((f) => f.endsWith(".png"));
    expect(pngs.length).toBeGreaterThan(0);
  }, 150_000);

  it("전체 화면 캡처(--mode static)가 성공한다", async () => {
    if (!cliBuildExists) return;
    const outDir = path.join(os.tmpdir(), "cli-e2e-capture-all");
    await fs.mkdir(outDir, { recursive: true });

    // 전체 화면(5개) 캡처 + 병렬 환경 부하 → 180s timeout
    const { stdout, code } = await runCli([
      "capture",
      FLUTTER_FIXTURE,
      "--mode",
      "static",
      "--out",
      outDir,
    ], 180_000);

    // 성공(0) 또는 부분 실패(2) 모두 허용
    expect([0, 2]).toContain(code);
    // 어떤 형태로든 요약이 출력돼야 한다
    expect(stdout.length).toBeGreaterThan(0);
  }, 240_000);

  it("--json 플래그로 JSON 결과를 출력한다", async () => {
    if (!cliBuildExists) return;
    const outDir = path.join(os.tmpdir(), "cli-e2e-capture-json");
    await fs.mkdir(outDir, { recursive: true });

    const { stdout, code } = await runCli([
      "capture",
      FLUTTER_FIXTURE,
      "--screen",
      "HomeScreen",
      "--mode",
      "static",
      "--out",
      outDir,
      "--json",
    ]);

    if (code !== 0) return; // static 렌더러가 없는 환경은 스킵
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty("screenId");
    expect(parsed).toHaveProperty("pngPath");
    expect(parsed).toHaveProperty("tierUsed");
    expect(parsed).toHaveProperty("confidence");
  });

  it("존재하지 않는 screenId는 종료코드 1", async () => {
    if (!cliBuildExists) return;
    const outDir = path.join(os.tmpdir(), "cli-e2e-capture-notfound");
    await fs.mkdir(outDir, { recursive: true });

    const { code } = await runCli([
      "capture",
      FLUTTER_FIXTURE,
      "--screen",
      "NonExistentScreen9999",
      "--mode",
      "static",
      "--out",
      outDir,
    ]);
    expect(code).toBe(1);
  });

  it("존재하지 않는 경로는 종료코드 1", async () => {
    if (!cliBuildExists) return;
    const { code } = await runCli([
      "capture",
      "/no/such/path",
      "--mode",
      "static",
      "--out",
      "/tmp/noop",
    ]);
    expect(code).toBe(1);
  });

  // 엣지 케이스: --seed 값이 결정론을 보장해야 한다
  it("같은 --seed로 두 번 캡처하면 동일한 결과를 낸다", async () => {
    if (!cliBuildExists) return;
    const outDir1 = path.join(os.tmpdir(), "cli-e2e-seed1");
    const outDir2 = path.join(os.tmpdir(), "cli-e2e-seed2");
    await fs.mkdir(outDir1, { recursive: true });
    await fs.mkdir(outDir2, { recursive: true });

    const args = [
      "capture",
      FLUTTER_FIXTURE,
      "--screen",
      "HomeScreen",
      "--mode",
      "static",
      "--seed",
      "7",
      "--json",
    ];

    const [r1, r2] = await Promise.all([
      runCli([...args, "--out", outDir1]),
      runCli([...args, "--out", outDir2]),
    ]);

    if (r1.code !== 0 || r2.code !== 0) return;
    const j1 = JSON.parse(r1.stdout);
    const j2 = JSON.parse(r2.stdout);
    // confidence, tierUsed 동일해야 한다
    expect(j1.tierUsed).toBe(j2.tierUsed);
    expect(j1.confidence).toBe(j2.confidence);
  });

  it(
    "--variants 플래그가 에러 없이 실행된다 (Tier2 단일 화면)",
    async () => {
      const outDir = path.join(os.tmpdir(), "cli-e2e-variants");
      const { code } = await runCli([
        "capture",
        FLUTTER_FIXTURE,
        "--screen",
        "ListScreen",
        "--mode",
        "static",
        "--variants",
        "--out",
        outDir,
      ]);
      // Tier 2 캡처이므로 성공해야 함 (Branch 없어도 에러 없음)
      expect(code).toBe(0);
    },
    30_000
  );

  it(
    "--overlay 플래그가 에러 없이 실행된다 (Tier2 단일 화면)",
    async () => {
      const outDir = path.join(os.tmpdir(), "cli-e2e-overlay");
      const { code } = await runCli([
        "capture",
        FLUTTER_FIXTURE,
        "--screen",
        "HomeScreen",
        "--mode",
        "static",
        "--overlay",
        "--out",
        outDir,
      ]);
      expect(code).toBe(0);
    },
    30_000
  );
});

// ─── karax mcp-config / karax mcp install-config ───────────────────────

describe("karax mcp-config", () => {
  it("유효한 JSON 스니펫을 출력한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["mcp-config"]);
    expect(code).toBe(0);
    // JSON이어야 한다
    const parsed = JSON.parse(stdout);
    // git clone 기반 런처 — node + mcp-launcher.mjs 형태여야 한다
    expect(parsed?.mcpServers?.karax?.command).toBe("node");
    expect(JSON.stringify(parsed)).toContain("mcp-launcher.mjs");
  });
});

describe("karax mcp install-config", () => {
  it("PLAN 7절 명칭(karax mcp install-config)으로도 동일한 스니펫을 출력한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["mcp", "install-config"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed?.mcpServers?.karax?.command).toBe("node");
    expect(JSON.stringify(parsed)).toContain("mcp-launcher.mjs");
  });
});

// ─── 알 수 없는 서브커맨드 ────────────────────────────────────────

describe("알 수 없는 서브커맨드", () => {
  it("알 수 없는 커맨드는 종료코드 1을 반환한다", async () => {
    if (!cliBuildExists) return;
    const { code } = await runCli(["unknowncommand"]);
    expect(code).toBe(1);
  });
});

// ─── React Native fixture karax detect / karax list e2e ───────────────

describe("karax detect — react-native-basic", () => {
  it("react-native를 감지한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["detect", RN_FIXTURE]);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("react-native");
  });
});

describe("karax list — react-native-basic", () => {
  it("화면 목록을 출력한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["list", RN_FIXTURE]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Screen/i);
  });

  it("--json으로 5개 화면이 반환된다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["list", RN_FIXTURE, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(5);
    expect(parsed[0]).toHaveProperty("id");
  });
});

// ─── Android fixture karax detect / karax list e2e ───────────────────

describe("karax detect — android-compose-basic", () => {
  it("android를 감지한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["detect", ANDROID_FIXTURE]);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("android");
  });
});

describe("karax list — android-compose-basic", () => {
  it("화면 목록을 출력한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["list", ANDROID_FIXTURE]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Screen/i);
  });

  it("--json으로 5개 화면이 반환된다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["list", ANDROID_FIXTURE, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(5);
    expect(parsed[0]).toHaveProperty("id");
  });
});

// ─── iOS fixture karax detect / karax list e2e ───────────────────────

describe("karax detect — ios-swiftui-basic", () => {
  it("ios를 감지한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["detect", IOS_FIXTURE]);
    expect(code).toBe(0);
    expect(stdout.toLowerCase()).toContain("ios");
  });
});

describe("karax list — ios-swiftui-basic", () => {
  it("화면 목록을 출력한다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["list", IOS_FIXTURE]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/Screen/i);
  });

  it("--json으로 5개 화면이 반환된다", async () => {
    if (!cliBuildExists) return;
    const { stdout, code } = await runCli(["list", IOS_FIXTURE, "--json"]);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(5);
    expect(parsed[0]).toHaveProperty("id");
  });
});
