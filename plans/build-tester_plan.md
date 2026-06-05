# E2E 테스트 자동화 기능 (`sfc test`) 구현 계획

> 프로젝트 규칙에 따라 구현 시작 시 이 계획을 `./plans/build-tester_plan.md`로 복사한다.

## Context

karax는 현재 "빌드 없이" 정적 분석으로 스크린샷을 추출하는 도구다. 이번 기능은 그 반대 방향의 신규 능력: **Android 에뮬레이터 / iOS 시뮬레이터를 실제로 부팅하고, 대상 앱을 풀 빌드·설치·실행한 뒤, LLM 에이전트(Claude Code·Codex·Gemini CLI)가 adb/simctl로 E2E 테스트를 수행**하게 한다.

- 사용자는 마크다운 시나리오 문서를 제공할 수 있고, 없으면 에이전트가 탐색적(exploratory) 테스트를 수행.
- **확정 결정 1 — 에이전트 CLI 단일 경로**: 자체 API tool-use 루프를 만들지 않는다. `claude -p` / `codex exec` / `gemini -p` 헤드리스 CLI를 spawn. 구독 사용자는 기존 CLI 로그인 그대로, API 토큰 사용자는 env(`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`) 주입으로 같은 경로 사용.
- **확정 결정 2 — 4종 프레임워크 전체 지원**: Flutter / RN / Android 네이티브 / iOS 네이티브(macOS 한정), Android 에뮬레이터 + iOS 시뮬레이터 모두.

기존 코드에 디바이스 라이프사이클·풀 앱 빌드·에이전트 spawn 인프라는 **전무**하므로 신규 패키지 `@sfc/e2e`를 만들고, doctor/cli/mcp/sdk를 확장한다.

## 핵심 설계

### 패키지 레이아웃 — 신규 `packages/e2e` (`@sfc/e2e`) 단일 패키지

```
packages/e2e/
  package.json          # deps: execa ^9, zod, @sfc/adapter-api, @sfc/doctor (workspace:*)
  tsconfig.json / vitest.config.ts   # 기존 패키지 패턴 그대로
  src/
    index.ts            # public API: runE2eTest(opts)
    types.ts            # E2E_ERROR_CODES, E2eError, 공유 타입
    session.ts          # createSessionDir(outDir) → {dir, screenshotsDir}
    device/             # 디바이스 라이프사이클
      types.ts          # DeviceManager, DeviceInfo, Platform
      parse.ts          # 순수 파서: adb devices/emulator -list-avds/avdmanager/simctl 출력
      android.ts        # adb + emulator + avdmanager
      ios.ts            # xcrun simctl
      index.ts          # createDeviceManager(platform)
    build/              # 풀 앱 빌드 (프레임워크×플랫폼 매트릭스)
      types.ts          # AppBuilder, BuildResult
      detect.ts         # 순수: gradle 앱 모듈 탐지, xcodebuild -list 스킴 선택
      artifact.ts       # 순수: APK/.app 경로 해석 + appId/bundleId 추출
      flutter.ts / reactNative.ts / androidNative.ts / iosNative.ts
      index.ts          # selectBuilder(framework, platform)
    agent/              # LLM 에이전트 CLI 오케스트레이션
      types.ts          # AgentKind = "claude"|"codex"|"gemini"
      args.ts           # 순수: CLI별 argv+env 구성 (최고 리스크 유닛)
      prompt.ts         # 순수: 태스크 프롬프트 템플릿 + 출력 계약
      resultSchema.ts   # 에이전트가 쓰는 result.json zod 스키마
      runner.ts         # execa spawn → 검증 → 1회 재시도
    scenario/parse.ts   # 순수: 마크다운 frontmatter(appId/platform) + body 통과
    report/             # schema.ts(E2eReport zod) + write.ts(report.json/report.md)
```

분리 근거: 기존 관례상 능력 1개 = 패키지 1개. device 레이어를 별도 패키지로 쪼개지 않음(소비자가 e2e뿐). `compile-ios`의 `selectSimulator` 파싱은 **복사·개작**(import 금지 — 레이어링 위반 + 기존 중복 관례 따름).

### 디바이스 레이어 (`device/`)

```typescript
interface DeviceManager {
  readonly platform: "android" | "ios";
  list(): Promise<DeviceInfo[]>;
  ensureBooted(preferredId?: string): Promise<DeviceInfo>;  // 부팅된 기기 재사용, 없으면 부팅+대기
  install(deviceId: string, artifactPath: string): Promise<void>;
  launch(deviceId: string, appId: string): Promise<void>;
  screenshot(deviceId: string, destPngPath: string): Promise<void>;
  shutdown?(deviceId: string): Promise<void>;  // --keep-booted 아니면 우리가 부팅한 것만 종료
}
```

- Android: SDK 경로는 `@sfc/doctor`의 `detectAndroidSdkPath()` 재사용. 부팅 `emulator -avd <name> -no-snapshot -no-audio`(detached) → `adb shell getprop sys.boot_completed` 폴링(기본 180s, 초과 시 `EMULATOR_BOOT_TIMEOUT`). 설치 `adb install -r -t`, 실행 `monkey -p <appId> -c android.intent.category.LAUNCHER 1`, 스샷 `adb exec-out screencap -p`.
- iOS: `simctl list devices available` 파싱(compile-ios에서 개작) → `simctl boot` + `bootstatus -b` → `simctl install` / `launch` / `io screenshot`.
- env 주입(`ANDROID_HOME`/`ANDROID_SDK_ROOT`)은 `compile-android/src/runner.ts` 방식 그대로.

### 빌드 레이어 (`build/`) — 매트릭스

| framework × platform | 빌드 명령 | 아티팩트 | appId 출처 |
|---|---|---|---|
| flutter/android | `flutter build apk --debug` | `build/app/outputs/flutter-apk/app-debug.apk` | `android/app/build.gradle`의 applicationId |
| flutter/ios | `flutter build ios --simulator --debug` | `build/ios/iphonesimulator/*.app` | 빌드된 Info.plist (PlistBuddy) |
| rn/android | `android/gradlew assembleDebug` | `android/app/build/outputs/apk/debug/*.apk` | applicationId |
| rn/ios | `xcodebuild -workspace ios/*.xcworkspace -scheme <s> -sdk iphonesimulator -derivedDataPath <tmp> build` | derivedData 산하 `*.app` | Info.plist |
| android 네이티브 | 앱 모듈 탐지(settings.gradle include + application 플러그인, 기본 `app`) → `./gradlew :<m>:assembleDebug` | `<m>/build/outputs/apk/debug/*.apk` | applicationId |
| ios 네이티브 | `xcodebuild -list -json` 스킴 선택 → `-sdk iphonesimulator -derivedDataPath <tmp> build` | derivedData 산하 `*.app` | Info.plist |

- 아티팩트 탐색: 우선순위 glob → 실패 시 `build/` 하위 최신 mtime `*.apk`/`*.app` 재귀 fallback (순수 함수 `findArtifact`).
- **원본 무수정 원칙**: 빌드 산출물은 프로젝트 자체 `build/` 또는 외부 temp derivedData에만. RN iOS에서 `Pods/` 없으면 `pod install`을 **자동 실행하지 않고** `COCOAPODS_REQUIRED` 진단 + 힌트만 노출.
- 타임아웃: 빌드 600s, adb/simctl 60s (execa, 기존 관례).

### 에이전트 오케스트레이션 (`agent/`)

- `buildAgentInvocation(kind, {prompt, apiKey})` → `{bin, args, env}`. apiKey가 있을 때만 해당 env 키 주입, 없으면 passthrough(구독 로그인 활용).
- 플래그 (구현 시 `--help`/`--version`으로 **런타임 검증 필수**, `// VERIFY:` 주석):
  - claude: `claude -p <prompt> --output-format json --allowedTools "Bash" --permission-mode bypassPermissions`
  - codex: `codex exec <prompt> --full-auto`
  - gemini: `gemini -p <prompt> --yolo`
- 프롬프트 계약: platform/deviceId/appId/adb·simctl 치트시트/시나리오 body(또는 탐색 모드 지시)/maxSteps(기본 20)/screenshotsDir 절대경로 + **엄격한 출력 계약** — 지정 경로에 `result.json`(AgentResultSchema: outcome, summary, steps[{index,description,status,screenshot,note}]) 작성, 스텝마다 스크린샷 저장.
- 오케스트레이터가 result.json을 zod 검증 → 위반 시 검증 에러 첨부해 1회 재시도(enrich-llm의 ENRICH_REJECTED 패턴) → 재실패 시 `AGENT_OUTPUT_INVALID`. 전체 wall-clock 타임아웃 기본 900s.

### 시나리오 / 리포트

- `parseScenario(md)`: 선택적 YAML frontmatter(`appId`, `platform`)만 파싱, body는 그대로 에이전트에 전달. 파일 미제공 → `exploratory: true`.
- 세션 디렉토리 `<outDir>/<timestamp>/`: `report.json`(zod 검증) + `report.md`(요약 테이블) + `screenshots/`.

### 에러 코드 / 종료 코드

`E2E_ERROR_CODES`: FRAMEWORK_NOT_DETECTED, SCENARIO_PARSE_ERROR, NO_DEVICE_AVAILABLE, EMULATOR_BOOT_TIMEOUT, COCOAPODS_REQUIRED, BUILD_FAILED, ARTIFACT_NOT_FOUND, INSTALL_FAILED, LAUNCH_FAILED, AGENT_CLI_MISSING, AGENT_OUTPUT_INVALID, AGENT_TIMEOUT.

CLI 종료 코드: 테스트 자체 실패(outcome:"fail") → `PARTIAL_FAILURE(2)`, 인프라 에러(E2eError) → `FAILURE(1)`, 통과 → `SUCCESS(0)`. (captureAll의 exit-2 의미론과 일치)

### 표면 (수정되는 기존 파일)

- **doctor**: 신규 체크 `checks/adb.ts`, `checks/emulator.ts`(emulator+avdmanager+AVD 존재), `checks/agentClis.ts`(claude/codex/gemini `--version`). `checks/index.ts`, `src/index.ts`(runAllChecks)에 와이어링. `tiers.ts`는 건드리지 않음(E2E는 캡처 티어 모델과 직교 — 주석 명시).
- **cli**: `commands.ts`에 `parseTestArgs`, `bin.ts`에 `test <path>` 커맨드. 옵션: `--platform <android|ios>`(필수), `--scenario <file>`, `--agent <claude|codex|gemini>`(기본 claude), `--api-key`, `--device <id>`, `--out <dir>`, `--timeout <ms>`, `--max-steps <n>`, `--json`, `--keep-booted`. lazy `await import("@sfc/e2e")`. 한국어 설명/에러.
- **mcp**: `server.ts`에 8번째 툴 `run_e2e_test` (장시간 소요 명시, 응답은 요약 텍스트 + 리포트 경로 + 최종 스크린샷 소량만 base64).
- **sdk**: `runE2eTest` 및 타입 재노출 (sdk가 public API 집약점이라는 관례 유지).
- 각 package.json에 `@sfc/e2e` 의존성 + tsconfig references 추가.

## 구현 순서 (TDD — 각 유닛 테스트 파일 먼저, Red→Green→Refactor)

| # | 단계 | 테스트 (먼저 작성) | 규모 |
|---|---|---|---|
| 0 | 이 계획을 `./plans/build-tester_plan.md`로 복사 | — | XS |
| 1 | 패키지 스캐폴드 + `types.ts`(에러 코드) | — | S |
| 2 | `device/parse.ts` 순수 파서 | adb devices -l / emulator -list-avds / avdmanager / simctl 픽스처 문자열 파싱 | M |
| 3 | `build/detect.ts` | gradle 모듈 탐지, xcodebuild -list 스킴 선택, 프로젝트 형태 판별 | M |
| 4 | `build/artifact.ts` | findArtifact 우선순위+fallback(temp dir), appId/bundleId 추출 | M |
| 5 | `scenario/parse.ts` | frontmatter 유/무/깨짐, body 통과, exploratory 플래그 | S |
| 6 | `agent/args.ts` | CLI별 argv·env 정확성, apiKey 유/무 | M |
| 7 | `agent/prompt.ts` | deviceId/appId/screenshotsDir/maxSteps/출력 계약 포함 여부, 시나리오 vs 탐색 분기 | S |
| 8 | `agent/resultSchema.ts` + `report/schema.ts` | zod valid/invalid 케이스 | S |
| 9 | `report/write.ts` + `session.ts` | temp 세션 디렉토리에 report.json/md 라운드트립 | S |
| 10 | `device/android.ts`·`ios.ts`·`index.ts` | execa mock — 명령/인자 검증, 부팅 폴링 타임아웃→EMULATOR_BOOT_TIMEOUT. 실기기 경로는 `SFC_E2E_REAL` env 가드(CI skip) | L |
| 11 | `build/*.ts` 빌더 4종 + `index.ts` | execa mock — 명령/env, COCOAPODS_REQUIRED preflight, 아티팩트 연결 | L |
| 12 | `agent/runner.ts` | execa mock + temp result.json — 성공/스키마위반→재시도→AGENT_OUTPUT_INVALID/타임아웃/CLI부재 | M |
| 13 | `src/index.ts` `runE2eTest` 오케스트레이션 | mock 주입 seam으로 파이프라인 순서·outcome 매핑·에러 전파 | M |
| 14 | doctor 체크 3종 + 와이어링 | 체크별 execa mock 테스트 | M |
| 15 | CLI `parseTestArgs` + `test` 커맨드 + sdk 재노출 | commands.test.ts에 파싱/검증 케이스 추가 | M |
| 16 | MCP `run_e2e_test` 툴 | server.test.ts에 등록·핸들러 검증(@sfc/e2e mock) | S |

파이프라인: detect framework → parse scenario → ensureBooted → preflight+build → install+launch → spawnAgent(검증/재시도) → report 작성 → (옵션) shutdown.

## 검증 방법

1. `pnpm -r build && pnpm -r typecheck && pnpm -r test` — 전 패키지 그린 확인 (신규 테스트 전부 mock 기반, 실기기 불필요).
2. 실기기 스모크 (로컬, macOS): `fixtures/flutter-basic` 또는 `fixtures/android-compose-basic` 대상
   - `node packages/cli/dist/bin.js doctor` — adb/emulator/agent CLI 체크 행 표시 확인
   - `node packages/cli/dist/bin.js test fixtures/android-compose-basic --platform android --agent claude` — 에뮬레이터 부팅→빌드→설치→에이전트 테스트→`report.json`/`report.md`/스크린샷 생성 확인
   - 시나리오 모드: 임시 마크다운 시나리오로 동일 실행, 시나리오 body가 프롬프트에 반영되는지 확인
   - iOS: `fixtures/ios-swiftui-basic --platform ios`로 simctl 경로 확인
3. 에이전트 CLI 플래그(`// VERIFY:` 표기 항목)는 구현 단계 6에서 각 CLI `--help`로 실제 검증 후 확정.

## 리스크 / 미확정

- 에이전트 CLI 플래그(claude `--permission-mode bypassPermissions`, codex `--full-auto`, gemini `--yolo`)는 버전에 따라 다를 수 있음 → 구현 시 런타임 검증, doctor 체크에 버전 표기.
- `adb monkey` 런처 실행은 기기-무관 선택지(매니페스트 파싱 불필요). 문제 시 `am start` fallback.
- MCP 툴은 수 분 소요 가능 — 설명에 명시, 응답 크기 제한.
