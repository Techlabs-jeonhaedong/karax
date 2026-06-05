/**
 * RN 웹 하니스 entry.jsx 생성기
 *
 * PLAN 1-1: 하니스 — 임시 workDir에 entry.jsx 생성:
 *   - 대상 화면 import
 *   - mock props(navigation:{navigate/goBack/setOptions noop}, route:{params:{}}) 주입
 *   - createRoot로 #root 렌더
 */
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import type { ScreenSummary, DeviceProfileId } from "@karax/adapter-api";

export interface GenerateHarnessOpts {
  projectPath: string;
  screen: ScreenSummary;
  device: DeviceProfileId;
  mockSeed: number;
  workDir?: string;
}

export interface HarnessProject {
  workDir: string;
  entryPath: string;
}

/**
 * workDir에 entry.jsx를 생성한다.
 * workDir이 지정되지 않으면 os.tmpdir()에 임시 디렉토리를 생성한다.
 */
export function generateHarness(opts: GenerateHarnessOpts): HarnessProject {
  const { projectPath, screen, device, mockSeed } = opts;

  // workDir 결정
  const hash = crypto
    .createHash("sha256")
    .update(`${projectPath}:${screen.id}:${device}:${mockSeed}`)
    .digest("hex")
    .slice(0, 12);
  const workDir = opts.workDir ?? path.join(os.tmpdir(), `karax-rn-${hash}`);
  fs.mkdirSync(workDir, { recursive: true });

  // 화면 소스 절대 경로 (존재 확인)
  const sourceFile = screen.sourceRef?.file ?? `src/screens/${screen.id}.tsx`;
  const absSourceFile = path.resolve(projectPath, sourceFile);

  if (!fs.existsSync(absSourceFile)) {
    throw new Error(`BUNDLE_FAILED: 화면 소스 파일을 찾을 수 없음: ${absSourceFile}`);
  }

  // entry.jsx 생성
  const entryContent = generateEntryJsx(absSourceFile, screen.id);
  const entryPath = path.join(workDir, "entry.jsx");
  fs.writeFileSync(entryPath, entryContent, "utf-8");

  return { workDir, entryPath };
}

/**
 * entry.jsx 내용 생성
 * - 화면 컴포넌트 import (default export 가정)
 * - navigation / route mock props 주입
 * - createRoot로 #root에 렌더
 */
function generateEntryJsx(absSourceFile: string, screenId: string): string {
  // require() → import 변환이 필요한 경우를 위해 절대경로 사용
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import ScreenComponent from '${absSourceFile.replace(/\\/g, "/")}';

// Mock navigation props (react-navigation 의존 화면 지원)
const mockNavigation = {
  navigate: () => {},
  goBack: () => {},
  setOptions: () => {},
  push: () => {},
  pop: () => {},
  reset: () => {},
  replace: () => {},
  dispatch: () => {},
  addListener: () => () => {},
  removeListener: () => {},
  isFocused: () => true,
  canGoBack: () => false,
};

const mockRoute = {
  key: '${screenId}-key',
  name: '${screenId}',
  params: {},
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    React.createElement(ScreenComponent, {
      navigation: mockNavigation,
      route: mockRoute,
    })
  );
}
`.trimStart();
}
