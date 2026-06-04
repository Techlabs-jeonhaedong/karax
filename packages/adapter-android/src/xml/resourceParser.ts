/**
 * resourceParser — XML 리소스 파일 파서 (strings.xml, colors.xml)
 *
 * 기존 parse/resources.ts의 로직을 Map 반환 형태로 export.
 * xmlLayoutAdapter에서 import.
 */

export function parseStringsXml(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<string\s+name="([^"]+)"[^>]*>([^<]*)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

export function parseColorsXml(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  // <color name="brand_primary">#FF6200EE</color>
  const re = /<color\s+name="([^"]+)"[^>]*>#?([0-9A-Fa-f]{6,8})<\/color>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const name = m[1]!;
    const hex = m[2]!;
    // AARRGGBB → #RRGGBB (알파 제거)
    const normalized = hex.length === 8 ? `#${hex.slice(2)}` : `#${hex}`;
    map.set(name, normalized.toUpperCase());
  }
  return map;
}
