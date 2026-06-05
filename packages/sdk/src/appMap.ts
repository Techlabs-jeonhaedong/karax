/**
 * generateAppMap — SDK AppMap 생성 공개 API
 *
 * @sfc/doctor, @sfc/renderer, @sfc/compile-* 에 의존하지 않아
 * 독립 모듈로 테스트 가능하다.
 */

import path from "path";
import { mkdir, writeFile } from "fs/promises";
import type {
  FrameworkId,
  AdapterContext,
  FrameworkAdapter,
} from "@karax/adapter-api";
import { detectFramework as coreDetectFramework } from "@karax/core";
import { assembleAppMap, sanitizeAppName, renderAppMapMarkdown, matchElement, AppMapSchema } from "@karax/core";
import type { AppMap, AppMapDocument, AppMapRenderOptions, IRDocument } from "@karax/core";

export { renderAppMapMarkdown };
export type { AppMap, AppMapDocument, AppMapRenderOptions };

export interface GenerateAppMapOptions {
  projectPath: string;
  framework?: FrameworkId;
  mockSeed?: number;
  includeCandidates?: boolean;
  /** 좌표 측정 여부 (기본: true). Chromium 실패 시 LAYOUT_UNAVAILABLE diagnostic 추가 후 좌표 생략. */
  includeLayout?: boolean;
  /** 레이아웃 측정 시 사용할 디바이스 프로파일 ID */
  device?: string;
}

/** write: true 오버로드 시 반환 타입 */
export interface GenerateAppMapResult {
  appMap: AppMap;
  documents: AppMapDocument[];
  writtenPaths: string[];
}

/**
 * outDir에 문서를 파일로 기록한다.
 * CLI bin.ts 경로 탈출 방어 로직과 동일하게 구현 (커밋 10ef7c5 패턴).
 */
export async function writeAppMapDocuments(
  docs: AppMapDocument[],
  outDir: string
): Promise<string[]> {
  const resolvedOutDir = path.resolve(outDir);
  await mkdir(resolvedOutDir, { recursive: true });

  const writtenPaths: string[] = [];
  for (const doc of docs) {
    // path.basename으로 경로 탈출 방어 — doc.fileName은 항상 단순 파일명이어야 함
    const safeFileName = path.basename(doc.fileName);
    const filePath = path.resolve(resolvedOutDir, safeFileName);
    // outDir 내부인지 검증
    if (!filePath.startsWith(resolvedOutDir + path.sep) && filePath !== resolvedOutDir) {
      throw new Error(`경로 탈출 감지: ${doc.fileName}`);
    }
    await writeFile(filePath, doc.content, "utf-8");
    writtenPaths.push(filePath);
  }
  return writtenPaths;
}

/** lazy 어댑터 로더 (doctor/renderer 없이) */
async function loadAdapter(id: FrameworkId): Promise<FrameworkAdapter> {
  switch (id) {
    case "flutter": {
      const m = await import("@karax/adapter-flutter");
      return m.flutterAdapter;
    }
    case "react-native": {
      const m = await import("@karax/adapter-react-native");
      return m.reactNativeAdapter;
    }
    case "android": {
      const m = await import("@karax/adapter-android");
      return m.androidAdapter;
    }
    case "ios": {
      const m = await import("@karax/adapter-ios");
      return m.iosAdapter;
    }
    default:
      throw Object.assign(
        new Error(`UNSUPPORTED_FRAMEWORK: '${id}' 어댑터가 없습니다.`),
        { code: "UNSUPPORTED_FRAMEWORK" }
      );
  }
}

async function resolveFrameworkId(opts: GenerateAppMapOptions): Promise<FrameworkId> {
  if (opts.framework) return opts.framework;

  const detected = await coreDetectFramework(opts.projectPath);
  if (detected.frameworks.length === 0) {
    throw Object.assign(
      new Error("프레임워크를 감지할 수 없습니다."),
      { code: "FRAMEWORK_NOT_DETECTED" }
    );
  }
  return detected.frameworks[0].id;
}

/**
 * 프로젝트의 화면 구조와 네비게이션 그래프를 분석해 AppMap을 생성한다.
 *
 * 오버로드 1 (기존, 하위호환): write/outDir 없이 호출 → AppMap 반환
 * 오버로드 2 (신규): write: true + outDir 지정 → { appMap, documents, writtenPaths } 반환
 *
 * - discoverNavigation이 없는 어댑터: 빈 edges + NAV_UNSUPPORTED 진단
 * - readAppName이 없는 어댑터: basename(projectPath) fallback
 */
export async function generateAppMap(
  opts: GenerateAppMapOptions & { write: true; outDir: string; maxCharsPerDoc?: number }
): Promise<GenerateAppMapResult>;
export async function generateAppMap(
  opts: GenerateAppMapOptions
): Promise<AppMap>;
export async function generateAppMap(
  opts: GenerateAppMapOptions & { write?: boolean; outDir?: string; maxCharsPerDoc?: number }
): Promise<AppMap | GenerateAppMapResult> {
  const frameworkId = await resolveFrameworkId(opts);
  const adapter = await loadAdapter(frameworkId);

  const ctx: AdapterContext = {
    projectPath: opts.projectPath,
    framework: frameworkId,
    mockSeed: opts.mockSeed,
    includeCandidates: opts.includeCandidates ?? true,
  };

  const screens = await adapter.discoverScreens(ctx);

  let navGraph: Awaited<ReturnType<Exclude<typeof adapter.discoverNavigation, undefined>>>;
  if (adapter.discoverNavigation) {
    navGraph = await adapter.discoverNavigation(ctx);
  } else {
    navGraph = {
      entryScreenId: null,
      edges: [],
      diagnostics: [
        {
          code: "NAV_UNSUPPORTED",
          message: `'${frameworkId}' 어댑터는 네비게이션 그래프 추출을 지원하지 않습니다`,
        },
      ],
    };
  }

  let rawAppName: string | undefined;
  if (adapter.readAppName) {
    rawAppName = await adapter.readAppName(ctx);
  }
  const appName = sanitizeAppName(rawAppName ?? path.basename(opts.projectPath));

  // 각 화면의 IR을 빌드해 elements를 채운다.
  // 화면 하나의 실패가 전체를 중단시키지 않도록 try/catch로 건너뜀.
  const irDocs: IRDocument[] = [];
  for (const screen of screens) {
    try {
      const irDoc = await adapter.buildScreenIR(ctx, screen.id);
      irDocs.push(irDoc);
    } catch {
      // IR 빌드 실패 — 해당 화면은 elements=[]로 처리 (계속 진행)
    }
  }

  const appMap = assembleAppMap({
    appName,
    framework: frameworkId,
    screens,
    navGraph,
    irDocs,
  });

  // ── 레이아웃 측정 후처리 ────────────────────────────────────────────
  const shouldMeasure = (opts.includeLayout ?? true) && irDocs.length > 0;

  if (shouldMeasure) {
    try {
      const { measureScreenLayouts } = await import("@karax/renderer");
      const layoutMap = await measureScreenLayouts(irDocs, { device: opts.device });

      // 화면별 bounds 주입
      for (const screenNode of appMap.screens) {
        const boundsArr = layoutMap.get(screenNode.id);
        if (!boundsArr || boundsArr.length === 0) continue;

        // element.sourceRef(file+line) → MeasuredBounds 매핑 (첫 번째 일치)
        for (const el of screenNode.elements) {
          if (!el.sourceRef?.file) continue;
          const matched = boundsArr.find(
            (b) =>
              b.sourceRef?.file === el.sourceRef!.file &&
              (el.sourceRef!.line === undefined ||
                b.sourceRef?.line === el.sourceRef!.line),
          );
          if (matched) {
            el.bounds = { x: matched.x, y: matched.y, width: matched.width, height: matched.height };
          }
        }

        // outgoing edge trigger bounds 주입
        for (const edge of screenNode.outgoing) {
          const matchedEl = matchElement(edge.trigger, screenNode.elements);
          if (matchedEl?.bounds) {
            (edge.trigger as Record<string, unknown>).bounds = matchedEl.bounds;
          }
        }
      }

      // appMap.edges도 동기화 (screenNode.outgoing과 같은 객체 참조 확인 불가 — 동일 로직 적용)
      for (const edge of appMap.edges) {
        const screenNode = appMap.screens.find((s) => s.id === edge.from);
        if (!screenNode) continue;
        const matchedEl = matchElement(edge.trigger, screenNode.elements);
        if (matchedEl?.bounds && !edge.trigger.bounds) {
          (edge.trigger as Record<string, unknown>).bounds = matchedEl.bounds;
        }
      }

      appMap.diagnostics.push({
        code: "LAYOUT_APPROX",
        message:
          "좌표는 Tier 2 정적 렌더 기반 근사값입니다 (CSS px, 디바이스 프로파일 뷰포트 기준)",
      });
    } catch (err: unknown) {
      const cause = err instanceof Error ? err.message : String(err);
      appMap.diagnostics.push({
        code: "LAYOUT_UNAVAILABLE",
        message: `Chromium 렌더 실패 — 좌표를 생략합니다: ${cause}`,
      });
    }
  }

  // 최종 스키마 재검증
  const validatedAppMap = AppMapSchema.parse(appMap);

  // write 오버로드: 파일 기록 후 GenerateAppMapResult 반환
  if ((opts as { write?: boolean }).write === true) {
    const outDir = (opts as { outDir?: string }).outDir!;
    const maxChars = (opts as { maxCharsPerDoc?: number }).maxCharsPerDoc;
    const documents = renderAppMapMarkdown(validatedAppMap, {
      ...(maxChars !== undefined ? { maxChars } : {}),
    });
    const writtenPaths = await writeAppMapDocuments(documents, outDir);
    return { appMap: validatedAppMap, documents, writtenPaths };
  }

  return validatedAppMap;
}
