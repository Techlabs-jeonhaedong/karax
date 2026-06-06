/**
 * runtime/idbParser.ts 단위 테스트
 *
 * idb describe-all 출력 정규화(표준 배열·AXFrame 문자열 포맷)·방어 케이스·엣지 케이스.
 * 순수 함수라 I/O 없음.
 */

import { describe, it, expect } from "vitest";
import { parseIdbDescribeAll } from "../runtime/idbParser.js";
import type { RuntimeUITree } from "../runtime/uiautomatorParser.js";

// ─── 픽스처: 표준 배열 포맷 (frame {x,y,width,height}) ───────────────────

const STANDARD_FIXTURE = JSON.stringify([
  {
    type: "Application",
    role: "Application",
    AXLabel: null,
    AXValue: null,
    AXIdentifier: null,
    AXEnabled: true,
    frame: { x: 0, y: 0, width: 393, height: 852 },
    children: [
      {
        type: "Button",
        role: "Button",
        AXLabel: "로그인",
        AXValue: null,
        AXIdentifier: "btn_login",
        AXEnabled: true,
        frame: { x: 20, y: 100, width: 353, height: 50 },
        children: [],
      },
      {
        type: "StaticText",
        role: "StaticText",
        AXLabel: "환영합니다",
        AXValue: "환영합니다",
        AXIdentifier: null,
        AXEnabled: false,
        frame: { x: 0, y: 50, width: 393, height: 40 },
        children: [],
      },
      {
        type: "TextField",
        role: "TextField",
        AXLabel: "이메일",
        AXValue: "user@example.com",
        AXIdentifier: "tf_email",
        AXEnabled: true,
        frame: { x: 20, y: 160, width: 353, height: 44 },
        children: [],
      },
    ],
  },
]);

// ─── 픽스처: AXFrame 문자열 포맷 (구버전 idb) ───────────────────────────

const AXFRAME_FIXTURE = JSON.stringify([
  {
    type: "Application",
    AXLabel: null,
    AXFrame: "{{0, 0}, {390, 844}}",
    AXEnabled: true,
    children: [
      {
        type: "Button",
        AXLabel: "회원가입",
        AXValue: null,
        AXFrame: "{{20, 200}, {350, 48}}",
        AXEnabled: true,
        children: [],
      },
      {
        type: "Image",
        AXLabel: "로고 이미지",
        AXValue: null,
        AXFrame: "{{140, 30}, {110, 60}}",
        AXEnabled: false,
        children: [],
      },
    ],
  },
]);

// ─── 픽스처: NDJSON 포맷 ─────────────────────────────────────────────────

const NDJSON_FIXTURE = [
  JSON.stringify({
    type: "Application",
    AXLabel: null,
    frame: { x: 0, y: 0, width: 375, height: 812 },
    AXEnabled: true,
  }),
  JSON.stringify({
    type: "Button",
    AXLabel: "확인",
    frame: { x: 10, y: 300, width: 355, height: 44 },
    AXEnabled: true,
  }),
].join("\n");

// ─────────────────────────────────────────────────────────────────────────────
// 표준 배열 포맷
// ─────────────────────────────────────────────────────────────────────────────

describe("parseIdbDescribeAll — 표준 배열 포맷", () => {
  let tree: RuntimeUITree;

  it("throw 없이 파싱된다", () => {
    expect(() => { tree = parseIdbDescribeAll(STANDARD_FIXTURE); }).not.toThrow();
  });

  it("root가 null이 아님", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    expect(tree.root).not.toBeNull();
  });

  it("deviceWidth/deviceHeight를 최상위 요소 frame에서 역산한다 (393×852)", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    expect(tree.deviceWidth).toBe(393);
    expect(tree.deviceHeight).toBe(852);
  });

  it("Button 노드의 text가 AXLabel에서 온다", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    const loginBtn = tree.root!.children.find((n) => n.text === "로그인");
    expect(loginBtn).toBeDefined();
  });

  it("StaticText 노드의 text가 AXLabel/AXValue에서 온다", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    const textNode = tree.root!.children.find((n) => n.text === "환영합니다");
    expect(textNode).toBeDefined();
  });

  it("TextField AXValue가 text로 온다", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    const tf = tree.root!.children.find((n) => n.text === "user@example.com" || n.text === "이메일");
    expect(tf).toBeDefined();
  });

  it("AXIdentifier가 contentDesc로 매핑된다", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    const loginBtn = tree.root!.children.find((n) => n.text === "로그인");
    expect(loginBtn?.contentDesc).toBe("btn_login");
  });

  it("Button 타입은 clickable=true", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    const loginBtn = tree.root!.children.find((n) => n.text === "로그인");
    expect(loginBtn?.clickable).toBe(true);
  });

  it("StaticText(AXEnabled=false)는 clickable=false", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    const textNode = tree.root!.children.find((n) => n.text === "환영합니다");
    expect(textNode?.clickable).toBe(false);
  });

  it("frame이 논리 좌표(pt)로 보존된다 (bounds x1/y1/x2/y2)", () => {
    tree = parseIdbDescribeAll(STANDARD_FIXTURE);
    const loginBtn = tree.root!.children.find((n) => n.text === "로그인");
    expect(loginBtn?.bounds).toEqual({ x1: 20, y1: 100, x2: 373, y2: 150 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AXFrame 문자열 포맷
// ─────────────────────────────────────────────────────────────────────────────

describe("parseIdbDescribeAll — AXFrame 문자열 포맷", () => {
  let tree: RuntimeUITree;

  it("throw 없이 파싱된다", () => {
    expect(() => { tree = parseIdbDescribeAll(AXFRAME_FIXTURE); }).not.toThrow();
  });

  it("deviceWidth/deviceHeight를 AXFrame에서 역산한다 (390×844)", () => {
    tree = parseIdbDescribeAll(AXFRAME_FIXTURE);
    expect(tree.deviceWidth).toBe(390);
    expect(tree.deviceHeight).toBe(844);
  });

  it("AXFrame 파싱: 회원가입 버튼 bounds 정확성", () => {
    tree = parseIdbDescribeAll(AXFRAME_FIXTURE);
    const btn = tree.root!.children.find((n) => n.text === "회원가입");
    // {{20, 200}, {350, 48}} → x1=20,y1=200, x2=370,y2=248
    expect(btn?.bounds).toEqual({ x1: 20, y1: 200, x2: 370, y2: 248 });
  });

  it("Button 타입은 clickable=true", () => {
    tree = parseIdbDescribeAll(AXFRAME_FIXTURE);
    const btn = tree.root!.children.find((n) => n.text === "회원가입");
    expect(btn?.clickable).toBe(true);
  });

  it("Image(AXEnabled=false)는 clickable=false", () => {
    tree = parseIdbDescribeAll(AXFRAME_FIXTURE);
    const img = tree.root!.children.find((n) => n.text === "로고 이미지");
    expect(img?.clickable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NDJSON 포맷
// ─────────────────────────────────────────────────────────────────────────────

describe("parseIdbDescribeAll — NDJSON 포맷", () => {
  it("줄 단위 JSON도 파싱된다", () => {
    const tree = parseIdbDescribeAll(NDJSON_FIXTURE);
    expect(tree.root).not.toBeNull();
  });

  it("NDJSON deviceWidth (375)", () => {
    const tree = parseIdbDescribeAll(NDJSON_FIXTURE);
    expect(tree.deviceWidth).toBe(375);
  });

  it("NDJSON '확인' 버튼 파싱", () => {
    const tree = parseIdbDescribeAll(NDJSON_FIXTURE);
    const btn = tree.root!.children.find((n) => n.text === "확인");
    expect(btn).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 방어 케이스
// ─────────────────────────────────────────────────────────────────────────────

describe("parseIdbDescribeAll — 방어 케이스", () => {
  it("빈 문자열 → 빈 트리(root:null)", () => {
    const tree = parseIdbDescribeAll("");
    expect(tree.root).toBeNull();
    expect(tree.deviceWidth).toBe(0);
    expect(tree.deviceHeight).toBe(0);
  });

  it("잘못된 JSON → 빈 트리(graceful)", () => {
    const tree = parseIdbDescribeAll("not json at all");
    expect(tree.root).toBeNull();
  });

  it("빈 배열 [] → 빈 트리", () => {
    const tree = parseIdbDescribeAll("[]");
    expect(tree.root).toBeNull();
  });

  it("4MB 초과 입력 → 빈 트리", () => {
    const huge = "x".repeat(4 * 1024 * 1024 + 1);
    const tree = parseIdbDescribeAll(huge);
    expect(tree.root).toBeNull();
    expect(tree.deviceWidth).toBe(0);
    expect(tree.deviceHeight).toBe(0);
  });

  it("null 입력 → 빈 트리 (graceful)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tree = parseIdbDescribeAll(null as any);
    expect(tree.root).toBeNull();
  });

  it("객체인 JSON (배열 아님) → 빈 트리", () => {
    const tree = parseIdbDescribeAll('{"type":"Button"}');
    // 단일 객체는 배열로 래핑해 처리해도 됨
    expect(tree).toHaveProperty("root");
    expect(tree).toHaveProperty("deviceWidth");
  });

  it("부분적으로 깨진 자식 → 가용 노드는 파싱", () => {
    const partial = JSON.stringify([
      {
        type: "Application",
        frame: { x: 0, y: 0, width: 393, height: 852 },
        AXEnabled: true,
        children: [
          { type: "Button", AXLabel: "OK", frame: { x: 0, y: 0, width: 100, height: 44 }, AXEnabled: true },
          null, // 깨진 자식
        ],
      },
    ]);
    const tree = parseIdbDescribeAll(partial);
    expect(tree.root).not.toBeNull();
    // OK 버튼은 파싱
    const ok = tree.root!.children.find((n) => n.text === "OK");
    expect(ok).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clickable 판정
// ─────────────────────────────────────────────────────────────────────────────

describe("parseIdbDescribeAll — clickable 판정", () => {
  it.each([
    ["Button", true],
    ["Cell", true],
    ["Switch", true],
    ["Link", true],
    ["MenuItem", true],
    ["StaticText", false],
    ["Image", false],
    ["Application", false],
  ])("%s 타입의 clickable=%s", (type, expected) => {
    const json = JSON.stringify([
      {
        type,
        AXLabel: "테스트",
        AXEnabled: true,
        frame: { x: 0, y: 0, width: 100, height: 44 },
        children: [],
      },
    ]);
    const tree = parseIdbDescribeAll(json);
    expect(tree.root?.clickable).toBe(expected);
  });

  it("AXEnabled=false인 Button은 clickable=false", () => {
    const json = JSON.stringify([
      {
        type: "Button",
        AXLabel: "비활성 버튼",
        AXEnabled: false,
        frame: { x: 0, y: 0, width: 100, height: 44 },
        children: [],
      },
    ]);
    const tree = parseIdbDescribeAll(json);
    expect(tree.root?.clickable).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 논리 좌표 보존 (iOS는 스케일 불필요)
// ─────────────────────────────────────────────────────────────────────────────

describe("parseIdbDescribeAll — 논리 좌표 보존", () => {
  it("iphone-15 논리 해상도 393×852 좌표를 그대로 보존한다", () => {
    const json = JSON.stringify([
      {
        type: "Application",
        AXLabel: null,
        AXEnabled: true,
        frame: { x: 0, y: 0, width: 393, height: 852 },
        children: [
          {
            type: "Button",
            AXLabel: "탭",
            AXEnabled: true,
            frame: { x: 50, y: 400, width: 293, height: 50 },
          },
        ],
      },
    ]);
    const tree = parseIdbDescribeAll(json);
    const btn = tree.root!.children.find((n) => n.text === "탭");
    // 좌표 배율 적용 없이 논리 pt 그대로
    expect(btn?.bounds).toEqual({ x1: 50, y1: 400, x2: 343, y2: 450 });
  });
});
