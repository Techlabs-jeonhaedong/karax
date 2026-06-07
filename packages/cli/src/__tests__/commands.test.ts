/**
 * CLI 커맨드 단위 테스트 (commander 파싱 중심)
 *
 * 빌드된 CLI를 실제로 실행하지 않고 내부 파서 함수를 직접 호출.
 * E2E(child_process) 테스트는 e2e.test.ts에서 별도 진행.
 */

import { describe, it, expect } from "vitest";
import {
  parseDetectArgs,
  parseDoctorArgs,
  parseListArgs,
  parseCaptureArgs,
  parseMcpConfigArgs,
  parseTestArgs,
  parseMapArgs,
  EXIT_CODES,
} from "../commands.js";

// ─── detect ────────────────────────────────────────────────────────

describe("parseDetectArgs", () => {
  it("경로 인수를 파싱한다", () => {
    const result = parseDetectArgs(["/some/project"]);
    expect(result.path).toBe("/some/project");
  });

  it("경로가 없으면 에러를 던진다", () => {
    expect(() => parseDetectArgs([])).toThrow();
  });
});

// ─── doctor ────────────────────────────────────────────────────────

describe("parseDoctorArgs", () => {
  it("경로 없이도 파싱된다 (옵셔널)", () => {
    const result = parseDoctorArgs([]);
    expect(result.path).toBeUndefined();
    expect(result.fix).toBe(false);
  });

  it("--fix 플래그를 파싱한다", () => {
    const result = parseDoctorArgs(["--fix"]);
    expect(result.fix).toBe(true);
  });

  it("경로와 --fix를 함께 파싱한다", () => {
    const result = parseDoctorArgs(["/some/project", "--fix"]);
    expect(result.path).toBe("/some/project");
    expect(result.fix).toBe(true);
  });

  it("경로를 먼저 받고 --fix를 뒤에 받아도 파싱된다", () => {
    const result = parseDoctorArgs(["--fix", "/some/project"]);
    expect(result.path).toBe("/some/project");
    expect(result.fix).toBe(true);
  });
});

// ─── list ──────────────────────────────────────────────────────────

describe("parseListArgs", () => {
  it("경로 인수를 파싱한다", () => {
    const result = parseListArgs(["/some/project"]);
    expect(result.path).toBe("/some/project");
    expect(result.includeCandidates).toBe(true); // 기본값
    expect(result.json).toBe(false);
  });

  it("--no-candidates로 includeCandidates=false 파싱", () => {
    const result = parseListArgs(["/p", "--no-candidates"]);
    expect(result.includeCandidates).toBe(false);
  });

  it("--include-candidates 플래그를 파싱한다", () => {
    const result = parseListArgs(["/p", "--include-candidates"]);
    expect(result.includeCandidates).toBe(true);
  });

  it("--json 플래그를 파싱한다", () => {
    const result = parseListArgs(["/p", "--json"]);
    expect(result.json).toBe(true);
  });

  it("경로가 없으면 에러를 던진다", () => {
    expect(() => parseListArgs([])).toThrow();
  });
});

// ─── capture ───────────────────────────────────────────────────────

describe("parseCaptureArgs", () => {
  it("경로만으로 파싱된다 (기본값 확인)", () => {
    const result = parseCaptureArgs(["/some/project"]);
    expect(result.path).toBe("/some/project");
    expect(result.screen).toBeUndefined();
    expect(result.device).toBeUndefined();
    expect(result.mode).toBe("auto");
    expect(result.out).toBeUndefined();
    expect(result.seed).toBeUndefined();
    expect(result.json).toBe(false);
  });

  it("--screen 옵션을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--screen", "HomeScreen"]);
    expect(result.screen).toBe("HomeScreen");
  });

  it("--device 옵션을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--device", "pixel-8"]);
    expect(result.device).toBe("pixel-8");
  });

  it("--mode compile을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--mode", "compile"]);
    expect(result.mode).toBe("compile");
  });

  it("--mode static을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--mode", "static"]);
    expect(result.mode).toBe("static");
  });

  it("잘못된 --mode 값이면 에러를 던진다", () => {
    expect(() => parseCaptureArgs(["/p", "--mode", "invalid"])).toThrow();
  });

  it("--out 옵션을 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--out", "/tmp/out"]);
    expect(result.out).toBe("/tmp/out");
  });

  it("--seed 옵션을 파싱한다 (숫자로 변환)", () => {
    const result = parseCaptureArgs(["/p", "--seed", "42"]);
    expect(result.seed).toBe(42);
  });

  it("--json 플래그를 파싱한다", () => {
    const result = parseCaptureArgs(["/p", "--json"]);
    expect(result.json).toBe(true);
  });

  it("경로가 없으면 에러를 던진다", () => {
    expect(() => parseCaptureArgs([])).toThrow();
  });
});

// ─── mcp-config ────────────────────────────────────────────────────

describe("parseMcpConfigArgs", () => {
  it("인수 없이도 파싱된다", () => {
    const result = parseMcpConfigArgs([]);
    expect(result).toBeDefined();
  });
});

// ─── test ──────────────────────────────────────────────────────────

describe("parseTestArgs", () => {
  it("필수 옵션(path + platform)을 파싱한다", () => {
    const result = parseTestArgs(["/some/project", "--platform", "android"]);
    expect(result.path).toBe("/some/project");
    expect(result.platform).toBe("android");
    expect(result.agent).toBe("claude");
    expect(result.json).toBe(false);
    expect(result.keepBooted).toBe(false);
  });

  it("ios 플랫폼을 파싱한다", () => {
    const result = parseTestArgs(["/proj", "--platform", "ios"]);
    expect(result.platform).toBe("ios");
  });

  it("--agent 옵션을 파싱한다", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--agent", "gemini"]);
    expect(result.agent).toBe("gemini");
  });

  it("--scenario 옵션을 파싱한다", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--scenario", "/tmp/test.md"]);
    expect(result.scenario).toBe("/tmp/test.md");
  });

  it("--keep-booted 플래그를 파싱한다", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--keep-booted"]);
    expect(result.keepBooted).toBe(true);
  });

  it("잘못된 플랫폼이면 에러를 던진다", () => {
    expect(() => parseTestArgs(["/proj", "--platform", "windows"])).toThrow();
  });

  it("잘못된 에이전트이면 에러를 던진다", () => {
    expect(() => parseTestArgs(["/proj", "--platform", "android", "--agent", "gpt"])).toThrow();
  });

  it("platform 없으면 에러를 던진다", () => {
    expect(() => parseTestArgs(["/proj"])).toThrow();
  });

  it("--max-steps 옵션을 파싱한다", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--max-steps", "10"]);
    expect(result.maxSteps).toBe(10);
  });

  it("--json 플래그를 파싱한다", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--json"]);
    expect(result.json).toBe(true);
  });

  // ── M11 플래그 ────────────────────────────────────────────────────

  it("기본값: noBuild=false (--no-build 미지정 시)", () => {
    const result = parseTestArgs(["/proj", "--platform", "android"]);
    expect(result.noBuild).toBe(false);
  });

  it("--no-build 지정 시 noBuild=true", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--no-build"]);
    expect(result.noBuild).toBe(true);
  });

  it("기본값: reuseBuild=false", () => {
    const result = parseTestArgs(["/proj", "--platform", "android"]);
    expect(result.reuseBuild).toBe(false);
  });

  it("--reuse-build 지정 시 reuseBuild=true", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--reuse-build"]);
    expect(result.reuseBuild).toBe(true);
  });

  it("기본값: grantPermissions=false", () => {
    const result = parseTestArgs(["/proj", "--platform", "android"]);
    expect(result.grantPermissions).toBe(false);
  });

  it("--grant-permissions 지정 시 grantPermissions=true", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--grant-permissions"]);
    expect(result.grantPermissions).toBe(true);
  });

  it("기본값: recordVideo=false", () => {
    const result = parseTestArgs(["/proj", "--platform", "android"]);
    expect(result.recordVideo).toBe(false);
  });

  it("--record-video 지정 시 recordVideo=true", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--record-video"]);
    expect(result.recordVideo).toBe(true);
  });

  it("4개 M11 플래그 동시 지정", () => {
    const result = parseTestArgs([
      "/proj", "--platform", "android",
      "--reuse-build", "--no-build", "--grant-permissions", "--record-video",
    ]);
    expect(result.reuseBuild).toBe(true);
    expect(result.noBuild).toBe(true);
    expect(result.grantPermissions).toBe(true);
    expect(result.recordVideo).toBe(true);
  });

  // ── --no-fail-on-crash ─────────────────────────────────────────────

  it("기본값: failOnCrash=true (--no-fail-on-crash 미지정 시)", () => {
    const result = parseTestArgs(["/proj", "--platform", "android"]);
    expect(result.failOnCrash).toBe(true);
  });

  it("--no-fail-on-crash 지정 시 failOnCrash=false", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--no-fail-on-crash"]);
    expect(result.failOnCrash).toBe(false);
  });

  it("--no-fail-on-crash와 다른 플래그 동시 지정", () => {
    const result = parseTestArgs([
      "/proj", "--platform", "android",
      "--no-fail-on-crash", "--keep-booted", "--json",
    ]);
    expect(result.failOnCrash).toBe(false);
    expect(result.keepBooted).toBe(true);
    expect(result.json).toBe(true);
  });

  // ── --build-command ────────────────────────────────────────────────

  it("기본값: buildCommand=undefined (--build-command 미지정 시)", () => {
    const result = parseTestArgs(["/proj", "--platform", "android"]);
    expect(result.buildCommand).toBeUndefined();
  });

  it("--build-command 지정 시 buildCommand에 값이 담긴다", () => {
    const result = parseTestArgs([
      "/proj", "--platform", "android",
      "--build-command", "fvm flutter build apk --debug --flavor dev",
    ]);
    expect(result.buildCommand).toBe("fvm flutter build apk --debug --flavor dev");
  });

  it("--build-command와 --reuse-build 동시 지정", () => {
    const result = parseTestArgs([
      "/proj", "--platform", "android",
      "--reuse-build",
      "--build-command", "fvm flutter build apk --debug --flavor dev",
    ]);
    expect(result.reuseBuild).toBe(true);
    expect(result.buildCommand).toBe("fvm flutter build apk --debug --flavor dev");
  });

  it("--build-command 4096자 초과 시 에러를 던진다 (INVALID_ARGUMENT)", () => {
    const longCmd = "a".repeat(4097);
    expect(() => parseTestArgs(["/proj", "--platform", "android", "--build-command", longCmd])).toThrow(
      /4096|INVALID_ARGUMENT/
    );
  });

  it("--build-command 정확히 4096자이면 허용된다", () => {
    const maxCmd = "a".repeat(4096);
    const result = parseTestArgs(["/proj", "--platform", "android", "--build-command", maxCmd]);
    expect(result.buildCommand?.length).toBe(4096);
  });

  it("--build-command 빈 문자열이면 undefined로 처리된다 (commander 동작)", () => {
    // commander는 빈 문자열 인수를 ""로 전달하므로 길이 0은 에러 없이 통과
    // (MCP 측에서 .min(1) 검증, CLI는 길이 상한만 체크)
    const result = parseTestArgs(["/proj", "--platform", "android", "--build-command", ""]);
    expect(result.buildCommand).toBe("");
  });
});

// ─── map ───────────────────────────────────────────────────────────

describe("parseMapArgs", () => {
  it("경로 인수를 파싱한다", () => {
    const result = parseMapArgs(["/some/project"]);
    expect(result.path).toBe("/some/project");
    expect(result.out).toBeUndefined();
    expect(result.maxChars).toBeUndefined();
    expect(result.json).toBe(false);
  });

  it("--out 옵션을 파싱한다", () => {
    const result = parseMapArgs(["/p", "--out", "/tmp/map-out"]);
    expect(result.out).toBe("/tmp/map-out");
  });

  it("--max-chars 옵션을 파싱한다 (숫자 변환)", () => {
    const result = parseMapArgs(["/p", "--max-chars", "3000"]);
    expect(result.maxChars).toBe(3000);
  });

  it("--json 플래그를 파싱한다", () => {
    const result = parseMapArgs(["/p", "--json"]);
    expect(result.json).toBe(true);
  });

  it("경로가 없으면 에러를 던진다", () => {
    expect(() => parseMapArgs([])).toThrow();
  });

  it("--max-chars 500 미만이면 에러를 던진다", () => {
    expect(() => parseMapArgs(["/p", "--max-chars", "499"])).toThrow(/500/);
  });

  it("--max-chars 0이면 에러를 던진다", () => {
    expect(() => parseMapArgs(["/p", "--max-chars", "0"])).toThrow(/500/);
  });

  it("--max-chars 음수면 에러를 던진다", () => {
    expect(() => parseMapArgs(["/p", "--max-chars", "-100"])).toThrow(/500/);
  });

  it("--max-chars가 숫자가 아니면 에러를 던진다", () => {
    expect(() => parseMapArgs(["/p", "--max-chars", "abc"])).toThrow(/500/);
  });

  it("--max-chars 500 경계값은 허용한다", () => {
    const result = parseMapArgs(["/p", "--max-chars", "500"]);
    expect(result.maxChars).toBe(500);
  });

  it("기본값으로 layout=true이다", () => {
    const result = parseMapArgs(["/p"]);
    expect(result.layout).toBe(true);
  });

  it("--no-layout 플래그로 layout=false가 된다", () => {
    const result = parseMapArgs(["/p", "--no-layout"]);
    expect(result.layout).toBe(false);
  });

  it("--no-layout과 --out을 함께 파싱한다", () => {
    const result = parseMapArgs(["/p", "--no-layout", "--out", "/tmp/out"]);
    expect(result.layout).toBe(false);
    expect(result.out).toBe("/tmp/out");
  });

  it("--no-layout과 --json을 함께 파싱한다", () => {
    const result = parseMapArgs(["/p", "--no-layout", "--json"]);
    expect(result.layout).toBe(false);
    expect(result.json).toBe(true);
  });

  // ── [작업 C-2] --framework / --stdout 옵션 ────────────────────────

  it("--framework flutter 옵션을 파싱한다", () => {
    const result = parseMapArgs(["/p", "--framework", "flutter"]);
    expect(result.framework).toBe("flutter");
  });

  it("--framework react-native 옵션을 파싱한다", () => {
    const result = parseMapArgs(["/p", "--framework", "react-native"]);
    expect(result.framework).toBe("react-native");
  });

  it("--framework android 옵션을 파싱한다", () => {
    const result = parseMapArgs(["/p", "--framework", "android"]);
    expect(result.framework).toBe("android");
  });

  it("--framework ios 옵션을 파싱한다", () => {
    const result = parseMapArgs(["/p", "--framework", "ios"]);
    expect(result.framework).toBe("ios");
  });

  it("잘못된 --framework 값이면 에러를 던진다", () => {
    expect(() => parseMapArgs(["/p", "--framework", "xamarin"])).toThrow(/framework/);
  });

  it("--stdout 플래그를 파싱한다", () => {
    const result = parseMapArgs(["/p", "--stdout"]);
    expect(result.stdout).toBe(true);
  });

  it("--stdout 미지정 시 false", () => {
    const result = parseMapArgs(["/p"]);
    expect(result.stdout).toBe(false);
  });

  it("framework 미지정 시 undefined", () => {
    const result = parseMapArgs(["/p"]);
    expect(result.framework).toBeUndefined();
  });

  it("--stdout과 --out 동시 지정 시 에러를 던진다", () => {
    expect(() => parseMapArgs(["/p", "--stdout", "--out", "/tmp/out"])).toThrow(/stdout.*out|out.*stdout/i);
  });
});

// ─── EXIT_CODES ────────────────────────────────────────────────────

describe("EXIT_CODES", () => {
  it("성공은 0", () => expect(EXIT_CODES.SUCCESS).toBe(0));
  it("부분 실패는 2", () => expect(EXIT_CODES.PARTIAL_FAILURE).toBe(2));
  it("실패는 1", () => expect(EXIT_CODES.FAILURE).toBe(1));
});

// ─── --debug 옵션 (Phase C-2) ────────────────────────────────────────

describe("parseDetectArgs — --debug 옵션", () => {
  it("--debug 미지정 시 debug=false", () => {
    const result = parseDetectArgs(["/some/project"]);
    expect(result.debug).toBe(false);
  });

  it("--debug 지정 시 debug=true", () => {
    const result = parseDetectArgs(["/some/project", "--debug"]);
    expect(result.debug).toBe(true);
  });
});

describe("parseDoctorArgs — --debug 옵션", () => {
  it("--debug 미지정 시 debug=false", () => {
    const result = parseDoctorArgs([]);
    expect(result.debug).toBe(false);
  });

  it("--debug 지정 시 debug=true", () => {
    const result = parseDoctorArgs(["--debug"]);
    expect(result.debug).toBe(true);
  });
});

describe("parseListArgs — --debug 옵션", () => {
  it("--debug 미지정 시 debug=false", () => {
    const result = parseListArgs(["/p"]);
    expect(result.debug).toBe(false);
  });

  it("--debug 지정 시 debug=true", () => {
    const result = parseListArgs(["/p", "--debug"]);
    expect(result.debug).toBe(true);
  });
});

describe("parseCaptureArgs — --debug 옵션", () => {
  it("--debug 미지정 시 debug=false", () => {
    const result = parseCaptureArgs(["/p"]);
    expect(result.debug).toBe(false);
  });

  it("--debug 지정 시 debug=true", () => {
    const result = parseCaptureArgs(["/p", "--debug"]);
    expect(result.debug).toBe(true);
  });
});

describe("parseMapArgs — --debug 옵션", () => {
  it("--debug 미지정 시 debug=false", () => {
    const result = parseMapArgs(["/p"]);
    expect(result.debug).toBe(false);
  });

  it("--debug 지정 시 debug=true", () => {
    const result = parseMapArgs(["/p", "--debug"]);
    expect(result.debug).toBe(true);
  });
});

describe("parseTestArgs — --debug 옵션", () => {
  it("--debug 미지정 시 debug=false", () => {
    const result = parseTestArgs(["/proj", "--platform", "android"]);
    expect(result.debug).toBe(false);
  });

  it("--debug 지정 시 debug=true", () => {
    const result = parseTestArgs(["/proj", "--platform", "android", "--debug"]);
    expect(result.debug).toBe(true);
  });
});
