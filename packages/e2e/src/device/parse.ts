/**
 * device/parse.ts — 순수 파서 (adb / emulator / simctl 출력)
 *
 * 외부 프로세스 호출 없음. 순수 문자열 → 구조체 변환.
 */

// ── adb devices ──────────────────────────────────────────────────────────

export interface AdbDeviceEntry {
  id: string;
  state: string;
  isEmulator: boolean;
}

/**
 * `adb devices` 또는 `adb devices -l` 출력을 파싱한다.
 */
export function parseAdbDevices(output: string): AdbDeviceEntry[] {
  const lines = output.split("\n");
  const result: AdbDeviceEntry[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("List of devices")) continue;

    // "emulator-5554\tdevice" 형식
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const id = parts[0]!;
    const state = parts[1]!;
    const isEmulator = id.startsWith("emulator-");

    result.push({ id, state, isEmulator });
  }

  return result;
}

// ── emulator -list-avds ─────────────────────────────────────────────────

/**
 * `emulator -list-avds` 출력을 파싱한다. (AVD 이름 배열 반환)
 */
export function parseEmulatorListAvds(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ── simctl list devices ─────────────────────────────────────────────────

export interface SimctlDeviceEntry {
  udid: string;
  name: string;
  iosVersion: string;
  state: "Booted" | "Shutdown" | string;
}

/**
 * `xcrun simctl list devices available` (또는 전체) 출력을 파싱한다.
 * tvOS/watchOS 섹션은 iosVersion 파싱 실패로 자연스럽게 제외.
 */
export function parseSimctlDevices(output: string): SimctlDeviceEntry[] {
  const versionRegex = /^-- iOS ([\d.]+) --$/;
  const nonIosSectionRegex = /^-- (?:tvOS|watchOS|visionOS|xrOS)/;
  const deviceRegex = /^\s+(.+?) \(([A-Z0-9-]{36})\) \((Booted|Shutdown|[^)]+)\)/;

  let currentVersion = "";
  const result: SimctlDeviceEntry[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();

    const verMatch = versionRegex.exec(line);
    if (verMatch) {
      currentVersion = verMatch[1]!;
      continue;
    }

    // tvOS/watchOS 등 비iOS 섹션 헤더를 만나면 currentVersion 리셋 → 이하 디바이스 무시
    if (nonIosSectionRegex.test(line)) {
      currentVersion = "";
      continue;
    }

    if (!currentVersion) continue;

    const devMatch = deviceRegex.exec(rawLine);
    if (devMatch) {
      result.push({
        name: devMatch[1]!.trim(),
        udid: devMatch[2]!,
        state: devMatch[3]!,
        iosVersion: currentVersion,
      });
    }
  }

  return result;
}

// ── selectBestSimulator ──────────────────────────────────────────────────

/**
 * simctl 출력에서 가장 높은 iOS 버전의 iPhone을 선택한다.
 * iPhone이 없으면 iPad 등 다른 디바이스를 선택한다.
 */
export function selectBestSimulator(simctlOutput: string): SimctlDeviceEntry | null {
  const devices = parseSimctlDevices(simctlOutput);

  let bestIphone: SimctlDeviceEntry | null = null;
  let bestOther: SimctlDeviceEntry | null = null;

  for (const dev of devices) {
    if (dev.name.startsWith("iPhone")) {
      if (
        !bestIphone ||
        compareVersions(dev.iosVersion, bestIphone.iosVersion) > 0 ||
        (compareVersions(dev.iosVersion, bestIphone.iosVersion) === 0 &&
          rankIphone(dev.name) > rankIphone(bestIphone.name))
      ) {
        bestIphone = dev;
      }
    } else {
      if (!bestOther || compareVersions(dev.iosVersion, bestOther.iosVersion) > 0) {
        bestOther = dev;
      }
    }
  }

  return bestIphone ?? bestOther;
}

// ── 유틸 ──────────────────────────────────────────────────────────────────

function compareVersions(a: string, b: string): number {
  if (!a) return -1;
  if (!b) return 1;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function rankIphone(name: string): number {
  const m = name.match(/iPhone (\d+)/);
  return m ? parseInt(m[1]!, 10) : 0;
}
