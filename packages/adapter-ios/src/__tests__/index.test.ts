import { describe, expect, it } from "vitest";
import { ADAPTER_ID } from "../index.js";

describe("adapter-ios 패키지 스텁", () => {
  it("adapter-ios stub가 올바른 값을 내보냄", () => {
    expect(ADAPTER_ID).toBe("ios");
  });
});
