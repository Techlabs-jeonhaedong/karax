/**
 * ThemeResolver — main.dart의 ThemeData를 파싱해 designTokens.colors 맵을 생성한다.
 *
 * 지원:
 * - ColorScheme.fromSeed(seedColor: Color(0x...)) → primary를 시드색으로, 나머지는 M3 근사
 * - 명시적 ColorScheme(...) 파라미터 직접 파싱
 * - 파싱 실패 시 Material3 light 기본 토큰 + THEME_DEFAULTED diagnostic
 */

import { readFile } from "fs/promises";
import path from "path";
import { parseSource } from "@sfc/adapter-api";
import type { SyntaxNode } from "@sfc/adapter-api";
import {
  findAllNodes,
  findChild,
  getDirectNamedArg,
  parseColorNode,
} from "./astUtils.js";

// ── Material3 light 기본 토큰 ─────────────────────────────────────────────────

const MATERIAL3_LIGHT_DEFAULTS: Record<string, string> = {
  primary: "#6750A4",
  onPrimary: "#FFFFFF",
  primaryContainer: "#EADDFF",
  onPrimaryContainer: "#21005D",
  secondary: "#625B71",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#E8DEF8",
  onSecondaryContainer: "#1D192B",
  tertiary: "#7D5260",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#FFD8E4",
  onTertiaryContainer: "#31111D",
  error: "#B3261E",
  onError: "#FFFFFF",
  errorContainer: "#F9DEDC",
  onErrorContainer: "#410E0B",
  surface: "#FFFBFE",
  onSurface: "#1C1B1F",
  surfaceVariant: "#E7E0EC",
  onSurfaceVariant: "#49454F",
  surfaceContainerHighest: "#E6E1E5",
  outline: "#79747E",
  outlineVariant: "#CAC4D0",
  background: "#FFFBFE",
  onBackground: "#1C1B1F",
  scrim: "#000000",
};

// ── diagnostic 타입 ───────────────────────────────────────────────────────────

export interface ThemeDiagnostic {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
}

// ── ThemeResult 타입 ──────────────────────────────────────────────────────────

export interface ThemeResult {
  colors: Record<string, string>;
  diagnostics: ThemeDiagnostic[];
}

// ── fromSeed 근사 계산 ─────────────────────────────────────────────────────────

/**
 * seedColor를 기반으로 Material3 컬러 스킴을 근사 생성한다.
 * 완전한 Material3 알고리즘 재현 없이, 시드색을 primary로 쓰고
 * 나머지는 밝기/채도 조정으로 합리적 근사값을 생성한다.
 */
function derivePaletteFromSeed(seedHex: string): Record<string, string> {
  // 시드색 파싱
  const r = parseInt(seedHex.slice(1, 3), 16);
  const g = parseInt(seedHex.slice(3, 5), 16);
  const b = parseInt(seedHex.slice(5, 7), 16);

  // onPrimary: 시드가 어두우면 흰색, 밝으면 검정
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const onPrimary = luminance < 0.5 ? "#FFFFFF" : "#000000";

  // primaryContainer: 시드를 매우 밝게 (90% white mix)
  const containerR = Math.round(r + (255 - r) * 0.8);
  const containerG = Math.round(g + (255 - g) * 0.8);
  const containerB = Math.round(b + (255 - b) * 0.8);
  const primaryContainer = toHex(containerR, containerG, containerB);

  return {
    ...MATERIAL3_LIGHT_DEFAULTS,
    primary: seedHex,
    onPrimary,
    primaryContainer,
    onPrimaryContainer: luminance < 0.5 ? toHex(Math.round(r * 0.2), Math.round(g * 0.2), Math.round(b * 0.2)) : "#FFFFFF",
  };
}

function toHex(r: number, g: number, b: number): string {
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * colorScheme 참조 문자열을 token: 형식으로 변환한다.
 * 예: "colorScheme.primary" → "token:primary"
 */
export function colorSchemeRefToToken(ref: string): string {
  const match = ref.match(/^(?:colorScheme|Theme\.of\([^)]*\)\.colorScheme)\.(\w+)$/);
  if (match) return `token:${match[1]}`;
  return ref;
}

/**
 * 프로젝트의 main.dart에서 ThemeData를 파싱해 색상 토큰을 반환한다.
 * 실패 시 Material3 기본 토큰 + THEME_DEFAULTED diagnostic을 반환한다.
 */
export async function resolveTheme(projectPath: string): Promise<ThemeResult> {
  const mainPath = path.join(projectPath, "lib", "main.dart");
  let source: string;
  try {
    source = await readFile(mainPath, "utf-8");
  } catch {
    return {
      colors: { ...MATERIAL3_LIGHT_DEFAULTS },
      diagnostics: [{
        level: "warn",
        code: "THEME_DEFAULTED",
        message: "main.dart를 읽을 수 없어 Material3 기본 테마 토큰을 사용합니다",
      }],
    };
  }

  try {
    const root = await parseSource("dart", source);

    // ColorScheme identifier를 named_argument 안에서 찾아 fromSeed 패턴 탐색
    // 구조: named_argument [label: "colorScheme:", identifier: "ColorScheme", selector: ".fromSeed", selector: "(...)"]
    const allIdentifiers = findAllNodes(root, "identifier");
    const colorSchemeIds = allIdentifiers.filter(n => n.text === "ColorScheme");

    for (const csId of colorSchemeIds) {
      const parent = csId.parent;
      if (!parent) continue;

      // named_argument 또는 그 상위 형제에서 fromSeed 패턴 찾기
      // ColorScheme + selector(.fromSeed) + selector(arguments) 구조
      const siblings = parent.children.filter(c => c !== null);
      const csIdx = siblings.findIndex(c => c === csId);

      // csId 다음 형제들에서 .fromSeed 와 argument_part 찾기
      let foundFromSeed = false;
      let argsSelector: SyntaxNode | undefined;

      for (let i = csIdx + 1; i < siblings.length; i++) {
        const sib = siblings[i]!;
        if (sib.type === "selector") {
          const text = sib.text;
          if (text === ".fromSeed") {
            foundFromSeed = true;
          } else if (foundFromSeed && text.startsWith("(")) {
            argsSelector = sib;
            break;
          }
        }
      }

      if (!foundFromSeed || !argsSelector) continue;

      // argument_part → arguments
      const ap = findChild(argsSelector, "argument_part");
      const args = ap ? findChild(ap, "arguments") : findChild(argsSelector, "arguments") ?? argsSelector;
      if (!args) continue;

      const seedArg = getDirectNamedArg(args, "seedColor");
      if (!seedArg) continue;

      const seedColor = parseColorNode(seedArg) ?? MATERIAL3_LIGHT_DEFAULTS.primary;
      return {
        colors: derivePaletteFromSeed(seedColor),
        diagnostics: [],
      };
    }

    // 명시적 colorScheme: ColorScheme(...) 파싱 시도 — fromSeed가 아닌 경우
    const colors: Record<string, string> = { ...MATERIAL3_LIGHT_DEFAULTS };
    let found = false;

    for (const csId of colorSchemeIds) {
      const parent = csId.parent;
      if (!parent) continue;

      const siblings = parent.children.filter(c => c !== null);
      const csIdx = siblings.findIndex(c => c === csId);

      // 바로 다음 selector가 (arguments) 형태인지 확인
      const nextSib = siblings[csIdx + 1];
      if (!nextSib || nextSib.type !== "selector") continue;

      const ap = findChild(nextSib, "argument_part");
      const args = ap ? findChild(ap, "arguments") : undefined;
      if (!args) continue;

      const colorKeys = ["primary", "onPrimary", "primaryContainer", "onPrimaryContainer",
        "secondary", "onSecondary", "surface", "onSurface", "error", "onError",
        "background", "onBackground", "outline"];

      for (const key of colorKeys) {
        const arg = getDirectNamedArg(args, key);
        if (arg) {
          const color = parseColorNode(arg);
          if (color) {
            colors[key] = color;
            found = true;
          }
        }
      }
    }

    if (found) {
      return { colors, diagnostics: [] };
    }

    // ThemeData 발견했지만 색상 못 찾음 — 기본값
    return {
      colors: { ...MATERIAL3_LIGHT_DEFAULTS },
      diagnostics: [{
        level: "info",
        code: "THEME_DEFAULTED",
        message: "ThemeData에서 색상 스킴을 파싱하지 못해 Material3 기본 토큰을 사용합니다",
      }],
    };
  } catch {
    return {
      colors: { ...MATERIAL3_LIGHT_DEFAULTS },
      diagnostics: [{
        level: "warn",
        code: "THEME_DEFAULTED",
        message: "테마 파싱 중 오류 발생, Material3 기본 토큰을 사용합니다",
      }],
    };
  }
}
