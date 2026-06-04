/**
 * xmlParser — 순수 정규식/상태기계 기반 Android XML layout 파서
 *
 * tree-sitter 없이 Node.js 내장만 사용. XML 파싱은 간단한 태그 스택으로 처리.
 * 지원 요소:
 *   LinearLayout, RelativeLayout, ConstraintLayout, FrameLayout → Column/Row/Stack
 *   TextView → Text
 *   ImageView → Image (@drawable 해석)
 *   Button → Button
 *   EditText → Input
 *   RecyclerView, ListView → Scroll + List (3개 대표 아이템)
 *   ScrollView → Scroll
 *   View (divider) → Divider
 */

import type { IRNode } from "@sfc/core";
import { NODE_CONFIDENCE } from "@sfc/core";

// ── 속성 파싱 유틸 ─────────────────────────────────────────────────────────────

export interface XmlAttrs {
  [key: string]: string;
}

/** 단일 태그 텍스트에서 속성 맵을 추출한다 */
export function parseAttrs(tagText: string): XmlAttrs {
  const attrs: XmlAttrs = {};
  // android:xxx="yyy" 또는 xxx="yyy"
  const re = /(?:android:)?(\w+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagText)) !== null) {
    attrs[m[1]!] = m[2]!;
  }
  return attrs;
}

/** layout_width/height 값 → fill | wrap | number */
export function parseDimension(
  val: string | undefined
): "fill" | "wrap" | number | undefined {
  if (!val) return undefined;
  if (val === "match_parent" || val === "fill_parent") return "fill";
  if (val === "wrap_content") return "wrap";
  const dp = /^(\d+(?:\.\d+)?)dp$/.exec(val);
  if (dp) return parseFloat(dp[1]!);
  return undefined;
}

/** Ndp 수치 추출 */
export function parseDp(val: string | undefined): number | undefined {
  if (!val) return undefined;
  const m = /^(\d+(?:\.\d+)?)dp$/.exec(val);
  return m ? parseFloat(m[1]!) : undefined;
}

/** @string/xxx → 실제 문자열 해석. 없으면 리터럴 그대로 */
export function resolveString(
  val: string | undefined,
  strings: Map<string, string>
): string | undefined {
  if (!val) return undefined;
  const ref = /^@string\/(.+)$/.exec(val);
  if (ref) return strings.get(ref[1]!) ?? val;
  return val;
}

/** @color/xxx → hex 색상 해석 */
export function resolveColor(
  val: string | undefined,
  colors: Map<string, string>
): string | undefined {
  if (!val) return undefined;
  const ref = /^@color\/(.+)$/.exec(val);
  if (ref) return colors.get(ref[1]!) ?? val;
  // 직접 hex
  if (/^#[0-9A-Fa-f]{6,8}$/.test(val)) return val;
  return undefined;
}

/** @drawable/xxx → asset://xxx */
export function resolveDrawable(val: string | undefined): string | undefined {
  if (!val) return undefined;
  const ref = /^@drawable\/(.+)$/.exec(val);
  if (ref) return `asset://${ref[1]}`;
  return "network-placeholder";
}

// ── XML 토크나이저 ─────────────────────────────────────────────────────────────

export interface XmlToken {
  type: "open" | "close" | "selfclose";
  tagName: string;
  attrs: XmlAttrs;
  raw: string;
}

/**
 * XML 소스를 태그 토큰 스트림으로 변환한다.
 * 주석, <?xml ...?> 처리 지시어는 건너뜀.
 */
export function tokenize(xml: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  // 태그 매칭: <tagName attrs... /> 또는 <tagName attrs...> 또는 </tagName>
  const tagRe = /<([!?\/]?)(\w[\w.:-]*)([^>]*)>/g;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(xml)) !== null) {
    const prefix = m[1]!;
    const tagName = m[2]!;
    const attrsText = m[3]!;
    const raw = m[0]!;

    // 닫는 태그
    if (prefix === "/") {
      tokens.push({ type: "close", tagName, attrs: {}, raw });
      continue;
    }
    // 주석, <!DOCTYPE, <?xml 등 건너뜀
    if (prefix === "!" || prefix === "?") continue;

    const isSelfClose = attrsText.trimEnd().endsWith("/");
    const attrs = parseAttrs(attrsText);

    tokens.push({
      type: isSelfClose ? "selfclose" : "open",
      tagName,
      attrs,
      raw,
    });
  }

  return tokens;
}

// ── XML DOM 노드 ───────────────────────────────────────────────────────────────

export interface XmlElement {
  tagName: string;
  attrs: XmlAttrs;
  children: XmlElement[];
}

/** 토큰 스트림 → 트리 구조 */
export function buildTree(tokens: XmlToken[]): XmlElement | undefined {
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;

  for (const token of tokens) {
    if (token.type === "open") {
      const elem: XmlElement = {
        tagName: token.tagName,
        attrs: token.attrs,
        children: [],
      };
      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(elem);
      } else {
        root = elem;
      }
      stack.push(elem);
    } else if (token.type === "selfclose") {
      const elem: XmlElement = {
        tagName: token.tagName,
        attrs: token.attrs,
        children: [],
      };
      if (stack.length > 0) {
        stack[stack.length - 1]!.children.push(elem);
      } else {
        root = elem;
      }
      // selfclose는 스택에 push하지 않음
    } else if (token.type === "close") {
      stack.pop();
    }
  }

  return root;
}

// ── XmlElement → IRNode 변환 ────────────────────────────────────────────────

const LAYOUT_MOCK_LIST_COUNT = 3;

export function xmlElementToIRNode(
  elem: XmlElement,
  strings: Map<string, string>,
  colors: Map<string, string>
): IRNode {
  const { tagName, attrs } = elem;
  const w = parseDimension(attrs["layout_width"]);
  const h = parseDimension(attrs["layout_height"]);
  const weight = attrs["layout_weight"]
    ? parseFloat(attrs["layout_weight"])
    : undefined;

  const paddingAll = parseDp(attrs["padding"]);
  const paddingTop = parseDp(attrs["paddingTop"]);
  const paddingBottom = parseDp(attrs["paddingBottom"]);
  const paddingLeft = parseDp(attrs["paddingLeft"] ?? attrs["paddingStart"]);
  const paddingRight = parseDp(attrs["paddingRight"] ?? attrs["paddingEnd"]);
  const marginTop = parseDp(attrs["layout_marginTop"]);
  const marginStart = parseDp(attrs["layout_marginStart"] ?? attrs["layout_marginLeft"]);

  const padding: [number, number, number, number] | undefined = paddingAll !== undefined
    ? [paddingAll, paddingAll, paddingAll, paddingAll]
    : (paddingTop !== undefined || paddingBottom !== undefined || paddingLeft !== undefined || paddingRight !== undefined)
      ? [paddingTop ?? 0, paddingRight ?? 0, paddingBottom ?? 0, paddingLeft ?? 0]
      : undefined;

  const margin: [number, number, number, number] | undefined =
    (marginTop !== undefined || marginStart !== undefined)
      ? [marginTop ?? 0, marginStart ?? 0, 0, 0]
      : undefined;

  const bgColor = resolveColor(attrs["background"], colors);

  switch (tagName) {
    // ── 레이아웃 컨테이너 ───────────────────────────────────────────────────
    case "LinearLayout": {
      const isHorizontal = (attrs["orientation"] ?? "vertical") === "horizontal";
      const children = elem.children.map((c) =>
        xmlElementToIRNode(c, strings, colors)
      );
      return {
        type: isHorizontal ? "Row" : "Column",
        layout: {
          direction: isHorizontal ? "row" : "column",
          width: w,
          height: h,
          padding,
          margin,
          flex: weight,
        },
        style: bgColor ? { background: bgColor } : undefined,
        confidence: NODE_CONFIDENCE.standard,
        children: children.length > 0 ? children : undefined,
      };
    }

    case "RelativeLayout":
    case "ConstraintLayout": {
      const children = elem.children.map((c) =>
        xmlElementToIRNode(c, strings, colors)
      );
      return {
        type: "Stack",
        layout: { width: w, height: h, padding, margin },
        style: bgColor ? { background: bgColor } : undefined,
        confidence: NODE_CONFIDENCE.standard,
        children: children.length > 0 ? children : undefined,
      };
    }

    case "FrameLayout": {
      const children = elem.children.map((c) =>
        xmlElementToIRNode(c, strings, colors)
      );
      return {
        type: "Stack",
        layout: { width: w, height: h, padding, margin },
        style: bgColor ? { background: bgColor } : undefined,
        confidence: NODE_CONFIDENCE.standard,
        children: children.length > 0 ? children : undefined,
      };
    }

    case "ScrollView":
    case "HorizontalScrollView": {
      const isHorizontal = tagName === "HorizontalScrollView";
      const children = elem.children.map((c) =>
        xmlElementToIRNode(c, strings, colors)
      );
      return {
        type: "Scroll",
        layout: {
          direction: isHorizontal ? "row" : "column",
          width: w,
          height: h,
        },
        confidence: NODE_CONFIDENCE.standard,
        children: children.length > 0 ? children : undefined,
      };
    }

    case "RecyclerView":
    case "ListView": {
      // 대표 아이템 3행 mock
      const mockItem: IRNode = {
        type: "Row",
        layout: { direction: "row", width: "fill", height: 56 },
        confidence: NODE_CONFIDENCE.mocked,
        children: [
          {
            type: "Text",
            text: { value: "List item" },
            confidence: NODE_CONFIDENCE.mocked,
          },
        ],
      };
      return {
        type: "Scroll",
        layout: { direction: "column", width: w, height: h, flex: weight },
        confidence: NODE_CONFIDENCE.standard,
        children: [
          {
            type: "List",
            layout: { direction: "column" },
            confidence: NODE_CONFIDENCE.mocked,
            children: Array.from({ length: LAYOUT_MOCK_LIST_COUNT }, () => ({
              ...mockItem,
            })),
          },
        ],
      };
    }

    // ── 콘텐츠 위젯 ─────────────────────────────────────────────────────────
    case "TextView": {
      const rawText = attrs["text"];
      const value = resolveString(rawText, strings) ?? rawText ?? "";
      const textSizeSp = attrs["textSize"]
        ? parseFloat(attrs["textSize"])
        : undefined;
      const textColor = resolveColor(attrs["textColor"], colors);
      return {
        type: "Text",
        text: {
          value,
          color: textColor,
          // sp → 토큰 근사
          token: textSizeSp !== undefined
            ? spToTypographyToken(textSizeSp)
            : undefined,
        },
        layout: { width: w, height: h, margin, flex: weight },
        confidence: NODE_CONFIDENCE.standard,
      };
    }

    case "ImageView": {
      const src = attrs["src"] ?? attrs["srcCompat"];
      const resolvedSrc = resolveDrawable(src) ?? "network-placeholder";
      return {
        type: "Image",
        src: resolvedSrc,
        layout: { width: w, height: h, margin, flex: weight },
        confidence: NODE_CONFIDENCE.standard,
      };
    }

    case "Button":
    case "ImageButton": {
      const rawText = attrs["text"];
      const label = resolveString(rawText, strings) ?? rawText ?? "";
      return {
        type: "Button",
        layout: { width: w, height: h, margin, flex: weight },
        confidence: NODE_CONFIDENCE.standard,
        children: label
          ? [{ type: "Text", text: { value: label }, confidence: NODE_CONFIDENCE.standard }]
          : undefined,
      };
    }

    case "EditText": {
      const rawHint = attrs["hint"];
      const hint = resolveString(rawHint, strings) ?? rawHint ?? "";
      return {
        type: "Input",
        text: { value: hint },
        layout: { width: w, height: h, margin, flex: weight },
        confidence: NODE_CONFIDENCE.standard,
      };
    }

    case "View": {
      // divider 역할
      return {
        type: "Divider",
        layout: { width: w, height: h, margin },
        style: bgColor ? { background: bgColor } : undefined,
        confidence: NODE_CONFIDENCE.standard,
      };
    }

    case "include": {
      // layout include 참조만 보존
      return {
        type: "Unknown",
        role: `include:${attrs["layout"] ?? "unknown"}`,
        confidence: NODE_CONFIDENCE.unknown,
      };
    }

    default: {
      // ViewGroup 계열: 자식 파싱 시도
      if (elem.children.length > 0) {
        const children = elem.children.map((c) =>
          xmlElementToIRNode(c, strings, colors)
        );
        return {
          type: "Box",
          layout: { width: w, height: h, padding, margin, flex: weight },
          style: bgColor ? { background: bgColor } : undefined,
          confidence: NODE_CONFIDENCE.standard,
          children: children.length > 0 ? children : undefined,
        };
      }
      return {
        type: "Unknown",
        role: `component:${tagName}`,
        confidence: NODE_CONFIDENCE.unknown,
        layout: { width: w, height: h },
      };
    }
  }
}

// ── sp → typography 토큰 근사 ─────────────────────────────────────────────────

function spToTypographyToken(sp: number): string {
  if (sp >= 24) return "heading1";
  if (sp >= 20) return "heading2";
  if (sp >= 18) return "heading3";
  if (sp >= 16) return "body";
  if (sp >= 14) return "bodyMedium";
  return "caption";
}
