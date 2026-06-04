import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "../index.js";

describe("sdk 패키지 스텁", () => {
  it("sdk stub가 올바른 값을 내보냄", () => {
    expect(SDK_VERSION).toBe("0.0.1");
  });
});
