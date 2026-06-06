/**
 * build/cache.ts — 빌드 캐시
 *
 * 소스 핑거프린트 계산 + 캐시 R/W.
 * 캐시 저장 위치: os.tmpdir()/karax-e2e-cache/<sha256(projectPath)>-<platform>.json
 * 원본 무수정 원칙 — 분석 대상 프로젝트에는 아무것도 쓰지 않는다.
 */

import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

// ── 파일 수 상한 ────────────────────────────────────────────────────

const SOURCE_FILE_LIMIT = 20_000;

// ── 빌드 산출물 디렉토리 (제외 목록) ────────────────────────────────

const EXCLUDE_DIRS = new Set([
  "build",
  ".gradle",
  "Pods",
  "node_modules",
  "DerivedData",
  ".dart_tool",
  ".idea",
  ".flutter-plugins",
  ".flutter-plugins-dependencies",
]);

// ── 프레임워크별 소스 스캔 대상 ──────────────────────────────────────

interface ScanSpec {
  dirs: string[];      // 상대 경로 디렉토리 목록 (존재하면 재귀 탐색)
  files: string[];     // 상대 경로 단일 파일 목록
  recursive: boolean;  // dirs를 재귀 탐색할지 여부
}

function getScanSpec(framework: string): ScanSpec {
  switch (framework) {
    case "flutter":
      return { dirs: ["lib"], files: ["pubspec.yaml"], recursive: true };
    case "react-native":
      return { dirs: ["src"], files: ["package.json"], recursive: true };
    case "android":
      return { dirs: ["app/src"], files: ["build.gradle", "build.gradle.kts"], recursive: true };
    case "ios":
      return { dirs: ["Sources"], files: [], recursive: true };
    default:
      return { dirs: ["src", "lib"], files: [], recursive: true };
  }
}

// ── 타입 ───────────────────────────────────────────────────────────

export interface SourceFingerprint {
  hash: string;
  newestSourceMtimeMs: number;
}

export interface CacheEntry {
  artifactPath: string;
  appId: string;
  sourceHash: string;
  builtAtMs: number;
}

// ── computeSourceFingerprint ────────────────────────────────────────

/**
 * projectPath 아래 프레임워크별 소스 파일 목록의 (상대경로+크기+mtime)을
 * 정렬해 조합한 뒤 sha256 해시를 반환한다.
 *
 * - 빌드 산출물(build/, .gradle/, Pods/, node_modules/, DerivedData) 제외
 * - 파일 수 상한 20,000 초과 시 hash에 "overflow" 마커 포함
 */
export function computeSourceFingerprint(
  projectPath: string,
  framework: string
): SourceFingerprint {
  const spec = getScanSpec(framework);
  const entries: Array<{ rel: string; size: number; mtimeMs: number }> = [];
  let overflowed = false;

  // 단일 파일 처리
  for (const relFile of spec.files) {
    if (overflowed) break;
    const full = path.join(projectPath, relFile);
    try {
      if (!fs.existsSync(full)) continue;
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        entries.push({ rel: relFile, size: stat.size, mtimeMs: stat.mtimeMs });
        if (entries.length >= SOURCE_FILE_LIMIT) {
          overflowed = true;
        }
      }
    } catch {
      // ignore
    }
  }

  // 디렉토리 재귀 탐색
  for (const relDir of spec.dirs) {
    if (overflowed) break;
    const full = path.join(projectPath, relDir);
    if (!fs.existsSync(full)) continue;
    collectFiles(full, relDir, entries, () => overflowed, () => { overflowed = true; });
  }

  if (overflowed) {
    return { hash: "overflow", newestSourceMtimeMs: 0 };
  }

  if (entries.length === 0) {
    return { hash: crypto.createHash("sha256").update("empty").digest("hex"), newestSourceMtimeMs: 0 };
  }

  // 정렬 결정론
  entries.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);

  const newestSourceMtimeMs = Math.max(...entries.map((e) => e.mtimeMs));

  const combined = entries.map((e) => `${e.rel}:${e.size}:${e.mtimeMs}`).join("\n");
  const hash = crypto.createHash("sha256").update(combined).digest("hex");

  return { hash, newestSourceMtimeMs };
}

function collectFiles(
  dir: string,
  relPrefix: string,
  entries: Array<{ rel: string; size: number; mtimeMs: number }>,
  isOverflowed: () => boolean,
  setOverflowed: () => void
): void {
  if (isOverflowed()) return;

  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(dir, { withFileTypes: true }) as fs.Dirent[];
  } catch {
    return;
  }

  for (const d of dirents) {
    if (isOverflowed()) return;
    const name = d.name;
    if (d.isDirectory()) {
      if (EXCLUDE_DIRS.has(name)) continue;
      collectFiles(path.join(dir, name), `${relPrefix}/${name}`, entries, isOverflowed, setOverflowed);
    } else if (d.isFile()) {
      try {
        const stat = fs.statSync(path.join(dir, name));
        entries.push({ rel: `${relPrefix}/${name}`, size: stat.size, mtimeMs: stat.mtimeMs });
        if (entries.length >= SOURCE_FILE_LIMIT) {
          setOverflowed();
        }
      } catch {
        // ignore
      }
    }
  }
}

// ── isArtifactFresh ─────────────────────────────────────────────────

/**
 * artifact 파일이 존재하고 mtime이 newestSourceMtimeMs보다 크면(=소스보다 최신) true.
 */
export function isArtifactFresh(artifactPath: string, fp: SourceFingerprint): boolean {
  try {
    if (!fs.existsSync(artifactPath)) return false;
    const stat = fs.statSync(artifactPath);
    return stat.mtimeMs > fp.newestSourceMtimeMs;
  } catch {
    return false;
  }
}

// ── 캐시 파일 경로 ─────────────────────────────────────────────────

function getCacheFilePath(projectPath: string, platform: string): string {
  const projectHash = crypto.createHash("sha256").update(projectPath).digest("hex");
  const cacheDir = path.join(os.tmpdir(), "karax-e2e-cache");
  return path.join(cacheDir, `${projectHash}-${platform}.json`);
}

// ── readBuildCache ──────────────────────────────────────────────────

/**
 * 캐시 파일에서 CacheEntry를 읽는다.
 * 파일 없음 / 손상 JSON / 필수 필드 누락 → null 반환 (graceful).
 */
export function readBuildCache(projectPath: string, platform: string): CacheEntry | null {
  const filePath = getCacheFilePath(projectPath, platform);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = String(fs.readFileSync(filePath, "utf-8"));
    const parsed = JSON.parse(raw) as Partial<CacheEntry>;

    if (
      typeof parsed.artifactPath !== "string" ||
      typeof parsed.appId !== "string" ||
      typeof parsed.sourceHash !== "string" ||
      typeof parsed.builtAtMs !== "number"
    ) {
      return null;
    }

    return {
      artifactPath: parsed.artifactPath,
      appId: parsed.appId,
      sourceHash: parsed.sourceHash,
      builtAtMs: parsed.builtAtMs,
    };
  } catch {
    return null;
  }
}

// ── writeBuildCache ─────────────────────────────────────────────────

/**
 * CacheEntry를 캐시 파일에 저장한다.
 */
export function writeBuildCache(
  projectPath: string,
  platform: string,
  entry: CacheEntry
): void {
  const filePath = getCacheFilePath(projectPath, platform);
  const cacheDir = path.dirname(filePath);

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
}
