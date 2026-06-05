# App Map 상세 매핑 고도화 계획 (mapping-advance)

## Context

현재 App Map(`generate_app_map` / CLI `map`)은 "어떤 화면 → 어떤 화면" 수준의 네비게이션 그래프만 제공한다. 사용자는 더 자세한 지도를 원한다:

1. **어떤 요소**를 눌러 이동하는지 (트리거 요소 식별)
2. 그 요소의 **위치/크기** (좌표)
3. 요소의 **생김새** (배경색, 모서리 등 스타일)
4. 요소의 **텍스트**

### 탐색으로 확인된 현재 상태
- `TriggerInfo { kind, label?, sourceRef? }` — 4개 어댑터 모두 **trigger.sourceRef를 채우지 않음**. 트리거 위젯의 위치 정보 부재.
- IR 노드(`packages/core/src/ir/schema.ts`)에는 style/layout/text/sourceRef(file+line)가 이미 있음 — **좌표만 없음** (정적 분석 한계).
- renderer에 `irToHtmlWithIdx()`(DOM에 `data-karax-idx` 부여) + `collectNodeInfoWithIdx()`(동일 순회 순서로 idx↔IR노드 매핑) + `page.evaluate()` 인프라가 이미 있음 → **getBoundingClientRect 기반 좌표 추출 가능**.
- `assemble.ts`에 트리거↔IR요소 매칭 로직 없음. `collectElements`는 BFS(렌더 순회는 DFS — **idx 직접 매칭 금지**).
- 4개 어댑터 IR sourceRef 좌표계 동일: `{ file: 프로젝트 상대경로, line: 1-based }`.

## 설계 결정

| 결정 | 선택 | 이유 |
|---|---|---|
| 트리거 위젯 위치 | `TriggerInfo.elementRef` **신규 필드** (기존 sourceRef 의미 변경 X) | 현재 sourceRef는 미사용이지만 핸들러 위치 의미로 예약, 충돌 방지 |
| bounds 병합 위치 | **SDK**(`generateAppMap`)에서 후처리. core는 순수 유지 | core→renderer 의존 금지. sdk는 이미 renderer 의존 |
| bounds↔요소 매칭 키 | **sourceRef(file+line)** 기반 (idx 직접 매칭 금지) | assemble BFS vs 렌더 DFS 순서 불일치를 회피 |
| 스키마 버전 | `appmap/1` 유지 | optional 필드만 추가 → 하위호환 |
| 좌표 수집 기본값 | **기본 ON** + CLI `--no-layout` / SDK·MCP `includeLayout`(기본 true). Chromium 실패 시 diagnostics 남기고 좌표만 생략 (graceful degradation) | 상세 지도가 목적. zero-config 유지 |
| 좌표의 의미 | Tier 2 정적 렌더 기반 **근사 좌표** (CSS px, 디바이스 프로파일 뷰포트 기준) — `LAYOUT_APPROX` diagnostic으로 명시 | 핵심 제약 4(한계를 숨기지 않음) 준수 |

## 구현 단계 (TDD: 각 단계 Red→Green→Refactor)

### 1단계: core 스키마 확장 — `packages/core/src/appmap/schema.ts`
테스트 먼저: `packages/core/src/__tests__/appmap.schema.test.ts`

```ts
// 신규 공유 스키마 (.strict())
BoundsSchema { x, y, width: nonneg, height: nonneg }
ElementStyleSchema { background?, borderRadius?, borderColor?, borderWidth?, textColor?, opacity? }
```
- `MapElementSchema`에 `style?: ElementStyleSchema`, `bounds?: BoundsSchema` 추가 (text는 기존 `label`이 담당 — 신규 필드 X)
- `TriggerInfoSchema`에 추가:
  - `elementRef?: { file, line? }` — 트리거 위젯 자체 위치 (어댑터가 기록)
  - `style?: ElementStyleSchema` — 매칭된 요소 외형 (assemble이 주입)
  - `bounds?: BoundsSchema` — 매칭된 요소 좌표 (SDK가 주입)
- 기존 데이터(필드 없는 JSON)가 그대로 파싱되는 하위호환 테스트 포함

### 2단계: core assemble — style 추출 + 트리거↔요소 매칭 — `packages/core/src/appmap/assemble.ts`
테스트 먼저: `appmap.assemble.test.ts`

- `extractElementStyle(node)`: IR `style.background/borderRadius/border.{color,width}/opacity` + `text.color` → `ElementStyle` (빈 객체면 undefined)
- `collectElements`에서 각 MapElement에 `style` 첨부
- `matchElement(trigger, elements)`: ① `elementRef.file === element.sourceRef.file && |line 차| <= 2` 중 최근접 → ② fallback: `trigger.label === element.label` → ③ 실패 시 undefined
- `assembleAppMap`에서 화면별 outgoing edge의 trigger에 매칭 요소의 `style` 주입. 매칭 실패 시 edge.diagnostics에 `TRIGGER_UNMATCHED` 추가
- **순수 함수 유지** (bounds는 여기서 다루지 않음)

### 3단계: 어댑터 4종 — 트리거 위젯 `elementRef` 기록
각 어댑터 navGraph 테스트 먼저 (fixtures 기반: trigger.elementRef.file/line이 fixture의 버튼 위치와 일치하는지)

공통: `elementRef = { file: parsedFile.filePath(상대경로), line: 1-based }` — IR sourceRef와 동일 좌표계.

- **Flutter** `packages/adapter-flutter/src/discover/navGraph.ts`: `scanNavCalls`에서 onPressed/onTap named_argument 노드의 `startPosition.row + 1`을 트리거 라인으로 기록 (AST 보유). pop(back) 트리거에도 기록
- **RN** `packages/adapter-react-native/src/discover/navGraph.ts`: `scanOnPressHandlers` 반환에 line 추가 — onPress attr(또는 부모 JSX 요소)의 `startPosition.row + 1`
- **Android** `packages/adapter-android/src/discover/navGraph.ts`: 정규식 기반 — `extractButtonClickLabels`에서 `bMatch.index` → `source.slice(0, idx).split("\n").length`로 라인 계산. `labelByCallback`을 `{label, line, file}`로 확장. ※ Android IR sourceRef가 line=0인 케이스 있음 → label fallback이 흡수
- **iOS** `packages/adapter-ios/src/discover/navGraph.ts`: `extractNavigationLinks`의 `m.index`로 동일하게 라인 계산

### 4단계: renderer — 레이아웃 측정 API — `packages/renderer/src/capture/capture.ts`
테스트 먼저 (기존 renderer 테스트의 Chromium 사용 패턴 따름)

- `collectNodesWithIdx(root): Array<{ idx, node: IRNode }>` 신규 — 기존 `collectNodeInfoWithIdx`와 동일 순회(Branch idx 소비·미수록, CONTAINER_TYPES만 children 순회). `collectNodeInfoWithIdx`는 이를 재사용하도록 리팩토링 (기존 테스트 그린 유지)
- `measureScreenLayouts(irs: IRDocument[], options: { device?: string }): Promise<Map<screenId, MeasuredBounds[]>>` 신규:
  - **브라우저 1회 launch로 전체 화면 측정** (화면당 launch 금지 — 성능)
  - 화면별: `irToHtmlWithIdx` → `page.setContent` → `page.evaluate`에서 `[data-karax-idx]` 전부 `getBoundingClientRect()` 수집
  - idx → `collectNodesWithIdx`로 IR 노드 식별 → `MeasuredBounds = { sourceRef?, nodeType, x, y, width, height }` (CSS px)
  - sourceRef를 동봉해 SDK가 file+line으로 매칭하게 함
- `packages/renderer/src/index.ts`에 export 추가

### 5단계: SDK — bounds 병합 + 옵션 — `packages/sdk/src/appMap.ts`
테스트 먼저: `packages/sdk/src/__tests__/generateAppMap.test.ts`
(a) `includeLayout: false` → bounds 없음·기존 동작 유지, (b) true → element/trigger bounds 채워짐, (c) Chromium 실패 모사 → `LAYOUT_UNAVAILABLE` diagnostic + 좌표만 생략

- `GenerateAppMapOptions`에 `includeLayout?: boolean`(기본 true), `device?: string` 추가
- `assembleAppMap` 호출 후 후처리:
  1. `measureScreenLayouts(irDocs, { device })` (try/catch — 실패 시 `LAYOUT_UNAVAILABLE` diagnostic, 좌표 생략)
  2. 화면별: `MapElement.sourceRef`(file+line)와 일치하는 MeasuredBounds → `element.bounds` 주입
  3. edge.trigger: assemble이 매칭해둔 요소의 bounds(= trigger.elementRef/label로 동일 매칭 로직 재사용) → `trigger.bounds` 주입
  4. layout 수행 시 `LAYOUT_APPROX` diagnostic 1회 추가
  5. 최종 `AppMapSchema.parse()` 재검증 (strict 가드)

### 6단계: markdown 렌더링 — `packages/core/src/appmap/markdown.ts`
테스트 먼저: `appmap.markdown.test.ts`

- UI 요소 테이블: `| 타입 | 라벨 | 위치 | 크기 | 스타일 |` — bounds/style 없으면 `-` (하위호환). 위치 `(x, y)`, 크기 `W×H`, 스타일은 `배경 #xxx · r8` 요약
- 이동 경로 테이블: 트리거 셀에 라벨 + 위치/크기/스타일 요약 추가
- 모든 신규 값 `escapeMarkdownCell` 통과. 분할(maxChars) 로직은 길이 기반이라 변경 불필요

### 7단계: CLI / MCP 옵션
- CLI `packages/cli/src/commands.ts`: `MapArgs.layout: boolean`, `parseMapArgs`에 `--no-layout` 옵션 (commander가 기본 true 처리). `bin.ts` map 액션에서 `generateAppMap({ ..., includeLayout: args.layout })`
- MCP `packages/mcp/src/server.ts`: `generate_app_map` 스키마에 `includeLayout: z.boolean().optional()` 추가, 핸들러 전파. 테스트: `packages/mcp/src/__tests__/index.test.ts`

## 빌드 순서 (workspace 의존 — dist import)
`core` → `adapter-api` → `adapter-{flutter,rn,android,ios}` · `renderer` → `sdk` → `cli` · `mcp`
(단계별로 `pnpm --filter @karax/<pkg> build` 후 다음 패키지 작업)

## 엣지 케이스 / 리스크
1. **BFS vs DFS 순서 불일치** → idx 직접 매칭 금지, sourceRef(file+line) 매칭으로 회피 (핵심 결정)
2. **Branch 노드**: 첫 variant만 렌더 → 미렌더 자식의 MapElement는 bounds 없음 (정상, 생략)
3. **한 줄에 여러 위젯**: 최근접(TOL=2) 1개 + label fallback
4. **Android line=0 sourceRef**: label fallback 의존
5. **IR 빌드 실패 화면**: 기존대로 elements=[], layout 측정 스킵
6. **Chromium 없음**: `LAYOUT_UNAVAILABLE` diagnostic, 정적 정보(트리거 식별·스타일·텍스트)는 정상 제공
7. **좌표 결정론**: 고정 프로파일+headless라 대체로 결정적이나 테스트는 정확값 대신 존재/범위 검증

## 검증 방법
1. `pnpm -r test` — 전체 그린 (특히 appmap.*, navGraph, generateAppMap, mcp 테스트)
2. `pnpm -r typecheck && pnpm -r build`
3. E2E 수동 검증: `node packages/cli/dist/bin.js map fixtures/flutter-basic --out ./out-map` → 마크다운에 트리거 요소의 텍스트/위치/크기/스타일이 표기되는지, `--json`으로 trigger.elementRef/bounds/style 확인. `--no-layout`으로 좌표 생략 동작 확인
4. 4개 fixture(flutter/react-native/android-compose/ios-swiftui) 전부에 대해 3번 반복
5. MCP 툴 `generate_app_map` 호출로 동일 확인

## 작업 절차 (글로벌 규칙)
- 구현은 **[developer] 에이전트**가 TDD로 진행
- 계획 사본을 `./plans/mapping-advance_plan.md`로 저장 (구현 시작 시)
- 완료 후 `code-review-side-effects` / `security-auditor` / `intent-drift-checker` **병렬 검수** → 위험도 높음/중간 항목 developer로 수정
- 검수 통과 후 `/pr_to_develop`
