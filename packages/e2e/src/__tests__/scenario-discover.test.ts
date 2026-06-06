/**
 * scenario/discover.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { discoverScenarioFiles } from "../scenario/discover.js";
import { E2eError } from "../types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-discover-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content = "# test") {
  fs.writeFileSync(path.join(tmpDir, name), content, "utf-8");
}

describe("discoverScenarioFiles — 파일 직접 전달", () => {
  it("파일을 직접 전달하면 [path]를 반환한다", () => {
    writeFile("scenario.md");
    const filePath = path.join(tmpDir, "scenario.md");
    const result = discoverScenarioFiles(filePath);
    expect(result).toEqual([filePath]);
  });

  it(".md 아닌 파일도 직접 전달 시 [path]를 반환한다", () => {
    fs.writeFileSync(path.join(tmpDir, "test.txt"), "content");
    const filePath = path.join(tmpDir, "test.txt");
    const result = discoverScenarioFiles(filePath);
    expect(result).toEqual([filePath]);
  });
});

describe("discoverScenarioFiles — 디렉토리", () => {
  it("디렉토리에서 *.md 파일을 사전순으로 반환한다", () => {
    writeFile("c_scenario.md");
    writeFile("a_scenario.md");
    writeFile("b_scenario.md");

    const result = discoverScenarioFiles(tmpDir);
    expect(result).toEqual([
      path.join(tmpDir, "a_scenario.md"),
      path.join(tmpDir, "b_scenario.md"),
      path.join(tmpDir, "c_scenario.md"),
    ]);
  });

  it(".md 아닌 파일은 무시한다", () => {
    writeFile("scenario.md");
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "text");
    fs.writeFileSync(path.join(tmpDir, "data.json"), "{}");

    const result = discoverScenarioFiles(tmpDir);
    expect(result).toEqual([path.join(tmpDir, "scenario.md")]);
  });

  it("빈 디렉토리면 SCENARIO_PARSE_ERROR를 던진다", () => {
    expect(() => discoverScenarioFiles(tmpDir)).toThrow(E2eError);
    try {
      discoverScenarioFiles(tmpDir);
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
      expect((e as E2eError).code).toBe("SCENARIO_PARSE_ERROR");
    }
  });

  it("*.md 파일이 없는 디렉토리면 SCENARIO_PARSE_ERROR를 던진다", () => {
    fs.writeFileSync(path.join(tmpDir, "data.json"), "{}");
    expect(() => discoverScenarioFiles(tmpDir)).toThrow(E2eError);
    try {
      discoverScenarioFiles(tmpDir);
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
      expect((e as E2eError).code).toBe("SCENARIO_PARSE_ERROR");
    }
  });

  it("디렉토리 내 하위 디렉토리는 스캔하지 않는다 (1단계만)", () => {
    const subDir = path.join(tmpDir, "sub");
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, "nested.md"), "# nested");
    writeFile("top.md");

    const result = discoverScenarioFiles(tmpDir);
    expect(result).toEqual([path.join(tmpDir, "top.md")]);
  });

  it("정확히 50개 파일은 성공한다", () => {
    for (let i = 1; i <= 50; i++) {
      writeFile(`scenario_${String(i).padStart(3, "0")}.md`);
    }
    const result = discoverScenarioFiles(tmpDir);
    expect(result).toHaveLength(50);
  });

  it("51개 파일이면 SCENARIO_PARSE_ERROR를 던진다 (상한 50개 초과)", () => {
    for (let i = 1; i <= 51; i++) {
      writeFile(`scenario_${String(i).padStart(3, "0")}.md`);
    }
    expect(() => discoverScenarioFiles(tmpDir)).toThrow(E2eError);
    try {
      discoverScenarioFiles(tmpDir);
    } catch (e) {
      expect(e).toBeInstanceOf(E2eError);
      expect((e as E2eError).code).toBe("SCENARIO_PARSE_ERROR");
    }
  });

  it("사전순 정렬이 숫자 파일명에도 올바르게 동작한다", () => {
    writeFile("10_scenario.md");
    writeFile("2_scenario.md");
    writeFile("1_scenario.md");

    const result = discoverScenarioFiles(tmpDir);
    // Array.prototype.sort() 기본 문자열 비교: "10_" < "1_" < "2_"
    // ('0'=48 < '_'=95, '1'=49 < '2'=50)
    const basenames = result.map((p) => path.basename(p));
    expect(basenames).toEqual(["10_scenario.md", "1_scenario.md", "2_scenario.md"]);
  });
});

describe("discoverScenarioFiles — 엣지 케이스", () => {
  it("존재하지 않는 경로면 E2eError를 던진다", () => {
    expect(() => discoverScenarioFiles("/nonexistent/path/99999")).toThrow();
  });

  it("한글/영문 파일명이 혼재해도 사전순 정렬된다", () => {
    writeFile("가나다.md");
    writeFile("abc.md");
    writeFile("zzz.md");

    const result = discoverScenarioFiles(tmpDir);
    expect(result).toHaveLength(3);
    // abc < zzz < 가나다 (UTF-16 기준)
    const basenames = result.map((p) => path.basename(p));
    expect(basenames[0]).toBe("abc.md");
    expect(basenames[1]).toBe("zzz.md");
    expect(basenames[2]).toBe("가나다.md");
  });
});
