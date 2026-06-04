import { describe, expect, it } from "vitest";
import { ADAPTER_ID, reactNativeAdapter } from "../index.js";

describe("adapter-react-native 패키지", () => {
  it("ADAPTER_ID가 올바른 값을 내보냄", () => {
    expect(ADAPTER_ID).toBe("react-native");
  });

  it("reactNativeAdapter id가 올바르다", () => {
    expect(reactNativeAdapter.id).toBe("react-native");
  });

  it("FrameworkAdapter 인터페이스를 구현한다", () => {
    expect(typeof reactNativeAdapter.detect).toBe("function");
    expect(typeof reactNativeAdapter.discoverScreens).toBe("function");
    expect(typeof reactNativeAdapter.buildScreenIR).toBe("function");
  });
});
