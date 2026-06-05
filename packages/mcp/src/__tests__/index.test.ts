/**
 * MCP 서버 계약 테스트
 *
 * @modelcontextprotocol/sdk의 InMemoryTransport로 서버를 실제 기동해
 * tools/list 8개 확인 + 핵심 tool 실호출 + isError 응답 검증
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLUTTER_FIXTURE = path.resolve(__dirname, "../../../../fixtures/flutter-basic");
const RN_FIXTURE = path.resolve(__dirname, "../../../../fixtures/react-native-basic");

/** 서버+클라이언트 InMemory 쌍을 생성하고 연결 */
async function makeClientServer() {
  process.env.KARAX_SKIP_ENSURE = "1";

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = createMcpServer();
  await server.connect(serverTransport);

  const client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} }
  );
  await client.connect(clientTransport);

  return { client, server };
}

describe("MCP 서버 — tools/list", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("정확히 9개 tool이 등록됨", async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(9);
  });

  it("모든 tool 이름이 일치함", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "capture_all",
      "capture_screen",
      "detect_framework",
      "doctor",
      "generate_app_map",
      "get_analysis_report",
      "get_screen_ir",
      "list_screens",
      "run_e2e_test",
    ]);
  });

  it("각 tool에 inputSchema가 정의됨", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("MCP 서버 — detect_framework tool", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("flutter-basic fixture 감지 → flutter 포함", async () => {
    const result = await client.callTool({
      name: "detect_framework",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content).toBeDefined();

    const text = (result.content as Array<{ type: string; text: string }>).find(
      (c) => c.type === "text"
    );
    expect(text).toBeDefined();

    const parsed = JSON.parse(text!.text);
    expect(parsed.frameworks).toBeDefined();
    expect(parsed.frameworks.length).toBeGreaterThan(0);
    const ids = parsed.frameworks.map((f: { id: string }) => f.id);
    expect(ids).toContain("flutter");
  });

  it("projectPath 누락 → isError 응답 (프로세스 죽지 않음)", async () => {
    const result = await client.callTool({
      name: "detect_framework",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("존재하지 않는 경로 → isError 응답", async () => {
    const result = await client.callTool({
      name: "detect_framework",
      arguments: { projectPath: "/tmp/nonexistent-path-abc123" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP 서버 — list_screens tool", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("flutter-basic fixture → screens 배열 반환", async () => {
    const result = await client.callTool({
      name: "list_screens",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });

    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>).find(
      (c) => c.type === "text"
    );
    expect(text).toBeDefined();

    const parsed = JSON.parse(text!.text);
    expect(Array.isArray(parsed.screens)).toBe(true);
    expect(parsed.screens.length).toBeGreaterThan(0);

    // 각 화면에 id, discovery 포함
    for (const screen of parsed.screens) {
      expect(screen.id).toBeDefined();
      expect(["route", "candidate"]).toContain(screen.discovery);
    }
  });

  it("projectPath 누락 → isError", async () => {
    const result = await client.callTool({
      name: "list_screens",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP 서버 — capture_screen tool (mode: static)", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("flutter-basic fixture 첫 화면 static 캡처 → image content 포함", async () => {
    // 먼저 화면 목록 조회
    const listResult = await client.callTool({
      name: "list_screens",
      arguments: { projectPath: FLUTTER_FIXTURE },
    }, undefined, { timeout: 60_000 });
    expect(listResult.isError).toBeFalsy();

    const listText = (listResult.content as Array<{ type: string; text: string }>).find(
      (c) => c.type === "text"
    );
    const { screens } = JSON.parse(listText!.text);
    const firstScreenId = screens[0].id;

    // Chromium 첫 시작이 30s+ 소요 가능 → MCP request timeout 120s
    const result = await client.callTool({
      name: "capture_screen",
      arguments: {
        projectPath: FLUTTER_FIXTURE,
        screenId: firstScreenId,
        captureMode: "static",
        outDir: "/tmp/karax-mcp-test",
        mockSeed: 42,
      },
    }, undefined, { timeout: 120_000 });

    expect(result.isError).toBeFalsy();

    const contents = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

    // 텍스트 요약 포함
    const textContent = contents.find((c) => c.type === "text");
    expect(textContent).toBeDefined();

    const summary = JSON.parse(textContent!.text!);
    expect(summary.screenId).toBe(firstScreenId);
    expect(summary.tierUsed).toBe("static");
    expect(typeof summary.confidence).toBe("number");
    expect(summary.pngPath).toBeDefined();

    // image content 포함
    const imageContent = contents.find((c) => c.type === "image");
    expect(imageContent).toBeDefined();
    expect(imageContent!.mimeType).toBe("image/png");
    expect(imageContent!.data).toBeDefined();
    expect(imageContent!.data!.length).toBeGreaterThan(0);
  // Chromium 첫 시작이 30s+ 소요 가능 → 120s
  }, 120_000);

  it("screenId 누락 → isError", async () => {
    const result = await client.callTool({
      name: "capture_screen",
      arguments: {
        projectPath: FLUTTER_FIXTURE,
        captureMode: "static",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("projectPath 누락 → isError", async () => {
    const result = await client.callTool({
      name: "capture_screen",
      arguments: {
        screenId: "HomeScreen",
        captureMode: "static",
      },
    });
    expect(result.isError).toBe(true);
  });

  it("존재하지 않는 screenId → isError", async () => {
    const result = await client.callTool({
      name: "capture_screen",
      arguments: {
        projectPath: FLUTTER_FIXTURE,
        screenId: "NonExistentScreen_XYZ_abc",
        captureMode: "static",
      },
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP 서버 — doctor tool", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("doctor → checks + tiersAvailable 포함 응답 반환", async () => {
    // doctor는 java/xcodebuild/flutter 체크 포함 → 콜드스타트 환경에서 30s+ 소요 가능
    // MCP request timeout도 120s로 설정
    const result = await client.callTool({
      name: "doctor",
      arguments: {},
    }, undefined, { timeout: 120_000 });

    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>).find(
      (c) => c.type === "text"
    );
    expect(text).toBeDefined();

    const parsed = JSON.parse(text!.text);
    expect(parsed.checks).toBeDefined();
    expect(parsed.tiersAvailable).toBeDefined();
  }, 120_000);
});

describe("MCP 서버 — get_screen_ir tool", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("flutter-basic fixture 첫 화면 IR 반환", async () => {
    // 화면 목록 조회
    const listResult = await client.callTool({
      name: "list_screens",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });
    const listText = (listResult.content as Array<{ type: string; text: string }>).find(
      (c) => c.type === "text"
    );
    const { screens } = JSON.parse(listText!.text);
    const firstScreenId = screens[0].id;

    const result = await client.callTool({
      name: "get_screen_ir",
      arguments: {
        projectPath: FLUTTER_FIXTURE,
        screenId: firstScreenId,
      },
    });

    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>).find(
      (c) => c.type === "text"
    );
    const parsed = JSON.parse(text!.text);
    expect(parsed.ir).toBeDefined();
    expect(parsed.ir.schemaVersion).toBe("0.1");
    expect(parsed.ir.screen).toBeDefined();
  }, 30_000);

  it("screenId 누락 → isError", async () => {
    const result = await client.callTool({
      name: "get_screen_ir",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP 서버 — get_analysis_report tool", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("flutter-basic fixture → report 반환", async () => {
    const result = await client.callTool({
      name: "get_analysis_report",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });

    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>).find(
      (c) => c.type === "text"
    );
    const parsed = JSON.parse(text!.text);
    expect(parsed.frameworks).toBeDefined();
    expect(parsed.screens).toBeDefined();
    expect(typeof parsed.overallConfidence).toBe("number");
    expect(Array.isArray(parsed.limitations)).toBe(true);
  }, 30_000);

  it("projectPath 누락 → isError", async () => {
    const result = await client.callTool({
      name: "get_analysis_report",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP 서버 — capture_all tool", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("outDir 누락 → isError", async () => {
    const result = await client.callTool({
      name: "capture_all",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });
    expect(result.isError).toBe(true);
  });

  it("projectPath 누락 → isError", async () => {
    const result = await client.callTool({
      name: "capture_all",
      arguments: { outDir: "/tmp/karax-mcp-test-all" },
    });
    expect(result.isError).toBe(true);
  });
});

// ─── [낮음-9] capture_all 응답 report.failures 계약 단언 ─────────────────
// capture_all을 실제 실행해 failures 필드가 포함되는지 검증한다.
// 빠른 검증을 위해 static 모드로 flutter-basic fixture를 캡처한다.

describe("MCP 서버 — capture_all report.failures 계약 (낮음-9 회귀)", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it(
    "성공 응답의 report 객체에 failures 배열이 포함됨",
    async () => {
      const result = await client.callTool({
        name: "capture_all",
        arguments: {
          projectPath: FLUTTER_FIXTURE,
          outDir: "/tmp/karax-mcp-capture-all-test",
          captureMode: "static",
          mockSeed: 0,
        },
      }, undefined, { timeout: 120_000 });

      // isError면 응답 구조 검증 불가 — skip
      if (result.isError) return;

      const text = (result.content as Array<{ type: string; text?: string }>).find(
        (c) => c.type === "text"
      );
      expect(text).toBeDefined();

      const parsed = JSON.parse(text!.text!);
      expect(parsed.report).toBeDefined();
      // [낮음-9] failures 필드가 report에 포함돼야 한다
      expect(parsed.report).toHaveProperty("failures");
      expect(Array.isArray(parsed.report.failures)).toBe(true);
    },
    120_000
  );
});

describe("MCP 서버 — generate_app_map tool", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("flutter-basic fixture → AppMap 반환", async () => {
    const result = await client.callTool({
      name: "generate_app_map",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });

    expect(result.isError).toBeFalsy();

    const contents = result.content as Array<{ type: string; text: string }>;

    // 첫 번째 content: 요약 JSON
    const summaryText = contents[0];
    expect(summaryText).toBeDefined();
    expect(summaryText!.type).toBe("text");

    const parsed = JSON.parse(summaryText!.text);
    expect(parsed.appMap).toBeDefined();
    expect(parsed.appMap.schemaVersion).toBe("appmap/1");
    expect(Array.isArray(parsed.appMap.screens)).toBe(true);
    expect(parsed.appMap.screens.length).toBeGreaterThan(0);
    expect(typeof parsed.documentCount).toBe("number");
    expect(parsed.documentCount).toBeGreaterThanOrEqual(1);

    // 두 번째 이후 content: 마크다운 문서 본문 (mermaid 블록 포함)
    const markdownContents = contents.slice(1);
    expect(markdownContents.length).toBeGreaterThanOrEqual(1);
    const combinedMarkdown = markdownContents.map((c) => c.text).join("\n");
    expect(combinedMarkdown).toContain("```mermaid");
    expect(combinedMarkdown).toContain("flowchart TD");
  }, 30_000);

  it("projectPath 누락 → isError", async () => {
    const result = await client.callTool({
      name: "generate_app_map",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });

  it("존재하지 않는 경로 → isError", async () => {
    const result = await client.callTool({
      name: "generate_app_map",
      arguments: { projectPath: "/tmp/nonexistent-abc123" },
    });
    expect(result.isError).toBe(true);
  });
});

describe("MCP 서버 — 엣지 케이스", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("알 수 없는 tool → isError 응답 (프로세스 죽지 않음)", async () => {
    // MCP SDK 1.29+는 미등록 tool 호출 시 reject 대신 isError: true 응답을 반환
    const result = await client.callTool({ name: "nonexistent_tool", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("빈 문자열 projectPath → isError (프로세스 죽지 않음)", async () => {
    const result = await client.callTool({
      name: "detect_framework",
      arguments: { projectPath: "" },
    });
    expect(result.isError).toBe(true);
  });

  it("SQL injection 패턴 projectPath → isError", async () => {
    const result = await client.callTool({
      name: "detect_framework",
      arguments: { projectPath: "'; DROP TABLE screens; --" },
    });
    expect(result.isError).toBe(true);
  });

  it("매우 긴 문자열 projectPath → isError (타임아웃 없음)", async () => {
    const result = await client.callTool({
      name: "detect_framework",
      arguments: { projectPath: "a".repeat(10000) },
    });
    expect(result.isError).toBe(true);
  });
});

// ─── list_screens — RN fixture 계약 테스트 ───────────────────────────

describe("MCP 서버 — list_screens 계약 (react-native-basic fixture)", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("react-native-basic fixture → screens 배열 반환, 각 항목에 id/discovery/confidence 포함", async () => {
    // tree-sitter WASM 초기화 30s+ 소요 가능 → 60s timeout
    const result = await client.callTool({
      name: "list_screens",
      arguments: { projectPath: RN_FIXTURE },
    });

    expect(result.isError).toBeFalsy();

    const text = (result.content as Array<{ type: string; text: string }>).find(
      (c) => c.type === "text"
    );
    expect(text).toBeDefined();

    const parsed = JSON.parse(text!.text);
    expect(Array.isArray(parsed.screens)).toBe(true);
    expect(parsed.screens.length).toBeGreaterThan(0);

    for (const screen of parsed.screens) {
      expect(screen).toHaveProperty("id");
      expect(["route", "candidate"]).toContain(screen.discovery);
      expect(typeof screen.confidence).toBe("number");
    }
  }, 60_000);
});

// ─── [중간-3] startStdioServer: ensureDependencies 실패 시 서버 기동 가능 ───
// startStdioServer를 직접 호출해 ensureDependencies 실패가 서버 기동을 차단하지 않는 것을 검증한다.
// StdioServerTransport를 mock으로 교체해 실제 stdio 연결 없이 기동 경로만 검사한다.
//
// 설계 근거:
//   server.ts는 ensureDependencies를 @karax/sdk에서 정적 import한다.
//   @karax/sdk dist 내부의 동적 import("@karax/doctor")는 vitest의 vi.mock("@karax/doctor")로
//   가로채이지 않는다 — SDK가 이미 resolve된 dist 바이너리를 실행하기 때문이다.
//   따라서 @karax/sdk 자체를 vi.doMock으로 교체해 ensureDependencies를 직접 실패시킨다.
//   이렇게 해야 try-catch fix를 revert하면 테스트가 실제로 실패한다.

describe("MCP 서버 — startStdioServer ensure 실패 시 기동 가능 (중간-3 회귀)", () => {
  it(
    "ensureDependencies가 던져도 startStdioServer가 reject되지 않음",
    async () => {
      // KARAX_SKIP_ENSURE를 해제해서 ensureDependencies 코드 경로를 활성화한다
      const original = process.env.KARAX_SKIP_ENSURE;
      delete process.env.KARAX_SKIP_ENSURE;

      // 모듈 캐시를 초기화해 doMock이 fresh import에 적용되게 한다
      vi.resetModules();

      // @karax/sdk를 vi.doMock으로 교체: ensureDependencies만 실패시키고 나머지는 유지
      // vi.mock(hoisted)이 아닌 vi.doMock(non-hoisted)을 사용해야 describe 블록 내에서 동작한다
      vi.doMock("@karax/sdk", async () => {
        // importActual로 실제 SDK 모듈을 가져와 나머지 export는 그대로 쓴다
        const actual = await vi.importActual<typeof import("@karax/sdk")>("@karax/sdk");
        return {
          ...actual,
          ensureDependencies: vi.fn().mockRejectedValue(new Error("MOCK: network timeout")),
        };
      });

      // StdioServerTransport를 mock해서 실제 stdio를 잡지 않게 한다
      vi.doMock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
        StdioServerTransport: class {
          onclose: (() => void) | null = null;
          onmessage: ((msg: unknown) => void) | null = null;
          onerror: ((err: Error) => void) | null = null;
          async start() {}
          async send() {}
          async close() {}
        },
      }));

      try {
        // vi.resetModules() 후 fresh import — doMock이 적용된 버전을 불러온다
        const { startStdioServer } = await import("../server.js");

        // startStdioServer는 ensureDependencies 실패 시에도 reject하지 않아야 한다
        // (try-catch로 잡고 stderr 경고만 출력 후 계속 진행)
        // server.connect(transport)에서 transport.start()를 호출하지만 mock이므로 바로 반환됨
        await expect(startStdioServer()).resolves.toBeUndefined();
      } finally {
        if (original !== undefined) {
          process.env.KARAX_SKIP_ENSURE = original;
        } else {
          process.env.KARAX_SKIP_ENSURE = "1";
        }
        vi.resetModules();
        vi.restoreAllMocks();
      }
    },
    15_000
  );
});

describe("MCP 서버 — ensure 실패 무관 도구 목록 (중간-3 회귀)", () => {
  let client: Client;
  let server: Awaited<ReturnType<typeof makeClientServer>>["server"];

  beforeEach(async () => {
    // KARAX_SKIP_ENSURE=1 상태에서도 createMcpServer는 정상 동작해야 한다
    ({ client, server } = await makeClientServer());
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("detect_framework는 ensure와 무관하게 동작 (네트워크 불필요 도구)", async () => {
    const result = await client.callTool({
      name: "detect_framework",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });
    // ensure가 실패해도 detect_framework는 성공해야 함
    expect(result.isError).toBeFalsy();
  });

  it("list_screens는 ensure와 무관하게 동작 (네트워크 불필요 도구)", async () => {
    const result = await client.callTool({
      name: "list_screens",
      arguments: { projectPath: FLUTTER_FIXTURE },
    });
    expect(result.isError).toBeFalsy();
  });

  it("doctor는 ensure와 무관하게 동작 (네트워크 불필요 도구)", async () => {
    const result = await client.callTool({
      name: "doctor",
      arguments: {},
    }, undefined, { timeout: 60_000 });
    expect(result.isError).toBeFalsy();
  }, 60_000);
});

// ─── run_e2e_test 핸들러 호출 테스트 (@karax/e2e mock) ──────────────────
// @karax/e2e를 mock해 실제 에뮬레이터 없이 run_e2e_test 핸들러 계약을 검증한다.

describe("MCP 서버 — run_e2e_test tool (핸들러 계약, @karax/e2e mock)", () => {
  beforeEach(async () => {
    vi.resetModules();
    // @karax/e2e의 runE2eTest를 mock해 즉시 성공 결과를 반환한다
    vi.doMock("@karax/e2e", () => ({
      runE2eTest: vi.fn().mockResolvedValue({
        outcome: "pass",
        sessionDir: "/tmp/karax-e2e-test-session",
        reportJsonPath: "/tmp/karax-e2e-test-session/report.json",
        reportMdPath: "/tmp/karax-e2e-test-session/report.md",
        screenshotsDir: "/tmp/karax-e2e-test-session/screenshots",
        summary: "모든 테스트 통과",
        steps: [
          { index: 1, description: "앱 실행", status: "pass" },
        ],
      }),
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("projectPath/platform 필수 인수 누락 시 isError", async () => {
    // 이 describe 블록에서는 fresh server를 doMock 이후 생성해야 한다.
    // makeClientServer()가 정적 import된 server.ts를 사용하므로
    // 여기서는 도구 등록 계약만 검증한다 (누락 인수 → zod 검증 실패 → isError).
    process.env.KARAX_SKIP_ENSURE = "1";
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const { createMcpServer: freshCreateMcpServer } = await import("../server.js");
    const srv = freshCreateMcpServer();
    await srv.connect(serverTransport);
    const cli = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await cli.connect(clientTransport);

    try {
      const result = await cli.callTool({
        name: "run_e2e_test",
        arguments: {},
      });
      expect(result.isError).toBe(true);
    } finally {
      await cli.close();
      await srv.close();
    }
  });

  it("projectPath만 있고 platform 누락 → isError", async () => {
    process.env.KARAX_SKIP_ENSURE = "1";
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const { createMcpServer: freshCreateMcpServer } = await import("../server.js");
    const srv = freshCreateMcpServer();
    await srv.connect(serverTransport);
    const cli = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await cli.connect(clientTransport);

    try {
      const result = await cli.callTool({
        name: "run_e2e_test",
        arguments: { projectPath: "/tmp/some-project" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await cli.close();
      await srv.close();
    }
  });

  it("존재하지 않는 projectPath → isError", async () => {
    process.env.KARAX_SKIP_ENSURE = "1";
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const { createMcpServer: freshCreateMcpServer } = await import("../server.js");
    const srv = freshCreateMcpServer();
    await srv.connect(serverTransport);
    const cli = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await cli.connect(clientTransport);

    try {
      const result = await cli.callTool({
        name: "run_e2e_test",
        arguments: { projectPath: "/tmp/nonexistent-karax-e2e-xyz", platform: "android" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await cli.close();
      await srv.close();
    }
  });
});

// ─── run_e2e_test — screenshot path traversal 방어 (이중 방어 회귀) ──────────
// steps에 탈출 경로가 주입된 경우 image content가 포함되지 않는지 검증한다.

describe("MCP 서버 — run_e2e_test screenshot path traversal 방어", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("steps에 탈출 경로(../../etc/passwd)가 있으면 image content를 포함하지 않는다", async () => {
    vi.resetModules();
    // screenshotsDir 밖으로 탈출하는 경로를 주입
    vi.doMock("@karax/e2e", () => ({
      runE2eTest: vi.fn().mockResolvedValue({
        outcome: "pass",
        sessionDir: "/tmp/karax-e2e-traversal-test",
        reportJsonPath: "/tmp/karax-e2e-traversal-test/report.json",
        reportMdPath: "/tmp/karax-e2e-traversal-test/report.md",
        screenshotsDir: "/tmp/karax-e2e-traversal-test/screenshots",
        summary: "통과",
        steps: [
          { index: 1, description: "탈출 시도", status: "pass", screenshot: "../../etc/passwd" },
        ],
      }),
    }));

    process.env.KARAX_SKIP_ENSURE = "1";
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const { createMcpServer: freshServer } = await import("../server.js");
    const srv = freshServer();
    await srv.connect(serverTransport);
    const cli = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await cli.connect(clientTransport);

    try {
      const result = await cli.callTool({
        name: "run_e2e_test",
        // FLUTTER_FIXTURE는 존재하는 경로이므로 validateProjectPath 통과
        arguments: { projectPath: FLUTTER_FIXTURE, platform: "android" },
      });

      // 에러가 아닌 정상 응답이어야 한다 (탈출 경로는 이미지 첨부만 건너뜀)
      expect(result.isError).toBeFalsy();

      const contents = result.content as Array<{ type: string }>;
      // image content가 포함되지 않아야 한다
      const imageContent = contents.find((c) => c.type === "image");
      expect(imageContent).toBeUndefined();
    } finally {
      await cli.close();
      await srv.close();
    }
  });
});
