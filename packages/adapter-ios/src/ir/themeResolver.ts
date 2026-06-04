/**
 * themeResolver — Assets.xcassets colorset → designTokens 생성
 *
 * Contents.json (colorset) 구조:
 * {
 *   "colors": [{
 *     "color": { "color-space": "srgb", "components": { "red": "0.2", "green": "0.5", "blue": "0.9", "alpha": "1" } },
 *     "idiom": "universal"
 *   }]
 * }
 */

import { readdir, readFile, stat } from "fs/promises";
import path from "path";

export interface ThemeResult {
  colors: Record<string, string>;
  diagnostics: Array<{ level: "info" | "warn" | "error"; code: string; message: string }>;
}

// ── sRGB float → hex ───────────────────────────────────────────────────────────

function floatToHex(v: number): string {
  return Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");
}

function srgbToHex(r: number, g: number, b: number): string {
  return `#${floatToHex(r)}${floatToHex(g)}${floatToHex(b)}`;
}

// ── colorset 파일 파싱 ─────────────────────────────────────────────────────────

async function parseColorset(contentsPath: string): Promise<string | undefined> {
  let json: any;
  try {
    const raw = await readFile(contentsPath, "utf-8");
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!Array.isArray(json.colors)) return undefined;

  // universal (light) 색상만 추출
  for (const entry of json.colors) {
    if (entry.appearances) continue; // dark / high-contrast 변형 건너뜀
    const comp = entry?.color?.components;
    if (!comp) continue;

    const r = parseFloat(comp.red);
    const g = parseFloat(comp.green);
    const b = parseFloat(comp.blue);

    if (isNaN(r) || isNaN(g) || isNaN(b)) continue;
    return srgbToHex(r, g, b);
  }

  // fallback: 첫 번째 항목
  const first = json.colors[0];
  const comp = first?.color?.components;
  if (!comp) return undefined;

  const r = parseFloat(comp.red);
  const g = parseFloat(comp.green);
  const b = parseFloat(comp.blue);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return undefined;
  return srgbToHex(r, g, b);
}

// ── Assets.xcassets 순회 ──────────────────────────────────────────────────────

async function walkXcassets(
  dir: string,
  colors: Record<string, string>
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry);
    const s = await stat(full).catch(() => null);
    if (!s) continue;

    if (s.isDirectory()) {
      if (entry.endsWith(".colorset")) {
        // colorset 디렉토리: name은 .colorset 제거
        const colorName = entry.replace(".colorset", "");
        const contentsPath = path.join(full, "Contents.json");
        const hex = await parseColorset(contentsPath);
        if (hex) {
          colors[`color:${colorName}`] = hex;
          colors[colorName] = hex; // 단축 접근용
        }
      } else {
        await walkXcassets(full, colors);
      }
    }
  }
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

export async function resolveSwiftTheme(projectPath: string): Promise<ThemeResult> {
  const colors: Record<string, string> = {};
  const diagnostics: ThemeResult["diagnostics"] = [];

  // xcassets 디렉토리 탐색
  const xcassetsDir = path.join(projectPath, "Assets.xcassets");
  try {
    await stat(xcassetsDir);
    await walkXcassets(xcassetsDir, colors);
  } catch {
    diagnostics.push({
      level: "warn",
      code: "THEME_DEFAULTED",
      message: "Assets.xcassets 디렉토리를 찾을 수 없습니다. 색상 토큰 없이 진행합니다.",
    });
  }

  return { colors, diagnostics };
}
