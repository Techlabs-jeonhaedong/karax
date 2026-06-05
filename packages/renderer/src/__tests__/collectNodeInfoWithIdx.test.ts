/**
 * collectNodeInfoWithIdx — leaf children 불변식 회귀 테스트 (중간-4)
 *
 * collectNodeInfoWithIdx를 직접 import해 guard 동작을 검증한다.
 * Leaf 타입(Text/Icon/Unknown 등)에 children이 있어도 순회하지 않아야 한다.
 * irToHtmlWithIdx와 동일 순서로 idx를 부여하는지도 검증한다.
 */
import { describe, it, expect } from "vitest";
import type { IRDocument, IRNode } from "@karax/core";
import { irToHtmlWithIdx } from "../html/irToHtml.js";
import { getDeviceProfile } from "../devices/profiles.js";
import { collectNodeInfoWithIdx } from "../capture/capture.js";

function makeDoc(root: IRNode): IRDocument {
  return {
    schemaVersion: "0.1",
    screen: {
      id: "Test",
      discovery: "route",
      confidence: 1.0,
      root,
    },
    designTokens: {},
    diagnostics: [],
  };
}

/** HTML에서 data-karax-idx 속성의 개수를 센다 */
function countIdxAttrs(html: string): number {
  return (html.match(/data-karax-idx="\d+"/g) ?? []).length;
}

/** HTML에서 data-karax-idx 값 목록을 정렬해 반환한다 */
function extractIdxValues(html: string): number[] {
  const matches = html.matchAll(/data-karax-idx="(\d+)"/g);
  return Array.from(matches, (m) => parseInt(m[1], 10)).sort((a, b) => a - b);
}

describe("collectNodeInfoWithIdx — leaf children 불변식 (중간-4 회귀)", () => {
  const profile = getDeviceProfile("iphone-15");

  it("Text 노드에 children이 있어도 collectNodeInfoWithIdx가 leaf children을 순회하지 않음", () => {
    // Text는 leaf 타입 — guard가 없으면 children 3개가 추가로 수집됨
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [
        {
          type: "Text",
          confidence: 1.0,
          text: { value: "Hello" },
          // 실제로는 불가능하지만 합성 IR로 leaf에 children을 주입
          children: [
            { type: "Text", confidence: 0.8, text: { value: "nested" } },
            { type: "Text", confidence: 0.3, text: { value: "deep" } },
          ],
        },
        {
          type: "Text",
          confidence: 1.0,
          text: { value: "World" },
        },
      ],
    };

    // collectNodeInfoWithIdx 직접 검증 — guard가 없으면 nested/deep Text가 포함돼 5개가 됨
    const infos = collectNodeInfoWithIdx(root);
    // Column(idx=0) + Text "Hello"(idx=1) + Text "World"(idx=2) = 3개만 있어야 함
    expect(infos).toHaveLength(3);
    expect(infos.map((n) => n.idx)).toEqual([0, 1, 2]);

    // HTML과도 일치
    const doc = makeDoc(root);
    const html = irToHtmlWithIdx(doc, profile);
    const idxValues = extractIdxValues(html);
    expect(idxValues).toEqual([0, 1, 2]);
    expect(countIdxAttrs(html)).toBe(3);
  });

  it("Icon 노드에 children이 있어도 collectNodeInfoWithIdx가 leaf children을 순회하지 않음", () => {
    const root: IRNode = {
      type: "Row",
      confidence: 1.0,
      children: [
        {
          type: "Icon",
          confidence: 1.0,
          text: { value: "home" },
          // leaf에 children 주입 — guard 없으면 orphan Text가 추가됨
          children: [{ type: "Text", confidence: 0.5, text: { value: "orphan" } }],
        },
        {
          type: "Text",
          confidence: 1.0,
          text: { value: "Label" },
        },
      ],
    };

    // collectNodeInfoWithIdx 직접 검증 — guard 없으면 4개(Row+Icon+orphan+Label)가 됨
    const infos = collectNodeInfoWithIdx(root);
    // Row(0) + Icon(1) + Text "Label"(2) = 3개만 있어야 함
    expect(infos).toHaveLength(3);
    expect(infos.map((n) => n.idx)).toEqual([0, 1, 2]);

    const doc = makeDoc(root);
    const html = irToHtmlWithIdx(doc, profile);
    const idxValues = extractIdxValues(html);
    expect(idxValues).toEqual([0, 1, 2]);
  });

  it("Unknown 노드에 children이 있어도 collectNodeInfoWithIdx가 leaf children을 순회하지 않음", () => {
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [
        {
          type: "Unknown",
          confidence: 0.2,
          text: { value: "CustomWidget" },
          // guard 없으면 inner Text가 추가됨
          children: [{ type: "Text", confidence: 0.2, text: { value: "inner" } }],
        },
        {
          type: "Text",
          confidence: 1.0,
          text: { value: "after" },
        },
      ],
    };

    // collectNodeInfoWithIdx 직접 검증 — guard 없으면 4개가 됨
    const infos = collectNodeInfoWithIdx(root);
    // Column(0) + Unknown(1) + Text "after"(2) = 3개만 있어야 함
    expect(infos).toHaveLength(3);
    expect(infos.map((n) => n.idx)).toEqual([0, 1, 2]);

    const doc = makeDoc(root);
    const html = irToHtmlWithIdx(doc, profile);
    const idxValues = extractIdxValues(html);
    expect(idxValues).toEqual([0, 1, 2]);
  });

  it("컨테이너(Button)는 children을 순회해 idx를 부여함", () => {
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [
        {
          type: "Button",
          confidence: 1.0,
          children: [
            { type: "Text", confidence: 1.0, text: { value: "Click" } },
          ],
        },
        {
          type: "Text",
          confidence: 1.0,
          text: { value: "after" },
        },
      ],
    };

    // Button은 컨테이너 — collectNodeInfoWithIdx가 children까지 순회해야 함
    const infos = collectNodeInfoWithIdx(root);
    // Column(0) + Button(1) + Text "Click"(2) + Text "after"(3) = 4개
    expect(infos).toHaveLength(4);
    expect(infos.map((n) => n.idx)).toEqual([0, 1, 2, 3]);

    const doc = makeDoc(root);
    const html = irToHtmlWithIdx(doc, profile);
    const idxValues = extractIdxValues(html);
    expect(idxValues).toEqual([0, 1, 2, 3]);
  });

  it("Branch는 idx를 1 소비하고 첫 child만 렌더링됨", () => {
    const root: IRNode = {
      type: "Column",
      confidence: 1.0,
      children: [
        {
          type: "Branch",
          confidence: 0.7,
          children: [
            { type: "Text", confidence: 1.0, text: { value: "VariantA" } },
            { type: "Text", confidence: 1.0, text: { value: "VariantB" } },
          ],
        },
        {
          type: "Text",
          confidence: 1.0,
          text: { value: "after" },
        },
      ],
    };

    // collectNodeInfoWithIdx: Branch 자체는 result에 없고, 첫 child만 포함
    // Column(0), Branch idx=1 소비 후 result에 미포함, VariantA Text(2), after Text(3)
    const infos = collectNodeInfoWithIdx(root);
    expect(infos).toHaveLength(3); // Branch 제외: Column + VariantA + after
    expect(infos.map((n) => n.idx)).toEqual([0, 2, 3]);

    const doc = makeDoc(root);
    const html = irToHtmlWithIdx(doc, profile);

    // Column(0), Branch(idx=1 소비, DOM 없음), VariantA(2), after(3)
    // VariantB는 렌더링 안 됨
    expect(html).toContain("VariantA");
    expect(html).not.toContain("VariantB");

    // data-karax-idx: 0(Column), 2(VariantA Text), 3(after Text) = 3개
    // Branch는 DOM에 심기지 않으므로 idx=1 없음
    const idxValues = extractIdxValues(html);
    expect(idxValues).toEqual([0, 2, 3]);
  });
});
