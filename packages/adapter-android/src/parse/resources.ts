/**
 * Android 리소스 파서
 *
 * - res/values/strings.xml: stringResource(R.string.xxx) → 실제 문자열
 * - res/values/colors.xml: colorResource(R.color.xxx) → hex 색상
 */

import { readFile } from "fs/promises";
import path from "path";

export interface ResourceMap {
  strings: Map<string, string>;
  colors: Map<string, string>;
}

function parseStringsXml(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<string\s+name="([^"]+)"[^>]*>([^<]*)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

function parseColorsXml(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  // <color name="brand_primary">#FF6200EE</color>
  const re = /<color\s+name="([^"]+)"[^>]*>#?([0-9A-Fa-f]{6,8})<\/color>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const name = m[1]!;
    const hex = m[2]!;
    // AARRGGBB → #RRGGBB (알파 제거)
    const normalized =
      hex.length === 8 ? `#${hex.slice(2)}` : `#${hex}`;
    map.set(name, normalized.toUpperCase());
  }
  return map;
}

export async function loadResources(
  projectPath: string
): Promise<ResourceMap> {
  const resDir = path.join(projectPath, "app", "src", "main", "res", "values");

  const strings = new Map<string, string>();
  const colors = new Map<string, string>();

  try {
    const stringsXml = await readFile(
      path.join(resDir, "strings.xml"),
      "utf-8"
    );
    for (const [k, v] of parseStringsXml(stringsXml)) {
      strings.set(k, v);
    }
  } catch {
    // strings.xml 없으면 빈 맵
  }

  try {
    const colorsXml = await readFile(path.join(resDir, "colors.xml"), "utf-8");
    for (const [k, v] of parseColorsXml(colorsXml)) {
      colors.set(k, v);
    }
  } catch {
    // colors.xml 없으면 빈 맵
  }

  return { strings, colors };
}
