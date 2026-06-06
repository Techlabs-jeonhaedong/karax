/**
 * karax ui 서브커맨드 단위 테스트
 *
 * dumpAndroidUI를 mock해서 실제 adb 없이 JSON 출력 계약과 exit code를 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

// dumpAndroidUI + dumpIosUI + isIdbAvailable mock
vi.mock("@karax/e2e", () => ({
  dumpAndroidUI: vi.fn(),
  dumpIosUI: vi.fn(),
  isIdbAvailable: vi.fn(),
  E2eError: class E2eError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = "E2eError";
    }
  },
}));

import { dumpAndroidUI, dumpIosUI, isIdbAvailable } from "@karax/e2e";
import {
  parseUiArgs,
  runUiDump,
  runUiLocate,
  runUiWhichScreen,
  type UiDumpResult,
  type UiLocateResult,
  type UiWhichScreenResult,
  type UiErrorResult,
} from "../commands/ui.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDump = dumpAndroidUI as any as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDumpIos = dumpIosUI as any as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockIsIdbAvailable = isIdbAvailable as any as ReturnType<typeof vi.fn>;

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]">
    <node index="0" text="로그인" resource-id="com.example:id/btn_login" class="android.widget.Button" content-desc="로그인 버튼" clickable="true" enabled="true" bounds="[100,500][980,700]"/>
    <node index="1" text="회원가입" resource-id="com.example:id/btn_register" class="android.widget.Button" content-desc="" clickable="true" enabled="true" bounds="[100,800][980,1000]"/>
    <node index="2" text="이용약관" resource-id="" class="android.widget.TextView" content-desc="" clickable="false" enabled="true" bounds="[100,1100][980,1200]"/>
  </node>
</hierarchy>`;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── parseUiArgs ─────────────────────────────────────────────────────

describe("parseUiArgs", () => {
  it("dump 서브커맨드와 --device를 파싱한다", () => {
    const args = parseUiArgs(["dump", "--device", "emulator-5554"]);
    expect(args.subcommand).toBe("dump");
    expect(args.device).toBe("emulator-5554");
    expect(args.platform).toBe("android"); // 기본값
  });

  it("locate 서브커맨드와 --label을 파싱한다", () => {
    const args = parseUiArgs(["locate", "--device", "emulator-5554", "--label", "로그인 버튼"]);
    expect(args.subcommand).toBe("locate");
    expect(args.label).toBe("로그인 버튼");
  });

  it("which-screen 서브커맨드를 파싱한다", () => {
    const args = parseUiArgs([
      "which-screen",
      "--device",
      "emulator-5554",
      "--appmap",
      "/tmp/appmap.json",
    ]);
    expect(args.subcommand).toBe("which-screen");
    expect(args.appmap).toBe("/tmp/appmap.json");
  });

  it("--platform android 파싱", () => {
    const args = parseUiArgs(["dump", "--device", "emulator-5554", "--platform", "android"]);
    expect(args.platform).toBe("android");
  });

  it("--platform ios 파싱", () => {
    const args = parseUiArgs(["dump", "--device", "udid-1234", "--platform", "ios"]);
    expect(args.platform).toBe("ios");
  });

  it("--json 플래그를 파싱한다", () => {
    const args = parseUiArgs(["dump", "--device", "emulator-5554", "--json"]);
    expect(args.json).toBe(true);
  });

  it("--device 없으면 에러를 던진다", () => {
    expect(() => parseUiArgs(["dump"])).toThrow();
  });

  it("서브커맨드 없으면 에러를 던진다", () => {
    expect(() => parseUiArgs(["--device", "emulator-5554"])).toThrow();
  });

  it("잘못된 --platform 값이면 에러를 던진다", () => {
    expect(() =>
      parseUiArgs(["dump", "--device", "emulator-5554", "--platform", "windows"])
    ).toThrow();
  });

  it("잘못된 서브커맨드면 에러를 던진다", () => {
    expect(() =>
      parseUiArgs(["unknown-cmd", "--device", "emulator-5554"])
    ).toThrow();
  });
});

// ─── runUiDump ────────────────────────────────────────────────────────

describe("runUiDump", () => {
  it("nodes 배열과 center 좌표가 포함된 JSON을 반환한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiDump({ device: "emulator-5554", platform: "android" });
    expect(result.ok).toBe(true);

    const ok = result as UiDumpResult;
    expect(ok.platform).toBe("android");
    expect(ok.deviceWidth).toBe(1080);
    expect(ok.deviceHeight).toBe(2400);
    expect(ok.nodes.length).toBeGreaterThan(0);
  });

  it("각 노드에 center 좌표가 사전 계산되어 있다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiDump({ device: "emulator-5554", platform: "android" }) as UiDumpResult;
    const loginNode = result.nodes.find((n) => n.text === "로그인");
    expect(loginNode).toBeDefined();
    // bounds [100,500][980,700] → center x=(100+980)/2=540, y=(500+700)/2=600
    expect(loginNode!.center.x).toBe(540);
    expect(loginNode!.center.y).toBe(600);
  });

  it("bounds 필드가 x1/y1/x2/y2 형태로 포함된다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiDump({ device: "emulator-5554", platform: "android" }) as UiDumpResult;
    const node = result.nodes[0]!;
    expect(node.bounds).toHaveProperty("x1");
    expect(node.bounds).toHaveProperty("y1");
    expect(node.bounds).toHaveProperty("x2");
    expect(node.bounds).toHaveProperty("y2");
  });

  it("nodes가 500개 초과하면 잘라내고 truncatedNodes:true를 설정한다", async () => {
    // 500개 이상 노드가 있는 XML 생성
    const manyNodes = Array.from({ length: 510 }, (_, i) =>
      `<node index="${i}" text="Node${i}" resource-id="" class="android.widget.TextView" content-desc="" clickable="true" enabled="true" bounds="[0,${i * 4}][100,${i * 4 + 4}]"/>`
    ).join("\n");
    const bigXml = `<hierarchy rotation="0"><node text="" resource-id="" class="android.widget.FrameLayout" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]">${manyNodes}</node></hierarchy>`;

    mockDump.mockResolvedValueOnce(bigXml);

    const result = await runUiDump({ device: "emulator-5554", platform: "android" }) as UiDumpResult;
    expect(result.nodes.length).toBe(500);
    expect(result.truncatedNodes).toBe(true);
  });

  it("nodes가 500개 이하이면 truncatedNodes 필드가 없다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiDump({ device: "emulator-5554", platform: "android" }) as UiDumpResult;
    expect(result.truncatedNodes).toBeUndefined();
  });

  it("dumpAndroidUI 실패 시 ok:false와 DUMP_FAILED 에러를 반환한다", async () => {
    const { E2eError } = await import("@karax/e2e");
    mockDump.mockRejectedValueOnce(new E2eError("DUMP_FAILED", "dump 실패"));

    const result = await runUiDump({ device: "emulator-5554", platform: "android" });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("DUMP_FAILED");
  });

  it("iOS + idb 없을 때(platform=ios, idbAvailable 미지정) IDB_UNAVAILABLE 에러를 반환한다", async () => {
    const result = await runUiDump({ device: "udid-1234", platform: "ios" });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("IDB_UNAVAILABLE");
  });

  it("DEVICE_NOT_FOUND E2eError가 그대로 매핑된다", async () => {
    const { E2eError } = await import("@karax/e2e");
    mockDump.mockRejectedValueOnce(new E2eError("NO_DEVICE_AVAILABLE", "디바이스 없음"));

    const result = await runUiDump({ device: "emulator-5554", platform: "android" });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("DEVICE_NOT_FOUND");
  });
});

// ─── runUiLocate ──────────────────────────────────────────────────────

describe("runUiLocate", () => {
  it("라벨로 요소를 찾으면 found:true와 tap 좌표를 반환한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "로그인",
    }) as UiLocateResult;

    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
    expect(result.tap).toBeDefined();
    expect(result.tap!.x).toBe(540);
    expect(result.tap!.y).toBe(600);
  });

  it("method 필드와 score 필드가 포함된다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "로그인",
    }) as UiLocateResult;

    expect(result.method).toBeDefined();
    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThan(0);
  });

  it("bounds 필드가 포함된다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "로그인",
    }) as UiLocateResult;

    expect(result.bounds).toBeDefined();
  });

  it("clickable:false인 노드가 매칭되면 tappable:false 경고가 포함된다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    // "이용약관"은 clickable:false
    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "이용약관",
    }) as UiLocateResult;

    expect(result.found).toBe(true);
    expect(result.tappable).toBe(false);
  });

  it("clickable:true인 노드가 매칭되면 tappable 경고가 없다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "로그인",
    }) as UiLocateResult;

    expect(result.found).toBe(true);
    // tappable:false 경고가 없어야 함 (undefined 또는 true)
    expect(result.tappable).not.toBe(false);
  });

  it("요소를 못 찾으면 found:false와 candidates를 반환한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "존재하지않는버튼",
    }) as UiLocateResult;

    expect(result.ok).toBe(true);
    expect(result.found).toBe(false);
    expect(Array.isArray(result.candidates)).toBe(true);
  });

  it("candidates는 최대 3개다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "없는버튼xyz",
    }) as UiLocateResult;

    expect(result.candidates!.length).toBeLessThanOrEqual(3);
  });

  it("appmap + screen 지정 시 화면 요소로 매칭한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");
    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "로그인 버튼",
      appmap: appmapPath,
      screen: "LoginScreen",
    }) as UiLocateResult;

    expect(result.ok).toBe(true);
  });

  it("appmap 경로가 잘못되면 APPMAP_PARSE_ERROR를 반환한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "로그인",
      appmap: "/nonexistent/appmap.json",
    });

    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("APPMAP_PARSE_ERROR");
  });

  it("appmap/1 (구버전) 파싱도 성공한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const appmapPath = path.join(FIXTURES_DIR, "appmap-v1.json");
    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "시작",
      appmap: appmapPath,
    });

    expect(result.ok).toBe(true);
  });

  it("iOS + idb 없을 때(platform=ios, idbAvailable 미지정) IDB_UNAVAILABLE 에러를 반환한다 (appmap 없음)", async () => {
    const result = await runUiLocate({
      device: "udid-1234",
      platform: "ios",
      label: "버튼",
    });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("IDB_UNAVAILABLE");
  });

  it("label 인자가 없으면 INVALID_ARGUMENT를 반환한다", async () => {
    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "",
    });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("INVALID_ARGUMENT");
  });

  it("candidates에 text와 center 필드가 포함된다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "로그인xyz",
    }) as UiLocateResult;

    if (result.found === false && result.candidates && result.candidates.length > 0) {
      const candidate = result.candidates[0]!;
      expect(candidate).toHaveProperty("text");
      expect(candidate).toHaveProperty("center");
    }
  });
});

// ─── runUiWhichScreen ─────────────────────────────────────────────────

describe("runUiWhichScreen", () => {
  it("화면 식별 결과를 반환한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");

    const result = await runUiWhichScreen({
      device: "emulator-5554",
      platform: "android",
      appmap: appmapPath,
    }) as UiWhichScreenResult;

    expect(result.ok).toBe(true);
    expect(typeof result.confidence).toBe("number");
    expect(Array.isArray(result.ranked)).toBe(true);
  });

  it("ranked 상위 5개를 반환한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");

    const result = await runUiWhichScreen({
      device: "emulator-5554",
      platform: "android",
      appmap: appmapPath,
    }) as UiWhichScreenResult;

    expect(result.ranked.length).toBeLessThanOrEqual(5);
  });

  it("appmap/1 파싱도 성공한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v1.json");

    const result = await runUiWhichScreen({
      device: "emulator-5554",
      platform: "android",
      appmap: appmapPath,
    });

    expect(result.ok).toBe(true);
  });

  it("appmap 없으면 INVALID_ARGUMENT를 반환한다", async () => {
    const result = await runUiWhichScreen({
      device: "emulator-5554",
      platform: "android",
      appmap: undefined,
    });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("INVALID_ARGUMENT");
  });

  it("잘못된 appmap JSON은 APPMAP_PARSE_ERROR를 반환한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiWhichScreen({
      device: "emulator-5554",
      platform: "android",
      appmap: "/nonexistent/appmap.json",
    });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("APPMAP_PARSE_ERROR");
  });

  it("iOS + idb 없을 때(platform=ios, idbAvailable 미지정) IDB_UNAVAILABLE 에러를 반환한다", async () => {
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");

    const result = await runUiWhichScreen({
      device: "udid-1234",
      platform: "ios",
      appmap: appmapPath,
    });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("IDB_UNAVAILABLE");
  });

  it("ranked 각 항목에 screenId와 similarity가 있다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");

    const result = await runUiWhichScreen({
      device: "emulator-5554",
      platform: "android",
      appmap: appmapPath,
    }) as UiWhichScreenResult;

    if (result.ranked.length > 0) {
      const first = result.ranked[0]!;
      expect(first).toHaveProperty("screenId");
      expect(first).toHaveProperty("similarity");
    }
  });
});

// ─── 에러 계약 공통 ──────────────────────────────────────────────────

describe("에러 응답 공통 계약", () => {
  it("에러 응답에는 ok:false, error, message 필드가 있다 (iOS idb 없음 케이스)", async () => {
    const result = await runUiDump({ device: "udid-1234", platform: "ios" }) as UiErrorResult;
    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe("string");
    expect(typeof result.message).toBe("string");
  });
});

// ─── M10: iOS idb 분기 ───────────────────────────────────────────────

const IDB_IOS_JSON = JSON.stringify([
  {
    type: "Application",
    AXLabel: null,
    AXEnabled: true,
    frame: { x: 0, y: 0, width: 393, height: 852 },
    children: [
      {
        type: "Button",
        AXLabel: "로그인",
        AXIdentifier: "btn_login",
        AXEnabled: true,
        frame: { x: 20, y: 100, width: 353, height: 50 },
      },
      {
        type: "StaticText",
        AXLabel: "환영합니다",
        AXEnabled: false,
        frame: { x: 0, y: 50, width: 393, height: 40 },
      },
    ],
  },
]);

describe("runUiDump — iOS + idb", () => {
  it("iOS + idb 있을 때 ok:true와 platform:ios를 반환한다", async () => {
    mockDumpIos.mockResolvedValueOnce(IDB_IOS_JSON);

    const result = await runUiDump({ device: "00008020-AABBCCDD", platform: "ios", idbAvailable: true });
    expect(result.ok).toBe(true);
    const ok = result as UiDumpResult;
    expect(ok.platform).toBe("ios");
  });

  it("iOS + idb 있을 때 노드 목록이 반환된다", async () => {
    mockDumpIos.mockResolvedValueOnce(IDB_IOS_JSON);

    const result = await runUiDump({ device: "00008020-AABBCCDD", platform: "ios", idbAvailable: true }) as UiDumpResult;
    expect(result.nodes.length).toBeGreaterThan(0);
    const loginNode = result.nodes.find((n) => n.text === "로그인");
    expect(loginNode).toBeDefined();
  });

  it("iOS + idb 있을 때 center 좌표가 계산된다", async () => {
    mockDumpIos.mockResolvedValueOnce(IDB_IOS_JSON);

    const result = await runUiDump({ device: "00008020-AABBCCDD", platform: "ios", idbAvailable: true }) as UiDumpResult;
    const loginNode = result.nodes.find((n) => n.text === "로그인");
    // frame x=20,y=100,w=353,h=50 → x2=373,y2=150 → center x=Math.round((20+373)/2)=197, y=Math.round((100+150)/2)=125
    expect(loginNode!.center.x).toBe(197);
    expect(loginNode!.center.y).toBe(125);
  });

  it("iOS + idb 없을 때(idbAvailable 생략) IDB_UNAVAILABLE을 반환한다", async () => {
    const result = await runUiDump({ device: "00008020-AABBCCDD", platform: "ios" });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("IDB_UNAVAILABLE");
  });

  it("iOS + idb 없을 때(idbAvailable:false) IDB_UNAVAILABLE을 반환한다", async () => {
    const result = await runUiDump({ device: "00008020-AABBCCDD", platform: "ios", idbAvailable: false });
    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("IDB_UNAVAILABLE");
  });
});

describe("runUiLocate — iOS + idb", () => {
  it("iOS + idb 있을 때 라벨 매칭 결과를 반환한다", async () => {
    mockDumpIos.mockResolvedValueOnce(IDB_IOS_JSON);

    const result = await runUiLocate({
      device: "00008020-AABBCCDD",
      platform: "ios",
      label: "로그인",
      idbAvailable: true,
    }) as UiLocateResult;

    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
    expect(result.tap).toBeDefined();
  });

  it("iOS + idb 있을 때 coordsUnit:'points'가 반환된다", async () => {
    mockDumpIos.mockResolvedValueOnce(IDB_IOS_JSON);

    const result = await runUiLocate({
      device: "00008020-AABBCCDD",
      platform: "ios",
      label: "로그인",
      idbAvailable: true,
    }) as UiLocateResult;

    expect((result as any).coordsUnit).toBe("points");
  });

  it("iOS + idb 없을 때 AppMap bounds 추정 폴백(estimated:true)을 반환한다", async () => {
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");

    const result = await runUiLocate({
      device: "00008020-AABBCCDD",
      platform: "ios",
      label: "로그인 버튼",
      appmap: appmapPath,
      idbAvailable: false,
    }) as any;

    expect(result.ok).toBe(true);
    // AppMap 추정 폴백이므로 estimated:true, method에 'appmap' 포함
    if (result.found) {
      expect(result.estimated).toBe(true);
      expect(result.method).toMatch(/appmap/i);
      expect((result as UiLocateResult).score).toBe(0.3);
    } else {
      // AppMap에 해당 라벨이 없으면 found:false도 정상
      expect(result.found).toBe(false);
    }
  });

  it("iOS + idb 없고 AppMap도 없을 때 IDB_UNAVAILABLE을 반환한다", async () => {
    const result = await runUiLocate({
      device: "00008020-AABBCCDD",
      platform: "ios",
      label: "버튼",
      idbAvailable: false,
    });

    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("IDB_UNAVAILABLE");
  });
});

describe("runUiWhichScreen — iOS + idb", () => {
  it("iOS + idb 있을 때 화면 식별을 반환한다", async () => {
    mockDumpIos.mockResolvedValueOnce(IDB_IOS_JSON);
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");

    const result = await runUiWhichScreen({
      device: "00008020-AABBCCDD",
      platform: "ios",
      appmap: appmapPath,
      idbAvailable: true,
    }) as UiWhichScreenResult;

    expect(result.ok).toBe(true);
    expect(typeof result.confidence).toBe("number");
  });

  it("iOS + idb 없을 때 IDB_UNAVAILABLE을 반환한다", async () => {
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");

    const result = await runUiWhichScreen({
      device: "00008020-AABBCCDD",
      platform: "ios",
      appmap: appmapPath,
      idbAvailable: false,
    });

    expect(result.ok).toBe(false);
    const err = result as UiErrorResult;
    expect(err.error).toBe("IDB_UNAVAILABLE");
  });
});

describe("Android 회귀 — M10 변경 후", () => {
  it("Android dump는 idbAvailable 없어도 정상 동작한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiDump({ device: "emulator-5554", platform: "android" });
    expect(result.ok).toBe(true);
    expect((result as UiDumpResult).platform).toBe("android");
  });

  it("Android locate는 idbAvailable 없어도 정상 동작한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);

    const result = await runUiLocate({
      device: "emulator-5554",
      platform: "android",
      label: "로그인",
    }) as UiLocateResult;

    expect(result.ok).toBe(true);
    expect(result.found).toBe(true);
  });

  it("Android which-screen은 idbAvailable 없어도 정상 동작한다", async () => {
    mockDump.mockResolvedValueOnce(SAMPLE_XML);
    const appmapPath = path.join(FIXTURES_DIR, "appmap-v2.json");

    const result = await runUiWhichScreen({
      device: "emulator-5554",
      platform: "android",
      appmap: appmapPath,
    }) as UiWhichScreenResult;

    expect(result.ok).toBe(true);
  });
});
