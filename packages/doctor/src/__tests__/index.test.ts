import { describe, expect, it } from "vitest";
import { runDoctor } from "../index.js";

describe("doctor 패키지 export", () => {
  it("runDoctor 함수가 export됨", () => {
    expect(typeof runDoctor).toBe("function");
  });
});
