import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import type { ScreenSummary, DeviceProfileId } from "@karax/adapter-api";
import {
  getDeviceProfile,
  physicalSize,
  type DeviceProfile,
} from "./deviceProfiles.js";
import {
  generateMockValue,
  parseConstructorParams,
  HarnessError,
  type ConstructorParam,
} from "./paramCodegen.js";

// ── 패키지 내 assets 경로 ──────────────────────────────────────────────────────

/** packages/compile-flutter/assets/fonts 절대경로 */
export function getBuiltinFontsDir(): string {
  // __dirname 대신 import.meta.url 사용 (ESM)
  const here = new URL(".", import.meta.url).pathname;
  // src/harness/ → ../../assets/fonts
  return path.resolve(here, "../../assets/fonts");
}

// ── pubspec.yaml 생성 ──────────────────────────────────────────────────────────

export interface GeneratePubspecOpts {
  appPackageName: string;
  appAbsolutePath: string;
  fontsDir: string;
  /** 대상 앱의 추가 asset 경로 목록 (하니스 pubspec에 선언 필요) */
  appAssetPaths?: string[];
}

/**
 * 하니스 pubspec.yaml 내용을 생성한다.
 */
export function generatePubspec(opts: GeneratePubspecOpts): string {
  const { appPackageName, appAbsolutePath, fontsDir, appAssetPaths = [] } = opts;

  // 폰트 파일 목록 — fontsDir 내 .ttf 파일
  let fontEntries = "";
  try {
    const ttfs = fs.readdirSync(fontsDir).filter((f) => f.endsWith(".ttf"));
    if (ttfs.length > 0) {
      fontEntries = `  fonts:\n    - family: Roboto\n      fonts:\n`;
      for (const ttf of ttfs.sort()) {
        const weight = ttf.includes("Bold")
          ? "\n          weight: 700"
          : ttf.includes("Medium")
          ? "\n          weight: 500"
          : ttf.includes("Light")
          ? "\n          weight: 300"
          : "";
        fontEntries += `        - asset: fonts/${ttf}${weight}\n`;
      }
    }
  } catch {
    // fontsDir 접근 실패 시 폰트 없이 진행
  }

  // asset 선언
  let assetSection = "";
  if (appAssetPaths.length > 0 || fontEntries) {
    const assetLines = appAssetPaths.map((p) => `    - ${p}`).join("\n");
    const assetBlock = appAssetPaths.length > 0 ? `  assets:\n${assetLines}\n` : "";
    assetSection = `\nflutter:\n  uses-material-design: true\n${assetBlock}${fontEntries}`;
  } else {
    assetSection = `\nflutter:\n  uses-material-design: true\n${fontEntries}`;
  }

  return `name: sfc_harness
description: Auto-generated harness for SFC screenshot capture
publish_to: none

version: 1.0.0+1

environment:
  sdk: ">=3.0.0 <4.0.0"
  flutter: ">=3.10.0"

dependencies:
  flutter:
    sdk: flutter
  ${appPackageName}:
    path: ${appAbsolutePath}

dev_dependencies:
  flutter_test:
    sdk: flutter
${assetSection}
`;
}

// ── test/screen_capture_test.dart 생성 ──────────────────────────────────────────

export interface GenerateTestDartOpts {
  screen: ScreenSummary;
  appPackageName: string;
  params: ConstructorParam[];
  device: DeviceProfileId;
  goldenFileName: string;
  mockSeed?: number;
}

/**
 * flutter test 하니스 Dart 파일 내용을 생성한다.
 */
export function generateTestDart(opts: GenerateTestDartOpts): string {
  const { screen, appPackageName, params, device, goldenFileName, mockSeed = 0 } = opts;
  const profile = getDeviceProfile(device);
  const pSize = physicalSize(profile);

  // 화면 import 경로: lib/screens/home_screen.dart → screens/home_screen.dart
  const sourceFile = screen.sourceRef?.file ?? `lib/${screen.id.toLowerCase()}.dart`;
  const importPath = sourceFile.startsWith("lib/")
    ? sourceFile.slice("lib/".length) // lib/ 제거
    : sourceFile;

  // 위젯 생성자 인수 생성
  const constructorArgs = buildConstructorArgs(params, screen.id, mockSeed);
  const widgetCall = constructorArgs.length === 0
    ? `const ${screen.id}()`
    : `${screen.id}(\n    ${constructorArgs}\n  )`;

  // 폰트 로더 코드
  const fontLoaderCode = generateFontLoaderCode();

  return `import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:${appPackageName}/${importPath}';

void main() {
  testWidgets('capture ${screen.id}', (WidgetTester tester) async {
    // 폰트 로드
${fontLoaderCode}

    // 디바이스 크기 설정: ${device} (물리 픽셀 ${pSize.width}x${pSize.height}, dpr=${profile.devicePixelRatio})
    tester.view.physicalSize = const Size(${pSize.width}.0, ${pSize.height}.0);
    tester.view.devicePixelRatio = ${profile.devicePixelRatio};
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    // 위젯 렌더
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(
            seedColor: const Color(0xFF6750A4),
            brightness: Brightness.light,
          ),
          useMaterial3: true,
          fontFamily: 'Roboto',
        ),
        home: ${widgetCall},
      ),
    );

    // 애니메이션/타이머 처리
    try {
      await tester.pumpAndSettle(const Duration(seconds: 3));
    } catch (_) {
      // 타이머/애니메이션 pending이 있어도 현재 프레임으로 캡처
      await tester.pump();
    }

    // 골든 파일 캡처
    await expectLater(
      find.byType(MaterialApp),
      matchesGoldenFile('${goldenFileName}'),
    );
  });
}
`;
}

/** 폰트 로더 Dart 코드 조각 생성 */
function generateFontLoaderCode(): string {
  const weights = [
    { file: "Roboto-Regular.ttf", weight: null },
    { file: "Roboto-Bold.ttf", weight: 700 },
    { file: "Roboto-Medium.ttf", weight: 500 },
    { file: "Roboto-Light.ttf", weight: 300 },
  ];

  const lines: string[] = [
    `    final fontLoader = FontLoader('Roboto');`,
  ];

  for (const { file } of weights) {
    lines.push(
      `    fontLoader.addFont(rootBundle.load('fonts/${file}'));`
    );
  }

  lines.push(`    await fontLoader.load();`);
  return lines.join("\n");
}

/** required 파라미터에 대한 Dart 생성자 인수 코드 생성 */
function buildConstructorArgs(
  params: ConstructorParam[],
  screenId: string,
  mockSeed: number
): string {
  const requiredParams = params.filter((p) => p.isRequired && p.name !== "key");
  if (requiredParams.length === 0) return "";

  const args: string[] = [];
  for (const param of requiredParams) {
    try {
      const value = generateMockValue(param.type, param.name, mockSeed);
      if (param.isNamed) {
        args.push(`${param.name}: ${value}`);
      } else {
        args.push(value);
      }
    } catch (e) {
      if (e instanceof HarnessError && e.code === "UNINJECTABLE_PARAM") {
        throw e; // 상위로 전달
      }
      throw e;
    }
  }

  return args.join(",\n    ");
}

// ── 하니스 프로젝트 생성 ────────────────────────────────────────────────────────

export interface GenerateHarnessOpts {
  projectPath: string;
  screen: ScreenSummary;
  device: DeviceProfileId;
  mockSeed: number;
  workDir?: string;
}

export interface HarnessProject {
  workDir: string;
  goldenFileName: string;
  goldenPath: string; // test/ 아래 골든 파일 절대경로
}

/**
 * workDir에 하니스 Flutter 프로젝트를 생성한다.
 * workDir이 지정되지 않으면 os.tmpdir()에 임시 디렉토리를 생성한다.
 */
export async function generateHarness(opts: GenerateHarnessOpts): Promise<HarnessProject> {
  const { projectPath, screen, device, mockSeed } = opts;

  // 앱 패키지명 읽기
  const pubspecContent = fs.readFileSync(path.join(projectPath, "pubspec.yaml"), "utf-8");
  const nameMatch = pubspecContent.match(/^name:\s*(\S+)/m);
  if (!nameMatch) throw new Error("pubspec.yaml에서 name 필드를 찾을 수 없음");
  const appPackageName = nameMatch[1];

  // workDir 결정
  const hash = crypto.createHash("sha256")
    .update(`${projectPath}:${screen.id}:${device}:${mockSeed}`)
    .digest("hex")
    .slice(0, 12);
  const workDir = opts.workDir ?? path.join(os.tmpdir(), `karax-flutter-${hash}`);

  // 하니스 디렉토리 생성
  fs.mkdirSync(workDir, { recursive: true });
  const testDir = path.join(workDir, "test");
  fs.mkdirSync(testDir, { recursive: true });

  // 폰트 복사: packages/compile-flutter/assets/fonts → workDir/fonts
  const fontsDir = getBuiltinFontsDir();
  const harnissFontsDir = path.join(workDir, "fonts");
  fs.mkdirSync(harnissFontsDir, { recursive: true });
  try {
    const ttfs = fs.readdirSync(fontsDir).filter((f) => f.endsWith(".ttf"));
    for (const ttf of ttfs) {
      fs.copyFileSync(path.join(fontsDir, ttf), path.join(harnissFontsDir, ttf));
    }
  } catch {
    // 폰트 복사 실패 시 Ahem 폰트로 폴백 — 골든 PNG에 블록 글자가 표시됨
    console.warn("[compile-flutter] 폰트 복사 실패 — Ahem 폰트로 폴백");
  }

  // 대상 앱 asset 처리: symlink 또는 복사
  const appAssets = extractAppAssets(pubspecContent, projectPath, workDir);

  // pubspec.yaml 생성
  const pubspecYaml = generatePubspec({
    appPackageName,
    appAbsolutePath: projectPath,
    fontsDir,
    appAssetPaths: appAssets.harnessDeclarations,
  });
  fs.writeFileSync(path.join(workDir, "pubspec.yaml"), pubspecYaml, "utf-8");

  // 생성자 파라미터 파싱
  const params = await extractConstructorParams(projectPath, screen, appPackageName);

  // 골든 파일명
  const goldenFileName = `${screen.id}.png`;

  // test/screen_capture_test.dart 생성
  const testDart = generateTestDart({
    screen,
    appPackageName,
    params,
    device,
    goldenFileName,
    mockSeed,
  });
  fs.writeFileSync(path.join(testDir, "screen_capture_test.dart"), testDart, "utf-8");

  return {
    workDir,
    goldenFileName,
    goldenPath: path.join(testDir, "goldens", goldenFileName),
  };
}

// ── 대상 앱 asset 처리 ─────────────────────────────────────────────────────────

interface AppAssetResult {
  harnessDeclarations: string[];
}

/**
 * 대상 앱의 pubspec.yaml에서 asset 경로를 추출하고
 * 하니스 workDir에 심링크 또는 복사한다.
 */
function extractAppAssets(
  pubspecContent: string,
  projectPath: string,
  workDir: string
): AppAssetResult {
  const harnessDeclarations: string[] = [];

  // flutter.assets 섹션 파싱 (간단한 정규식)
  const assetsSection = pubspecContent.match(/^  assets:\s*\n((?:    - .+\n?)*)/m);
  if (!assetsSection) return { harnessDeclarations };

  const assetLines = assetsSection[1]
    .split("\n")
    .map((l) => l.trim().replace(/^- /, ""))
    .filter(Boolean);

  for (const assetPath of assetLines) {
    const srcPath = path.join(projectPath, assetPath);
    const destPath = path.join(workDir, assetPath);

    // 목적지 디렉토리 생성
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    try {
      if (fs.existsSync(srcPath)) {
        // 심링크 시도 — 실패 시 복사
        try {
          if (!fs.existsSync(destPath)) {
            fs.symlinkSync(srcPath, destPath);
          }
        } catch {
          fs.copyFileSync(srcPath, destPath);
        }
        harnessDeclarations.push(assetPath);
      }
    } catch {
      // asset 처리 실패 시 건너뜀
    }
  }

  return { harnessDeclarations };
}

// ── 생성자 파라미터 추출 ───────────────────────────────────────────────────────

/**
 * 화면 소스 파일에서 생성자 파라미터를 추출한다.
 */
async function extractConstructorParams(
  projectPath: string,
  screen: ScreenSummary,
  _appPackageName: string
): Promise<ConstructorParam[]> {
  const sourceFile = screen.sourceRef?.file;
  if (!sourceFile) return [];

  const absPath = path.join(projectPath, sourceFile);
  try {
    const source = fs.readFileSync(absPath, "utf-8");
    return parseConstructorParams(screen.id, source);
  } catch {
    return [];
  }
}
