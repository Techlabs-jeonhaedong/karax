# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**karax** — 모바일 앱 테스트 자동화 도구. 사용자가 시나리오를 주면 Android 에뮬레이터/iOS 시뮬레이터에서 완전 자동으로 E2E 테스트를 수행하고 보고서를 작성한다. 시나리오가 없으면 앱을 자유 탐색하며 findings(anomaly 분류 + severity)를 보고한다. Flutter / React Native / Android(Compose·XML) / iOS(SwiftUI·UIKit)를 지원하며 SDK + MCP 서버 + CLI 형태로 제공된다. pnpm workspace 기반 TypeScript 모노레포(ESM, NodeNext).

스크린샷 추출과 AppMap(화면 간 이동 관계 지도) 생성은 테스트 자동화의 하부 기능이다 — AppMap을 세션 시작 시 자동으로 에이전트 프롬프트에 주입해 LLM이 버튼 위치를 찾는 시간을 줄인다.

> **리네임 완료**: 프로젝트 이름은 `karax`다. 구 명칭 `screenshot-from-code` / `sfc`는 사용하지 않는다. 패키지 스코프는 `@karax/*`이며, 루트 package.json name은 `karax`다. pnpm filter 명령어에서는 `@karax/*`를 사용할 것.

`PLAN.md`가 자기완결적 설계 문서다 — 아키텍처 의사결정의 배경이 궁금하면 먼저 참고할 것.

## 자주 쓰는 명령어

```bash
pnpm install              # 의존성 설치
pnpm -r build             # 전체 패키지 빌드 (tsc)
pnpm -r test              # 전체 테스트 (vitest)
pnpm -r typecheck         # 전체 타입체크

# 단일 패키지 테스트
pnpm --filter @karax/adapter-flutter test

# 단일 테스트 파일 실행
pnpm --filter @karax/adapter-flutter exec vitest run src/__tests__/discover.test.ts

# CLI 직접 실행 (빌드 후)
node packages/cli/dist/bin.js detect <path>
node packages/cli/dist/bin.js capture <path> --screen <id> --mode static --out ./out
```

- 테스트 파일 위치 규칙: 각 패키지의 `src/**/__tests__/*.test.ts` (vitest config의 include 패턴).
- 패키지 간 의존은 `workspace:*` 참조이므로, 다른 패키지의 변경을 반영하려면 해당 패키지를 먼저 `build` 해야 한다 (dist를 import함).

## Plan 모드 규칙

plan 모드로 계획을 세울 경우, 계획을 `./plans` 디렉토리 안에 `{브랜치 이름}_plan.md` 파일명으로 마크다운 문서로 저장한다. (브랜치 이름의 `/`는 `-`로 치환, 예: `feat/foo` → `feat-foo_plan.md`)

## 아키텍처

### 파이프라인 (데이터 흐름)

**스크린샷/AppMap 파이프라인 (하부 기능)**

```
projectPath
 → [1] Project Detector (프레임워크 후보 + confidence + evidence)
 → [2] Doctor (환경 진단, 가용 티어 판정, 누락 의존성 자동 설치)
 → [3] Framework Adapter (정적 분석으로 화면 발견: route-graph + heuristic)
 → [4] Capture Engine (화면별 티어 선택)
      ├─ Tier 1 (compile): 임시 오버레이에 하니스 생성 → 화면 단위 컴파일 → 실제 렌더러 캡처
      └─ Tier 2 (static): 위젯 트리 → UI IR → HTML/CSS → Playwright Chromium → PNG
 → PNG + *.report.json (confidence, tierUsed, diagnostics)
```

**E2E 테스트 파이프라인 (최종 목표)**

```
projectPath + platform + scenarioPath?
 → [1] Doctor (환경 진단 — emulator/simulator/idb/agent CLI 체크)
 → [2] AppMap 자동 생성 (세션마다 3단계 압축 후 에이전트 프롬프트에 주입)
 → [3] Build + Install (에뮬레이터/시뮬레이터에 풀 빌드·설치, --reuse-build로 캐시 재사용 가능)
 → [4] LLM 에이전트 spawn (claude/codex/gemini 헤드리스 CLI)
      ├─ 시나리오 모드: frontmatter steps(action+expect) 순서대로 수행
      └─ 탐색적 모드: 자유 탐색 + anomaly 10종 taxonomy로 findings 분류
 → report.json (v2: findings/coverage/crashes/videos/qualityWarnings) + report.md + screenshots/
```

- 화면 **발견(discovery)은 항상 정적 분석**. **캡처만** 2티어로 나뉜다. 기본 모드 `auto`는 Tier 1 시도 후 화면 단위로 Tier 2 fallback (`COMPILE_FALLBACK` diagnostic 기록).
- Capture Engine 본체: `packages/core/src/pipeline/captureEngine.ts`

### 패키지 구조와 의존 방향

```
core (IR 스키마·detect·mock·confidence·pipeline·runtime, zod만 의존)
 ↑
adapter-api (FrameworkAdapter 인터페이스, 공유 타입 — FrameworkId, ScreenSummary, CaptureResult 등)
 ↑
adapter-{flutter,react-native,android,ios}   ← 프레임워크별 정적 분석 → IR 생성 (Tier 2)
compile-{flutter,react-native,android,ios}   ← 프레임워크별 부분 컴파일 백엔드 (Tier 1)
renderer (IR → HTML/CSS → Chromium 캡처, 디바이스 프로파일)
doctor (환경 진단·자동 설치 — adb/emulator/ios-simulator/ios-idb/agent CLI 체크, ensureIdb(brew))
e2e (E2E 테스트 엔진)
  ├─ scenario/ (schema.ts, parser, runner, suite — v2 frontmatter)
  ├─ agent/ (resultSchema, prompt 생성 — AppMap 주입·budget 조정)
  ├─ anomaly/ (taxonomy.ts — 10종 분류, severity)
  ├─ crash/ (detect.ts — logcat/idb crash 감지)
  ├─ recovery/ (부분 복구, outcome: partial)
  └─ report/ (schema.ts v2 — findings/coverage/crashes/videos/qualityWarnings)
 ↑
sdk (모든 패키지를 묶은 public API: detectFramework, listScreens, captureScreen, captureAll, buildScreenIR,
      generateAppMap, runE2eTest, runE2eSuite)
 ↑
cli (@karax/cli — bin.ts, commands.ts, ui 서브커맨드) / mcp (@karax/mcp — MCP 서버, tool 9종)

enrich-llm (선택 플러그인 — confidence 낮은 노드만 LLM으로 보강)
```

- 새 프레임워크 어댑터를 추가하려면 `packages/adapter-api/src/types.ts`의 `FrameworkAdapter` 인터페이스를 구현하고 sdk에 등록한다.
- Tier 1 백엔드: Flutter=위젯 테스트 골든(`flutter test`), RN=esbuild+react-native-web alias+Chromium, Compose=Paparazzi(JVM), SwiftUI=xcodebuild+시뮬레이터(macOS 한정). 레거시(Android XML, UIKit)는 Tier 2만 지원.

### UI IR (Tier 2의 공통 중간표현)

- 프레임워크 중립 JSON 트리, zod 스키마로 `packages/core/src/ir`에 정의. **노드 타입은 최소화**하고 다양성은 role/style/layout 속성으로 흡수한다.
- 노드 타입: 레이아웃(`Box`/`Row`/`Column`/`Stack`/`Scroll`/`Grid`/`List`/`Spacer`), 콘텐츠(`Text`/`Image`/`Icon`/`Button`/`Input`/`Divider`), 메타(`Unknown`/`Branch`/`Slot`). AppBar/TabBar/SafeArea는 별도 타입이 아니라 `Box` + `role`로 표현.
- `Branch`는 조건 분기 variant 그룹 — `--variants` 옵션이 이걸 분기별 PNG로 확장한다.
- IR 스키마를 바꾸면 4개 어댑터 + renderer + enrich-llm 모두 영향받으므로 주의.

## 핵심 제약 (설계 불변 조건)

1. **zero-config**: 분석 대상 프로젝트에 아무 조치 없이 동작해야 한다.
2. **원본 무수정**: 분석 대상 프로젝트의 소스를 절대 수정하지 않는다. Tier 1 하니스 등 모든 생성물은 임시 디렉토리/오버레이에서만 작업.
3. **코어는 LLM 없이 결정론적으로 동작**: mock 데이터는 `mockSeed` 기반 결정론적 생성. LLM 보강은 `enrich-llm` 플러그인으로만, 선택적으로 주입한다 (테스트 가능성 보장).
4. Tier 2는 픽셀 퍼펙트가 아닌 **구조적 근사** — 한계는 숨기지 말고 confidence score + diagnostics 코드(`UNRESOLVED_COMPONENT`, `DYNAMIC_DATA_MOCKED`, `COMPILE_FALLBACK` 등)로 수치화해 노출한다.

## 테스트 픽스처

`fixtures/` 아래에 프레임워크별 실제 미니 프로젝트(`flutter-basic`, `react-native-basic`, `android-compose-basic`, `ios-swiftui-basic`)가 있고, 어댑터 테스트(discover/buildScreenIR/goldens 등)가 이를 직접 분석한다. 어댑터 동작을 바꾸면 해당 픽스처 기반 골든 테스트가 깨질 수 있다.
