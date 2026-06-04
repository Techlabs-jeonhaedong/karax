/**
 * xmlLayoutAdapter — Android XML layout 레거시 경로
 *
 * 공개 API:
 *   parseXmlLayout(layoutPath, strings, colors) → IRNode
 *   discoverXmlLayouts(projectPath) → ScreenSummary[]
 *   buildXmlScreenIR(projectPath, screenId, mockSeed?) → IRDocument
 *
 * 탐색 전략:
 *   1. res/layout/*.xml 전체 수집
 *   2. Java/Kotlin 소스에서 setContentView(R.layout.xxx) 연결
 *   3. 연결된 layout → route, 미참조 layout → candidate
 */

import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import type { ScreenSummary } from "@sfc/adapter-api";
import type { IRDocument, IRNode } from "@sfc/core";
import {
  aggregateScreenConfidence,
  parseIRDocument,
  NODE_CONFIDENCE,
} from "@sfc/core";
import {
  tokenize,
  buildTree,
  xmlElementToIRNode,
  resolveColor,
} from "./xmlParser.js";
import { parseColorsXml, parseStringsXml } from "./resourceParser.js";

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * XML layout 파일 한 장을 IRNode 트리로 변환한다.
 */
export async function parseXmlLayout(
  layoutPath: string,
  strings: Map<string, string>,
  colors: Map<string, string>
): Promise<IRNode> {
  const xml = await readFile(layoutPath, "utf-8");
  const tokens = tokenize(xml);
  const tree = buildTree(tokens);
  if (!tree) {
    return {
      type: "Unknown",
      role: "component:empty",
      confidence: NODE_CONFIDENCE.unknown,
    };
  }
  return xmlElementToIRNode(tree, strings, colors);
}

/**
 * 프로젝트 경로에서 XML layout 화면 목록을 발견한다.
 * - Activity의 setContentView(R.layout.xxx) → route
 * - 미참조 layout → candidate
 */
export async function discoverXmlLayouts(
  projectPath: string
): Promise<ScreenSummary[]> {
  const layoutDir = path.join(
    projectPath,
    "app",
    "src",
    "main",
    "res",
    "layout"
  );

  // layout/*.xml 수집
  const layoutFiles = await collectLayoutXmls(layoutDir);
  if (layoutFiles.length === 0) return [];

  // Java/Kotlin 소스에서 setContentView 참조 수집
  const referenced = await collectSetContentViewReferences(projectPath);

  const screens: ScreenSummary[] = [];

  for (const layoutFile of layoutFiles) {
    const layoutName = path.basename(layoutFile, ".xml");
    const relPath = path.relative(projectPath, layoutFile);
    const ref = referenced.get(layoutName);

    if (ref) {
      screens.push({
        id: layoutName,
        title: layoutNameToTitle(layoutName),
        discovery: "route",
        confidence: 1.0,
        sourceRef: {
          file: relPath,
          line: 1,
          symbol: layoutName,
        },
      });
    } else {
      screens.push({
        id: layoutName,
        title: layoutNameToTitle(layoutName),
        discovery: "candidate",
        confidence: 0.6,
        sourceRef: {
          file: relPath,
          line: 1,
          symbol: layoutName,
        },
      });
    }
  }

  return screens;
}

/**
 * 특정 XML layout screenId에 대한 IRDocument를 빌드한다.
 */
export async function buildXmlScreenIR(
  projectPath: string,
  screenId: string,
  mockSeed: number = 42
): Promise<IRDocument> {
  const layoutDir = path.join(
    projectPath,
    "app",
    "src",
    "main",
    "res",
    "layout"
  );
  const layoutPath = path.join(layoutDir, `${screenId}.xml`);

  // 리소스 로드
  const strings = await loadStrings(projectPath);
  const colors = await loadColors(projectPath);

  // layout 파일 존재 확인
  const exists = await fileExists(layoutPath);
  if (!exists) {
    const doc = {
      schemaVersion: "0.1",
      screen: {
        id: screenId,
        discovery: "candidate" as const,
        confidence: 0,
        root: {
          type: "Unknown" as const,
          confidence: NODE_CONFIDENCE.unknown,
          role: `component:${screenId}`,
        },
      },
      diagnostics: [
        {
          level: "warn" as const,
          code: "UNRESOLVED_COMPONENT",
          message: `XML layout '${screenId}.xml'를 찾을 수 없음`,
        },
      ],
    };
    return parseIRDocument(doc);
  }

  // discovery 판단
  const referenced = await collectSetContentViewReferences(projectPath);
  const discovery: "route" | "candidate" = referenced.has(screenId)
    ? "route"
    : "candidate";

  // IRNode 변환
  let root: IRNode;
  const diagnostics: Array<{
    level: "info" | "warn" | "error";
    code: string;
    message: string;
  }> = [];

  try {
    root = await parseXmlLayout(layoutPath, strings, colors);
  } catch (err) {
    diagnostics.push({
      level: "warn",
      code: "UNRESOLVED_COMPONENT",
      message: `XML layout 파싱 오류: ${err instanceof Error ? err.message : String(err)}`,
    });
    root = {
      type: "Unknown",
      confidence: NODE_CONFIDENCE.unknown,
      role: `component:${screenId}`,
    };
  }

  const confidence = aggregateScreenConfidence(root, discovery);
  const relPath = path.relative(
    projectPath,
    path.join(layoutDir, `${screenId}.xml`)
  );

  const doc = {
    schemaVersion: "0.1",
    screen: {
      id: screenId,
      sourceRef: {
        file: relPath,
        line: 1,
        symbol: screenId,
      },
      device: "pixel-8" as const,
      discovery,
      confidence,
      root,
    },
    designTokens: {
      colors: Object.fromEntries(colors),
    },
    diagnostics,
  };

  return parseIRDocument(doc);
}

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

async function collectLayoutXmls(layoutDir: string): Promise<string[]> {
  try {
    const entries = await readdir(layoutDir);
    return entries
      .filter((e) => e.endsWith(".xml"))
      .map((e) => path.join(layoutDir, e));
  } catch {
    return [];
  }
}

/**
 * Java/Kotlin 소스에서 setContentView(R.layout.xxx) 패턴을 수집한다.
 * @returns layoutName → sourceFile 맵
 */
async function collectSetContentViewReferences(
  projectPath: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // app/src/main/java 및 kotlin 디렉토리 탐색
  const sourceDirs = [
    path.join(projectPath, "app", "src", "main", "java"),
    path.join(projectPath, "app", "src", "main", "kotlin"),
    path.join(projectPath, "src", "main", "java"),
    path.join(projectPath, "src", "main", "kotlin"),
  ];

  for (const dir of sourceDirs) {
    await walkSourceDir(dir, map, projectPath);
  }

  return map;
}

async function walkSourceDir(
  dir: string,
  map: Map<string, string>,
  projectPath: string
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      await walkSourceDir(full, map, projectPath);
    } else if (entry.endsWith(".java") || entry.endsWith(".kt")) {
      const source = await readFile(full, "utf-8").catch(() => "");
      // setContentView(R.layout.activity_main) 또는
      // setContentView(R.layout.activity_main, ...)
      const re = /setContentView\s*\(\s*R\.layout\.(\w+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        const layoutName = m[1]!;
        if (!map.has(layoutName)) {
          map.set(layoutName, path.relative(projectPath, full));
        }
      }
    }
  }
}

async function loadStrings(projectPath: string): Promise<Map<string, string>> {
  const p = path.join(
    projectPath,
    "app",
    "src",
    "main",
    "res",
    "values",
    "strings.xml"
  );
  try {
    const xml = await readFile(p, "utf-8");
    return parseStringsXml(xml);
  } catch {
    return new Map();
  }
}

async function loadColors(projectPath: string): Promise<Map<string, string>> {
  const p = path.join(
    projectPath,
    "app",
    "src",
    "main",
    "res",
    "values",
    "colors.xml"
  );
  try {
    const xml = await readFile(p, "utf-8");
    return parseColorsXml(xml);
  } catch {
    return new Map();
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function layoutNameToTitle(name: string): string {
  // activity_main → Activity Main
  // layout_orphan → Orphan
  const stripped = name.replace(/^(activity|layout|fragment)_/, "");
  return stripped
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
