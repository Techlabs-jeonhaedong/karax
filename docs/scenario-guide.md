# 시나리오 작성 가이드

karax E2E 테스트에서 사용하는 시나리오 파일 작성 방법을 설명한다.

---

## 시나리오 v1 — 자연어만

가장 단순한 형태. frontmatter 없이 자연어로만 작성한다. 에이전트가 텍스트를 읽고 자유롭게 해석해 수행한다.

```markdown
로그인 화면에서 이메일과 비밀번호를 입력하고 로그인 버튼을 탭한다.
로그인 후 홈 화면이 표시되면 성공이다.
```

단점: 기대 동작이 모호해 pass/fail 판정이 에이전트 재량에 따라 달라진다. 반복 재현성이 낮다.

---

## 시나리오 v2 — frontmatter 구조화

YAML frontmatter로 메타데이터와 단계를 구조화한다. 에이전트가 각 스텝의 `action`을 수행하고 `expect`와 실제 화면을 비교해 pass/fail을 판정한다.

```markdown
---
title: 로그인 정상 흐름
platform: android
appId: com.example.app
mode: scenario
preconditions:
  - 앱이 설치되어 있음
  - 네트워크 연결됨
testData:
  email: test@example.com
  password: "{{SECRET:TEST_PASSWORD}}"
permissions:
  - android.permission.CAMERA
  - android.permission.READ_MEDIA_IMAGES
steps:
  - action: 이메일 입력란에 {{testData.email}} 입력
    expect: 이메일 입력란에 텍스트가 표시됨
  - action: 비밀번호 입력란에 {{testData.password}} 입력
    expect: 비밀번호가 마스킹(●●●)으로 표시됨
  - action: 로그인 버튼 탭
    expect: 홈 화면으로 이동하고 환영 메시지가 표시됨
---

로그인 후 홈 화면이 정상 표시되는지 확인하는 기본 시나리오.
```

---

## frontmatter 필드 레퍼런스

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `appId` | `string` | 선택 | 앱 패키지/번들 ID (예: `com.example.app`). 미지정 시 자동 감지 |
| `platform` | `"android" \| "ios"` | 선택 | 대상 플랫폼. CLI `--platform`이 우선 |
| `title` | `string` | 선택 | 시나리오 제목. report.md 헤더에 표시됨 |
| `mode` | `"scenario" \| "exploratory"` | 선택 | 실행 모드. 미지정 시 `steps` 유무로 자동 판정 |
| `preconditions` | `string[]` | 선택 | 사전 조건 목록. 에이전트가 테스트 전 상태를 확인하는 데 사용 |
| `testData` | `Record<string, string>` | 선택 | 키-값 테스트 데이터. `{{testData.key}}` 형태로 steps에서 참조 |
| `steps` | `ScenarioStep[]` | 선택 | 수행할 단계 목록. 미지정 시 exploratory 모드 |
| `permissions` | `string[]` | 선택 | 자동으로 grant할 권한 목록 |

### ScenarioStep 구조

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `action` | `string` | 필수 | 에이전트가 수행할 동작 설명 |
| `expect` | `string` | 선택 | 동작 후 기대 결과. 있으면 fail 판정의 기준이 됨 |

---

## steps / expect 작성 요령

- `action`은 단일 동작으로 작성한다. "탭하고 스크롤한다" 대신 두 스텝으로 분리.
- `expect`는 관찰 가능한 화면 상태로 작성한다. "성공해야 한다" 대신 "OO 화면이 표시됨"처럼 구체적으로.
- `testData` 참조는 `{{testData.키이름}}` 형태로. 공백이 없는 단순 키를 권장.
- 긴 텍스트 입력은 `action`에 입력 내용을 직접 쓰거나 `testData`로 분리.

```yaml
# 좋은 예
steps:
  - action: 검색창에 "카라멜 라떼" 입력
    expect: 자동완성 목록이 표시됨
  - action: 첫 번째 자동완성 항목 탭
    expect: 검색 결과 화면으로 이동

# 피해야 할 예
steps:
  - action: 검색하고 결과를 확인한다   # 동작이 모호하고 두 개 이상
    expect: 성공해야 함               # 관찰 불가능한 기대 결과
```

---

## testData 주의 — 시크릿 처리

비밀번호, API 키 등 민감 정보는 시나리오 파일에 직접 쓰지 않는다. `{{SECRET:변수명}}` 플레이스홀더를 사용하면:

- 실행 시 환경 변수 `KARAX_SECRET_변수명`에서 값을 읽는다.
- report.md, report.json에 값이 노출되지 않는다 (`[REDACTED]`로 표시).

```yaml
testData:
  password: "{{SECRET:LOGIN_PASSWORD}}"
  apiKey: "{{SECRET:PROD_API_KEY}}"
```

실행 환경에서 환경 변수를 설정한다:

```bash
KARAX_SECRET_LOGIN_PASSWORD=my-password karax test ./my-app --platform android --scenario ./scenarios/login.md
```

---

## permissions 목록

시나리오 `permissions` 필드에 선언하면 `--grant-permissions` 옵션과 함께 실행 시 자동으로 grant된다.

**Android 주요 권한:**
- `android.permission.CAMERA`
- `android.permission.RECORD_AUDIO`
- `android.permission.READ_MEDIA_IMAGES`
- `android.permission.ACCESS_FINE_LOCATION`
- `android.permission.POST_NOTIFICATIONS`

**iOS 주요 권한 (시뮬레이터 `privacy` 명령 기반):**
- `photos`
- `camera`
- `microphone`
- `location`
- `notifications`

---

## 디렉토리 일괄 실행 (suite)

`--scenario`에 디렉토리를 전달하면 해당 디렉토리의 `*.md` 파일을 모두 순서대로 실행한다.

```bash
# scenarios/ 디렉토리의 모든 시나리오를 순서대로 실행
karax test ./my-app --platform android --scenario ./scenarios/ --out ./reports
```

MCP에서 `run_e2e_test` 호출:

```json
{
  "projectPath": "./my-app",
  "platform": "android",
  "scenarioPath": "./scenarios/"
}
```

결과는 `reports/suite_YYYYMMDD_HHMMSS/` 아래 시나리오별 서브디렉토리로 저장된다.

---

## exploratory 모드 — 시나리오 없이 실행

시나리오 파일을 전달하지 않거나 `mode: exploratory`로 설정하면 에이전트가 앱을 자유 탐색한다.

```bash
karax test ./my-app --platform android --agent claude --out ./reports
```

에이전트는 anomaly 10종 taxonomy로 발견 사항을 분류해 findings 목록을 보고한다:

| 카테고리 | 설명 |
|---|---|
| `crash` | 앱 강제 종료 |
| `layout-overflow` | 텍스트/요소 잘림, 화면 밖 삐져나옴 |
| `untranslated-text` | 현재 로케일에 맞지 않는 미번역 문자열 |
| `dead-button` | 탭해도 아무 반응 없는 버튼/링크 |
| `navigation-inconsistency` | 뒤로 가기 동작이 예상과 다름, 화면 전환 오류 |
| `slow-response` | 명시적 로딩 없이 2초 이상 대기 |
| `accessibility` | 접근성 레이블 누락, 대비 부족 |
| `visual-glitch` | 흰 화면, 겹침, 렌더링 오류 |
| `error-state` | 에러 메시지 노출, 예외 화면 |
| `other` | 위 분류에 해당하지 않는 이상 동작 |

---

## report.md 읽는 법

### findings severity

| severity | 의미 |
|---|---|
| `critical` | 즉시 수정 필요. 앱 크래시, 주요 기능 완전 불동작 |
| `major` | 높은 우선순위. 주요 흐름 방해, 명확한 버그 |
| `minor` | 낮은 우선순위. 사용성 저하, 미세한 UI 오류 |

### coverage 섹션

```
총 화면 수: 12
방문 화면: 8 (66.7%)
미방문: ProfileScreen, SettingsScreen, HelpScreen, NotificationScreen
```

AppMap 화면 목록 기준으로 에이전트가 방문한 화면 수를 추적한다. 방문률이 낮으면 `qualityWarnings`에 경고가 추가된다.

### crashes 섹션

logcat(Android) 또는 idb crash log(iOS)에서 감지된 크래시 이벤트 목록. 크래시 발생 시 `outcome`이 `fail` 또는 `partial`로 강등된다 (`failOnCrash: false`로 억제 가능).

### outcome 값

| outcome | 의미 |
|---|---|
| `pass` | 모든 스텝 통과, 크래시 없음 |
| `fail` | 하나 이상의 스텝 실패 또는 크래시 감지 |
| `partial` | 일부 스텝 수행 후 복구 불가 상태 (타임아웃, 무한루프 등) |
| `error` | 인프라 오류 (빌드 실패, 에뮬레이터 미기동 등) |
