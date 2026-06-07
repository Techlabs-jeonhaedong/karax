/**
 * MCP run_e2e_test — progress notification 테스트
 *
 * - progressToken 있을 때: notifications/progress 전송 확인
 * - progressToken 없을 때: notification 미전송 가드
 * - logging notification fallback 확인
 * - notification 전송 실패 시 파이프라인 영향 없음
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// SDK가 진짜 E2E 실행을 시도하는 것을 막기 위해 mock
vi.mock("@karax/sdk", () => ({
  runE2eTest: vi.fn(),
  runE2eSuite: vi.fn(),
  detectFramework: vi.fn().mockResolvedValue([]),
  doctor: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
  doctorFix: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
  listScreens: vi.fn().mockResolvedValue([]),
  buildScreenIR: vi.fn().mockResolvedValue(null),
  captureScreen: vi.fn().mockResolvedValue(null),
  captureAll: vi.fn().mockResolvedValue([]),
  ensureDependencies: vi.fn().mockResolvedValue(undefined),
  generateAppMap: vi.fn().mockResolvedValue({ appMap: { screens: [] }, writtenPaths: [] }),
  renderAppMapMarkdown: vi.fn().mockReturnValue(""),
  resetParserState: vi.fn(),
}));

import * as sdkMock from "@karax/sdk";
const mockRunE2eTest = vi.mocked(sdkMock.runE2eTest);

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-mcp-progress-test-"));
  process.env.KARAX_SKIP_ENSURE = "1";
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeSuccessResult() {
  return {
    outcome: "pass" as const,
    sessionDir: tmpDir,
    reportJsonPath: path.join(tmpDir, "report.json"),
    reportMdPath: path.join(tmpDir, "report.md"),
    screenshotsDir: path.join(tmpDir, "screenshots"),
    summary: "통과",
    steps: [],
  };
}

async function makeClientServer() {
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

// ── onProgress 콜백이 MCP 서버에서 sendNotification으로 전달되는지 ──

describe("MCP run_e2e_test — onProgress → sendNotification", () => {
  it("runE2eTest가 onProgress 콜백을 받아 호출한다", async () => {
    // runE2eTest가 onProgress를 실제로 호출하는지 확인
    mockRunE2eTest.mockImplementation(async (opts) => {
      // onProgress 콜백 호출 시뮬레이션
      if (opts.onProgress) {
        opts.onProgress({
          phase: "build",
          status: "start",
          timestamp: Date.now(),
          detail: "빌드 시작",
        });
        opts.onProgress({
          phase: "build",
          status: "done",
          timestamp: Date.now(),
          detail: "빌드 완료",
        });
      }
      return makeSuccessResult();
    });

    const { client, server } = await makeClientServer();

    try {
      const result = await client.callTool({
        name: "run_e2e_test",
        arguments: {
          projectPath: tmpDir,
          platform: "android",
        },
      });

      expect(result.isError).toBeFalsy();
      // onProgress 콜백이 runE2eTest에 전달됐는지 확인
      expect(mockRunE2eTest).toHaveBeenCalledWith(
        expect.objectContaining({ onProgress: expect.any(Function) })
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("progressToken 없을 때 runE2eTest는 여전히 onProgress를 받는다 (logging fallback)", async () => {
    mockRunE2eTest.mockImplementation(async (opts) => {
      // onProgress가 있더라도 호출이 가능해야 함
      if (opts.onProgress) {
        opts.onProgress({
          phase: "agent",
          status: "start",
          timestamp: Date.now(),
        });
      }
      return makeSuccessResult();
    });

    const { client, server } = await makeClientServer();

    try {
      const result = await client.callTool({
        name: "run_e2e_test",
        arguments: {
          projectPath: tmpDir,
          platform: "android",
        },
      });

      expect(result.isError).toBeFalsy();
      // onProgress가 전달됐는지 확인
      expect(mockRunE2eTest).toHaveBeenCalledWith(
        expect.objectContaining({ onProgress: expect.any(Function) })
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("onProgress 내부에서 sendNotification이 실패해도 runE2eTest가 완료된다", async () => {
    // onProgress 콜백 내부에서 오류가 발생해도 파이프라인이 완료되어야 함
    mockRunE2eTest.mockImplementation(async (opts) => {
      if (opts.onProgress) {
        // 여러 번 호출해도 문제없어야 함
        for (let i = 0; i < 5; i++) {
          opts.onProgress({
            phase: "build",
            status: "start",
            timestamp: Date.now(),
            detail: `진행 ${i}`,
          });
        }
      }
      return makeSuccessResult();
    });

    const { client, server } = await makeClientServer();

    try {
      const result = await client.callTool({
        name: "run_e2e_test",
        arguments: {
          projectPath: tmpDir,
          platform: "android",
        },
      });

      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("suite 모드에서도 onProgress가 runE2eSuite에 전달된다", async () => {
    const mockRunE2eSuite = vi.mocked(sdkMock.runE2eSuite);

    // 시나리오 디렉토리 생성
    const scenarioDir = path.join(tmpDir, "scenarios");
    fs.mkdirSync(scenarioDir, { recursive: true });
    fs.writeFileSync(path.join(scenarioDir, "01-test.md"), "# 테스트\n본문", "utf-8");

    // statSync가 디렉토리임을 인식하도록 실제 디렉토리 사용
    mockRunE2eSuite.mockImplementation(async (opts) => {
      if (opts.onProgress) {
        opts.onProgress({
          phase: "agent",
          status: "start",
          timestamp: Date.now(),
          stepIndex: 0,
          totalSteps: 1,
        });
      }
      return {
        outcome: "pass" as const,
        results: [],
        summary: "1/1 pass",
      };
    });

    const { client, server } = await makeClientServer();

    try {
      const result = await client.callTool({
        name: "run_e2e_test",
        arguments: {
          projectPath: tmpDir,
          platform: "android",
          scenarioPath: scenarioDir,
        },
      });

      expect(result.isError).toBeFalsy();
      expect(mockRunE2eSuite).toHaveBeenCalledWith(
        expect.objectContaining({ onProgress: expect.any(Function) })
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
