# 프로그램 지도(App Map) 생성 기능 구현 계획

> ⚠️ 구현 시작 시 이 계획을 `./plans/make-map_plan.md`로 복사할 것 (프로젝트 CLAUDE.md 규칙).
> ⚠️ 모든 작업은 워크트리 `/Users/jeonhaedong/Desktop/worktrees/karax/make-map`에서만 수행. 원본 프로젝트 디렉토리 절대 금지.
> 작업 흐름: [developer] 에이전트가 TDD로 구현 → 3종 검수 병렬 실행 → 위험도 높음/중간 수정 → /pr_to_develop.

## Context

karax는 정적 분석으로 화면 **발견**과 **캡처**는 갖췄지만, 화면 간 **이동 관계**(어떤 버튼 → 어떤 화면)는 추출하지 않는다. 진입점부터 시작하는 네비게이션 그래프 = "프로그램 지도"를 마크다운 문서(`{앱 이름}_map_{숫자}.md`, 길면 분할)로 생성하는 기능을 추가한다. 4개 프레임워크 지원, 기존 제약(zero-config, 원본 무수정, LLM 없이 결정론적, 한계는 confidence/diagnostics로 노출) 유지.

**기존 자산 (탐색으로 확인됨):**
- 각 어댑터에 `discover/routeGraph.ts` — 진입점 탐지 + 라우트 선언 파싱 완비. Flutter는 `scanNavigatorPush`/`extractFromMaterialPageRoute`, RN은 `scanNavigateCall`, iOS는 NavigationLink BFS, Android는 NavHost composable 파싱 보유.
- 각 어댑터에 SymbolTable + AST 유틸(`findNodes`, `getNamedArg` 등).
- Android `parse/resources.ts` — `R.string.*` 해석 (버튼 라벨·app_name 재사용 가능).
- 없는 것: 네비게이션 엣지 자료구조, 버튼 핸들러→네비 호출 연결, 앱 이름 추출, 마크다운 생성기.

## 핵심 설계 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 자료구조 위치 | `@sfc/core`의 `src/appmap/schema.ts` (zod) | 의존 방향 core ← adapter-api ← adapters ← sdk. IRDocument와 동일 패턴 |
| 어댑터 확장 | `FrameworkAdapter`에 **optional** `discoverNavigation?(ctx)` + `readAppName?(ctx)` | 점진 구현 가능, 미구현 시 SDK가 빈 그래프 + `NAV_UNSUPPORTED` diagnostic |
| 트리거 추출 | 어댑터별 `discover/navGraph.ts` 신규 (routeGraph 헬퍼 재사용) | routeGraph는 무수정 유지, 헬퍼만 export로 승격 |
| 마크다운 생성 | `core/src/appmap/markdown.ts` 순수 함수 (AppMap → 문서 배열) | 결정론·무 I/O. 파일 쓰기는 SDK 담당 |
| screenId 규약 | 기존 `ScreenSummary.id`와 동일 (클래스/컴포저블/컴포넌트명) | RN은 라우트명("Home")≠컴포넌트명("HomeScreen") — `to`=컴포넌트명, `toRouteName`=라우트명 |

## 1. 자료구조 — `packages/core/src/appmap/schema.ts` (신규)

```ts
TriggerInfo  = { kind: "button"|"navlink"|"tap"|"back"|"system", label?, sourceRef? }
NavigationEdge = { from, to: string|null, toRouteName?, action: "push"|"replace"|"pop"|"navigate"|"present"|"unknown",
                   trigger: TriggerInfo, confidence, diagnostics[] }
MapElement   = { type: NodeType, label?, sourceRef? }          // IR에서 추린 상호작용 요소
ScreenNode   = { id, title?, discovery, isEntry, confidence, sourceRef?, elements[], outgoing: NavigationEdge[] }
AppMap       = { schemaVersion: "appmap/1", appName, framework, entryScreenId: string|null,
                 screens: ScreenNode[], edges: NavigationEdge[], diagnostics[], overallConfidence }
NavigationGraph = { entryScreenId, edges, diagnostics }        // 어댑터 반환용 중간 타입
```
`core/src/index.ts`에 export 추가.

## 2. adapter-api — `packages/adapter-api/src/types.ts` (수정)

```ts
discoverNavigation?(ctx: AdapterContext): Promise<NavigationGraph>;
readAppName?(ctx: AdapterContext): Promise<string | undefined>;
```
`index.ts`에 `NavigationGraph` re-export.

## 3. 어댑터별 navGraph (각 `src/discover/navGraph.ts` 신규 + `src/index.ts` 메서드 구현)

공통 골격: SymbolTable + routeGraph 결과 재사용 → 화면별 본문 AST에서 핸들러 → 네비 호출 → 엣지. 해석 성공 conf 1.0 / 휴리스틱 0.6 / 미해석 0.3 + `DYNAMIC_NAV`/`UNRESOLVED_NAV` diagnostic, `to=null`.

- **Flutter**: `onPressed`/`onTap` 클로저 내 `Navigator.push(MaterialPageRoute(...))`→클래스, `pushNamed('/x')`→routes 테이블 역참조(이를 위해 `parseRoutesMap`을 `{route, className}` 반환으로 확장), `pop`→back 엣지. 라벨=버튼 child Text 리터럴. routeGraph의 `extractFromMaterialPageRoute`/`getNamedArg` export 승격.
- **RN**: `onPress` arrow 내 `navigation.navigate('List')`→routeMap으로 컴포넌트 해석, `push`/`goBack`. 라벨=Touchable 자식 `<Text>` 또는 Button title.
- **Android Compose** (가장 복잡 — 2단계 간접 추적):
  1. NavHost의 `composable(route){ Screen(onX = { navController.navigate(AppRoutes.Y) }) }`에서 콜백 주입 맵 구축. `object AppRoutes` 상수 해석기(`buildRouteConstMap`) 필요.
  2. 화면 함수 본문의 `Button(onClick = onX)`에서 파라미터명 매칭 → 목적지 확정. 라벨=`stringResource(R.string.*)`를 기존 `parse/resources.ts`로 해석 또는 리터럴.
  - 3단계 이상 전달은 추적 포기 (conf 0.3 + diagnostic).
- **iOS SwiftUI**: `NavigationLink(destination: X())` + 라벨 content의 Text. Button action 내 path 조작/dismiss는 동적 처리.

## 4. 앱 이름 추출 (각 어댑터 `readAppName`)

Flutter=`pubspec.yaml name`(기존 readPackageName 재사용), RN=`app.json displayName`→`package.json name`, Android=`strings.xml app_name`(resources.ts 재사용)→manifest package, iOS=`Package.swift name`→`@main` 구조체명. 전부 실패 시 SDK가 `basename(projectPath)` fallback. `sanitizeAppName`(경로 위험 문자 제거, 공백→`_`)은 core에.

## 5. 마크다운 생성기 — `core/src/appmap/markdown.ts`

`renderAppMapMarkdown(appMap, {maxChars=12000}): Array<{fileName, content}>`

- **`{앱}_map_1.md` (인덱스)**: 앱 이름·프레임워크·진입점·화면/엣지 수·전체 신뢰도 → Mermaid `flowchart TD` (엣지 라벨=버튼 라벨, pop은 점선 `-.->`, 미해석은 `"❓"`) → 화면 목록 테이블(상세 링크) → 한계/진단 섹션.
- **화면별 상세 섹션**: 정의 위치, 요소 테이블(IR 기반 Button/Input/List/Image + 라벨), 이동 테이블(트리거→동작→목적지 링크→신뢰도).
- **분할 규칙**: 상세는 `_map_1.md`에 이어 붙이되 누적 길이 > maxChars면 `_map_2.md`... 화면 단위로만 분할. 인덱스 링크는 `{앱}_map_2.md#anchor` 형태. 비인덱스 문서 첫 줄에 `> [목차로 돌아가기]({앱}_map_1.md)`.

`core/src/appmap/assemble.ts`: nav 엣지→ScreenNode.outgoing 분배, IR BFS로 elements 수집, overallConfidence 계산 (순수 함수, core에 둠).

## 6. SDK / CLI / MCP

- **SDK** (`packages/sdk/src/index.ts`): `generateAppMap(opts: AnalyzeOptions & { outDir, maxCharsPerDoc?, write? }) → { appMap, documents, writtenPaths }`. discoverScreens + discoverNavigation(없으면 NAV_UNSUPPORTED fallback) + buildScreenIR(요소 추출) + assemble + render + writeDocs. 렌더러 불필요하므로 `ensureDependencies()` 호출 안 함.
- **CLI** (`commands.ts`+`bin.ts`): `sfc map <path> [--out <dir>] [--framework <id>] [--max-chars <n>] [--stdout] [--json]`. `--out` 기본 `process.cwd()`(분석 대상 프로젝트 내부가 아님 — 원본 무수정). `parseMapArgs`를 commands.ts에 분리(기존 패턴).
- **MCP** (`server.ts`): 8번째 tool `generate_app_map` { projectPath, framework?, outDir?, maxCharsPerDoc?, write? } → 요약 JSON + 문서 본문 text content.

## 7. TDD 순서 (각 단계: 테스트 먼저 → 구현 → 해당 패키지 build)

> workspace:* 의존 — 하위 패키지 변경 후 반드시 build해야 상위에서 보임.

1. **core 스키마**: `core/src/__tests__/appmap.schema.test.ts` → `appmap/schema.ts` → export → build
2. **core assemble+markdown**: `appmap.assemble.test.ts`, `appmap.markdown.test.ts` (분할 케이스·Mermaid·상호링크·sanitize·빈 그래프) → 구현 → build
3. **adapter-api**: optional 메서드 추가 → build
4. **Flutter navGraph**: `navGraph.test.ts` (픽스처 기대 엣지: Home→Detail push "Explore Products"·pushNamed 해석·pop·진입점) + readAppName → 구현 → build
5. **RN navGraph**: navigate→컴포넌트 해석·toRouteName·goBack·라벨 → 구현 → build
6. **Android navGraph**: 2단계 간접 추적·AppRoutes 상수·R.string 라벨·Orphan 무엣지 → 구현 → build
7. **iOS navGraph**: NavigationLink→push·라벨 → 구현 → build
8. **SDK**: `generateAppMap.test.ts` (4 픽스처: 구조·파일 생성·write:false·NAV_UNSUPPORTED fallback) → 구현 → build
9. **CLI**: `commands.test.ts`에 parseMapArgs 케이스 → 구현 → build
10. **MCP**: generate_app_map tool 테스트 → 구현 → build
11. 전체 회귀: `pnpm -r build && pnpm -r test && pnpm -r typecheck`

## 8. 파일 목록

**신규**: `core/src/appmap/{schema,assemble,markdown}.ts` + core 테스트 3개, 각 어댑터 `src/discover/navGraph.ts` + `__tests__/navGraph.test.ts` (×4), `sdk/src/__tests__/generateAppMap.test.ts`

**수정**: `core/src/index.ts`, `adapter-api/src/{types,index}.ts`, 각 어댑터 `src/index.ts` + `routeGraph.ts`(헬퍼 export 승격, Flutter `parseRoutesMap` 반환 확장), `sdk/src/index.ts`, `cli/src/{commands,bin}.ts`, `mcp/src/server.ts`

## 검증

1. `pnpm -r build && pnpm -r test && pnpm -r typecheck` 전체 통과
2. CLI 수동 검증 (4개 픽스처):
   ```bash
   node packages/cli/dist/bin.js map fixtures/flutter-basic --out /tmp/karax-map
   ```
   → `/tmp/karax-map/flutter_basic_fixture_map_1.md` 생성 확인: 진입점 HomeScreen, Home→Detail/List/Settings 엣지, 버튼 라벨, Orphan은 엣지 없는 candidate로 표시, Mermaid 문법 유효
3. 분할 검증: `--max-chars 1500`으로 실행 → `_map_2.md` 이상 생성 + 상호 링크 정상
4. 기존 기능 회귀 없음 확인 (discoverScreens/captureScreen 테스트 통과 — routeGraph 헬퍼 export 승격이 동작 변경 없는지)
