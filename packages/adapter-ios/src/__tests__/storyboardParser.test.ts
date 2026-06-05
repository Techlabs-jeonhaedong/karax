/**
 * storyboardParser 테스트 (TDD Red → Green)
 *
 * UIKit 레거시 경로: Storyboard/XIB 파싱 + 화면 발견 + IR 빌드
 */

import path from "path";
import fs from "fs";
import os from "os";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  parseStoryboard,
  discoverUIKitScreens,
  buildUIKitScreenIR,
  detectUIKit,
} from "../legacy/storyboardParser.js";
import type { StoryboardScene, UIKitDiscoveryResult } from "../legacy/storyboardParser.js";

const FIXTURE = path.resolve(
  __dirname,
  "fixtures/uikit-storyboard-case"
);
const STORYBOARD = path.join(FIXTURE, "Main.storyboard");

// ── parseStoryboard ────────────────────────────────────────────────────────────

describe("parseStoryboard", () => {
  let scenes: StoryboardScene[];

  beforeAll(async () => {
    scenes = await parseStoryboard(STORYBOARD);
  });

  it("3개 scene을 파싱한다 (HomeViewController, DetailViewController, OrphanViewController)", () => {
    expect(scenes).toHaveLength(3);
  });

  it("scene들이 customClass를 갖는다", () => {
    const classes = scenes.map((s) => s.customClass);
    expect(classes).toContain("HomeViewController");
    expect(classes).toContain("DetailViewController");
    expect(classes).toContain("OrphanViewController");
  });

  it("HomeViewController scene에 segue 연결이 있다 (homeToDetail)", () => {
    const home = scenes.find((s) => s.customClass === "HomeViewController");
    expect(home).toBeDefined();
    const segues = home!.segues;
    expect(segues.some((sg) => sg.identifier === "homeToDetail")).toBe(true);
    expect(segues.some((sg) => sg.destination === "detail-vc")).toBe(true);
  });

  it("OrphanViewController는 segue 연결이 없다", () => {
    const orphan = scenes.find((s) => s.customClass === "OrphanViewController");
    expect(orphan).toBeDefined();
    expect(orphan!.segues).toHaveLength(0);
  });

  it("navigationController scene은 view controller scene 목록에서 제외된다", () => {
    const classes = scenes.map((s) => s.customClass);
    // navigationController 자체는 별도 scene이지만 viewController가 없으므로 제외
    expect(classes.every((c) => c !== undefined && c !== null && c !== "")).toBe(true);
  });

  it("HomeViewController의 subviews에서 label을 파싱한다", () => {
    const home = scenes.find((s) => s.customClass === "HomeViewController");
    const labels = home!.viewHierarchy.filter((v) => v.type === "label");
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels.some((l) => l.text === "Welcome Home")).toBe(true);
  });

  it("HomeViewController의 subviews에서 imageView를 파싱한다", () => {
    const home = scenes.find((s) => s.customClass === "HomeViewController");
    const images = home!.viewHierarchy.filter((v) => v.type === "imageView");
    expect(images.length).toBeGreaterThanOrEqual(1);
  });

  it("HomeViewController의 subviews에서 button을 파싱한다", () => {
    const home = scenes.find((s) => s.customClass === "HomeViewController");
    const buttons = home!.viewHierarchy.filter((v) => v.type === "button");
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons.some((b) => b.text === "Go to Detail")).toBe(true);
  });

  it("HomeViewController의 subviews에서 stackView를 파싱한다", () => {
    const home = scenes.find((s) => s.customClass === "HomeViewController");
    const stacks = home!.viewHierarchy.filter((v) => v.type === "stackView");
    expect(stacks.length).toBeGreaterThanOrEqual(1);
    expect(stacks[0]!.axis).toBe("vertical");
  });

  it("stackView 내부의 label 자식들이 파싱된다", () => {
    const home = scenes.find((s) => s.customClass === "HomeViewController");
    const stack = home!.viewHierarchy.find((v) => v.type === "stackView");
    expect(stack).toBeDefined();
    expect(stack!.children?.some((c) => c.type === "label")).toBe(true);
  });

  it("DetailViewController의 textField를 파싱한다", () => {
    const detail = scenes.find((s) => s.customClass === "DetailViewController");
    const inputs = detail!.viewHierarchy.filter((v) => v.type === "textField");
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it("각 scene에 navigationItem title이 있다", () => {
    const home = scenes.find((s) => s.customClass === "HomeViewController");
    expect(home!.navigationTitle).toBe("Home");
  });

  // 엣지 케이스: 없는 storyboard
  it("존재하지 않는 storyboard 경로에서 에러를 던진다", async () => {
    await expect(parseStoryboard("/nonexistent/path/Missing.storyboard"))
      .rejects.toThrow();
  });
});

// ── discoverUIKitScreens ───────────────────────────────────────────────────────

describe("discoverUIKitScreens", () => {
  let result: UIKitDiscoveryResult;

  beforeAll(async () => {
    result = await discoverUIKitScreens(FIXTURE);
  });

  it("initialViewController 연결 화면들을 route로 발견한다", () => {
    const routes = result.screens.filter((s) => s.discovery === "route");
    const ids = routes.map((s) => s.id);
    expect(ids).toContain("HomeViewController");
    // HomeViewController → DetailViewController segue 연결
    expect(ids).toContain("DetailViewController");
  });

  it("미연결 OrphanViewController를 candidate로 발견한다", () => {
    const orphan = result.screens.find((s) => s.id === "OrphanViewController");
    expect(orphan).toBeDefined();
    expect(orphan!.discovery).toBe("candidate");
  });

  it("모든 화면에 sourceRef가 있다", () => {
    for (const screen of result.screens) {
      expect(screen.sourceRef).toBeDefined();
    }
  });

  it("storyboard 파일이 없으면 빈 배열을 반환한다", async () => {
    const emptyResult = await discoverUIKitScreens(FIXTURE + "/nonexistent");
    expect(emptyResult.screens).toHaveLength(0);
  });

  it("diagnostics가 배열이다", () => {
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });
});

// ── buildUIKitScreenIR ────────────────────────────────────────────────────────

describe("buildUIKitScreenIR", () => {
  let homeIR: Awaited<ReturnType<typeof buildUIKitScreenIR>>;
  let detailIR: Awaited<ReturnType<typeof buildUIKitScreenIR>>;
  let orphanIR: Awaited<ReturnType<typeof buildUIKitScreenIR>>;
  let missingIR: Awaited<ReturnType<typeof buildUIKitScreenIR>>;

  beforeAll(async () => {
    homeIR = await buildUIKitScreenIR(FIXTURE, "HomeViewController");
    detailIR = await buildUIKitScreenIR(FIXTURE, "DetailViewController");
    orphanIR = await buildUIKitScreenIR(FIXTURE, "OrphanViewController");
    missingIR = await buildUIKitScreenIR(FIXTURE, "NonExistentViewController");
  }, 60_000);

  // HomeViewController IR
  it("HomeViewController IR의 schemaVersion이 0.1이다", () => {
    expect(homeIR.schemaVersion).toBe("0.1");
  });

  it("HomeViewController의 discovery가 route이다", () => {
    expect(homeIR.screen.discovery).toBe("route");
  });

  it("HomeViewController IR의 root가 Box(navController 래퍼)이다", () => {
    expect(homeIR.screen.root.type).toBe("Box");
  });

  it("HomeViewController IR에 Text 노드(Welcome Home)가 있다", () => {
    const findText = (node: any, val: string): boolean => {
      if (!node) return false;
      if (node.type === "Text" && node.text?.value?.includes(val)) return true;
      return (node.children ?? []).some((c: any) => findText(c, val));
    };
    expect(findText(homeIR.screen.root, "Welcome Home")).toBe(true);
  });

  it("HomeViewController IR에 Image 노드가 있다", () => {
    const findType = (node: any, type: string): boolean => {
      if (!node) return false;
      if (node.type === type) return true;
      return (node.children ?? []).some((c: any) => findType(c, type));
    };
    expect(findType(homeIR.screen.root, "Image")).toBe(true);
  });

  it("HomeViewController IR에 Button 노드가 있다", () => {
    const findType = (node: any, type: string): boolean => {
      if (!node) return false;
      if (node.type === type) return true;
      return (node.children ?? []).some((c: any) => findType(c, type));
    };
    expect(findType(homeIR.screen.root, "Button")).toBe(true);
  });

  it("HomeViewController IR에 Column 노드가 있다 (stackView axis=vertical)", () => {
    const findType = (node: any, type: string): boolean => {
      if (!node) return false;
      if (node.type === type) return true;
      return (node.children ?? []).some((c: any) => findType(c, type));
    };
    expect(findType(homeIR.screen.root, "Column")).toBe(true);
  });

  it("HomeViewController IR에 appbar role Box가 있다 (navigationTitle)", () => {
    const hasAppbar = (node: any): boolean => {
      if (!node) return false;
      if (node.role === "appbar") return true;
      return (node.children ?? []).some((c: any) => hasAppbar(c));
    };
    expect(hasAppbar(homeIR.screen.root)).toBe(true);
  });

  it("HomeViewController의 confidence가 0.2 이상이다", () => {
    expect(homeIR.screen.confidence).toBeGreaterThanOrEqual(0.2);
  });

  // DetailViewController IR
  it("DetailViewController IR에 Input 노드(textField)가 있다", () => {
    const findType = (node: any, type: string): boolean => {
      if (!node) return false;
      if (node.type === type) return true;
      return (node.children ?? []).some((c: any) => findType(c, type));
    };
    expect(findType(detailIR.screen.root, "Input")).toBe(true);
  });

  // OrphanViewController IR
  it("OrphanViewController의 discovery가 candidate이다", () => {
    expect(orphanIR.screen.discovery).toBe("candidate");
  });

  it("OrphanViewController의 confidence는 route보다 낮다 (candidate 가중치)", () => {
    expect(orphanIR.screen.confidence).toBeLessThan(homeIR.screen.confidence);
  });

  // 존재하지 않는 화면
  it("존재하지 않는 viewController에서 UNRESOLVED_COMPONENT diagnostic이 발생한다", () => {
    expect(
      missingIR.diagnostics?.some((d: any) => d.code === "UNRESOLVED_COMPONENT")
    ).toBe(true);
  });

  it("존재하지 않는 viewController의 root가 Unknown이다", () => {
    expect(missingIR.screen.root.type).toBe("Unknown");
  });
});

// ── detectUIKit ────────────────────────────────────────────────────────────────

describe("detectUIKit", () => {
  it("Storyboard 파일이 있고 SwiftUI @main이 없으면 true를 반환한다", async () => {
    const result = await detectUIKit(FIXTURE);
    expect(result.hasStoryboard).toBe(true);
    expect(result.hasSwiftUI).toBe(false);
  });

  it("storyboardFiles에 Main.storyboard가 포함된다", async () => {
    const result = await detectUIKit(FIXTURE);
    expect(result.storyboardFiles.some((f) => f.includes("Main.storyboard"))).toBe(true);
  });

  it("SwiftUI 프로젝트에서 hasSwiftUI가 true이다", async () => {
    const swiftUIFixture = path.resolve("../../fixtures/ios-swiftui-basic");
    const result = await detectUIKit(swiftUIFixture);
    expect(result.hasSwiftUI).toBe(true);
  });

  it("존재하지 않는 경로에서 에러 없이 기본값 반환한다", async () => {
    const result = await detectUIKit("/nonexistent/project");
    expect(result.hasStoryboard).toBe(false);
    expect(result.hasSwiftUI).toBe(false);
    expect(result.storyboardFiles).toHaveLength(0);
  });
});

// ── 엣지 케이스 ───────────────────────────────────────────────────────────────

describe("storyboardParser — 엣지 케이스", () => {
  let emptyTmpDir: string | undefined;

  afterEach(() => {
    if (emptyTmpDir) {
      fs.rmSync(emptyTmpDir, { recursive: true, force: true });
      emptyTmpDir = undefined;
    }
  });

  it("빈 프로젝트 디렉토리에서 discoverUIKitScreens가 빈 배열을 반환한다", async () => {
    emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sfc-empty-"));
    const result = await discoverUIKitScreens(emptyTmpDir);
    expect(result.screens).toHaveLength(0);
  });

  it("customClass 없는 viewController는 id를 screenId로 사용한다", async () => {
    // Storyboard에 customClass가 없는 scene은 storyboard ID를 사용
    // 현재 fixture는 모두 customClass가 있으므로 기본 동작 확인
    const result = await discoverUIKitScreens(FIXTURE);
    expect(result.screens.every((s) => s.id.length > 0)).toBe(true);
  });
});
