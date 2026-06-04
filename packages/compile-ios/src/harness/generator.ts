/**
 * compile-ios — 하니스 코드 생성기
 *
 * SwiftPM 패키지 구조:
 *   workDir/
 *     Package.swift          — 라이브러리 타깃 + 테스트 타깃
 *     Sources/SFCHarness/    — 대상 화면 소스 복사본
 *     Tests/SFCHarnessTests/ — XCTest 캡처 코드
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import type { ScreenSummary, DeviceProfileId } from "@sfc/adapter-api";

// ── 디바이스 프로파일 ─────────────────────────────────────────────────────────

interface DeviceProfile {
  logicalWidth: number;
  logicalHeight: number;
  scale: number;
}

const DEVICE_PROFILES: Record<string, DeviceProfile> = {
  "iphone-15": { logicalWidth: 393, logicalHeight: 852, scale: 3.0 },
  "iphone-se": { logicalWidth: 375, logicalHeight: 667, scale: 2.0 },
  "pixel-8": { logicalWidth: 393, logicalHeight: 851, scale: 2.625 },
  "pixel-7": { logicalWidth: 393, logicalHeight: 851, scale: 2.625 },
  "generic-tablet": { logicalWidth: 768, logicalHeight: 1024, scale: 2.0 },
};

function getDeviceProfile(device: string): DeviceProfile {
  return DEVICE_PROFILES[device] ?? DEVICE_PROFILES["iphone-15"]!;
}

// ── selectSimulator ───────────────────────────────────────────────────────────

export interface SimulatorInfo {
  udid: string;
  name: string;
  iosVersion: string;
}

/**
 * `xcrun simctl list devices available` 출력을 파싱해
 * 가장 높은 iOS 버전의 iPhone(없으면 iPad)을 반환한다.
 */
export function selectSimulator(simctlOutput: string): SimulatorInfo | null {
  const versionRegex = /^-- iOS ([\d.]+) --$/;
  const deviceRegex = /^\s+(.+?) \(([A-Z0-9-]{36})\) \((?:Shutdown|Booted)\)/;

  let currentVersion = "";
  let bestVersion = "";
  let bestIphone: SimulatorInfo | null = null;
  let bestDevice: SimulatorInfo | null = null;

  for (const rawLine of simctlOutput.split("\n")) {
    const line = rawLine.trim();
    const verMatch = versionRegex.exec(line);
    if (verMatch) {
      currentVersion = verMatch[1]!;
      continue;
    }

    const devMatch = deviceRegex.exec(rawLine);
    if (devMatch && currentVersion) {
      const name = devMatch[1]!.trim();
      const udid = devMatch[2]!;
      const info: SimulatorInfo = { udid, name, iosVersion: currentVersion };

      // 버전 비교 (숫자 배열로)
      if (compareVersions(currentVersion, bestVersion) >= 0) {
        bestVersion = currentVersion;
        if (name.startsWith("iPhone")) {
          // iPhone 우선
          if (
            !bestIphone ||
            compareVersions(currentVersion, bestIphone.iosVersion) > 0 ||
            (currentVersion === bestIphone.iosVersion && rankIphone(name) > rankIphone(bestIphone.name))
          ) {
            bestIphone = info;
          }
        } else {
          if (
            !bestDevice ||
            compareVersions(currentVersion, bestDevice.iosVersion) > 0
          ) {
            bestDevice = info;
          }
        }
      }
    }
  }

  return bestIphone ?? bestDevice;
}

function compareVersions(a: string, b: string): number {
  if (!a) return -1;
  if (!b) return 1;
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** iPhone 기종 선호도 점수 (Pro > 일반 > 나머지) */
function rankIphone(name: string): number {
  if (name.includes("Pro Max")) return 3;
  if (name.includes("Pro")) return 2;
  if (/iPhone \d+$/.test(name) || /iPhone \d+ $/.test(name)) return 1;
  return 0;
}

// ── buildMockValue ────────────────────────────────────────────────────────────

const MOCK_STRINGS = [
  "Sample Text",
  "Hello World",
  "Mock Value",
  "Test Item",
  "Lorem Ipsum",
];

/**
 * Swift 타입명과 seed로 결정론적 mock 값을 생성한다.
 * 반환값은 Swift 코드에 그대로 삽입 가능한 리터럴 문자열.
 */
export function buildMockValue(type: string, name: string, seed: number): string {
  // seed + name 조합으로 결정론 보장
  const hash = simpleHash(`${seed}:${name}:${type}`);

  const baseType = type.replace(/\?$/, "").trim();
  const isOptional = type.endsWith("?");

  // optional이면 50% 확률로 nil (hash 기반)
  if (isOptional && hash % 2 === 0) {
    return "nil";
  }

  // 배열 타입
  if (baseType.startsWith("[") && baseType.endsWith("]")) {
    const inner = baseType.slice(1, -1).trim();
    const items = [0, 1, 2].map((i) => buildMockValue(inner, `${name}${i}`, seed + i));
    return `[${items.join(", ")}]`;
  }

  switch (baseType) {
    case "String":
      return `"${MOCK_STRINGS[hash % MOCK_STRINGS.length]}"`;

    case "Int":
    case "Int32":
    case "Int64":
    case "UInt":
    case "UInt32":
    case "UInt64":
      return String((hash % 100) + 1);

    case "Double":
    case "Float":
    case "CGFloat":
      return `${(hash % 100) + 1}.${hash % 100 < 10 ? "0" + (hash % 10) : hash % 10}`;

    case "Bool":
      return hash % 2 === 0 ? "true" : "false";

    default:
      return "nil";
  }
}

/** 간단한 결정론적 해시 (32비트) */
function simpleHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

// ── generatePackageSwift ──────────────────────────────────────────────────────

export interface GeneratePackageSwiftOpts {
  packageName: string;
  sourceFiles: string[];
}

/**
 * Package.swift 내용을 생성한다.
 *
 * 구조:
 *  - 라이브러리 타깃: Sources/<packageName>/ — 대상 화면 소스 포함 (MyApp.swift 제외)
 *  - 테스트 타깃: Tests/<packageName>Tests/ — 캡처 테스트
 *
 * xcodebuild scheme 이름: packageName 자체 (not packageName-Package)
 */
export function generatePackageSwift(opts: GeneratePackageSwiftOpts & { excludeFiles?: string[] }): string {
  const { packageName, excludeFiles = [] } = opts;
  const testTargetName = `${packageName}Tests`;

  // exclude 선언 (MyApp.swift + 컴파일 에러 파일 포함)
  const allExcludes = ["MyApp.swift", ...excludeFiles];
  const excludeDecl =
    allExcludes.length > 0
      ? `,\n            exclude: [${allExcludes.map((f) => `"${f}"`).join(", ")}]`
      : "";

  return `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "${packageName}",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "${packageName}", targets: ["${packageName}"]),
    ],
    targets: [
        .target(
            name: "${packageName}",
            path: "Sources/${packageName}"${excludeDecl}
        ),
        .testTarget(
            name: "${testTargetName}",
            dependencies: ["${packageName}"],
            path: "Tests/${testTargetName}"
        ),
    ]
)
`;
}

// ── generateCaptureTest ───────────────────────────────────────────────────────

export interface GenerateCaptureTestOpts {
  screen: ScreenSummary;
  moduleName: string;
  outPath: string;
  width: number;
  height: number;
  scale: number;
  constructorArgs: string;
}

/**
 * XCTest 캡처 Swift 코드를 생성한다.
 *
 * - @MainActor XCTestCase: Swift 6 동시성 규칙 준수
 * - UIWindow에 UIHostingController를 attach한 뒤 렌더 (오프스크린 빈 이미지 방지)
 *   window에 attach되지 않은 view는 SwiftUI 콘텐츠를 그리지 못하는 iOS 알려진 제약
 * - RunLoop.main.run(until:)으로 SwiftUI 렌더 싸이클 완료 대기
 * - 1차: UIGraphicsImageRenderer (UIWindow 경유)
 * - 2차 fallback: ImageRenderer (UIHostingController 렌더 결과가 너무 작으면)
 * - outPath는 코드에 문자열 상수로 하드코딩 (env 전달 불필요)
 */
export function generateCaptureTest(opts: GenerateCaptureTestOpts): string {
  const { screen, moduleName, outPath, width, height, scale, constructorArgs } = opts;
  const widgetCall = constructorArgs
    ? `${screen.id}(\n            ${constructorArgs}\n        )`
    : `${screen.id}()`;

  return `import XCTest
import SwiftUI
import UIKit
@testable import ${moduleName}

@MainActor
final class CaptureTest: XCTestCase {
    func testCapture${screen.id}() async throws {
        let outPath = "${outPath}"

        let rootView = AnyView(
            ${widgetCall}
                .frame(width: ${width}, height: ${height})
        )

        // UIWindow에 attach해서 렌더링 (window 없이는 SwiftUI가 콘텐츠를 그리지 않음)
        let windowScene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first
        let window: UIWindow
        if let scene = windowScene {
            window = UIWindow(windowScene: scene)
        } else {
            window = UIWindow(frame: CGRect(x: 0, y: 0, width: ${width}, height: ${height}))
        }
        window.frame = CGRect(x: 0, y: 0, width: ${width}, height: ${height})

        let hostingVC = UIHostingController(rootView: rootView)
        hostingVC.view.frame = window.bounds
        hostingVC.view.backgroundColor = .systemBackground
        window.rootViewController = hostingVC
        window.makeKeyAndVisible()

        // SwiftUI 렌더 싸이클 완료 대기 (레이아웃 패스 2회 이상 허용)
        hostingVC.view.layoutIfNeeded()
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.5))
        hostingVC.view.layoutIfNeeded()

        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = ${scale}
        fmt.opaque = false
        let uiGraphicsRenderer = UIGraphicsImageRenderer(
            size: CGSize(width: ${width}, height: ${height}),
            format: fmt
        )
        let uiImage = uiGraphicsRenderer.image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }

        var pngData = uiImage.pngData()

        // fallback: UIWindow 렌더 결과가 너무 작으면 ImageRenderer 시도
        if pngData == nil || pngData!.count < 500 {
            let renderer = ImageRenderer(content: rootView)
            renderer.scale = ${scale}
            renderer.proposedSize = .init(width: ${width}, height: ${height})
            pngData = renderer.uiImage?.pngData()
        }

        guard let finalPngData = pngData else {
            XCTFail("ImageRenderer failed to render ${screen.id}")
            return
        }

        let url = URL(fileURLWithPath: outPath)
        try finalPngData.write(to: url)

        XCTAssertTrue(
            FileManager.default.fileExists(atPath: outPath),
            "PNG not found at: \\(outPath)"
        )
        XCTAssertGreaterThan(finalPngData.count, 100, "PNG too small: \\(finalPngData.count) bytes")
    }
}
`;
}

// ── 소스 파일 복사 ────────────────────────────────────────────────────────────

/**
 * 컴파일 에러를 유발하는 것으로 알려진 패턴 목록.
 * 이 패턴이 파일에 포함되어 있으면 stub으로 대체한다.
 */
const COMPILE_ERROR_PATTERNS: RegExp[] = [
  // Swift 6 / Xcode 26 SDK 변경: Toggle.tint(Color?) vs View.tint(ShapeStyle)
  /\.tint\(\.tint\)/,
];

/**
 * @main 구조체를 포함하는 파일은 라이브러리 타깃에서 제외해야 한다.
 */
function hasMainAttribute(source: string): boolean {
  return /@main\b/.test(source);
}

/**
 * 컴파일 에러 패턴이 파일에 포함되어 있는지 확인한다.
 */
function hasCompileErrorPattern(source: string): boolean {
  return COMPILE_ERROR_PATTERNS.some((pattern) => pattern.test(source));
}

/**
 * 화면 구조체명에서 최소 stub SwiftUI View를 생성한다.
 */
function generateStubView(structName: string): string {
  return `import SwiftUI\n// Auto-generated stub (compilation error in original)\nstruct ${structName}: View {\n    var body: some View { Text("${structName}") }\n}\n`;
}

/**
 * Swift 파일에서 주요 struct/class 이름을 추출한다.
 */
function extractTopLevelNames(source: string): string[] {
  const names: string[] = [];
  const re = /^(?:public\s+|internal\s+|private\s+)?(?:struct|class|enum)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

export interface CopySourceFilesResult {
  copiedFiles: string[];
  stubbedFiles: string[];
}

/**
 * 대상 프로젝트에서 화면 관련 Swift 소스 파일을 workDir/Sources/<pkg>/에 복사한다.
 *
 * - @main 구조체 포함 파일: 제외 (라이브러리 타깃과 충돌)
 * - 컴파일 에러 패턴 파일: stub으로 대체
 * - import 그래프 선별 없이 Sources/ 전체 복사
 */
export function copySourceFiles(
  projectPath: string,
  workDir: string,
  packageName: string,
  _targetScreenId?: string
): CopySourceFilesResult {
  const destDir = path.join(workDir, "Sources", packageName);
  fs.mkdirSync(destDir, { recursive: true });

  const copiedFiles: string[] = [];
  const stubbedFiles: string[] = [];

  // Sources/ 디렉토리 탐색 (없으면 프로젝트 루트 전체 .swift 파일)
  const sourcesDir = path.join(projectPath, "Sources");
  const searchDir = fs.existsSync(sourcesDir) ? sourcesDir : projectPath;

  const swiftFiles = findSwiftFiles(searchDir);
  for (const srcFile of swiftFiles) {
    const relPath = path.relative(searchDir, srcFile);
    const destFile = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(destFile), { recursive: true });

    let source: string;
    try {
      source = fs.readFileSync(srcFile, "utf-8");
    } catch {
      continue;
    }

    // @main 파일: 제외 (라이브러리 타깃에 포함되면 entry point 중복 에러)
    if (hasMainAttribute(source)) {
      continue;
    }

    // 컴파일 에러 패턴: stub으로 대체
    if (hasCompileErrorPattern(source)) {
      const names = extractTopLevelNames(source);
      const stubContent = names.length > 0
        ? names.map((n) => generateStubView(n)).join("\n")
        : `import SwiftUI\n// Auto-generated stub (compilation error in original)\n`;
      fs.writeFileSync(destFile, stubContent, "utf-8");
      stubbedFiles.push(relPath);
    } else {
      fs.copyFileSync(srcFile, destFile);
    }

    copiedFiles.push(relPath);
  }

  return { copiedFiles, stubbedFiles };
}

function findSwiftFiles(dir: string): string[] {
  const result: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith(".")) {
        result.push(...findSwiftFiles(full));
      } else if (e.isFile() && e.name.endsWith(".swift")) {
        result.push(full);
      }
    }
  } catch {
    // ignore
  }
  return result;
}

// ── generateHarness ───────────────────────────────────────────────────────────

export interface GenerateHarnessOpts {
  projectPath: string;
  screen: ScreenSummary;
  device: DeviceProfileId;
  mockSeed: number;
  workDir?: string;
}

export interface HarnessProject {
  workDir: string;
  packageName: string;
  schemeName: string;  // xcodebuild -scheme <name>
  outPath: string;     // PNG 출력 경로 (하니스 코드에 하드코딩됨)
}

/**
 * workDir에 하니스 SwiftPM 패키지를 생성한다.
 *
 * 구조:
 *   workDir/
 *     Package.swift
 *     Sources/SFCHarness<hash>/   (대상 소스 복사 + stub 대체)
 *     Tests/SFCHarness<hash>Tests/
 *       CaptureTest.swift
 *
 * xcodebuild scheme 이름은 packageName 자체 (not packageName-Package).
 */
export async function generateHarness(opts: GenerateHarnessOpts): Promise<HarnessProject> {
  const { projectPath, screen, device, mockSeed } = opts;

  const hash = crypto
    .createHash("sha256")
    .update(`${projectPath}:${screen.id}:${device}:${mockSeed}`)
    .digest("hex")
    .slice(0, 8);

  const packageName = `SFCHarness${hash}`;
  const workDir = opts.workDir ?? path.join(os.tmpdir(), `sfc-ios-${hash}`);
  const outPath = path.join(workDir, `${screen.id}.png`);

  // 디렉토리 생성
  const testDir = path.join(workDir, "Tests", `${packageName}Tests`);
  fs.mkdirSync(testDir, { recursive: true });

  // 소스 파일 복사 + 컴파일 에러 파일을 stub으로 대체
  const { copiedFiles, stubbedFiles } = copySourceFiles(projectPath, workDir, packageName, screen.id);

  // Package.swift 생성 (stub 대체된 파일은 이미 workDir에 있으므로 exclude 불필요)
  const packageSwift = generatePackageSwift({ packageName, sourceFiles: copiedFiles });
  fs.writeFileSync(path.join(workDir, "Package.swift"), packageSwift, "utf-8");

  if (stubbedFiles.length > 0) {
    console.warn(
      `[compile-ios] 컴파일 에러 감지 파일 stub 대체: ${stubbedFiles.join(", ")}`
    );
  }

  // 디바이스 프로파일
  const profile = getDeviceProfile(device);

  // 생성자 인자 파싱 (Swift 소스에서)
  const constructorArgs = extractConstructorArgs(projectPath, screen, mockSeed);

  // 캡처 테스트 생성
  const captureTest = generateCaptureTest({
    screen,
    moduleName: packageName,
    outPath,
    width: profile.logicalWidth,
    height: profile.logicalHeight,
    scale: profile.scale,
    constructorArgs,
  });
  fs.writeFileSync(path.join(testDir, "CaptureTest.swift"), captureTest, "utf-8");

  // xcodebuild scheme 이름 = packageName (SwiftPM 패키지는 패키지 이름 자체가 scheme)
  const schemeName = packageName;

  return { workDir, packageName, schemeName, outPath };
}

// ── 생성자 인자 추출 ──────────────────────────────────────────────────────────

/**
 * Swift 소스에서 화면 구조체/클래스의 init 파라미터를 간단히 파싱해
 * Swift 생성자 인자 코드를 반환한다.
 *
 * 정확도보다 실용성 우선: 복잡한 파라미터는 nil 주입.
 */
function extractConstructorArgs(
  projectPath: string,
  screen: ScreenSummary,
  mockSeed: number
): string {
  const sourceFile = screen.sourceRef?.file;
  if (!sourceFile) return "";

  const absPath = path.join(projectPath, sourceFile);
  let source: string;
  try {
    source = fs.readFileSync(absPath, "utf-8");
  } catch {
    return "";
  }

  // init 파라미터 파싱 (간단한 정규식 — tree-sitter는 adapter-ios가 담당)
  // 패턴: init( ... ) 또는 struct/class 선언 바로 뒤 { var ... } 에서 stored property 추출
  const params = parseInitParams(source, screen.id);
  if (params.length === 0) return "";

  const args: string[] = [];
  for (const p of params) {
    const val = buildMockValue(p.type, p.name, mockSeed);
    // nil이면 optional parameter는 skip
    if (val === "nil" && p.isOptional) continue;
    args.push(`${p.name}: ${val}`);
  }
  return args.join(",\n            ");
}

interface ParsedParam {
  name: string;
  type: string;
  isOptional: boolean;
}

/**
 * Swift 소스에서 특정 View struct의 stored property를 추출한다.
 * 간략 파싱: `let name: Type` / `var name: Type` 패턴
 */
function parseInitParams(source: string, structName: string): ParsedParam[] {
  // struct/class 블록 찾기
  const structMatch = source.match(
    new RegExp(`(?:struct|class)\\s+${structName}\\s*:\\s*View\\s*\\{([\\s\\S]*?)(?=^(?:struct|class|extension|func|@)\\s|$)`, "m")
  );
  if (!structMatch) return [];

  const body = structMatch[1]!;
  const params: ParsedParam[] = [];

  // `let name: Type` 패턴 (stored property, @State 등 속성 제외)
  const propRegex = /^\s*(?:private\s+)?let\s+(\w+)\s*:\s*([^\s=\n{]+)/gm;
  let m: RegExpExecArray | null;
  while ((m = propRegex.exec(body)) !== null) {
    const name = m[1]!;
    const type = m[2]!.trim();
    if (name === "id") continue; // Identifiable id 제외
    params.push({ name, type, isOptional: type.endsWith("?") });
  }

  return params;
}
