import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseUiautomatorXml,
  flattenInteractive,
} from "../runtime/uiautomatorParser.js";
import type { RuntimeUITree, RuntimeNode } from "../runtime/uiautomatorParser.js";

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const fixtureDir = join(__dir, "fixtures", "uiautomator");

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf-8");
}

// ──────────────────────────────────────────────────────────────
// simple.xml 파싱 테스트
// ──────────────────────────────────────────────────────────────

describe("parseUiautomatorXml — simple.xml", () => {
  let tree: RuntimeUITree;

  it("파싱 성공 후 root가 null이 아님", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    expect(tree.root).not.toBeNull();
  });

  it("deviceWidth/Height를 루트 bounds에서 역산한다 (1080×2400)", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    expect(tree.deviceWidth).toBe(1080);
    expect(tree.deviceHeight).toBe(2400);
  });

  it("루트 노드 className이 FrameLayout", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    expect(tree.root!.className).toBe("android.widget.FrameLayout");
  });

  it("루트 자식이 1개(ViewGroup)", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    expect(tree.root!.children).toHaveLength(1);
    expect(tree.root!.children[0].className).toBe("android.view.ViewGroup");
  });

  it("ViewGroup 자식이 3개(TextView + Button × 2)", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const vg = tree.root!.children[0];
    expect(vg.children).toHaveLength(3);
  });

  it("버튼 text 파싱 — 로그인", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const btn = tree.root!.children[0].children[1];
    expect(btn.text).toBe("로그인");
  });

  it("버튼 content-desc 파싱 — 로그인 버튼", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const btn = tree.root!.children[0].children[1];
    expect(btn.contentDesc).toBe("로그인 버튼");
  });

  it("버튼 clickable=true", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const btn = tree.root!.children[0].children[1];
    expect(btn.clickable).toBe(true);
  });

  it("TextView clickable=false", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const tv = tree.root!.children[0].children[0];
    expect(tv.clickable).toBe(false);
  });

  it("bounds 파싱 — 버튼 [100,500][980,700]", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const btn = tree.root!.children[0].children[1];
    expect(btn.bounds).toEqual({ x1: 100, y1: 500, x2: 980, y2: 700 });
  });

  it("resourceId 파싱", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const btn = tree.root!.children[0].children[1];
    expect(btn.resourceId).toBe("com.example.app:id/btn_login");
  });

  it("text 없는 노드는 빈 문자열", () => {
    tree = parseUiautomatorXml(loadFixture("simple.xml"));
    expect(tree.root!.text).toBe("");
  });
});

// ──────────────────────────────────────────────────────────────
// nested-list.xml — 중첩·한글·이모지·엔티티
// ──────────────────────────────────────────────────────────────

describe("parseUiautomatorXml — nested-list.xml", () => {
  let tree: RuntimeUITree;

  it("파싱 성공", () => {
    tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    expect(tree.root).not.toBeNull();
  });

  it("deviceWidth/Height 1080×2400", () => {
    tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    expect(tree.deviceWidth).toBe(1080);
    expect(tree.deviceHeight).toBe(2400);
  });

  it("XML 엔티티 디코드: &amp; → & in toolbar title", () => {
    tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    const toolbar = tree.root!.children[0];
    const title = toolbar.children[0];
    expect(title.text).toBe("쇼핑몰 & 스토어");
  });

  it("XML 엔티티 디코드: &lt; &gt; → < > in item name", () => {
    tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    const recycler = tree.root!.children[1];
    const item2 = recycler.children[2];
    const name = item2.children[0];
    expect(name.text).toBe("포도 <3>");
  });

  it("이모지가 포함된 한글 텍스트 — 사과 🍎", () => {
    tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    const recycler = tree.root!.children[1];
    const item0 = recycler.children[0];
    expect(item0.children[0].text).toBe("사과 🍎");
  });

  it("RecyclerView 자식 3개 (리스트 아이템)", () => {
    tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    const recycler = tree.root!.children[1];
    expect(recycler.children).toHaveLength(3);
  });

  it("리스트 아이템 내 '담기' 버튼 clickable=true", () => {
    tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    const recycler = tree.root!.children[1];
    const btn = recycler.children[0].children[1];
    expect(btn.text).toBe("담기");
    expect(btn.clickable).toBe(true);
  });

  it("toolbar content-desc 파싱 — 상품 목록", () => {
    tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    const toolbar = tree.root!.children[0];
    expect(toolbar.contentDesc).toBe("상품 목록");
  });
});

// ──────────────────────────────────────────────────────────────
// broken.xml — graceful 파싱
// ──────────────────────────────────────────────────────────────

describe("parseUiautomatorXml — broken.xml (graceful)", () => {
  it("throw하지 않고 객체를 반환한다", () => {
    expect(() => parseUiautomatorXml(loadFixture("broken.xml"))).not.toThrow();
  });

  it("root가 null이 아님 (최대한 파싱)", () => {
    const tree = parseUiautomatorXml(loadFixture("broken.xml"));
    // broken XML이어도 파싱 가능한 노드는 반환
    expect(tree).toBeDefined();
    expect(tree).toHaveProperty("deviceWidth");
    expect(tree).toHaveProperty("deviceHeight");
  });
});

// ──────────────────────────────────────────────────────────────
// 완전 깨진 입력 / 엣지 케이스
// ──────────────────────────────────────────────────────────────

describe("parseUiautomatorXml — 엣지 케이스", () => {
  it("빈 문자열 → {root:null, deviceWidth:0, deviceHeight:0}", () => {
    const tree = parseUiautomatorXml("");
    expect(tree).toEqual({ root: null, deviceWidth: 0, deviceHeight: 0 });
  });

  it("XML 태그 전혀 없는 입력 → {root:null, deviceWidth:0, deviceHeight:0}", () => {
    const tree = parseUiautomatorXml("hello world this is not xml");
    expect(tree).toEqual({ root: null, deviceWidth: 0, deviceHeight: 0 });
  });

  it("4MB 초과 입력 → {root:null, deviceWidth:0, deviceHeight:0}", () => {
    const huge = "x".repeat(4 * 1024 * 1024 + 1);
    const tree = parseUiautomatorXml(huge);
    expect(tree).toEqual({ root: null, deviceWidth: 0, deviceHeight: 0 });
  });

  it("hierarchy 태그만 있고 node 없음 → root:null", () => {
    const xml = `<hierarchy rotation="0"></hierarchy>`;
    const tree = parseUiautomatorXml(xml);
    expect(tree.root).toBeNull();
  });

  it("음수 bounds → 그대로 파싱", () => {
    const xml = `<hierarchy rotation="0">
      <node text="x" resource-id="" class="Foo" content-desc="" clickable="false" enabled="true" bounds="[-10,-20][1080,2400]" />
    </hierarchy>`;
    const tree = parseUiautomatorXml(xml);
    expect(tree.root?.bounds.x1).toBe(-10);
    expect(tree.root?.bounds.y1).toBe(-20);
  });
});

// ──────────────────────────────────────────────────────────────
// decodeEntities — 잘못된 숫자 엔티티 NUL 변질 방지 (#3)
// ──────────────────────────────────────────────────────────────

describe("parseUiautomatorXml — 잘못된 숫자 엔티티 원문 보존 (#3)", () => {
  it("&#xZZZZ; (잘못된 16진수) → 원문 그대로 보존", () => {
    const xml = `<hierarchy rotation="0">
      <node text="&#xZZZZ;" resource-id="" class="Foo" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]" />
    </hierarchy>`;
    const tree = parseUiautomatorXml(xml);
    expect(tree.root?.text).toBe("&#xZZZZ;");
  });

  it("&#ZZZZ; (잘못된 10진수) → 원문 그대로 보존", () => {
    const xml = `<hierarchy rotation="0">
      <node text="&#ZZZZ;" resource-id="" class="Foo" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]" />
    </hierarchy>`;
    const tree = parseUiautomatorXml(xml);
    expect(tree.root?.text).toBe("&#ZZZZ;");
  });

  it("&#x41; (정상 16진수 'A') → 'A'로 디코딩", () => {
    const xml = `<hierarchy rotation="0">
      <node text="&#x41;" resource-id="" class="Foo" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]" />
    </hierarchy>`;
    const tree = parseUiautomatorXml(xml);
    expect(tree.root?.text).toBe("A");
  });

  it("&#65; (정상 10진수 'A') → 'A'로 디코딩", () => {
    const xml = `<hierarchy rotation="0">
      <node text="&#65;" resource-id="" class="Foo" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]" />
    </hierarchy>`;
    const tree = parseUiautomatorXml(xml);
    expect(tree.root?.text).toBe("A");
  });

  it("NUL 문자(\\x00)가 text에 없어야 함 — 잘못된 엔티티가 NUL로 변질되지 않음", () => {
    const xml = `<hierarchy rotation="0">
      <node text="&#xZZZZ;" resource-id="" class="Foo" content-desc="" clickable="false" enabled="true" bounds="[0,0][1080,2400]" />
    </hierarchy>`;
    const tree = parseUiautomatorXml(xml);
    expect(tree.root?.text).not.toContain("\x00");
  });
});

// ──────────────────────────────────────────────────────────────
// flattenInteractive
// ──────────────────────────────────────────────────────────────

describe("flattenInteractive", () => {
  it("simple.xml — clickable 또는 text/contentDesc 있는 노드 반환", () => {
    const tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const nodes = flattenInteractive(tree);
    // 로그인 버튼, 회원가입 버튼, Welcome text → 3개
    const texts = nodes.map((n) => n.text || n.contentDesc);
    expect(texts).toContain("로그인");
    expect(texts).toContain("회원가입");
    expect(texts).toContain("Welcome");
  });

  it("DFS 순서 보장 — 로그인이 회원가입보다 먼저", () => {
    const tree = parseUiautomatorXml(loadFixture("simple.xml"));
    const nodes = flattenInteractive(tree);
    const loginIdx = nodes.findIndex((n) => n.text === "로그인");
    const registerIdx = nodes.findIndex((n) => n.text === "회원가입");
    expect(loginIdx).toBeGreaterThanOrEqual(0);
    expect(loginIdx).toBeLessThan(registerIdx);
  });

  it("nested-list.xml — 동명 '담기' 버튼 3개 모두 포함", () => {
    const tree = parseUiautomatorXml(loadFixture("nested-list.xml"));
    const nodes = flattenInteractive(tree);
    const addBtns = nodes.filter((n) => n.text === "담기");
    expect(addBtns).toHaveLength(3);
  });

  it("빈 트리 → 빈 배열", () => {
    const tree = parseUiautomatorXml("");
    const nodes = flattenInteractive(tree);
    expect(nodes).toEqual([]);
  });

  it("root가 null → 빈 배열", () => {
    const tree: RuntimeUITree = { root: null, deviceWidth: 0, deviceHeight: 0 };
    expect(flattenInteractive(tree)).toEqual([]);
  });
});
