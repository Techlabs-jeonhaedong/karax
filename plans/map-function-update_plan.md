# AppMap 매핑 기능 개선 — 실전 Flutter(GetX) 네비게이션 엣지 추출

> 실행 시작 시 이 계획을 `plans/map-function-update_plan.md`에도 복사할 것 (프로젝트 Plan 모드 규칙).
> 작업 디렉토리: `/Users/jeonhaedong/Desktop/worktrees/karax/map-function-update` (워크트리 — 원본 프로젝트에서 작업 금지)

## Context

`generate_app_map`이 실제 Flutter 앱에서 **화면 목록만 반환**하고 화면 간 이동(엣지) 정보가 비어 나온다. 엣지 추출 코드(eb7d1aa)는 존재하지만 패턴 커버리지가 픽스처 수준:

- 라우트 테이블: `main.dart`의 `MaterialApp routes:{}` **리터럴**만 파싱
- 네비 호출: `onPressed/onTap` **인라인 클로저** 안의 `Navigator.push/pushNamed/pop`만 인식
- 검증 대상 실프로젝트 `/Users/jeonhaedong/Desktop/youandi_front`(GetX 앱, pubspec name=loveting)는:
  - 라우트가 별도 파일 `lib/presentation/route/u_n_i_route.dart`의 `static final routes = [GetPage(name: UnIPath.X, page: () => XScreen())]`
  - 라우트 이름이 상수 참조(`UnIPath.SPLASH` → `lib/presentation/route/u_n_i_path.dart`의 `static const String`) — **상수 해석 필요**
  - 호출이 `Get.toNamed`(250) / `Get.offAll`(38) / `Get.to(()=>X())`(23) / `Get.off`(5), `Navigator.*` 0건
  - 호출 위치가 화면 위젯 외에 controller/util/manager 파일에 분산, 핸들러도 분리 메서드 다수

→ **엣지 0개 = "화면 목록만 나온다"**. 목표: 보고서에 "어떤 화면 → 어떤 화면, 어떤 위치(file:line + 렌더 좌표)의 어떤 요소를 누르면 이동"이 나오게 한다. Flutter 우선, 설계는 타 어댑터 전파 가능 구조로.

## 구현 (TDD: 각 단계 테스트 먼저 → 구현)

### 단계 0 — 스키마 확장 (선행 필수, zod `.strict()`라 필드 선등록 필요)
`packages/core/src/appmap/schema.ts`의 `NavigationEdgeSchema`에 **optional** 필드 추가 (하위호환, appmap/1 유지):
- `fromKind?: "screen" | "controller" | "global"` — from 특정 방식
- `fromRef?: { file, line?, symbol? }` — 실제 호출 위치
테스트: 기존 파싱 그린 유지 + 신규 필드 round-trip (`appmap.schema.test.ts`).

### 단계 1 — ConstResolver (정적 문자열 상수 해석기)
- 신규 `packages/adapter-flutter/src/parse/constResolver.ts`
- `SymbolTable`(scanner.ts)에 `stringConstants: Map<"ClassName.MEMBER", string>` 추가 — 전 클래스의 `static const/final String X = "..."` 수집
- `resolveStringExpr(node, table)`: string_literal → 그대로 / `UnIPath.SPLASH` 형태 → 맵 룩업 / 미해석 → undefined
- 테스트: 인라인 소스 단위 테스트 (`constResolver.test.ts`)

### 단계 2 — GetX 라우트 파서 (화면 발견 + 라우트맵)
- 신규 `packages/adapter-flutter/src/discover/getx.ts` + `routeGraph.ts` 통합
- `GetMaterialApp(getPages: X.routes, initialRoute: 상수)` → 참조된 `static final routes = [GetPage(...)]` 리스트를 SymbolTable에서 찾아 파싱
- `GetPage(name: 상수, page: () => X())` — name은 ConstResolver, page는 기존 `extractWidgetClassFromBuilder` 재사용 (arrow/block 지원 확인됨)
- `discoverScreens`(index.ts:93, route.className 기반)는 routeGraph 경유라 대부분 자동 반영
- entryScreenId = initialRoute 해석 → 라우트맵 역참조

### 단계 3 — 표준 Navigator 확장
`navGraph.ts`: `pushReplacement(Named)`, `pushAndRemoveUntil`, `popAndPushNamed`, `maybePop`, `Navigator.of(context).push` 체인 인식. action 매핑(replace/pop). 테스트 케이스를 `navGraph.test.ts`에 먼저 추가.

### 단계 4 — GetX 호출 스캔
`Get.toNamed/offNamed/offAllNamed`(상수 → ConstResolver → 라우트맵), `Get.to/off/offAll(()=>X())`(빌더 → 클래스), `Get.back`(pop). 기존 Navigator selector 체인 파싱 패턴 재사용. action: to/toNamed=push, off*=replace, back=pop.

### 단계 5 — HandlerResolver (핸들러 간접 참조 추적)
- 신규 `packages/adapter-flutter/src/parse/handlerResolver.ts`
- `onPressed: _onTap`(같은 클래스 메서드), `onTap: () => controller.goX()`, 컨트롤러 메서드 본문 내 호출 추적
- 깊이 제한 2단계 + visited set (결정론·종료 보장). `a.b` 수신자 타입 미해석 시 전역 동명 메서드가 **유일할 때만** 채택(파일경로 사전순, confidence 하향 + diagnostic)
- scanner에 `methodsByClass` 인덱스 추가로 O(1) 룩업

### 단계 6 — from-화면 특정 전략
호출 위치 기준 폴백 체인 (엣지를 절대 버리지 않음):
1. 호출을 감싸는 **가장 가까운 위젯 클래스**(AST 조상 탐색 — 같은 파일 다중 화면 오귀속 방지) → confidence 1.0, fromKind=screen
2. 컨트롤러/매니저 클래스 → (a) 같은 feature 디렉토리 화면 1개면 채택 (b) `XController`↔`XScreen` 네이밍 매칭 (c) `GetView<T>/GetBuilder<T>` 역색인. → confidence 0.6, fromKind=controller
3. 특정 불가(util/전역) → 합성 from id `"(global)"`, fromKind=global, confidence 0.4
모든 엣지에 `fromRef`(실제 호출 file:line) 기록.

### 단계 7 — assemble / markdown 보고서 개선
- `assemble.ts`: `(global)` 등 화면 미매칭 엣지를 "전역 이동" 버킷으로 보존 (top-level edges에는 이미 보존됨 — 확인 완료)
- `markdown.ts`:
  - 이동 경로 테이블에 **호출 위치(fromRef file:line)** 컬럼 추가
  - `to=null`이어도 `toRouteName` 있으면 `↗ /route (미해석)` 표시
  - "전역/공통 이동" 섹션 신설, Mermaid에 `(global)` 노드 구분
- 기존 트리거 위치/크기/스타일 표기(`@(x,y) W×H [배경…]`)는 유지 — bounds는 measureScreenLayouts가 주입

### 단계 8 — flutter-getx 픽스처 + 통합 테스트
- 신규 `fixtures/flutter-getx/` 미니 GetX 앱: path 상수 클래스 / route 파일 / main(GetMaterialApp) / 화면 2~3 / 컨트롤러 1 / util 1 (Get.toNamed 포함)
- 풀 파이프(discover→nav→assemble→markdown) 회귀 테스트. `fixtures/flutter-basic`은 무수정 (기존 그린 유지)
- 단위 테스트는 인라인 소스, 통합은 픽스처 — 기존 navGraph.test.ts 스타일과 일관

### 단계 9 (2차, 후순위) — go_router 호출측
`context.go/push(상수)` 스캔. 이번 PR 범위 밖, TODO로만 표기.

## 핵심 제약
- 분석 대상(youandi_front) **읽기 전용** — 원본 무수정 원칙
- 코어 결정론적 (LLM 없음, 동명 후보 다수 시 사전순 첫째)
- 스키마는 optional 추가만 → RN/Android/iOS 어댑터·renderer 무변경 통과
- 동적 인자(`Get.toNamed(변수)`)·문자열 보간 라우트는 `to=null` + `UNRESOLVED_NAV` diagnostic으로 정직하게 노출
- 조건 분기(`if (x) Get.toNamed(A) else B`)는 양쪽 다 엣지 (over-approximation 허용)

## 검증

1. **단위/통합**: `pnpm --filter @karax/adapter-flutter test`, `pnpm --filter @karax/core test`, 이후 `pnpm -r build && pnpm -r test && pnpm -r typecheck` (workspace dist 의존 주의 — core 먼저 build)
2. **E2E (youandi_front, 읽기 전용)**:
   ```bash
   node packages/cli/dist/bin.js map /Users/jeonhaedong/Desktop/youandi_front --json --no-layout
   ```
   판정 기준:
   - 라우트 기반 화면 발견 ≥ UnIPath 상수 수의 80%
   - `UnIPath.*` 상수 해석률 ≥ 95%
   - 엣지 총수 ≥ 150 (보수적 합격선; 호출 ~316건 기준)
   - `to != null`(목적지 해석) 비율 ≥ 70%
   - entryScreenId = SplashScreen
   - 엣지 손실 0 (미해석도 diagnostic과 함께 보존)
3. **회귀**: flutter-basic 기존 테스트 전부 그린
4. **레이아웃 검증(선택)**: `--no-layout` 없이 실행해 trigger.bounds 좌표 주입 확인

## 작업 흐름 (글로벌 CLAUDE.md 규칙)
1. developer 에이전트가 단계 0→8 순서로 TDD 구현
2. git diff 요약 보고
3. `code-review-side-effects` + `security-auditor` + `intent-drift-checker` 3종 **병렬** 검수 → 위험도 높음/중간 항목은 developer로 수정
4. `/pr_to_develop` 실행
