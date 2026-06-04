import { describe, expect, it } from "vitest";
import { MCP_VERSION } from "../index.js";

describe("mcp 패키지 스텁", () => {
  it("mcp stub가 올바른 값을 내보냄", () => {
    expect(MCP_VERSION).toBe("0.0.1");
  });
});
