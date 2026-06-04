import { describe, expect, it } from "vitest";
import { BACKEND_ID } from "../index.js";

describe("compile-ios 패키지 스텁", () => {
  it("compile-ios stub가 올바른 값을 내보냄", () => {
    expect(BACKEND_ID).toBe("ios");
  });
});
