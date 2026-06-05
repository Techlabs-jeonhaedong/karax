# karax

소스코드를 분석해서 앱을 빌드하지 않고도 화면 스크린샷과 구조 정보를 추출하는 도구.

- **zero-config**: 분석 대상 프로젝트 소스에 아무 조치 없이 동작
- **원본 무수정**: 분석 대상 프로젝트 소스를 절대 수정하지 않음
- **의존성 자동 설치**: Chromium 등 필수 런타임 자동 설치
- **한계를 숨기지 않음**: 모든 결과에 confidence score + diagnostics 코드 동봉

지원 프레임워크: **Flutter / React Native / Android(Compose·XML) / iOS(SwiftUI·UIKit)**
제공 형태: **SDK + MCP 서버 + CLI**

---

## 핵심 능력

| 능력 | CLI | MCP tool | SDK |
|---|---|---|---|
| 프레임워크 감지 | `detect` | `detect_framework` | `detectFramework` |
| 환경 진단 + 자동 설치 | `doctor` | `doctor` | `doctor` / `doctorFix` |
| 화면 발견 (정적 분석) | `list` | `list_screens` | `listScreens` |
| 화면 캡처 (2-티어) | `capture` | `capture_screen` / `capture_all` | `captureScreen` / `captureAll` |
| UI IR 추출 | — | `get_screen_ir` | `buildScreenIR` |
| 전체 분석 리포트 | — | `get_analysis_report` | — |
| **앱 지도 (App Map)** | `map` | `generate_app_map` | `generateAppMap` |
| **E2E 테스트 (LLM 에이전트)** | `test` | `run_e2e_test` | `runE2eTest` |

---

## 2-티어 캡처 전략

| 티어 | 조건 | 방식 | 충실도 |
|---|---|---|---|
| **Tier 1: Partial Compile** | 해당 프레임워크 툴체인 감지됨 | 화면 단위 하니스 컴파일 후 실제 렌더러로 캡처 | 높음 |
| **Tier 2: Static IR** | 툴체인 없음 / Tier 1 실패 | 정적 분석 → UI IR → HTML/CSS → Chromium 캡처 | 구조적 근사 + confidence score |

기본 모드(`auto`)는 Tier 1을 시도하고 화면 단위 실패 시 Tier 2로 자동 fallback한다(`COMPILE_FALLBACK` diagnostic 기록). 화면 **발견은 항상 정적 분석**이며, 캡처만 2티어로 나뉜다.

---

## 지원 프레임워크 매트릭스

| 프레임워크 | 발견 | Tier 2 (정적 IR) | Tier 1 (컴파일) |
|---|---|---|---|
| Flutter | route-graph + heuristic | 위젯 트리 | `flutter test` golden |
| React Native | react-navigation 스택/탭 | react-native-web alias | esbuild + Chromium |
| Android Compose | NavHost route-graph + heuristic | Compose 함수 트리 | Paparazzi (JVM) |
| Android XML (레거시) | setContentView 연결 | res/layout/*.xml 파싱 | — |
| iOS SwiftUI | NavigationStack + WindowGroup | SwiftUI 뷰 트리 | xcodebuild + 시뮬레이터 (macOS) |
| iOS UIKit (레거시) | Storyboard/XIB + segue 그래프 | view 계층 파싱 | — |

---

## 설치

### MCP 서버 — git clone 방식 (npm 배포 없음)

karax는 npm에 발행되지 않는다. **git clone만 받으면 바로 MCP 서버로 등록·사용**할 수 있다.

#### Claude Code (권장)

```bash
git clone <repo-url> karax
```

프로젝트를 열면 루트의 `.mcp.json`을 자동으로 인식한다. **첫 실행 시 `pnpm install` + 빌드가 자동으로 수행되므로 수 분이 소요될 수 있다.** 지연을 없애려면 사전 워밍업을 먼저 실행하라.

```bash
# 사전 워밍업 (선택) — install + build + Chromium 설치까지 미리 완료
pnpm bootstrap
```

#### 다른 MCP 클라이언트 (Cursor, 직접 등록)

```bash
# 방법 1: claude mcp add 명령
claude mcp add karax -- node "$(pwd)/scripts/mcp-launcher.mjs"

# 방법 2: karax mcp-config로 스니펫 생성
node packages/cli/dist/bin.js mcp-config
```

방법 2 출력 예시:

```json
{
  "mcpServers": {
    "karax": {
      "command": "node",
      "args": ["/절대/경로/karax/scripts/mcp-launcher.mjs"]
    }
  }
}
```

이 JSON을 클라이언트의 설정 파일에 붙여넣는다.

> **첫 실행 지연**: `node_modules`나 `dist`가 없으면 런처가 자동으로 install + build를 수행한다(진행 로그는 stderr로만 출력 — MCP stdout 프로토콜 채널은 오염되지 않음). MCP 클라이언트의 연결 타임아웃이 짧은 경우 `pnpm bootstrap`을 먼저 실행해 사전 워밍업하라.

> **보안**: 런처는 첫 실행 시 `pnpm install`을 자동 수행하며 이 과정에서 의존성 postinstall 스크립트가 실행된다. 신뢰할 수 있는 출처(공식 저장소)에서 클론한 경우에만 사용할 것.

### CLI 직접 실행

```bash
# 의존성 설치 및 빌드 (처음 한 번)
pnpm install && pnpm -r build

node packages/cli/dist/bin.js <command>
```

---

## CLI 사용법

```
karax detect <path>                      프레임워크 감지
karax doctor [path] [--fix]              환경 진단 + 자동 설치
karax list <path> [--json] [--no-candidates]   화면 목록 출력
karax capture <path>                     전체 화면 캡처
  --screen <id>                        단일 화면 지정
  --mode auto|compile|static           캡처 모드 (기본: auto)
  --device <id>                        디바이스 프로파일 (기본: iphone-15)
  --out <dir>                          출력 디렉토리
  --seed <n>                           결정론적 mock 시드
  --variants                           Branch 분기별 추가 PNG 생성 (Tier 2 전용)
  --overlay                            confidence 오버레이 PNG 추가 생성
  --json                               JSON 형식 출력
karax map <path>                         앱 지도(App Map) 마크다운 생성
  --out <dir>                          출력 디렉토리 (기본: ./)
  --framework <id>                     프레임워크 강제 지정: flutter|react-native|android|ios
  --max-chars <n>                      문서 분할 기준 최대 글자 수
  --stdout                             파일 저장 없이 마크다운을 stdout으로 출력 (--out과 동시 지정 불가)
  --no-layout                          정적 좌표 측정 비활성화 (Chromium 미사용)
  --json                               AppMap JSON 출력
karax test <path>                        LLM 에이전트 E2E 테스트 (실기기 빌드·설치)
  --platform android|ios               타겟 플랫폼 (필수)
  --scenario <file>                    시나리오 마크다운 (없으면 탐색적 테스트)
  --agent claude|codex|gemini          LLM 에이전트 CLI (기본: claude)
  --api-key <key>                      API 키 (없으면 CLI 로그인 사용)
  --device <id>                        디바이스/에뮬레이터 ID
  --out <dir>                          결과 출력 디렉토리
  --timeout <ms>                       에이전트 전체 타임아웃
  --max-steps <n>                      에이전트 최대 스텝 수
  --keep-booted                        테스트 후 디바이스 유지
karax mcp-config                         MCP 클라이언트 설정 스니펫 출력
```

### 사용 예

```bash
# flutter 프로젝트 전체 화면 캡처 (auto 모드)
karax capture ./my-flutter-app --out ./screenshots

# 특정 화면만 static 모드로 캡처
karax capture ./my-app --screen HomeScreen --mode static --out ./out

# Branch 분기별 variant 스크린샷 생성
karax capture ./my-app --screen ListScreen --mode static --variants --out ./out
# → ListScreen_iphone-15.png, ListScreen__arm1_iphone-15.png, ...

# confidence 오버레이 디버그 PNG 생성
karax capture ./my-app --screen HomeScreen --mode static --overlay --out ./out
# → HomeScreen_iphone-15.png, HomeScreen_iphone-15__overlay.png

# 앱 지도 생성 — 네비게이션 그래프 + 트리거 요소의 텍스트·스타일·좌표
karax map ./my-app --out ./docs
# → {앱 이름}_map_1.md (길면 _2, _3, ... 분할 + 상호 링크)

# E2E 테스트 — 에뮬레이터 부팅 + 풀 빌드 + LLM 에이전트 주행
karax test ./my-app --platform android --agent claude
# 시나리오 지정
karax test ./my-app --platform ios --scenario ./scenarios/login.md
```

---

## 앱 지도 (App Map)

화면 간 **이동 관계**(어떤 요소를 누르면 어떤 화면으로 가는지)를 정적 분석으로 추출해 "프로그램 지도"를 만든다.

- **산출물**: Mermaid `flowchart TD` 그래프 + 화면 목록 테이블 + 화면별 상세 섹션(요소 테이블 · 이동 테이블). `--max-chars` 초과 시 화면 단위로 문서 분할 + 상호 링크.
- **상세 매핑**: 트리거 요소의 텍스트, 스타일(배경색·모서리 등), 위치/크기(좌표)까지 기록. 좌표는 Tier 2 정적 렌더 기반 **근사값**이며 `LAYOUT_APPROX` diagnostic으로 명시된다.
- **graceful degradation**: Chromium이 없으면 좌표만 생략(`LAYOUT_UNAVAILABLE`), 어댑터가 네비게이션 추적을 지원하지 않으면 빈 그래프 + `NAV_UNSUPPORTED`.
- **신뢰도**: 해석 성공 1.0 / 휴리스틱 0.6 / 미해석 0.3 (`DYNAMIC_NAV` / `UNRESOLVED_NAV` diagnostic).

```ts
import { generateAppMap, renderAppMapMarkdown } from "@karax/sdk";

const appMap = await generateAppMap({
  projectPath: "./my-app",
  includeLayout: true, // 기본 ON, false면 Chromium 미사용
});
const docs = renderAppMapMarkdown(appMap, { maxChars: 20000 });
```

---

## E2E 테스트 (`karax test`)

에뮬레이터/시뮬레이터를 실제로 부팅하고, 앱을 풀 빌드·설치·실행한 뒤, **LLM 에이전트(Claude Code / Codex / Gemini CLI)가 adb·simctl로 E2E 테스트를 수행**한다.

- **에이전트 CLI 단일 경로**: `claude -p` / `codex exec` / `gemini -p` 헤드리스 CLI를 spawn. 구독 사용자는 기존 로그인 그대로, API 키 사용자는 env 주입.
- **시나리오**: frontmatter(appId/platform)가 있는 마크다운을 그대로 수행. 없으면 탐색적(exploratory) 테스트.
- **산출물**: 세션 디렉토리에 `report.json` + `report.md` + `screenshots/`.
- **종료 코드**: 통과 = 0, 인프라 에러 = 1, 테스트 실패 = 2.
- **RN iOS**: `pod install`을 자동 실행하지 않는다(원본 무수정 원칙) — `COCOAPODS_REQUIRED` 진단만 보고.

에러 코드 13종: `FRAMEWORK_NOT_DETECTED`, `SCENARIO_PARSE_ERROR`, `NO_DEVICE_AVAILABLE`, `EMULATOR_BOOT_TIMEOUT`, `COCOAPODS_REQUIRED`, `BUILD_FAILED`, `ARTIFACT_NOT_FOUND`, `INSTALL_FAILED`, `LAUNCH_FAILED`, `AGENT_CLI_MISSING`, `AGENT_OUTPUT_INVALID`, `AGENT_TIMEOUT`, `INVALID_ARGUMENT`

```ts
import { runE2eTest } from "@karax/sdk";

const result = await runE2eTest({
  projectPath: "./my-app",
  platform: "android",
  agent: "claude",
  scenarioPath: "./scenarios/login.md", // 생략 시 exploratory
});
```

> `run_e2e_test` MCP 툴은 빌드·부팅을 포함하므로 **수 분이 소요**될 수 있다.

---

## SDK API 요약

```ts
import {
  detectFramework,
  doctor, doctorFix,
  listScreens,
  buildScreenIR,
  captureScreen,
  captureAll,
  generateAppMap, renderAppMapMarkdown,
  runE2eTest,
} from "@karax/sdk";

// 프레임워크 감지
const { frameworks } = await detectFramework("./my-app");

// 화면 목록
const screens = await listScreens({ projectPath: "./my-app" });

// 특정 화면 캡처
const result = await captureScreen({
  projectPath: "./my-app",
  screenId: "HomeScreen",
  outDir: "./out",
  captureMode: "auto",    // "auto" | "compile" | "static"
  device: "iphone-15",
  variants: true,         // Branch 분기별 PNG 추가 생성 (Tier 2 전용)
  overlay: "confidence",  // confidence 오버레이 PNG 추가 생성
});

// 전체 화면 캡처
const { screens: captured, report } = await captureAll({
  projectPath: "./my-app",
  outDir: "./out",
});

// LLM 보강 플러그인 (선택)
import { createLlmEnrichmentPlugin } from "@karax/enrich-llm";

const enrich = createLlmEnrichmentPlugin({
  complete: async (prompt) => { /* your LLM call */ return response; },
  threshold: 0.5, // confidence 이 미만 노드만 보강
});

await captureScreen({ projectPath: "./my-app", screenId: "HomeScreen", outDir: "./out", enrich });
```

### AnalyzeOptions

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `projectPath` | `string` | 필수 | 분석할 프로젝트 경로 |
| `framework` | `FrameworkId` | 자동 감지 | `"flutter"` \| `"react-native"` \| `"android"` \| `"ios"` |
| `device` | `DeviceProfileId` | `"iphone-15"` | 디바이스 프로파일 |
| `captureMode` | `CaptureMode` | `"auto"` | `"auto"` \| `"compile"` \| `"static"` |
| `mockSeed` | `number` | `0` | 결정론적 mock 시드 |
| `includeCandidates` | `boolean` | `true` | 라우트 미연결 후보 화면 포함 |
| `enrich` | `EnrichmentPlugin` | — | LLM 보강 플러그인 |

---

## MCP Tools (9종)

| tool | 설명 |
|---|---|
| `detect_framework` | 프레임워크 감지 |
| `doctor` | 환경 진단 + 자동 설치 (fix 옵션) |
| `list_screens` | 화면 목록 반환 |
| `get_screen_ir` | 특정 화면의 UI IR 반환 |
| `capture_screen` | 화면 캡처 (image content + 사이드카 JSON) |
| `capture_all` | 전체 화면 캡처 |
| `get_analysis_report` | 프로젝트 전체 분석 리포트 |
| `generate_app_map` | 앱 지도 — 네비 그래프 + 트리거 상세 (`includeLayout`, `maxCharsPerDoc`, `write`+`outDir` 옵션) |
| `run_e2e_test` | 실기기 E2E 테스트 (수 분 소요) |

`capture_screen` / `capture_all` 공통 옵션:
- `variants: boolean` — Branch 분기별 variant PNG 추가 생성
- `overlay: "confidence"` — confidence 오버레이 PNG 추가 생성

---

## Confidence & Diagnostics

### Tier 2 confidence 계산

| 상황 | confidence |
|---|---|
| 표준 위젯 매핑 | 1.0 |
| 인라인 해석 성공 | 0.7 |
| mock 데이터 바인딩 | 0.5 |
| Unknown 노드 | 0.2 |
| route 발견 가중치 | 1.0 |
| candidate 발견 가중치 | 0.6 |

### Diagnostics 코드

| 코드 | 의미 |
|---|---|
| `UNRESOLVED_COMPONENT` | 커스텀 컴포넌트 심볼 해석 실패 |
| `THEME_DEFAULTED` | 테마 토큰 해석 실패 → 기본 테마 사용 |
| `DYNAMIC_DATA_MOCKED` | 런타임 데이터 → mock 값으로 대체 |
| `COMPILE_FALLBACK` | Tier 1 실패 → Tier 2 fallback |
| `BRANCH_VARIANT_EXPANDED` | Branch 분기 variant 확장 |
| `ENRICHED` | LLM 보강 적용됨 |
| `ENRICH_REJECTED` | LLM 보강 실패/스키마 위반 |
| `NAV_UNSUPPORTED` | 어댑터가 네비게이션 추적 미지원 → 빈 그래프 |
| `DYNAMIC_NAV` | 동적 네비게이션 → 휴리스틱 해석 (conf 하향) |
| `UNRESOLVED_NAV` | 네비게이션 타겟 해석 실패 |
| `TRIGGER_UNMATCHED` | 트리거 ↔ 요소 매칭 실패 |
| `LAYOUT_APPROX` | 좌표는 Tier 2 정적 렌더 기반 근사값 |
| `LAYOUT_UNAVAILABLE` | Chromium 측정 실패 → 좌표 생략 |
| `COCOAPODS_REQUIRED` | RN iOS — `pod install` 수동 실행 필요 |

### confidence 오버레이

`--overlay` (CLI) / `overlay: "confidence"` (SDK/MCP)를 사용하면 각 화면의 저신뢰 노드를 하이라이트한 디버그 PNG가 추가로 생성된다.

- `confidence < 0.5`: 반투명 주황 테두리 + 코너 점수 라벨
- `Unknown` 노드: 빨강 테두리
- 파일명: `<screenId>_<device>__overlay.png`

---

## 한계

> Tier 2는 픽셀 퍼펙트가 아닌 **구조적 근사**다. (설계 배경: `plans/total_plan.md`)

- **잘 됨**: 화면 인벤토리, 정적 레이아웃 골격, 정적 텍스트, 명시적 색/spacing, 표준 컴포넌트
- **근사**: 커스텀 컴포넌트 다수 화면, 테마 토큰 간접 참조, 리스트/그리드
- **약함**: 런타임 API 데이터 의존 화면, 차트/지도/Canvas, 애니메이션 상태, 복잡한 DI 그래프, 코드생성(`build_runner`/`R.java`) 의존 UI
- **App Map 좌표는 근사값** — 실기기 픽셀과 다를 수 있다 (`LAYOUT_APPROX`)
- **Android 네비 추적은 2단계 간접 추적까지** — 3단계 이상 콜백 전달은 conf 0.3으로 보고
- **에이전트 CLI 플래그는 버전 의존** — `--permission-mode bypassPermissions` 등은 런타임 검증 필요

동적 데이터, 차트, 지도, 애니메이션은 placeholder/근사로 처리된다. 코드 생성 의존 UI는 누락될 수 있다.

---

## 개발 가이드

```bash
# 의존성 설치 (최초 1회)
pnpm install

# 전체 빌드
pnpm -r build

# 전체 테스트 (패키지 + scripts 런처 테스트)
pnpm test

# 특정 패키지만
pnpm --filter @karax/core test
pnpm --filter @karax/renderer test  # Playwright 필요

# 통합 테스트 환경변수
KARAX_SKIP_ENSURE=1 pnpm --filter @karax/sdk test   # Chromium 자동 설치 건너뜀
```

### 패키지 구조

```
packages/
  core/           IR 스키마, Detector, 파이프라인, confidence, appmap
  adapter-api/    FrameworkAdapter/CompileBackend 인터페이스
  adapter-flutter/
  adapter-react-native/
  adapter-ios/    SwiftUI + UIKit 레거시
  adapter-android/ Compose + XML 레거시
  compile-flutter/
  compile-react-native/
  compile-android/
  compile-ios/
  renderer/       IR → HTML → Playwright PNG, 좌표 측정
  doctor/         환경 감지 + 의존성 자동 설치 (adb/emulator/agent CLI 체크 포함)
  sdk/            공개 API 조립
  mcp/            MCP 서버 (tool 9종)
  cli/            karax 커맨드
  e2e/            E2E 테스트 (device/build/agent/scenario/report)
  enrich-llm/     선택 LLM 보강 플러그인
scripts/
  mcp-launcher.mjs  자가 부트스트랩 MCP 런처 (의존성 0)
  setup.mjs         사전 워밍업 (pnpm bootstrap)
```

### 골든/스냅샷 이미지 갱신

```bash
# 골든은 명시적 리뷰 후에만 갱신 (자동 갱신 금지)
UPDATE_GOLDEN=1 pnpm --filter @karax/renderer test
```
