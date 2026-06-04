import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type { IRDocument, IRNode } from "@sfc/core";
import type { DeviceProfile } from "../devices/profiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, "../../fonts");

// ── 폰트 base64 캐시 (결정론 보장) ──────────────────────────────────
let _fontFaceCache: string | null = null;

function getFontFaceCSS(): string {
  if (_fontFaceCache !== null) return _fontFaceCache;

  const fonts: Array<{ file: string; weight: number }> = [
    { file: "Inter-Regular.woff2", weight: 400 },
    { file: "Inter-Medium.woff2", weight: 500 },
    { file: "Inter-SemiBold.woff2", weight: 600 },
    { file: "Inter-Bold.woff2", weight: 700 },
  ];

  const faces = fonts
    .map(({ file, weight }) => {
      const path = resolve(FONTS_DIR, file);
      if (!existsSync(path)) return "";
      const b64 = readFileSync(path).toString("base64");
      return `@font-face{font-family:'Inter';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:${weight};font-style:normal;font-display:block;}`;
    })
    .filter(Boolean)
    .join("\n");

  _fontFaceCache = faces;
  return faces;
}

// ── 토큰 해석 ──────────────────────────────────────────────────────
function resolveToken(
  value: string,
  designTokens: IRDocument["designTokens"],
): string {
  if (!value.startsWith("token:")) return value;
  const tokenName = value.slice(6);
  const resolved = designTokens?.colors?.[tokenName];
  return resolved ?? "#CCCCCC";
}

function resolveColor(
  value: string | undefined,
  designTokens: IRDocument["designTokens"],
): string | undefined {
  if (!value) return undefined;
  return resolveToken(value, designTokens);
}

// ── CSS 유틸 ───────────────────────────────────────────────────────
function toPx(v: unknown): string {
  if (v === "fill") return "100%";
  if (v === "wrap") return "auto";
  if (typeof v === "number") return `${v}px`;
  return "auto";
}

function mainAxisToJustify(v: string | undefined): string {
  switch (v) {
    case "center": return "center";
    case "end": return "flex-end";
    case "spaceBetween": return "space-between";
    case "spaceAround": return "space-around";
    default: return "flex-start";
  }
}

function crossAxisToAlign(v: string | undefined): string {
  switch (v) {
    case "center": return "center";
    case "end": return "flex-end";
    case "stretch": return "stretch";
    default: return "flex-start";
  }
}

function buildLayoutCSS(
  node: IRNode,
  designTokens: IRDocument["designTokens"],
): string {
  const l = node.layout;
  const s = node.style;
  const parts: string[] = [];

  // Size
  if (l?.width !== undefined) parts.push(`width:${toPx(l.width)}`);
  if (l?.height !== undefined) parts.push(`height:${toPx(l.height)}`);
  if (l?.flex !== undefined) parts.push(`flex:${l.flex}`);

  // Padding & Margin
  if (l?.padding) {
    const [t, r, b, left] = l.padding;
    parts.push(`padding:${t}px ${r}px ${b}px ${left}px`);
  }
  if (l?.margin) {
    const [t, r, b, left] = l.margin;
    parts.push(`margin:${t}px ${r}px ${b}px ${left}px`);
  }
  if (l?.gap !== undefined) parts.push(`gap:${l.gap}px`);

  // Style
  if (s?.background) {
    const bg = resolveToken(s.background, designTokens);
    parts.push(`background:${bg}`);
  }
  if (s?.borderRadius !== undefined) parts.push(`border-radius:${s.borderRadius}px`);
  if (s?.border) {
    const borderColor = resolveToken(s.border.color ?? "#000000", designTokens);
    parts.push(`border:${s.border.width ?? 1}px solid ${borderColor}`);
  }
  if (s?.shadow) {
    const sh = s.shadow;
    parts.push(
      `box-shadow:${sh.offsetX ?? 0}px ${sh.offsetY ?? 0}px ${sh.blur ?? 0}px ${sh.spread !== undefined ? sh.spread + "px " : ""}${sh.color ?? "rgba(0,0,0,0.2)"}`,
    );
  }
  if (s?.opacity !== undefined) parts.push(`opacity:${s.opacity}`);

  return parts.join(";");
}

// ── 노드 렌더러 ───────────────────────────────────────────────────
function renderNode(
  node: IRNode,
  designTokens: IRDocument["designTokens"],
  isStackChild: boolean = false,
): string {
  const baseCSS = buildLayoutCSS(node, designTokens);
  const positionCSS = isStackChild ? "position:absolute;top:0;left:0;right:0;bottom:0;" : "";

  switch (node.type) {
    case "Column":
      return renderFlex(node, designTokens, "column", isStackChild);

    case "Row":
      return renderFlex(node, designTokens, "row", isStackChild);

    case "Box": {
      const role = node.role;
      if (role === "appbar") {
        return renderAppBar(node, designTokens);
      }
      if (role === "tabbar") {
        return renderTabBar(node, designTokens);
      }
      const children = (node.children ?? [])
        .map((c) => renderNode(c, designTokens, false))
        .join("");
      const css = [
        "box-sizing:border-box",
        baseCSS,
        positionCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}">${children}</div>`;
    }

    case "Stack": {
      const children = (node.children ?? [])
        .map((c) => renderNode(c, designTokens, true))
        .join("");
      const css = [
        "position:relative",
        "box-sizing:border-box",
        baseCSS,
        positionCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}">${children}</div>`;
    }

    case "Scroll": {
      const direction = node.layout?.direction ?? "column";
      const overflowCSS =
        direction === "row" ? "overflow-x:auto;overflow-y:hidden" : "overflow-y:auto;overflow-x:hidden";
      const children = (node.children ?? [])
        .map((c) => renderNode(c, designTokens, false))
        .join("");
      const css = [
        "box-sizing:border-box",
        overflowCSS,
        baseCSS,
        positionCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}">${children}</div>`;
    }

    case "Grid": {
      const children = (node.children ?? [])
        .map((c) => renderNode(c, designTokens, false))
        .join("");
      const gapVal = node.layout?.gap !== undefined ? `${node.layout.gap}px` : "8px";
      const css = [
        "display:grid",
        "grid-template-columns:repeat(auto-fill,minmax(100px,1fr))",
        `gap:${gapVal}`,
        "box-sizing:border-box",
        baseCSS,
        positionCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}">${children}</div>`;
    }

    case "List": {
      const children = (node.children ?? [])
        .map((c) => renderNode(c, designTokens, false))
        .join("");
      const css = [
        "display:flex",
        "flex-direction:column",
        "box-sizing:border-box",
        baseCSS,
        positionCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}">${children}</div>`;
    }

    case "Spacer": {
      const hasWidth = node.layout?.width !== undefined;
      const hasHeight = node.layout?.height !== undefined;
      const css = hasWidth || hasHeight
        ? `width:${toPx(node.layout?.width ?? "auto")};height:${toPx(node.layout?.height ?? "auto")};flex-shrink:0`
        : "flex:1";
      return `<div style="${css}"></div>`;
    }

    case "Text": {
      const t = node.text;
      const value = t?.value ?? "";
      const color = resolveColor(t?.color, designTokens) ?? "inherit";
      const maxLines = t?.maxLines;
      const layoutCSS = buildLayoutCSS(node, designTokens);
      const clampCSS = maxLines
        ? `display:-webkit-box;-webkit-line-clamp:${maxLines};-webkit-box-orient:vertical;overflow:hidden`
        : "white-space:pre-wrap";
      const css = [
        "box-sizing:border-box",
        `color:${color}`,
        clampCSS,
        layoutCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}">${escapeHtml(value)}</div>`;
    }

    case "Image": {
      const src = node.src ?? "";
      const layoutCSS = buildLayoutCSS(node, designTokens);

      // 로컬 asset이고 파일이 실제 존재하면 file:// URL 사용 (기본은 placeholder)
      const isAsset = src.startsWith("asset://");
      const label = src.replace(/^asset:\/\//, "");

      if (isAsset) {
        const css = [
          "box-sizing:border-box",
          "display:flex",
          "align-items:center",
          "justify-content:center",
          "background:#E0E0E0",
          "border:1px dashed #9E9E9E",
          layoutCSS,
        ]
          .filter(Boolean)
          .join(";");
        return `<div style="${css}"><span style="font-size:11px;color:#757575;">${escapeHtml(label)}</span></div>`;
      }

      const css = [
        "box-sizing:border-box",
        "object-fit:cover",
        "display:block",
        layoutCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<img src="${escapeHtml(src)}" style="${css}" alt="" />`;
    }

    case "Icon": {
      const name = node.text?.value ?? "icon";
      const size = node.layout?.width ?? 24;
      const iconColor = resolveColor(node.text?.color, designTokens) ?? "#757575";
      const css = [
        `width:${size}px`,
        `height:${size}px`,
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        `color:${iconColor}`,
        "font-size:11px",
        "overflow:hidden",
      ]
        .join(";");
      return `<div style="${css}" title="${escapeHtml(name)}">[${escapeHtml(name)}]</div>`;
    }

    case "Button": {
      const children = (node.children ?? [])
        .map((c) => renderNode(c, designTokens, false))
        .join("");
      const css = [
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "cursor:pointer",
        "box-sizing:border-box",
        baseCSS,
        positionCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}">${children}</div>`;
    }

    case "Input": {
      const placeholder = node.text?.value ?? "";
      const css = [
        "display:flex",
        "align-items:center",
        "box-sizing:border-box",
        baseCSS,
        positionCSS,
      ]
        .filter(Boolean)
        .join(";");
      const placeholderCSS = "color:#9E9E9E;font-size:14px;";
      return `<div style="${css}"><span style="${placeholderCSS}">${escapeHtml(placeholder)}</span></div>`;
    }

    case "Divider": {
      const color = resolveColor(node.style?.background, designTokens) ?? "#E0E0E0";
      const heightVal = node.layout?.height;
      const isHorizontal = typeof heightVal === "number" ? heightVal <= 2 : true;
      if (isHorizontal) {
        return `<div style="width:100%;height:1px;background:${color};flex-shrink:0;"></div>`;
      }
      return `<div style="width:1px;height:100%;background:${color};flex-shrink:0;"></div>`;
    }

    case "Unknown": {
      const componentName = node.text?.value ?? "Unknown";
      const layoutCSS = buildLayoutCSS(node, designTokens);
      const css = [
        "box-sizing:border-box",
        "border:2px dashed #FF9800",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "background:rgba(255,152,0,0.05)",
        layoutCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}"><span style="font-size:11px;color:#FF9800;font-family:monospace;">[${escapeHtml(componentName)}]</span></div>`;
    }

    case "Branch": {
      // 첫 번째 variant만 렌더
      const first = node.children?.[0];
      if (!first) return "";
      return renderNode(first, designTokens, isStackChild);
    }

    case "Slot": {
      const layoutCSS = buildLayoutCSS(node, designTokens);
      const css = [
        "box-sizing:border-box",
        "border:2px dashed #BDBDBD",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "background:rgba(189,189,189,0.08)",
        layoutCSS,
      ]
        .filter(Boolean)
        .join(";");
      return `<div style="${css}"><span style="font-size:10px;color:#9E9E9E;">slot</span></div>`;
    }

    default:
      return "";
  }
}

function renderFlex(
  node: IRNode,
  designTokens: IRDocument["designTokens"],
  direction: "row" | "column",
  isStackChild: boolean,
): string {
  const role = node.role;
  if (role === "appbar") return renderAppBar(node, designTokens);
  if (role === "tabbar") return renderTabBar(node, designTokens);

  const l = node.layout;
  const justify = mainAxisToJustify(l?.mainAxis);
  const align = crossAxisToAlign(l?.crossAxis);
  const baseCSS = buildLayoutCSS(node, designTokens);
  const positionCSS = isStackChild ? "position:absolute;top:0;left:0;right:0;bottom:0;" : "";

  const children = (node.children ?? [])
    .map((c) => renderNode(c, designTokens, false))
    .join("");

  const css = [
    "display:flex",
    `flex-direction:${direction}`,
    `justify-content:${justify}`,
    `align-items:${align}`,
    "box-sizing:border-box",
    baseCSS,
    positionCSS,
  ]
    .filter(Boolean)
    .join(";");

  return `<div style="${css}">${children}</div>`;
}

function renderAppBar(
  node: IRNode,
  designTokens: IRDocument["designTokens"],
): string {
  const h = node.layout?.height ?? 56;
  const bg = resolveToken(node.style?.background ?? "#1976D2", designTokens);
  const sh = node.style?.shadow;
  const shadowCSS = sh
    ? `box-shadow:${sh.offsetX ?? 0}px ${sh.offsetY ?? 2}px ${sh.blur ?? 4}px ${sh.color ?? "rgba(0,0,0,0.2)"};`
    : "box-shadow:0px 2px 4px rgba(0,0,0,0.2);";
  const children = (node.children ?? [])
    .map((c) => renderNode(c, designTokens, false))
    .join("");
  const css =
    `position:sticky;top:0px;left:0;right:0;width:100%;height:${h}px;` +
    `background:${bg};${shadowCSS}z-index:100;box-sizing:border-box;` +
    `display:flex;align-items:center;flex-shrink:0;`;
  return `<div style="${css}">${children}</div>`;
}

function renderTabBar(
  node: IRNode,
  designTokens: IRDocument["designTokens"],
): string {
  const h = node.layout?.height ?? 56;
  const bg = resolveToken(node.style?.background ?? "#FFFFFF", designTokens);
  const border = node.style?.border;
  const borderCSS = border
    ? `border-top:${border.width ?? 1}px solid ${resolveToken(border.color ?? "#E0E0E0", designTokens)};`
    : "border-top:1px solid #E0E0E0;";
  const children = (node.children ?? [])
    .map((c) => renderNode(c, designTokens, false))
    .join("");
  const css =
    `position:sticky;bottom:0px;left:0;right:0;width:100%;height:${h}px;` +
    `background:${bg};${borderCSS}z-index:100;box-sizing:border-box;` +
    `display:flex;align-items:center;flex-shrink:0;`;
  return `<div style="${css}">${children}</div>`;
}

// ── SafeArea 상태바 렌더러 ────────────────────────────────────────
function renderStatusBar(profile: DeviceProfile): string {
  if (profile.safeAreaTop === 0) return "";
  const h = profile.safeAreaTop;
  return `<div style="position:sticky;top:0;left:0;right:0;width:100%;height:${h}px;background:rgba(0,0,0,0);z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 16px;box-sizing:border-box;flex-shrink:0;">
  <span style="font-size:12px;font-weight:600;color:#111;">9:41</span>
  <div style="display:flex;gap:6px;align-items:center;">
    <span style="font-size:10px;color:#111;">●●●●</span>
    <span style="font-size:10px;color:#111;">WiFi</span>
    <span style="font-size:10px;color:#111;">🔋</span>
  </div>
</div>`;
}

function renderHomeIndicator(profile: DeviceProfile): string {
  if (profile.safeAreaBottom === 0) return "";
  const h = profile.safeAreaBottom;
  return `<div style="position:sticky;bottom:0;left:0;right:0;width:100%;height:${h}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:transparent;z-index:200;">
  <div style="width:120px;height:5px;border-radius:3px;background:rgba(0,0,0,0.2);"></div>
</div>`;
}

// ── HTML 이스케이프 ─────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── 메인 변환 함수 ─────────────────────────────────────────────────
export function irToHtml(ir: IRDocument, profile: DeviceProfile): string {
  const fontFaceCSS = getFontFaceCSS();
  const designTokens = ir.designTokens;
  const w = profile.width;
  const h = profile.height;

  const bodyContent =
    renderStatusBar(profile) +
    renderNode(ir.screen.root, designTokens, false) +
    renderHomeIndicator(profile);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${w},initial-scale=1" />
<style>
${fontFaceCSS}
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:${w}px;height:${h}px;overflow:hidden;font-family:${profile.fontStack};font-size:14px;line-height:1.4;}
body{display:flex;flex-direction:column;}
</style>
</head>
<body>
${bodyContent}
</body>
</html>`;
}
