/**
 * MCP 서버 계약 테스트
 *
 * @modelcontextprotocol/sdk의 InMemoryTransport로 서버를 실제 기동해
 * tools/list 7개 확인 + 핵심 tool 실호출 + isError 응답 검증
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  process.env.SFC_SKIP_ENSURE = "1";

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

  it("정확히 7개 tool이 등록됨", async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(7);
  });

  it("모든 tool 이름이 일치함", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "capture_all",
      "capture_screen",
      "detect_framework",
      "doctor",
      "get_analysis_report",
      "get_screen_ir",
      "list_screens",
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
        outDir: "/tmp/sfc-mcp-test",
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
      arguments: { outDir: "/tmp/sfc-mcp-test-all" },
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
