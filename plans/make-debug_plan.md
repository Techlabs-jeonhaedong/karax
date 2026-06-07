# 디버깅 모드 추가 구현 계획 (make-debug)

> 목표: 사용자가 karax의 오류를 추적하고 수정할 수 있는 디버깅 모드를 추가한다.
> 설계 근거: 6영역 병렬 코드 분석 + 3관점 설계안 + 2심사위원 패널 합성 결과.

## 0. 설계 요약 (합성안)

- **단일 신호**: `--debug` CLI 플래그(전 커맨드) + `KARAX_DEBUG=1` env. 우선순위: 명시 플래그 > env > off. 로그레벨/`--verbose`/`--debug-keep-artifacts`는 도입하지 않음 (심사 합의: 과잉).
- **redact 단일 게이트**: `sanitizeStderr`를 `@karax/core`로 승격(`redactSecrets`), e2e 기존 모듈은 re-export shim. cli/renderer/e2e가 공유. `redactInvocation`(env 객체 값 마스킹) 신설.
- **stderr 전용**: 모든 디버그 출력은 stderr. stdout은 `--json`·`ui` JSON·MCP JSON-RPC 계약 절대 불변.
- **아티팩트**: debug on일 때만 `sessionDir/debug/` 생성 (빌드 풀로그·agent raw/invocation·teardown.log·manifest.json·logcat 원문). 모든 기록은 redact + 크기 상한.
- **결정론/순수성**: core는 zod-only 유지(순수 함수·콜백만), SDK는 console 금지(onDebug DI 콜백), off일 때 모든 경로 no-op으로 기존 골든/JSON 테스트 무영향.

## 1. 불변 제약 (위반 = 실패)

1. 디버그 출력은 stderr 전용 — stdout 계약(--json JSON.parse 테스트, ui JSON 한 덩어리, MCP JSON-RPC) 불변.
2. 디스크 기록·stderr 출력 직전 반드시 redact (`redactSecrets`/`redactInvocation`).
3. core는 zod 외 의존 금지. SDK는 직접 console 금지 — `onDebug` 콜백 DI만.
4. 원본 프로젝트 무수정 — 아티팩트는 outDir/sessionDir/tmpdir에만. off일 때 `debug/` 디렉토리 미생성.
5. 결정론 — mockSeed/clock 주입 관례 유지, stdout 골든 무영향.
6. **와이어링 완전성** (M11 사고 재발 방지 최우선): CLI 플래그 → commands.ts parse* → bin.ts commonOpts → sdk → e2e → build/agent 전 구간. dist/bin.js execFile E2E 테스트로 종단 검증.
7. TDD: 테스트 먼저(Red) → 구현(Green) → 리팩토링. 테스트는 `src/**/__tests__/*.test.ts`, vitest, 한국어 설명.
8. 어댑터의 finally dispose·catch-dispose-rethrow 흐름은 절대 변경 금지 (관측 추가만).
9. 기존 `[karax/e2e]` stderr 포맷 일괄 교체 금지 (회귀 위험 — 신규 로그만 `[karax/debug]`).

## 2. Phase A — 기반 (core / adapter-api / sdk)

빌드 순서상 최하단부터. `pnpm -r build`로 dist 갱신 필수 (workspace는 dist를 import).

### A-1. `packages/core/src/debug/redact.ts` (신규)
- `redactSecrets(text: string): string` — e2e `agent/sanitize.ts`의 `sanitizeStderr` 로직을 이식(패턴 동일). 순수 함수, 의존 0.
- `redactInvocation(inv: { bin: string; args: string[]; env?: Record<string,string> }): ...` — env 값은 전부 `[REDACTED]`(키 이름만 보존), args 중 `--api-key` 다음 값 마스킹. **주의**: env 객체는 JSON 직렬화 시 `KEY=값` 패턴에 안 잡히므로 패턴 매칭이 아닌 구조적 마스킹.
- `formatRespawnCrash(result: { status: number | null; signal: string | null; error?: Error }): string | null` — 자식 정상 종료(status!=null && signal==null && !error)면 null, 즉사면 사람이 읽을 사유 문자열(SIGKILL/SIGSEGV/spawn error). cli/mcp 양쪽 bin.ts가 공유.
- core index.ts에서 export. **테스트 먼저**: `packages/core/src/__tests__/redact.test.ts` — 기존 sanitize.test 케이스 이식 + redactInvocation env 마스킹 + formatRespawnCrash signal/error/정상 케이스.

### A-2. `packages/e2e/src/agent/sanitize.ts` → re-export shim
- 기존 export 시그니처(`sanitizeStderr`) 유지한 채 내부 구현을 `@karax/core`의 `redactSecrets` 위임으로 교체. importer(agent/runner.ts, crash/detect.ts) 무영향.
- 기존 sanitize 테스트 그대로 통과해야 함 (Green 확인).

### A-3. `packages/adapter-api/src/types.ts`
- `DebugEvent` 타입 신설: `{ tag: string; message: string; detail?: string }`.
- `AdapterContext`와 `CaptureOptions`에 `onDebug?: (e: DebugEvent) => void` 옵셔널 추가.

### A-4. `packages/core/src/pipeline/captureEngine.ts`
- `LocalAdapterContext`(L26-31)에 `onDebug` 옵셔널 **동기화** (구조적 재정의 — adapter-api와 드리프트 금지).
- auto 모드 COMPILE_FALLBACK 분기(L228-244)에서 fallback 직전 원본 `CompileCaptureError`를 onDebug로 전달 (`tag: "compile-fallback"`, detail에 stack).
- **테스트**: 기존 captureEngine 테스트에 onDebug 스파이 케이스 추가 — fallback 시 이벤트 수신, off 시 무호출, 반환값·diagnostics 불변.

### A-5. `packages/sdk/src/index.ts` + `appMap.ts`
- `AnalyzeOptions`(및 captureScreen/captureAll/generateAppMap 옵션)에 `onDebug?: (e: DebugEvent) => void` + `debug?: boolean` 추가.
- captureAll 화면별 catch(L771-775): `failures[]`/`extraLimitations[]`는 **불변**, onDebug로 stack 포함 이벤트 추가 전달. variant/overlay 빈 catch(L752/L767)도 동일.
- appMap.ts 빈 catch(L161-168): onDebug 있으면 사유 전달 (반환값 불변).
- runE2eTest/runE2eSuite 래퍼: `opts.debug`를 e2e로 패스스루 (이미 spread라 RunE2eTestOptions에 필드만 추가되면 자동 — 명시 확인).
- AdapterContext 생성 지점(L504/L526/L578/L688)에서 onDebug를 ctx로 전파.
- **테스트**: captureAll 실패 시 onDebug 이벤트 수신 + failures[] 기존 형태 유지(하위호환).

### A-6. 어댑터 관측 (4개 — 범위 한정)
- adapter-flutter/react-native/android/ios의 **index.ts 수준** 빈 catch (discoverScreens의 route-graph 실패 폴백, readPackageName 등)에 `ctx.onDebug?.(...)` 호출 추가. 깊은 내부 모듈까지는 1차 범위 제외.
- dispose/rethrow 패턴 절대 보존. 동작·반환값 불변 (관측만).
- **테스트**: 각 어댑터 기존 discover 테스트에 onDebug 스파이 1케이스씩 (깨진 픽스처 입력 시 이벤트 발생).

## 3. Phase B — e2e (디버그 로거·아티팩트·빌드·에이전트·teardown)

### B-1. `packages/e2e/src/debug.ts` (신규)
- `isDebug(opt?: boolean): boolean` — `opt ?? process.env.KARAX_DEBUG === "1"`.
- `debugLog(enabled: boolean, tag: string, msg: string): void` — enabled일 때만 `process.stderr.write("[karax/debug] [" + tag + "] ...")`, 출력 직전 `redactSecrets` + 제어문자 strip.
- `createDebugArtifacts(debugDir: string | undefined)` → `{ write(name, content, maxBytes?), writeJson(name, obj) }` — debugDir undefined면 전부 no-op. 기록 직전 redactSecrets, 기본 상한(빌드 5MB, 기타 2MB) 초과 시 앞부분 보존+절단 표시. 기록 실패는 삼키되 debugLog로 사유.
- **테스트 먼저**: `__tests__/debug.test.ts` — no-op(off)/redact/상한 절단/stderr 전용.

### B-2. `packages/e2e/src/types.ts` + `session.ts`
- `RunE2eTestOptions.debug?: boolean` 추가 (RunE2eSuiteOptions는 상속 자동).
- session: debug일 때만 `sessionDir/debug/` mkdir, `SessionInfo.debugDir?: string`.

### B-3. `packages/e2e/src/index.ts`
- `const debug = isDebug(opts.debug)` 1회 해석 → 하위 전파.
- 세션 시작 시 `manifest.json` 기록 (karax version, node version, platform, 옵션 스냅샷 — apiKey 제외, 타임스탬프).
- teardown `.catch(()=>{})` (recorder.stop/deviceManager.shutdown): debug 시 사유를 debugLog + `teardown.log` 기록. **off 시 기존 침묵 유지** (동작 불변).
- makeErrorResult 경로: debug 시 `debug/error.json`에 stack/code/details(redact) 기록. **report.json 스키마 불변**.
- crash 감지 입력 logcat 원문이 메모리에 있으면 `debug/logcat-raw.txt` 보존 (redact).

### B-4. `packages/e2e/src/build/*.ts` (flutter/androidNative/reactNative/iosNative)
- **핵심 주의**: execa는 non-zero exit 시 throw — 실패 빌드의 stdout/stderr/exitCode는 **catch한 ExecaError에서 추출**해야 함 (`error.stdout`/`error.stderr`). 성공·실패 양쪽 모두 debug 시 `debug/build-<platform>.log`로 풀로그 보존.
- **보안 수정(디버그 무관 상시)**: `BUILD_FAILED` 메시지의 `${result.stderr}` raw 보간을 `redactSecrets`로 감싼다 — 현재 시크릿이 report까지 영속화되는 실존 결함 차단.
- AppBuilder.build 시그니처에 옵셔널 ctx(`{ debug?: boolean; artifacts?: ... }`) 추가 (기존 호출 무영향).
- **테스트**: BUILD_FAILED 메시지 redact 회귀 + ExecaError 경로에서 buildLog 보존 + off 시 미보존.

### B-5. `packages/e2e/src/agent/runner.ts`
- debug 시: invocation을 `redactInvocation` 거쳐 `debug/agent/invocation.json`, 정상·실패 실행의 raw stdout/stderr를 redact 후 `debug/agent/raw-stdout.txt`·`raw-stderr.txt` 보존 (현재 정상 출력은 전부 버려짐 — "agent가 result.json 없이 죽음" 시나리오의 유일한 단서).
- 실패 경로 기존 sanitizeStderr→details 동작 불변.
- **테스트**: 기존 runner 테스트 보강 — debug on/off 아티팩트 유무, invocation.json에 API키 값 부재.

## 4. Phase C — cli / mcp / renderer / compile-*

### C-1. `packages/cli/src/debug.ts` (신규)
- `resolveDebug(flagValue: boolean | undefined, env: NodeJS.ProcessEnv): boolean` — 명시 플래그 > `KARAX_DEBUG===\"1\"` > false.
- `printError(e: unknown, debug: boolean): void` — off: 기존 `console.error("오류:", message)` 동일. on: 추가로 E2eError면 `code`/`details`, Error면 `stack`을 stderr로 (redactSecrets + stripControls 통과).
- **테스트 먼저**: `__tests__/debug.test.ts` — resolveDebug 우선순위, printError off가 기존 포맷과 byte-identical, on 시 stack/code 포함, redact 적용.

### C-2. `packages/cli/src/commands.ts` + `bin.ts`
- commands.ts: 각 parse* 함수(detect/doctor/list/capture/map/test)에 `--debug` 옵션과 반환 객체 `debug: boolean` 필드 추가. ui는 parseUiArgs에 추가.
- bin.ts: 각 .command에 `--debug` 옵션 등록, **catch 블록 10곳 전부** (L111/157/215/352/439/472/487/666/733/754) `printError(e, debug)`로 교체. ui catch(L733)는 stdout JSON 계약 유지 + debug 시 stderr로만 stack 추가.
- commonOpts(test 커맨드)에 `debug` 추가, captureScreen/captureAll/generateAppMap/listScreens 호출에 `debug` + stderr 출력하는 onDebug 콜백(`[karax/debug]` 라인) 주입.
- 전역 `process.on("unhandledRejection")`/`("uncaughtException")` 핸들러 설치 (bin.ts 진입점 한정): 평소 1줄 요약, debug 시 full stack — 둘 다 stderr, 그 후 exit 1.
- WASM self-respawn 블록: `formatRespawnCrash(result)` 결과가 non-null이면 stderr로 보고 (stdio는 `inherit` 유지 — pipe 캡처는 TTY/스트리밍 동작 변경 위험으로 제외). env는 `...process.env`로 KARAX_DEBUG 자동 전파 — 추가 작업 불필요(확인만).
- **테스트**: commands.test.ts에 parse* debug 필드. e2e.test.ts(dist/bin.js execFile)에 ① `--debug` 시 stderr에 stack 출력 ② `capture --json --debug` stdout이 순수 JSON(JSON.parse 성공) ③ `KARAX_DEBUG=1` env로도 동작 ④ ui `--debug` stdout JSON 한 덩어리 불변.

### C-3. `packages/mcp/src/bin.ts` + `server.ts`
- bin.ts: 전역 unhandled 핸들러 + respawn `formatRespawnCrash` 보고 (stderr 전용).
- server.ts: `KARAX_DEBUG=1`일 때 wrapError/handleWasmError가 stack·code·details를 **stderr로** 추가 기록 (errorContent의 message는 기존 그대로 — JSON-RPC 채널 불변). runE2eTest commonOpts에 debug 전파.
- **테스트**: 기존 index.test.ts 보강 — KARAX_DEBUG 시 errorContent 형태 불변(stdout 계약).

### C-4. `packages/renderer/src/capture/capture.ts`
- `RenderOptions.debug?: boolean` 추가. renderScreenshot에서 debug 시 page console 메시지 수집, 실패(setContent/screenshot throw) 시 `outDir/debug/render-<screen>.html`(page.content())과 콘솔 로그 덤프 후 rethrow. headless 유지, browser.close() finally 불변.
- **테스트**: 순수 함수 단위 테스트 가능한 부분(덤프 파일명 생성 등) + 기존 golden 무영향 확인.

### C-5. compile-* keepWorkDir 연동
- sdk captureScreen에서 `debug: true`면 compile backend 옵션 `keepWorkDir: true` 매핑 + 보존 경로를 onDebug로 안내.
- **compile-react-native**: 실패 시 강제 삭제 경로(index.ts L63-69, L109-116)를 debug면 보존하도록 분기.
- **테스트**: RN 강제 삭제 분기 — debug 시 디렉토리 잔존.

## 5. 검증 게이트

각 Phase 종료마다:
```bash
pnpm -r build && pnpm -r typecheck && pnpm -r test
```
전부 통과해야 다음 Phase 진행. 최종적으로 dist/bin.js E2E 테스트가 와이어링 종단 검증.

## 6. 범위 제외 (의도적)

- 로그레벨 시스템(--verbose/trace), 구조화 JSON 로깅 — boolean으로 충분 (심사 합의)
- report.json 스키마 변경 — debug 아티팩트는 별도 파일로 격리
- 기존 빈 catch의 제어흐름 변경(throw 전환) — 관측만 추가
- 기존 `[karax/e2e]` 포맷 마이그레이션 — 회귀 위험
- respawn 자식 stdio pipe 캡처 — TTY/스트리밍 동작 변경 위험
- enrich-llm 추가 계측 — 이미 ENRICH_REJECTED diagnostic으로 구조화됨
- 원격 텔레메트리 — 보안/프라이버시 범위 확대
