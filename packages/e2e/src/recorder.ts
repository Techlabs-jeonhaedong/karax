/**
 * recorder.ts — 디바이스 화면 비디오 녹화
 *
 * Android: adb shell screenrecord --time-limit 180 세그먼트 루프
 *   - 3분 제한(screenrecord 자체 제한) 대응 → 세그먼트 자동 시작
 *   - stop: SIGINT → adb pull → adb shell rm (best-effort)
 *
 * iOS: xcrun simctl io <udid> recordVideo --codec h264
 *   - stop: SIGINT → 종료 대기
 *
 * 녹화 실패는 항상 비차단 — 호출부(index.ts)가 try/catch 없이 써도 안전.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execa } from "execa";

export interface Recorder {
  /** 녹화를 중지하고 저장된 로컬 파일 경로 목록을 반환한다. 실패 시 빈 배열. */
  stop(): Promise<string[]>;
}

// ── Android ────────────────────────────────────────────────────────

const ANDROID_SEGMENT_TIME_LIMIT = 180; // 초
const ANDROID_MAX_SEGMENTS = 14;        // 최대 세그먼트 수 (42분)
const ADB_TIMEOUT = 30_000;

/**
 * Android 녹화를 시작한다.
 * adb shell screenrecord --time-limit 180 /sdcard/karax_rec_<suffix>_<n>.mp4
 * 세그먼트 프로세스가 종료(3분 경과)되면 다음 세그먼트를 자동 시작한다.
 */
export async function startAndroidRecording(
  deviceId: string,
  videosDir: string
): Promise<Recorder> {
  fs.mkdirSync(videosDir, { recursive: true });

  const suffix = crypto.randomBytes(4).toString("hex");
  const devicePaths: string[] = [];
  const localPaths: string[] = [];
  let segIndex = 0;
  let stopped = false;

  // adb 바이너리 경로 결정 (환경변수 ANDROID_HOME 우선, 없으면 PATH에서 찾음)
  const androidHome = process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"];
  const adbBin = androidHome
    ? path.join(androidHome, "platform-tools", "adb")
    : "adb";

  function adbArgs(...args: string[]): [string, string[]] {
    return [adbBin, ["-s", deviceId, ...args]];
  }

  // 세그먼트 프로세스 참조
  let currentProc: ReturnType<typeof execa> | null = null;

  function startSegment(): void {
    if (stopped || segIndex >= ANDROID_MAX_SEGMENTS) return;

    const devicePath = `/sdcard/karax_rec_${suffix}_${segIndex}.mp4`;
    devicePaths.push(devicePath);
    segIndex++;

    const [bin, args] = adbArgs("shell", "screenrecord", "--time-limit", String(ANDROID_SEGMENT_TIME_LIMIT), devicePath);
    const proc = execa(bin, args, { detached: true, stdio: "ignore" });
    currentProc = proc;
    proc.unref?.();

    // 세그먼트 종료 시 다음 세그먼트 자동 시작
    void proc.then(
      () => { if (!stopped) startSegment(); },
      () => { if (!stopped) startSegment(); }
    );
  }

  startSegment();

  return {
    async stop(): Promise<string[]> {
      stopped = true;

      // 현재 프로세스 SIGINT
      try {
        currentProc?.kill("SIGINT");
      } catch {
        // ignore
      }

      // 각 세그먼트 pull + rm (best-effort)
      for (let i = 0; i < devicePaths.length; i++) {
        const devicePath = devicePaths[i]!;
        const localName = path.basename(devicePath);
        const localPath = path.join(videosDir, localName);

        try {
          const [bin, args] = adbArgs("pull", devicePath, localPath);
          await execa(bin, args, { timeout: ADB_TIMEOUT });
          localPaths.push(localPath);
        } catch {
          // pull 실패 — 비차단
        }

        try {
          const [bin, args] = adbArgs("shell", "rm", "-f", devicePath);
          await execa(bin, args, { timeout: ADB_TIMEOUT });
        } catch {
          // rm 실패 — best-effort
        }
      }

      return localPaths;
    },
  };
}

// ── iOS ────────────────────────────────────────────────────────────

const IOS_STOP_WAIT_MS = 5_000;

/**
 * iOS 시뮬레이터 녹화를 시작한다.
 * xcrun simctl io <udid> recordVideo --codec h264 <videosDir>/recording.mov
 */
export async function startIosRecording(
  deviceId: string,
  videosDir: string
): Promise<Recorder> {
  fs.mkdirSync(videosDir, { recursive: true });

  const outputPath = path.join(videosDir, "recording.mov");

  const proc = execa(
    "xcrun",
    ["simctl", "io", deviceId, "recordVideo", "--codec", "h264", outputPath],
    { detached: true, stdio: "ignore" }
  );
  proc.unref?.();

  return {
    async stop(): Promise<string[]> {
      try {
        proc.kill("SIGINT");
      } catch {
        // ignore
      }

      // 종료 대기 (타임아웃 내에서)
      await Promise.race([
        proc.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, IOS_STOP_WAIT_MS)),
      ]);

      // 파일 존재 확인
      if (fs.existsSync(outputPath)) {
        return [outputPath];
      }
      return [];
    },
  };
}
