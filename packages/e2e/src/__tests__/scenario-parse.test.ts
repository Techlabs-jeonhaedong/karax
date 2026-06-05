/**
 * scenario/parse.ts 단위 테스트
 */

import { describe, it, expect } from "vitest";
import { parseScenario } from "../scenario/parse.js";

describe("parseScenario", () => {
  it("frontmatter가 있으면 파싱한다", () => {
    const md = `---
appId: com.example.app
platform: android
---
# 로그인 테스트
로그인 버튼을 탭하고 성공 확인`;

    const result = parseScenario(md);
    expect(result.appId).toBe("com.example.app");
    expect(result.platform).toBe("android");
    expect(result.body).toContain("로그인 테스트");
    expect(result.exploratory).toBe(false);
  });

  it("frontmatter가 없으면 exploratory=true", () => {
    const md = `# 테스트\n앱을 탐색한다`;
    const result = parseScenario(md);
    expect(result.exploratory).toBe(true);
    expect(result.body).toContain("앱을 탐색한다");
  });

  it("빈 frontmatter도 처리한다", () => {
    const md = `---\n---\n본문`;
    const result = parseScenario(md);
    expect(result.exploratory).toBe(false);
    expect(result.body.trim()).toBe("본문");
  });

  it("frontmatter만 있고 body 없으면 body는 빈 문자열", () => {
    const md = `---\nappId: com.example\n---\n`;
    const result = parseScenario(md);
    expect(result.body.trim()).toBe("");
  });

  it("깨진 frontmatter(닫는 --- 없음)는 전체 body로 처리", () => {
    const md = `---\nappId: com.example\n본문이다`;
    const result = parseScenario(md);
    expect(result.exploratory).toBe(true);
  });

  it("appId/platform 없이 frontmatter만 있으면 exploratory=false, 값은 undefined", () => {
    const md = `---\ntitle: 테스트\n---\n본문`;
    const result = parseScenario(md);
    expect(result.exploratory).toBe(false);
    expect(result.appId).toBeUndefined();
    expect(result.platform).toBeUndefined();
  });

  it("빈 문자열이면 exploratory=true, body는 빈 문자열", () => {
    const result = parseScenario("");
    expect(result.exploratory).toBe(true);
    expect(result.body).toBe("");
  });

  it("특수문자/이모지 포함 body를 그대로 통과시킨다", () => {
    const body = `🚀 앱을 테스트하자!\n<script>alert('xss')</script>\nSQL: ' OR 1=1--`;
    const md = `---\nappId: test\n---\n${body}`;
    const result = parseScenario(md);
    expect(result.body).toBe("\n" + body);
  });
});
