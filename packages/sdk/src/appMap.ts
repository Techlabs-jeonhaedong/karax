/**
 * generateAppMap — SDK AppMap 생성 공개 API
 *
 * @sfc/doctor, @sfc/renderer, @sfc/compile-* 에 의존하지 않아
 * 독립 모듈로 테스트 가능하다.
 */

import path from "path";
import type {
  FrameworkId,
  AdapterContext,
  FrameworkAdapter,
} from "@sfc/adapter-api";
import { detectFramework as coreDetectFramework } from "@sfc/core";
import { assembleAppMap, sanitizeAppName, renderAppMapMarkdown } from "@sfc/core";
import type { AppMap, AppMapDocument, AppMapRenderOptions } from "@sfc/core";

export { renderAppMapMarkdown };
export type { AppMap, AppMapDocument, AppMapRenderOptions };

export interface GenerateAppMapOptions {
  projectPath: string;
  framework?: FrameworkId;
  mockSeed?: number;
  includeCandidates?: boolean;
}

/** lazy 어댑터 로더 (doctor/renderer 없이) */
async function loadAdapter(id: FrameworkId): Promise<FrameworkAdapter> {
  switch (id) {
    case "flutter": {
      const m = await import("@sfc/adapter-flutter");
      return m.flutterAdapter;
    }
    case "react-native": {
      const m = await import("@sfc/adapter-react-native");
      return m.reactNativeAdapter;
    }
    case "android": {
      const m = await import("@sfc/adapter-android");
      return m.androidAdapter;
    }
    case "ios": {
      const m = await import("@sfc/adapter-ios");
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
 * - discoverNavigation이 없는 어댑터: 빈 edges + NAV_UNSUPPORTED 진단
 * - readAppName이 없는 어댑터: basename(projectPath) fallback
 */
export async function generateAppMap(
  opts: GenerateAppMapOptions
): Promise<AppMap> {
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

  return assembleAppMap({
    appName,
    framework: frameworkId,
    screens,
    navGraph,
    irDocs: [],
  });
}
