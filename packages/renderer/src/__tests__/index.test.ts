import { describe, expect, it } from "vitest";
import { RENDERER_VERSION } from "../index.js";

describe("renderer 패키지 스텁", () => {
  it("renderer stub가 올바른 값을 내보냄", () => {
    expect(RENDERER_VERSION).toBe("0.0.1");
  });
});
