import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import type { IRDocument } from "@karax/core";
import { irToHtml } from "../html/irToHtml.js";
import { getDeviceProfile } from "../devices/profiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): IRDocument {
  const raw = readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
  return JSON.parse(raw) as IRDocument;
}

describe("irToHtml — 구조 단언", () => {
  it("01: Column+Text → HTML 문서 구조 생성", () => {
    const ir = loadFixture("01-simple-column-text.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
    expect(html).toContain("<body");
    expect(html).toContain("Hello World");
    expect(html).toContain("Caption text");
    expect(html).toContain("@font-face");
    expect(html).toContain("Inter");
  });

  it("01: Column → display:flex + flex-direction:column", () => {
    const ir = loadFixture("01-simple-column-text.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("display:flex");
    expect(html).toContain("flex-direction:column");
  });

  it("01: Text maxLines → -webkit-line-clamp", () => {
    const ir = loadFixture("01-simple-column-text.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("-webkit-line-clamp");
    expect(html).toContain("2");
  });

  it("01: iphone-15 viewport 크기가 393x852", () => {
    const ir = loadFixture("01-simple-column-text.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("393px");
    expect(html).toContain("852px");
  });

  it("02: Row → display:flex + flex-direction:row", () => {
    const ir = loadFixture("02-nested-row-flex.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("flex-direction:row");
  });

  it("02: Row mainAxis=spaceBetween → justify-content:space-between", () => {
    const ir = loadFixture("02-nested-row-flex.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("justify-content:space-between");
  });

  it("02: Spacer → flex:1", () => {
    const ir = loadFixture("02-nested-row-flex.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("flex:1");
  });

  it("02: Icon → 정사각 박스 + 이름 라벨", () => {
    const ir = loadFixture("02-nested-row-flex.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("more_vert");
  });

  it("03: Stack → position:relative + 자식 position:absolute", () => {
    const ir = loadFixture("03-stack-scroll.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("position:relative");
    expect(html).toContain("position:absolute");
  });

  it("03: Scroll → overflow:auto 또는 overflow-y:auto", () => {
    const ir = loadFixture("03-stack-scroll.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toMatch(/overflow(-y)?:(auto|scroll)/);
  });

  it("03: role=tabbar → 하단 고정", () => {
    const ir = loadFixture("03-stack-scroll.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("bottom:");
  });

  it("04: role=appbar → 상단 고정 + 그림자", () => {
    const ir = loadFixture("04-appbar-tabbar-safearea.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("top:");
    expect(html).toContain("box-shadow");
  });

  it("04: Button → 스타일 박스", () => {
    const ir = loadFixture("04-appbar-tabbar-safearea.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("Click Me");
    expect(html).toContain("border-radius");
  });

  it("04: Input → 테두리 박스 + placeholder", () => {
    const ir = loadFixture("04-appbar-tabbar-safearea.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("Type something...");
    expect(html).toContain("border");
  });

  it("04: Divider → 1px 선", () => {
    const ir = loadFixture("04-appbar-tabbar-safearea.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("1px");
  });

  it("04: iphone-15 safeArea 상단 59px 반영", () => {
    const ir = loadFixture("04-appbar-tabbar-safearea.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("59px");
  });

  it("05: designTokens 참조 → 실제 색상으로 해석", () => {
    const ir = loadFixture("05-tokens-unknown-branch.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    // token:primary → #6750A4
    expect(html).toContain("#6750A4");
    // token:surface → #FFFBFE
    expect(html).toContain("#FFFBFE");
  });

  it("05: Unknown → 점선 테두리 박스 + componentName", () => {
    const ir = loadFixture("05-tokens-unknown-branch.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("CustomWidget");
    expect(html).toContain("dashed");
  });

  it("05: Branch → 첫 번째 variant만 렌더", () => {
    const ir = loadFixture("05-tokens-unknown-branch.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("Variant A (default)");
    expect(html).not.toContain("Variant B (error state)");
  });

  it("05: Slot → 점선 박스", () => {
    const ir = loadFixture("05-tokens-unknown-branch.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("dashed");
  });

  it("05: Grid → display:grid", () => {
    const ir = loadFixture("05-tokens-unknown-branch.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("display:grid");
  });

  it("동일 IR로 두 번 생성 시 동일한 HTML 반환 (결정론)", () => {
    const ir = loadFixture("01-simple-column-text.json");
    const profile = getDeviceProfile("iphone-15");
    const html1 = irToHtml(ir, profile);
    const html2 = irToHtml(ir, profile);

    expect(html1).toBe(html2);
  });

  it("Image src가 없을 경우 placeholder 박스 렌더", () => {
    const ir: IRDocument = {
      schemaVersion: "0.1",
      screen: {
        id: "ImageTest",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Image",
          confidence: 1.0,
          src: "asset://non-existent.png",
        },
      },
      designTokens: {},
      diagnostics: [],
    };
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("non-existent.png");
  });

  it("layout.width=fill → width:100%", () => {
    const ir = loadFixture("01-simple-column-text.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("width:100%");
  });

  it("layout.height=fill → height:100%", () => {
    const ir = loadFixture("01-simple-column-text.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("height:100%");
  });

  it("mainAxis=spaceAround → justify-content:space-around", () => {
    const ir = loadFixture("04-appbar-tabbar-safearea.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("justify-content:space-around");
  });

  it("style.shadow → box-shadow CSS", () => {
    const ir = loadFixture("02-nested-row-flex.json");
    const profile = getDeviceProfile("pixel-8");
    const html = irToHtml(ir, profile);

    expect(html).toContain("box-shadow");
  });

  it("style.opacity → CSS opacity", () => {
    const ir: IRDocument = {
      schemaVersion: "0.1",
      screen: {
        id: "OpacityTest",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          style: { opacity: 0.5, background: "#FF0000" },
          children: [],
        },
      },
      designTokens: {},
      diagnostics: [],
    };
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("opacity:0.5");
  });

  it("layout.padding → padding CSS (top right bottom left)", () => {
    const ir = loadFixture("01-simple-column-text.json");
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("padding:");
  });

  it("List → 자식 반복 렌더", () => {
    const ir: IRDocument = {
      schemaVersion: "0.1",
      screen: {
        id: "ListTest",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "List",
          confidence: 1.0,
          layout: { width: "fill", height: "fill" },
          children: [
            { type: "Text", confidence: 1.0, text: { value: "Item A" } },
            { type: "Text", confidence: 1.0, text: { value: "Item B" } },
            { type: "Text", confidence: 1.0, text: { value: "Item C" } },
          ],
        },
      },
      designTokens: {},
      diagnostics: [],
    };
    const profile = getDeviceProfile("iphone-15");
    const html = irToHtml(ir, profile);

    expect(html).toContain("Item A");
    expect(html).toContain("Item B");
    expect(html).toContain("Item C");
  });
});

// ── CSS 값 새니타이저 보안 테스트 ───────────────────────────────────────

describe("irToHtml — CSS 값 새니타이저 (보안)", () => {
  const profile = getDeviceProfile("iphone-15");

  function makeBoxIR(background: string): IRDocument {
    return {
      schemaVersion: "0.1",
      screen: {
        id: "SecTest",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          style: { background },
          children: [],
        },
      },
      designTokens: {},
      diagnostics: [],
    };
  }

  function makeDividerIR(background: string): IRDocument {
    return {
      schemaVersion: "0.1",
      screen: {
        id: "DividerSecTest",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Divider",
          confidence: 1.0,
          style: { background },
        },
      },
      designTokens: {},
      diagnostics: [],
    };
  }

  function makeAppBarIR(background: string): IRDocument {
    return {
      schemaVersion: "0.1",
      screen: {
        id: "AppBarSecTest",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          role: "appbar",
          confidence: 1.0,
          style: { background },
          children: [],
        },
      },
      designTokens: {},
      diagnostics: [],
    };
  }

  function makeTabBarIR(background: string): IRDocument {
    return {
      schemaVersion: "0.1",
      screen: {
        id: "TabBarSecTest",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          role: "tabbar",
          confidence: 1.0,
          style: { background },
          children: [],
        },
      },
      designTokens: {},
      diagnostics: [],
    };
  }

  // ── 악성 입력: 속성 탈출 시도 ──────────────────────────────────────

  it('Box: 악성 background "><script>alert(1)</script> 가 style 속성에 그대로 삽입되지 않는다', () => {
    const html = irToHtml(makeBoxIR('"><script>alert(1)</script>'), profile);
    expect(html).not.toContain('"><script>');
    expect(html).not.toContain("alert(1)");
  });

  it("Box: 세미콜론+url(javascript:) 포함 background가 그대로 삽입되지 않는다", () => {
    const html = irToHtml(makeBoxIR("red;background:url(javascript:alert(1))"), profile);
    expect(html).not.toContain("javascript:");
  });

  it("Box: 악성 background가 기본값(#E0E0E0)으로 대체된다", () => {
    const html = irToHtml(makeBoxIR('"><script>'), profile);
    expect(html).toContain("background:#E0E0E0");
  });

  it("Divider: 악성 background가 기본값(#E0E0E0)으로 대체된다", () => {
    const html = irToHtml(makeDividerIR('"><script>'), profile);
    expect(html).toContain("background:#E0E0E0");
    expect(html).not.toContain('"><script>');
  });

  it("AppBar: 악성 background가 기본값(#1976D2)으로 대체된다", () => {
    const html = irToHtml(makeAppBarIR('"><script>'), profile);
    expect(html).toContain("background:#1976D2");
    expect(html).not.toContain('"><script>');
  });

  it("TabBar: 악성 background가 기본값(#FFFFFF)으로 대체된다", () => {
    const html = irToHtml(makeTabBarIR('"><script>'), profile);
    expect(html).toContain("background:#FFFFFF");
    expect(html).not.toContain('"><script>');
  });

  // ── 정상 입력: 통과 보장 ────────────────────────────────────────────

  it("정상 hex 색상(#RRGGBB)은 그대로 출력된다", () => {
    const html = irToHtml(makeBoxIR("#FF5722"), profile);
    expect(html).toContain("background:#FF5722");
  });

  it("rgba(...) 값은 그대로 출력된다", () => {
    const html = irToHtml(makeBoxIR("rgba(255,87,34,0.5)"), profile);
    expect(html).toContain("background:rgba(255,87,34,0.5)");
  });

  it("rgb(...) 값은 그대로 출력된다", () => {
    const html = irToHtml(makeBoxIR("rgb(255,87,34)"), profile);
    expect(html).toContain("background:rgb(255,87,34)");
  });

  it("CSS 색상 키워드(transparent, white)는 그대로 출력된다", () => {
    const htmlT = irToHtml(makeBoxIR("transparent"), profile);
    expect(htmlT).toContain("background:transparent");
    const htmlW = irToHtml(makeBoxIR("white"), profile);
    expect(htmlW).toContain("background:white");
  });

  it("token: 접두사 값은 토큰 해석 후 결과가 새니타이징된다", () => {
    const ir: IRDocument = {
      schemaVersion: "0.1",
      screen: {
        id: "TokenSecTest",
        discovery: "route",
        confidence: 1.0,
        root: {
          type: "Box",
          confidence: 1.0,
          style: { background: "token:primary" },
          children: [],
        },
      },
      designTokens: { colors: { primary: "#6750A4" } },
      diagnostics: [],
    };
    const html = irToHtml(ir, profile);
    expect(html).toContain("background:#6750A4");
  });

  it("linear-gradient 값은 그대로 출력된다", () => {
    const html = irToHtml(makeBoxIR("linear-gradient(to bottom, #FF5722, #E91E63)"), profile);
    expect(html).toContain("linear-gradient");
  });
});
