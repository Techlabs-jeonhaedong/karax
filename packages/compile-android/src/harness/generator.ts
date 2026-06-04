import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import type { ScreenSummary, DeviceProfileId } from "@sfc/adapter-api";
import {
  parseKotlinConstructorParams,
  generateKotlinMockArg,
  type KotlinParam,
} from "./paramCodegen.js";

// ── 디바이스 프로파일 매핑 ────────────────────────────────────────────────────

/**
 * DeviceProfileId → Paparazzi DeviceConfig 이름
 * Paparazzi는 app.cash.paparazzi.DeviceConfig 상수를 사용
 */
export function deviceConfigForProfile(device: DeviceProfileId | string): string {
  switch (device) {
    case "pixel-8":
    case "pixel-7":
      return "DeviceConfig.PIXEL_6"; // Paparazzi에서 PIXEL_6은 공식 지원 (유사 spec)
    case "generic-tablet":
      return "DeviceConfig.NEXUS_10";
    case "iphone-15":
    case "iphone-se":
    default:
      return "DeviceConfig.NEXUS_5"; // iOS는 Android 테스트에서 phone 폴백
  }
}

// ── settings.gradle.kts 생성 ──────────────────────────────────────────────────

export function generateSettingsGradle(projectName: string): string {
  return `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "${projectName}"
include(":app")
`;
}

// ── gradle/libs.versions.toml 생성 ───────────────────────────────────────────

/**
 * Paparazzi 호환 버전 카탈로그.
 * AGP 8.2.x + Kotlin 2.0.x + Paparazzi 1.3.5 조합이 안정적.
 */
export function generateLibsVersionsToml(): string {
  return `[versions]
agp = "8.2.2"
kotlin = "2.0.21"
paparazzi = "1.3.5"
composeBom = "2024.06.00"
coreKtx = "1.13.1"
lifecycleRuntimeKtx = "2.8.4"
activityCompose = "1.9.1"
navigationCompose = "2.7.7"
coil = "2.7.0"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
androidx-lifecycle-runtime-ktx = { group = "androidx.lifecycle", name = "lifecycle-runtime-ktx", version.ref = "lifecycleRuntimeKtx" }
androidx-activity-compose = { group = "androidx.activity", name = "activity-compose", version.ref = "activityCompose" }
androidx-compose-bom = { group = "androidx.compose", name = "compose-bom", version.ref = "composeBom" }
androidx-ui = { group = "androidx.compose.ui", name = "ui" }
androidx-ui-graphics = { group = "androidx.compose.ui", name = "ui-graphics" }
androidx-ui-tooling = { group = "androidx.compose.ui", name = "ui-tooling" }
androidx-ui-tooling-preview = { group = "androidx.compose.ui", name = "ui-tooling-preview" }
androidx-material3 = { group = "androidx.compose.material3", name = "material3" }
androidx-navigation-compose = { group = "androidx.navigation", name = "navigation-compose", version.ref = "navigationCompose" }
androidx-material-icons-extended = { group = "androidx.compose.material", name = "material-icons-extended" }
coil-compose = { group = "io.coil-kt", name = "coil-compose", version.ref = "coil" }

[plugins]
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
paparazzi = { id = "app.cash.paparazzi", version.ref = "paparazzi" }
`;
}

// ── build.gradle.kts (최상위) 생성 ───────────────────────────────────────────

export function generateRootBuildGradle(): string {
  return `// Top-level build file — plugins are declared in submodules
`;
}

// ── app/build.gradle.kts 생성 ─────────────────────────────────────────────────

export interface HarnessModuleBuildGradleOpts {
  /** 하니스 모듈 namespace (R 클래스 매칭용: fixture 앱 packageName과 동일하게 설정) */
  packageName: string;
  /** @deprecated 미사용 — sourceSets는 하니스 내 복사된 소스만 참조 */
  sourceAbsPath?: string;
}

export function generateHarnessModuleBuildGradle(
  opts: HarnessModuleBuildGradleOpts
): string {
  const { packageName } = opts;
  return `plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.paparazzi)
}

android {
    namespace = "${packageName}"
    compileSdk = 35

    defaultConfig {
        minSdk = 26

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.coil.compose)
    debugImplementation(libs.androidx.ui.tooling)
}
`;
}

// ── Paparazzi 테스트 Kotlin 파일 생성 ────────────────────────────────────────

export interface PaparazziTestKtOpts {
  screenName: string;
  packageName: string;       // 대상 화면의 패키지 (import 용)
  testPackageName: string;   // 테스트 파일 패키지
  deviceConfig: string;      // DeviceConfig.XXX
  constructorArgs: string[]; // named args: "onClick = {}", "title = \"Sample\""
}

export function generatePaparazziTestKt(opts: PaparazziTestKtOpts): string {
  const { screenName, packageName, testPackageName, deviceConfig, constructorArgs } = opts;

  const argsStr =
    constructorArgs.length === 0
      ? ""
      : "\n        " + constructorArgs.join(",\n        ") + "\n    ";

  return `package ${testPackageName}

import app.cash.paparazzi.DeviceConfig
import app.cash.paparazzi.Paparazzi
import androidx.compose.material3.MaterialTheme
import org.junit.Rule
import org.junit.Test
import ${packageName}.${screenName}

class ${screenName}PaparazziTest {

    @get:Rule
    val paparazzi = Paparazzi(
        deviceConfig = ${deviceConfig},
        showSystemUi = false,
    )

    @Test
    fun snapshot() {
        paparazzi.snapshot {
            MaterialTheme {
                ${screenName}(${argsStr})
            }
        }
    }
}
`;
}

// ── gradle.properties 생성 ────────────────────────────────────────────────────

export function generateGradleProperties(): string {
  return `android.useAndroidX=true
android.enableJetifier=false
kotlin.code.style=official
android.nonTransitiveRClass=true
org.gradle.jvmargs=-Xmx2g -XX:+UseSerialGC
`;
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
  snapshotDir: string; // Paparazzi 스냅샷 출력 디렉토리
  screenName: string;
}

/**
 * workDir에 하니스 Gradle 프로젝트를 생성한다.
 * workDir 미지정 시 os.tmpdir()에 임시 디렉토리를 생성한다.
 */
export async function generateHarness(opts: GenerateHarnessOpts): Promise<HarnessProject> {
  const { projectPath, screen, device, mockSeed } = opts;

  // workDir 결정
  const hash = crypto
    .createHash("sha256")
    .update(`${projectPath}:${screen.id}:${device}:${mockSeed}`)
    .digest("hex")
    .slice(0, 12);
  const workDir = opts.workDir ?? path.join(os.tmpdir(), `sfc-android-${hash}`);

  fs.mkdirSync(workDir, { recursive: true });

  // gradle wrapper 디렉토리
  const gradleWrapperDir = path.join(workDir, "gradle", "wrapper");
  fs.mkdirSync(gradleWrapperDir, { recursive: true });

  // settings.gradle.kts
  fs.writeFileSync(
    path.join(workDir, "settings.gradle.kts"),
    generateSettingsGradle("sfc_harness"),
    "utf-8"
  );

  // gradle/libs.versions.toml
  fs.writeFileSync(
    path.join(gradleWrapperDir, "..", "libs.versions.toml"),
    generateLibsVersionsToml(),
    "utf-8"
  );

  // build.gradle.kts (루트)
  fs.writeFileSync(
    path.join(workDir, "build.gradle.kts"),
    generateRootBuildGradle(),
    "utf-8"
  );

  // gradle.properties
  fs.writeFileSync(
    path.join(workDir, "gradle.properties"),
    generateGradleProperties(),
    "utf-8"
  );

  // gradle wrapper 복사 (대상 앱의 wrapper 재사용)
  copyGradleWrapper(projectPath, workDir);

  // app 모듈 디렉토리
  const appDir = path.join(workDir, "app");
  fs.mkdirSync(path.join(appDir, "src", "main", "kotlin"), { recursive: true });
  fs.mkdirSync(path.join(appDir, "src", "test", "java"), { recursive: true });

  // 대상 화면 패키지 분석
  const { packageName } = resolveSourceInfo(projectPath, screen);
  const testPackageName = "com.sfc.harness.test";

  // 대상 앱 소스 복사 (하니스 모듈의 main 소스로)
  const harnessMainKotlinDir = path.join(appDir, "src", "main", "kotlin");
  copySourceFiles(projectPath, screen, harnessMainKotlinDir);

  // 생성자 파라미터 파싱
  const params = extractParams(projectPath, screen);

  // Mock 인자 생성
  const constructorArgs = buildConstructorArgs(params, mockSeed);

  // Paparazzi 테스트 파일 생성
  const deviceConfig = deviceConfigForProfile(device);
  const testKt = generatePaparazziTestKt({
    screenName: screen.id,
    packageName,
    testPackageName,
    deviceConfig,
    constructorArgs,
  });

  const testDir = path.join(appDir, "src", "test", "java",
    ...testPackageName.split(".")
  );
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(
    path.join(testDir, `${screen.id}PaparazziTest.kt`),
    testKt,
    "utf-8"
  );

  // app/build.gradle.kts — namespace는 fixture 패키지명으로 설정 (R 클래스 매칭)
  const fixtureNamespace = extractNamespace(projectPath) ?? packageName;
  const buildGradle = generateHarnessModuleBuildGradle({
    packageName: fixtureNamespace,
    sourceAbsPath: path.join(projectPath, "app", "src", "main", "java"),
  });
  fs.writeFileSync(path.join(appDir, "build.gradle.kts"), buildGradle, "utf-8");

  // consumer-rules.pro (라이브러리 모듈 필수)
  fs.writeFileSync(path.join(appDir, "consumer-rules.pro"), "", "utf-8");

  // AndroidManifest.xml (라이브러리 모듈 최소 매니페스트)
  fs.writeFileSync(
    path.join(appDir, "src", "main", "AndroidManifest.xml"),
    `<manifest />\n`,
    "utf-8"
  );

  const snapshotDir = path.join(
    workDir,
    "app",
    "build",
    "outputs",
    "paparazzi",
    "images"
  );

  return { workDir, snapshotDir, screenName: screen.id };
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

interface SourceInfo {
  packageName: string;
}

/**
 * 화면 sourceRef를 기반으로 패키지명을 추론한다.
 */
function resolveSourceInfo(
  _projectPath: string,
  screen: ScreenSummary
): SourceInfo {
  const sourceFile = screen.sourceRef?.file ?? "";

  // app/src/main/java/com/example/.../Screen.kt 패턴에서 패키지명 추출
  const javaRootMatch = sourceFile.match(/app\/src\/main\/(?:java|kotlin)\/(.*)\//);
  if (javaRootMatch) {
    const pkgPath = javaRootMatch[1];
    const packageName = pkgPath.replace(/\//g, ".");
    return { packageName };
  }

  return { packageName: "com.example" };
}

/**
 * app/build.gradle.kts에서 namespace를 읽는다.
 */
function extractNamespace(projectPath: string): string | null {
  try {
    const buildGradle = fs.readFileSync(
      path.join(projectPath, "app", "build.gradle.kts"),
      "utf-8"
    );
    const match = buildGradle.match(/namespace\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * 대상 화면과 관련된 Kotlin 파일을 하니스 모듈로 복사한다.
 * 단순화: app/src/main/java|kotlin 전체를 하니스 주 소스로 복사한다.
 */
function copySourceFiles(
  projectPath: string,
  _screen: ScreenSummary,
  destDir: string
): void {
  for (const srcRoot of ["java", "kotlin"]) {
    const src = path.join(projectPath, "app", "src", "main", srcRoot);
    if (fs.existsSync(src)) {
      copyDirRecursive(src, destDir);
    }
  }

  // res/ 디렉토리도 복사 (R.string 등을 위해 main/res → main/res)
  const resSrc = path.join(projectPath, "app", "src", "main", "res");
  if (fs.existsSync(resSrc)) {
    const resDest = path.join(path.dirname(destDir), "res");
    copyDirRecursive(resSrc, resDest);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  try {
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      const srcFull = path.join(src, entry);
      const destFull = path.join(dest, entry);
      try {
        const stat = fs.statSync(srcFull);
        if (stat.isDirectory()) {
          copyDirRecursive(srcFull, destFull);
        } else {
          if (!fs.existsSync(destFull)) {
            fs.copyFileSync(srcFull, destFull);
          }
        }
      } catch {
        // 파일 접근 실패 무시
      }
    }
  } catch {
    // 디렉토리 읽기 실패 무시
  }
}

/**
 * 대상 프로젝트의 gradle wrapper를 하니스 workDir로 복사한다.
 */
function copyGradleWrapper(projectPath: string, workDir: string): void {
  const wrapperSrc = path.join(projectPath, "gradle", "wrapper");
  const wrapperDest = path.join(workDir, "gradle", "wrapper");

  if (!fs.existsSync(wrapperSrc)) return;

  fs.mkdirSync(wrapperDest, { recursive: true });
  try {
    const entries = fs.readdirSync(wrapperSrc);
    for (const entry of entries) {
      const src = path.join(wrapperSrc, entry);
      const dest = path.join(wrapperDest, entry);
      try {
        fs.copyFileSync(src, dest);
      } catch {
        // 무시
      }
    }
  } catch {
    // 무시
  }

  // gradlew / gradlew.bat 복사
  for (const script of ["gradlew", "gradlew.bat"]) {
    const src = path.join(projectPath, script);
    const dest = path.join(workDir, script);
    if (fs.existsSync(src) && !fs.existsSync(dest)) {
      try {
        fs.copyFileSync(src, dest);
        // 실행 권한 부여 (Unix)
        fs.chmodSync(dest, 0o755);
      } catch {
        // 무시
      }
    }
  }
}

/**
 * 화면 소스에서 생성자 파라미터를 추출한다.
 */
function extractParams(projectPath: string, screen: ScreenSummary): KotlinParam[] {
  const sourceFile = screen.sourceRef?.file;
  if (!sourceFile) return [];

  const absPath = path.join(projectPath, sourceFile);
  try {
    const source = fs.readFileSync(absPath, "utf-8");
    return parseKotlinConstructorParams(screen.id, source);
  } catch {
    return [];
  }
}

/**
 * required 파라미터에 대한 Kotlin named argument 코드를 생성한다.
 */
function buildConstructorArgs(params: KotlinParam[], mockSeed: number): string[] {
  const required = params.filter((p) => p.isRequired);
  return required.map((p) => {
    const value = generateKotlinMockArg(p, mockSeed);
    return `${p.name} = ${value}`;
  });
}
