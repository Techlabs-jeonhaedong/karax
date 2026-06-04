import { describe, expect, it } from "vitest";
import { ENRICH_VERSION } from "../index.js";

describe("enrich-llm 패키지 스텁", () => {
  it("enrich-llm stub가 올바른 값을 내보냄", () => {
    expect(ENRICH_VERSION).toBe("0.0.1");
  });
});
