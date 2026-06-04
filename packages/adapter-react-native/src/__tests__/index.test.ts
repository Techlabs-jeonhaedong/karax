import { describe, expect, it } from "vitest";
import { ADAPTER_ID } from "../index.js";

describe("adapter-react-native 패키지 스텁", () => {
  it("adapter-react-native stub가 올바른 값을 내보냄", () => {
    expect(ADAPTER_ID).toBe("react-native");
  });
});
