/**
 * scenario/parse.ts 단위 테스트
 *
 * 기존 8개 테스트(v1) + v2 신규 케이스
 */

import { describe, it, expect, vi } from "vitest";
import { parseScenario } from "../scenario/parse.js";

// ─── 기존 테스트 (v1) — 무수정 통과 필수 ────────────────────────────

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

// ─── v2 신규 케이스 ──────────────────────────────────────────────────

describe("parseScenario v2 — 신규 필드", () => {
  it("title 필드를 파싱한다", () => {
    const md = `---
title: 로그인 시나리오
appId: com.example
---
본문`;
    const result = parseScenario(md);
    expect(result.title).toBe("로그인 시나리오");
    expect(result.exploratory).toBe(false);
  });

  it("steps 배열(action+expect)을 파싱한다", () => {
    const md = `---
appId: com.example
steps:
  - action: 로그인 버튼을 탭한다
    expect: 홈 화면이 표시된다
  - action: 로그아웃 버튼을 탭한다
---
`;
    const result = parseScenario(md);
    expect(result.steps).toHaveLength(2);
    expect(result.steps![0].action).toBe("로그인 버튼을 탭한다");
    expect(result.steps![0].expect).toBe("홈 화면이 표시된다");
    expect(result.steps![1].action).toBe("로그아웃 버튼을 탭한다");
    expect(result.steps![1].expect).toBeUndefined();
  });

  it("preconditions 배열을 파싱한다", () => {
    const md = `---
appId: com.example
preconditions:
  - 앱이 설치되어 있다
  - 인터넷 연결이 가능하다
---
`;
    const result = parseScenario(md);
    expect(result.preconditions).toEqual(["앱이 설치되어 있다", "인터넷 연결이 가능하다"]);
  });

  it("testData 맵을 파싱한다", () => {
    const md = `---
appId: com.example
testData:
  username: testuser
  password: secret123
---
`;
    const result = parseScenario(md);
    expect(result.testData).toEqual({ username: "testuser", password: "secret123" });
  });

  it("permissions 배열을 파싱한다", () => {
    const md = `---
appId: com.example
permissions:
  - android.permission.CAMERA
  - android.permission.RECORD_AUDIO
---
`;
    const result = parseScenario(md);
    expect(result.permissions).toEqual([
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
    ]);
  });

  it("mode: scenario를 명시하면 exploratory=false, mode='scenario'", () => {
    const md = `---
mode: scenario
appId: com.example
---
본문`;
    const result = parseScenario(md);
    expect(result.mode).toBe("scenario");
    expect(result.exploratory).toBe(false);
  });

  it("mode: exploratory를 명시하면 exploratory=true, mode='exploratory'", () => {
    const md = `---
mode: exploratory
appId: com.example
---
본문`;
    const result = parseScenario(md);
    expect(result.mode).toBe("exploratory");
    expect(result.exploratory).toBe(true);
  });

  it("mode 미명시 + frontmatter 있으면 기존 추론(exploratory=false) 유지", () => {
    const md = `---
appId: com.example
---
본문`;
    const result = parseScenario(md);
    expect(result.exploratory).toBe(false);
    expect(result.mode).toBeUndefined();
  });

  it("mode 미명시 + frontmatter 없으면 기존 추론(exploratory=true) 유지", () => {
    const md = `# 그냥 탐색`;
    const result = parseScenario(md);
    expect(result.exploratory).toBe(true);
    expect(result.mode).toBeUndefined();
  });

  it("testData의 {{SECRET:NAME}} 플레이스홀더를 해석하지 않고 보존한다", () => {
    const md = `---
appId: com.example
testData:
  apiKey: "{{SECRET:API_KEY}}"
  token: "{{SECRET:TOKEN}}"
---
`;
    const result = parseScenario(md);
    expect(result.testData?.apiKey).toBe("{{SECRET:API_KEY}}");
    expect(result.testData?.token).toBe("{{SECRET:TOKEN}}");
  });

  it("알 수 없는 키는 무시한다 (미래 호환)", () => {
    const md = `---
appId: com.example
unknownField: someValue
anotherUnknown:
  nested: value
---
본문`;
    const result = parseScenario(md);
    expect(result.appId).toBe("com.example");
    expect((result as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it("잘못된 YAML은 graceful하게 SCENARIO_PARSE_ERROR로 처리된다", () => {
    // 잘못된 들여쓰기로 YAML 파싱 실패
    const md = `---
steps:
  - action: 탭
 - action: 잘못된들여쓰기
---
본문`;
    // YAML 파싱 실패 시에는 exploratory=true로 폴백 (body 전체로 처리)
    const result = parseScenario(md);
    // YAML 실패 → exploratory=true로 폴백
    expect(result.exploratory).toBe(true);
  });

  it("잘못된 YAML(이중 콜론) 파싱 실패 시 stderr에 경고 1줄을 출력한다", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const md = `---
key: value: duplicate_colon
---
본문`;
      const result = parseScenario(md);
      // exploratory 폴백 확인
      expect(result.exploratory).toBe(true);
      // stderr에 경고가 출력됐어야 한다
      expect(stderrSpy).toHaveBeenCalledOnce();
      const warningArg = stderrSpy.mock.calls[0][0] as string;
      expect(warningArg).toContain("[karax/e2e] frontmatter YAML 파싱 실패");
      expect(warningArg).toContain("exploratory 모드로 폴백");
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("잘못된 들여쓰기 YAML 파싱 실패 시 stderr 경고에 에러 첫 줄이 포함된다", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const md = `---
steps:
  - action: 탭
 - action: 잘못된들여쓰기
---
본문`;
      parseScenario(md);
      expect(stderrSpy).toHaveBeenCalledOnce();
      const warningArg = stderrSpy.mock.calls[0][0] as string;
      // 경고 메시지가 \n으로 끝나야 한다 (한 줄 출력)
      expect(warningArg).toMatch(/\n$/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("frontmatter 없어서 exploratory 폴백 시에는 stderr 경고를 출력하지 않는다", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const md = `# 그냥 탐색\n본문`;
      parseScenario(md);
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("steps 중 action이 빈 문자열인 경우 해당 step은 무시된다", () => {
    const md = `---
appId: com.example
steps:
  - action: 유효한 액션
  - action: ""
---
`;
    const result = parseScenario(md);
    // 빈 action은 zod 스키마에서 min(1)이므로 파싱 실패 → pickKnownFields가 유효한 step만 유지
    expect(result.steps).toBeDefined();
    expect(result.steps).toHaveLength(1);
    expect(result.steps![0].action).toBe("유효한 액션");
  });

  it("모든 v2 필드를 한꺼번에 파싱한다", () => {
    const md = `---
appId: com.example.app
platform: android
title: 풀 시나리오 테스트
mode: scenario
preconditions:
  - 계정이 있어야 한다
testData:
  user: "{{SECRET:TEST_USER}}"
steps:
  - action: 앱을 실행한다
    expect: 스플래시 화면이 표시된다
  - action: 로그인 버튼을 탭한다
permissions:
  - android.permission.CAMERA
---
# 테스트 본문
자유 텍스트 설명`;

    const result = parseScenario(md);
    expect(result.appId).toBe("com.example.app");
    expect(result.platform).toBe("android");
    expect(result.title).toBe("풀 시나리오 테스트");
    expect(result.mode).toBe("scenario");
    expect(result.exploratory).toBe(false);
    expect(result.preconditions).toEqual(["계정이 있어야 한다"]);
    expect(result.testData?.user).toBe("{{SECRET:TEST_USER}}");
    expect(result.steps).toHaveLength(2);
    expect(result.steps![0].expect).toBe("스플래시 화면이 표시된다");
    expect(result.permissions).toEqual(["android.permission.CAMERA"]);
    expect(result.body).toContain("테스트 본문");
  });
});

// ── permissions 형식 검증 (항목 8) ─────────────────────────────────

describe("permissions 형식 검증 (^[A-Za-z0-9_.]+$)", () => {
  it("유효한 permission은 통과한다", () => {
    const content = `---
mode: scenario
permissions:
  - android.permission.CAMERA
  - RECORD_AUDIO
  - com.example.permission.MY_PERM
---
본문`;
    const result = parseScenario(content);
    expect(result.permissions).toEqual([
      "android.permission.CAMERA",
      "RECORD_AUDIO",
      "com.example.permission.MY_PERM",
    ]);
  });

  it("형식 불합격 항목(셸 메타문자, 공백 등)은 제거된다", () => {
    const content = `---
mode: scenario
permissions:
  - android.permission.CAMERA
  - "bad perm with space"
  - "perm;injection"
  - valid.perm
---
본문`;
    const result = parseScenario(content);
    // 유효한 것만 남음
    expect(result.permissions).toEqual([
      "android.permission.CAMERA",
      "valid.perm",
    ]);
  });

  it("모든 permissions가 불합격이면 빈 배열을 반환한다", () => {
    const content = `---
mode: scenario
permissions:
  - "bad perm"
  - "$(inject)"
---
본문`;
    const result = parseScenario(content);
    expect(result.permissions).toEqual([]);
  });
});
