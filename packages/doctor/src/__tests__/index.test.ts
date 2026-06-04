import { describe, expect, it } from "vitest";
import { DOCTOR_VERSION } from "../index.js";

describe("doctor 패키지 스텁", () => {
  it("doctor stub가 올바른 값을 내보냄", () => {
    expect(DOCTOR_VERSION).toBe("0.0.1");
  });
});
