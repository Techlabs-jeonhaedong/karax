import * as fs from "fs";
import * as path from "path";

// ── 타입 ──────────────────────────────────────────────────────────

export type FrameworkId = "flutter" | "react-native" | "ios" | "android";

export interface FrameworkCandidate {
  id: FrameworkId;
  confidence: number;
  evidence: string[];
}

export interface DetectResult {
  frameworks: FrameworkCandidate[];
}

// ── 내부 유틸 ─────────────────────────────────────────────────────

function exists(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * dir 내에서 glob 패턴 없이 단순 파일/디렉토리 존재 확인.
 * 파일명이 suffix로 끝나는 항목을 첫 번째만 반환 (얕은 스캔).
 */
function findBySuffix(dir: string, suffix: string): string | undefined {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.endsWith(suffix)) {
        return path.join(dir, entry.name);
      }
    }
  } catch {
    // 읽기 실패 무시
  }
  return undefined;
}

/** dart 파일이 lib/ 하위에 존재하는지 확인 */
function hasDartFiles(dir: string): boolean {
  const libDir = path.join(dir, "lib");
  try {
    const entries = fs.readdirSync(libDir, { withFileTypes: true });
    return entries.some((e) => e.name.endsWith(".dart"));
  } catch {
    return false;
  }
}

/** package.json 파싱 — 실패 시 null */
function readPackageJson(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasReactNativeDep(pkg: Record<string, unknown>): boolean {
  const check = (deps: unknown): boolean => {
    if (!deps || typeof deps !== "object") return false;
    return "react-native" in (deps as object);
  };
  return (
    check(pkg["dependencies"]) ||
    check(pkg["devDependencies"]) ||
    check(pkg["peerDependencies"])
  );
}

/** AndroidManifest.xml 존재 여부 (재귀 2단계까지) */
function findAndroidManifest(dir: string): string | undefined {
  // 흔한 경로들을 우선 체크
  const candidates = [
    path.join(dir, "app", "src", "main", "AndroidManifest.xml"),
    path.join(dir, "AndroidManifest.xml"),
    path.join(dir, "src", "main", "AndroidManifest.xml"),
  ];
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return undefined;
}

/** settings.gradle 또는 settings.gradle.kts 존재 경로 반환 */
function findSettingsGradle(dir: string): string | undefined {
  for (const name of ["settings.gradle.kts", "settings.gradle"]) {
    const p = path.join(dir, name);
    if (exists(p)) return p;
  }
  return undefined;
}

// ── 단일 디렉토리 분석 ────────────────────────────────────────────

interface RawCandidate {
  id: FrameworkId;
  confidence: number;
  evidence: string[];
}

/**
 * 주어진 projectDir 단일 디렉토리에서 프레임워크 시그니처 스캔.
 * flutter/RN 루트의 내부 ios/android는 별도 후보로 올리지 않고,
 * flutter/RN confidence가 높으면 무시(또는 embedded 마킹+낮은 confidence).
 */
function scanDir(projectDir: string): RawCandidate[] {
  const candidates: RawCandidate[] = [];

  // ── Flutter ──────────────────────────────────────────────────
  const pubspecPath = path.join(projectDir, "pubspec.yaml");
  if (exists(pubspecPath)) {
    const evidence: string[] = [pubspecPath];
    if (hasDartFiles(projectDir)) {
      // lib/*.dart 찾기
      try {
        const dartFiles = fs
          .readdirSync(path.join(projectDir, "lib"))
          .filter((f) => f.endsWith(".dart"))
          .slice(0, 3)
          .map((f) => path.join(projectDir, "lib", f));
        evidence.push(...dartFiles);
      } catch {
        // ignore
      }
    }
    candidates.push({ id: "flutter", confidence: 0.95, evidence });
  }

  // ── React Native ─────────────────────────────────────────────
  const pkgJsonPath = path.join(projectDir, "package.json");
  if (exists(pkgJsonPath)) {
    const pkg = readPackageJson(pkgJsonPath);
    if (pkg && hasReactNativeDep(pkg)) {
      const evidence: string[] = [pkgJsonPath];
      candidates.push({ id: "react-native", confidence: 0.95, evidence });
    }
  }

  // ── iOS ──────────────────────────────────────────────────────
  // .xcodeproj 또는 Package.swift + *.swift
  const xcodeprojPath = findBySuffix(projectDir, ".xcodeproj");
  const packageSwiftPath = path.join(projectDir, "Package.swift");

  if (xcodeprojPath) {
    candidates.push({
      id: "ios",
      confidence: 0.95,
      evidence: [xcodeprojPath],
    });
  } else if (exists(packageSwiftPath)) {
    // swift 파일이 있는지 확인
    const hasSwift = hasSwiftFiles(projectDir);
    if (hasSwift) {
      candidates.push({
        id: "ios",
        confidence: 0.92,
        evidence: [packageSwiftPath],
      });
    } else {
      candidates.push({
        id: "ios",
        confidence: 0.85,
        evidence: [packageSwiftPath],
      });
    }
  }

  // ── Android ──────────────────────────────────────────────────
  const manifestPath = findAndroidManifest(projectDir);
  const settingsGradlePath = findSettingsGradle(projectDir);

  if (manifestPath && settingsGradlePath) {
    candidates.push({
      id: "android",
      confidence: 0.95,
      evidence: [settingsGradlePath, manifestPath],
    });
  } else if (manifestPath) {
    candidates.push({
      id: "android",
      confidence: 0.7,
      evidence: [manifestPath],
    });
  }

  return candidates;
}

function hasSwiftFiles(dir: string): boolean {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".swift")) return true;
      if (entry.isDirectory() && entry.name !== "node_modules") {
        const sub = path.join(dir, entry.name);
        if (hasSwiftFilesShallow(sub)) return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function hasSwiftFilesShallow(dir: string): boolean {
  try {
    return fs
      .readdirSync(dir)
      .some((f) => f.endsWith(".swift"));
  } catch {
    return false;
  }
}

// ── 메인 함수 ─────────────────────────────────────────────────────

/**
 * projectPath 아래를 depth=3까지 스캔해 프레임워크 후보 목록을 반환.
 * - confidence 내림차순 정렬
 * - flutter/RN 루트가 있으면 내부 ios/android를 embedded로 마킹하고 confidence < 0.3으로 낮춤
 */
export async function detectFramework(projectPath: string): Promise<DetectResult> {
  if (!exists(projectPath)) {
    return { frameworks: [] };
  }

  // depth=0 (루트) 스캔
  const allCandidates: Array<RawCandidate & { dirPath: string }> = [];

  const rootCandidates = scanDir(projectPath);
  for (const c of rootCandidates) {
    allCandidates.push({ ...c, dirPath: projectPath });
  }

  // depth=1,2,3 서브디렉토리 스캔 (모노레포용)
  collectSubdirCandidates(projectPath, 0, 3, allCandidates);

  if (allCandidates.length === 0) {
    return { frameworks: [] };
  }

  // flutter/RN 루트 존재 여부 확인
  const rootFlutter = allCandidates.find(
    (c) => c.dirPath === projectPath && c.id === "flutter"
  );
  const rootRN = allCandidates.find(
    (c) => c.dirPath === projectPath && c.id === "react-native"
  );

  // 결과 후보 합치기: 같은 id + dirPath 중복 제거, 최대 confidence 유지
  const merged = new Map<string, FrameworkCandidate>();

  for (const c of allCandidates) {
    // flutter/RN 루트의 내부 ios/android는 embedded로 처리
    const isEmbeddedIosOrAndroid =
      (c.id === "ios" || c.id === "android") &&
      c.dirPath !== projectPath &&
      (rootFlutter || rootRN);

    // 루트 자체에 ios/android 시그니처가 있고 flutter/RN도 루트에 있다면 embedded 처리
    const isRootEmbedded =
      (c.id === "ios" || c.id === "android") &&
      c.dirPath === projectPath &&
      (rootFlutter || rootRN);

    const key = c.id;
    const existing = merged.get(key);

    if (isEmbeddedIosOrAndroid || isRootEmbedded) {
      // embedded: confidence < 0.3 으로 낮추고 evidence에 embedded 표시
      const embeddedEvidence = [...c.evidence, "embedded"];
      const embeddedConfidence = Math.min(c.confidence, 0.25);

      if (!existing || embeddedConfidence > existing.confidence) {
        merged.set(key, {
          id: c.id,
          confidence: embeddedConfidence,
          evidence: embeddedEvidence,
        });
      }
    } else {
      if (!existing || c.confidence > existing.confidence) {
        merged.set(key, {
          id: c.id,
          confidence: c.confidence,
          evidence: c.evidence,
        });
      }
    }
  }

  // confidence 내림차순 정렬
  const frameworks = Array.from(merged.values()).sort(
    (a, b) => b.confidence - a.confidence
  );

  return { frameworks };
}

/**
 * dir의 직접 자식 디렉토리들을 재귀적으로 스캔 (maxDepth까지).
 * currentDepth는 0부터 시작 (0이면 dir의 자식 = depth 1에 해당).
 */
function collectSubdirCandidates(
  dir: string,
  currentDepth: number,
  maxDepth: number,
  result: Array<RawCandidate & { dirPath: string }>
): void {
  if (currentDepth >= maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // 무시할 디렉토리
    if (shouldSkipDir(entry.name)) continue;

    const subDir = path.join(dir, entry.name);
    const candidates = scanDir(subDir);
    for (const c of candidates) {
      result.push({ ...c, dirPath: subDir });
    }

    collectSubdirCandidates(subDir, currentDepth + 1, maxDepth, result);
  }
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".dart_tool",
  "build",
  "dist",
  ".gradle",
  ".idea",
  "Pods",
  "__pycache__",
  ".cache",
  "coverage",
]);

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}
