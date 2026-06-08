# karax 통합 계획 (total_plan)

> `plans/` 디렉토리의 4개 계획 문서(`make-map`, `mapping-advance`, `build-tester`, `no-npm`)를 종합해, 프로젝트의 의도와 기능 전체를 정리한 문서.

---

## 1. 프로젝트의 의도 (Why)

**karax**는 "소스코드를 정적 분석해서, 앱을 빌드하지 않고도 화면 스크린샷과 구조 정보를 추출하는 도구"다.

핵심 가치는 다음 4가지 **설계 불변 조건**으로 요약된다:

1. **zero-config** — 분석 대상 프로젝트에 아무 조치 없이 동작.
2. **원본 무수정** — 대상 프로젝트의 소스를 절대 수정하지 않음. 모든 생성물은 임시 디렉토리/오버레이에서만.
3. **코어는 LLM 없이 결정론적으로 동작** — mock 데이터는 `mockSeed` 기반 결정론적 생성, LLM 보강은 `enrich-llm` 플러그인으로만 선택 주입.
4. **한계를 숨기지 않음** — Tier 2는 구조적 근사이므로 confidence score + diagnostics 코드(`UNRESOLVED_COMPONENT`, `COMPILE_FALLBACK`, `LAYOUT_APPROX` 등)로 수치화해 노출.

지원 프레임워크: **Flutter / React Native / Android(Compose·XML) / iOS(SwiftUI·UIKit)** 4종.
제공 형태: **SDK + MCP 서버 + CLI** (pnpm workspace 기반 TypeScript 모노레포, ESM/NodeNext).

### 기능 진화의 흐름

4개 계획은 karax가 "스크린샷 추출 도구"에서 "**앱 구조 이해·검증 플랫폼**"으로 확장돼 온 궤적을 보여준다:

```
[기반] 화면 발견 + 2-티어 캡처
   ↓
[make-map] 화면 간 이동 관계 추출 → "프로그램 지도(App Map)" 생성
   ↓
[mapping-advance] 지도 고도화 — 트리거 요소의 텍스트·스타일·좌표까지 식별
   ↓
[build-tester] 정적 분석의 반대 방향 — 실제 빌드·설치 후 LLM 에이전트 E2E 테스트
   ↓
[no-npm] 배포 전략 — npm 발행 없이 git clone만으로 MCP 서버 사용 가능
```

---

## 2. 기반 아키텍처 (What — 기존 자산)

### 파이프라인

```
projectPath
 → [1] Project Detector (프레임워크 후보 + confidence + evidence)
 → [2] Doctor (환경 진단, 가용 티어 판정, 누락 의존성 자동 설치)
 → [3] Framework Adapter (정적 분석으로 화면 발견: route-graph + heuristic)
 → [4] Capture Engine (화면별 티어 선택)
      ├─ Tier 1 (compile): 임시 오버레이에 하니스 생성 → 화면 단위 컴파일 → 실제 렌더러 캡처
      └─ Tier 2 (static): 위젯 트리 → UI IR → HTML/CSS → Playwright Chromium → PNG
 → PNG + *.report.json
```

- 화면 **발견은 항상 정적 분석**, **캡처만** 2티어. 기본 `auto` 모드는 Tier 1 시도 후 화면 단위 Tier 2 fallback.
- Tier 1 백엔드: Flutter=위젯 테스트 골든, RN=esbuild+react-native-web, Compose=Paparazzi, SwiftUI=xcodebuild+시뮬레이터(macOS 한정).

### 패키지 의존 방향

```
core → adapter-api → adapter-{flutter,rn,android,ios} · compile-* · renderer · doctor → sdk → cli / mcp
(+ enrich-llm 선택 플러그인, + e2e 신규 패키지)
```

---

## 3. 계획별 기능 정리 (What + How)

### 3.1 make-map — 프로그램 지도(App Map) 생성

**의도**: 화면 발견·캡처는 갖췄지만 화면 간 **이동 관계**(어떤 버튼 → 어떤 화면)는 추출하지 않았다. 진입점부터 시작하는 네비게이션 그래프 = "프로그램 지도"를 마크다운 문서(`{앱 이름}_map_{숫자}.md`, 길면 분할)로 생성한다.

**핵심 설계**:

| 항목 | 결정 |
|---|---|
| 자료구조 | `core/src/appmap/schema.ts` (zod) — `AppMap { schemaVersion: "appmap/1", appName, framework, entryScreenId, screens, edges, diagnostics, overallConfidence }` |
| 어댑터 확장 | `FrameworkAdapter`에 **optional** `discoverNavigation?(ctx)` + `readAppName?(ctx)` — 미구현 시 빈 그래프 + `NAV_UNSUPPORTED` diagnostic |
| 트리거 추출 | 어댑터별 `discover/navGraph.ts` 신규 (기존 routeGraph 헬퍼 재사용, routeGraph는 무수정) |
| 마크다운 생성 | `core/src/appmap/markdown.ts` 순수 함수 (결정론·무 I/O, 파일 쓰기는 SDK) |
| 신뢰도 | 해석 성공 1.0 / 휴리스틱 0.6 / 미해석 0.3 + `DYNAMIC_NAV`/`UNRESOLVED_NAV` diagnostic |

**어댑터별 네비게이션 추적**:
- **Flutter**: `onPressed`/`onTap` 내 `Navigator.push(MaterialPageRoute)` → 클래스, `pushNamed` → routes 테이블 역참조, `pop` → back 엣지.
- **RN**: `onPress` 내 `navigation.navigate('List')` → routeMap으로 컴포넌트 해석. 라우트명≠컴포넌트명 구분(`to`/`toRouteName`).
- **Android Compose** (가장 복잡): NavHost 콜백 주입 맵 + 화면 함수의 `Button(onClick = onX)` 파라미터 매칭 — 2단계 간접 추적. 3단계 이상은 포기(conf 0.3).
- **iOS SwiftUI**: `NavigationLink(destination:)` + 라벨 Text.

**산출물**: 인덱스 문서(Mermaid `flowchart TD` 그래프 + 화면 목록 테이블) + 화면별 상세 섹션(요소 테이블·이동 테이블), `maxChars` 초과 시 화면 단위 분할 + 상호 링크.

**표면**: SDK `generateAppMap()`, CLI `map` 커맨드, MCP `generate_app_map` 툴.

### 3.2 mapping-advance — App Map 상세 매핑 고도화

**의도**: make-map의 지도는 "어떤 화면 → 어떤 화면" 수준. 사용자가 원하는 건 더 자세한 지도 — ① **어떤 요소**를 눌러 이동하는지 ② 그 요소의 **위치/크기**(좌표) ③ **생김새**(배경색·모서리 등 스타일) ④ **텍스트**.

**핵심 설계 결정**:

| 결정 | 선택 | 이유 |
|---|---|---|
| 트리거 위젯 위치 | `TriggerInfo.elementRef` 신규 필드 | 기존 sourceRef는 핸들러 위치 의미로 예약 |
| bounds 병합 위치 | SDK 후처리 (core는 순수 유지) | core→renderer 의존 금지 |
| bounds↔요소 매칭 | sourceRef(file+line) 기반, **idx 직접 매칭 금지** | assemble BFS vs 렌더 DFS 순서 불일치 회피 |
| 스키마 버전 | `appmap/1` 유지 | optional 필드만 추가 → 하위호환 |
| 좌표 수집 | 기본 ON (`--no-layout`/`includeLayout`으로 끔), Chromium 실패 시 graceful degradation | zero-config 유지 |
| 좌표 의미 | Tier 2 정적 렌더 기반 **근사 좌표** — `LAYOUT_APPROX` diagnostic 명시 | 한계를 숨기지 않음 |

**구현 흐름**:
1. core 스키마 확장 — `BoundsSchema`, `ElementStyleSchema`, `MapElement.style/bounds`, `TriggerInfo.elementRef/style/bounds`.
2. core assemble — IR에서 스타일 추출 + 트리거↔요소 매칭(`file 일치 && |line 차|≤2` 최근접 → label fallback → 실패 시 `TRIGGER_UNMATCHED`).
3. 어댑터 4종 — 트리거 위젯의 `elementRef`(file+line) 기록 (AST 보유 어댑터는 startPosition, 정규식 어댑터는 인덱스→라인 계산).
4. renderer — `measureScreenLayouts()`: 브라우저 1회 launch로 전체 화면을 `data-karax-idx` + `getBoundingClientRect()`로 측정.
5. SDK — 측정 결과를 sourceRef 매칭으로 element/trigger의 `bounds`에 병합, 실패 시 `LAYOUT_UNAVAILABLE`.
6. markdown — 요소 테이블에 `위치 | 크기 | 스타일` 컬럼 추가 (없으면 `-`).
7. CLI `--no-layout` / MCP `includeLayout` 옵션.

→ **이미 구현 완료** (커밋 `eb7d1aa feat: App Map 상세 매핑`).

### 3.3 build-tester — E2E 테스트 자동화 (`karax test`)

**의도**: karax의 기존 방향("빌드 없이")과 반대인 신규 능력 — **에뮬레이터/시뮬레이터를 실제로 부팅하고, 앱을 풀 빌드·설치·실행한 뒤, LLM 에이전트(Claude Code·Codex·Gemini CLI)가 adb/simctl로 E2E 테스트를 수행**. 시나리오 마크다운이 있으면 그대로, 없으면 탐색적(exploratory) 테스트.

**확정 결정**:
- **에이전트 CLI 단일 경로**: 자체 API tool-use 루프를 만들지 않고 `claude -p` / `codex exec` / `gemini -p` 헤드리스 CLI를 spawn. 구독 사용자는 기존 로그인 그대로, API 키 사용자는 env 주입.
- **4종 프레임워크 전체 지원**: Android 에뮬레이터 + iOS 시뮬레이터(macOS 한정).

**신규 패키지 `@karax/e2e`** 구조:
- `device/` — DeviceManager (list/ensureBooted/install/launch/screenshot/shutdown). Android는 adb+emulator, iOS는 simctl.
- `build/` — 프레임워크×플랫폼 빌드 매트릭스 (flutter build apk, gradlew assembleDebug, xcodebuild 등). 아티팩트 glob → mtime fallback. RN iOS의 `pod install`은 자동 실행하지 않고 `COCOAPODS_REQUIRED` 진단만 (원본 무수정).
- `agent/` — CLI별 argv/env 구성, 프롬프트 계약(deviceId/appId/치트시트/maxSteps/출력 계약), `result.json` zod 검증 + 1회 재시도.
- `scenario/` — 마크다운 frontmatter(appId/platform) 파싱, 미제공 시 exploratory.
- `report/` — 세션 디렉토리에 `report.json` + `report.md` + `screenshots/`.

**파이프라인**: detect framework → parse scenario → ensureBooted → build → install+launch → spawnAgent(검증/재시도) → report → (옵션) shutdown.

**에러/종료 코드**: `E2E_ERROR_CODES` 12종 (EMULATOR_BOOT_TIMEOUT, BUILD_FAILED, AGENT_OUTPUT_INVALID 등). 테스트 실패=exit 2, 인프라 에러=exit 1, 통과=0.

**표면**: doctor 체크 3종(adb/emulator/agentClis) 추가, CLI `test` 커맨드, MCP `run_e2e_test` 툴(8번째), SDK `runE2eTest` 재노출. E2E는 캡처 티어 모델과 직교이므로 `tiers.ts` 무수정.

→ **구현 완료** (MCP 서버에 `run_e2e_test` 툴 존재).

### 3.4 no-npm — git clone만으로 MCP 서버 사용

**의도**: npm 발행 계획이 없는데 README가 `npx -y @sfc/mcp`로 안내돼 있었다. 다른 개발자가 **git clone만 받으면 바로 MCP 서버로 등록·사용**할 수 있게 한다.

**채택안**: 자가 부트스트랩 런처 + 사전 setup 스크립트 하이브리드.
- `scripts/mcp-launcher.mjs` (의존성 0): node_modules/dist 상태 검사 → 없으면 `pnpm install` + `pnpm -r build`를 **stderr 전용**으로 수행 → `packages/mcp/dist/bin.js`로 핸드오프. 동시 기동 락(`wx` 원자 생성), stale 감지(`src` mtime > dist), Windows 분기.
- 루트 `.mcp.json` 커밋 → Claude Code가 프로젝트 열면 자동 인식 (클론 직후 추가 명령 0).
- 첫 실행 수 분 지연은 우회 불가 → `scripts/setup.mjs` 사전 워밍업(Chromium 설치 포함) 병행.

**기각안**: 번들 커밋(C)은 playwright Chromium·tree-sitter-wasm·esbuild 네이티브 바이너리 때문에 불가, tsx 직접 실행(D)도 exports가 dist 기준이라 부적합.

**부수 수정 (필수)**:
- `doctor/src/ensure.ts` — `ensureChromium()`의 `stdio: "inherit"`가 **MCP stdout(프로토콜 채널)을 오염**시킬 수 있음 → stderr로 격리.
- `cli/src/bin.ts`의 `runMcpConfig` — npx 스니펫을 런처 절대경로 기준으로 교체.
- README 문서 갱신 (npx 스니펫 제거, 클론 기반 사용법 안내).

**구현 노트 (검증 완료, 2026-06-05)**:
- zod 직접 import 없는 13개 패키지에서 zod 의존성 제거 가능 (workspace hoisting으로 빌드 통과 확인).
- `tsconfig exclude: ["src/**/__tests__"]` 필수 — 없으면 dist에 테스트 코드(vitest devDep import)가 포함됨.

---

## 4. 현재 기능 전체 요약 (계획 반영 후의 karax)

| 능력 | 진입점 | 비고 |
|---|---|---|
| 프레임워크 감지 | `detect` / `detect_framework` | confidence + evidence |
| 환경 진단 | `doctor` | 티어 가용성 + adb/emulator/agent CLI 체크 + 자동 설치 |
| 화면 발견 | `list_screens` | 항상 정적 분석 (route-graph + heuristic) |
| 화면 캡처 | `capture` / `capture_screen` / `capture_all` | 2-티어 (compile/static/auto), variants, overlay, enrich |
| IR 추출 | `get_screen_ir` | 프레임워크 중립 zod 스키마 |
| **앱 지도** | `map` / `generate_app_map` | 네비 그래프 + 트리거 요소의 텍스트·스타일·좌표(근사) + Mermaid 마크다운 |
| **E2E 테스트** | `test` / `run_e2e_test` | 실기기 빌드·설치 + LLM 에이전트(claude/codex/gemini) 주행 + 리포트 |
| **배포 없는 사용** | `.mcp.json` + `scripts/mcp-launcher.mjs` | clone → 자동 부트스트랩 → MCP 서버 |

## 5. 모든 계획을 관통하는 공통 원칙 (How — 작업 방식)

1. **TDD 필수** — 모든 단계가 "테스트 먼저(Red) → 구현(Green) → Refactor". 순수 함수(파서·매칭·argv 구성 등)를 부수효과(spawn/fs/Chromium)와 분리해 테스트 가능성 확보.
2. **빌드 순서 준수** — workspace:* 의존은 dist를 import하므로 하위 패키지 변경 후 반드시 `build`: `core → adapter-api → adapters · renderer → sdk → cli · mcp`.
3. **하위호환** — 스키마 확장은 optional 필드만 (`appmap/1` 유지), 어댑터 인터페이스 확장도 optional 메서드.
4. **graceful degradation** — Chromium 없음 → 좌표만 생략, 어댑터 미구현 → 빈 그래프 + diagnostic. 기능 전체가 죽지 않게.
5. **검수 워크플로** — developer 에이전트 TDD 구현 → git diff 보고 → `code-review-side-effects` / `security-auditor` / `intent-drift-checker` 3종 병렬 검수 → 위험도 높음/중간 수정 → `/pr_to_develop`.
6. **검증** — `pnpm -r build && pnpm -r test && pnpm -r typecheck` 전체 그린 + 4개 fixture(`flutter-basic`, `react-native-basic`, `android-compose-basic`, `ios-swiftui-basic`) 기반 CLI 수동 검증 + MCP 핸드셰이크 확인.

## 6. 알려진 리스크 / 한계 (계획서에서 명시된 것)

- **좌표는 근사값** — Tier 2 정적 렌더 기반 CSS px. `LAYOUT_APPROX`로 명시.
- **Android 네비 추적은 2단계 간접 추적까지** — 3단계 이상 콜백 전달은 conf 0.3 + diagnostic으로 포기.
- **에이전트 CLI 플래그는 버전 의존** — `--permission-mode bypassPermissions` / `--full-auto` / `--yolo`는 런타임 검증 필요.
- **MCP `run_e2e_test`는 수 분 소요** — 응답 크기 제한, 장시간 소요 명시.
- **fresh clone 첫 실행 지연** — install+build 수 분, MCP 클라이언트 타임아웃 가능 → `pnpm bootstrap` 워밍업 권장. (`setup`은 pnpm 내장 명령과 충돌해 `bootstrap`으로 명명)
- **BFS vs DFS 순회 순서 불일치** — idx 직접 매칭 금지, sourceRef(file+line) 매칭이 유일하게 안전.
