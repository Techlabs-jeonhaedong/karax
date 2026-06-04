import { describe, expect, it } from "vitest";
import { CLI_VERSION } from "../index.js";

describe("cli 패키지 스텁", () => {
  it("cli stub가 올바른 값을 내보냄", () => {
    expect(CLI_VERSION).toBe("0.0.1");
  });
});
