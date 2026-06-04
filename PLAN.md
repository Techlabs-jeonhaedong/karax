# PLAN.md — 소스코드 기반 앱 스크린샷 추출 도구

> **이 문서는 자기완결적 계획서다.** 새 세션에서 이 문서만 읽어도 구현을 이어갈 수 있도록 작성됐다.
> 마지막 갱신: 2026-06-04 / 상태: M0~M3 완료, M4 미착수

---

## 1. 제품 정의

**소스코드를 분석해서, 앱을 직접 빌드하지 않고도 화면 스크린샷을 추출하는 프로그램.**

- **대상**: iOS Native(SwiftUI/UIKit), Android Native(Compose/XML), Flutter, React Native 앱의 소스코드
- **제공 방식**: SDK(라이브러리 API) + MCP 서버 (+ CLI)
- **핵심 제약 1 — zero-config**: 개발자가 앱 소스코드에 아무 조치도 하지 않아도 동작. 프로그램이 스스로 진입점과 임포트 맵을 분석해 화면 목록을 발견하고 전체 화면 스크린샷을 생성한다.
- **핵심 제약 2 — 원본 무수정**: 어떤 경우에도 분석 대상 프로젝트의 소스를 수정하지 않는다 (임시 디렉토리/오버레이에서만 작업).
- **핵심 제약 3 — 의존성 자동 설치**: 설치한 사람이 별도 의존성을 수동으로 깔지 않아도 된다 (Doctor 시스템, 7절).

### 1-1. 2-티어 캡처 전략 (핵심 설계 판단)

**화면 발견(discovery)은 항상 정적 분석**으로 수행하고(빌드 불필요), **캡처(렌더링)는 환경에 따라 2개 티어 중 자동 선택**한다:

| 티어 | 조건 | 방식 | 충실도 |
|---|---|---|---|
| **Tier 1: Partial Compile** (우선) | 해당 프레임워크 툴체인 감지됨 | 발견된 화면 1개만 감싸는 **하니스 코드를 임시 오버레이 디렉토리에 생성** 후 화면 단위 컴파일·렌더 (전체 앱 빌드 아님) | 높음 (실제 렌더러 사용) |
| **Tier 2: Static IR** (fallback) | 툴체인 없음 / 부분 컴파일 실패 | 정적 분석 → UI IR → HTML/CSS → Chromium 캡처 | 구조적 근사 + confidence score |

선택 모드: `captureMode: "auto" | "compile" | "static"` (기본 `auto` — Tier 1 시도 → 화면 단위로 실패 시 Tier 2 fallback).

**프레임워크별 부분 컴파일 백엔드 (Tier 1)**:

| 프레임워크 | 방식 | 에뮬레이터/디바이스 |
|---|---|---|
| Flutter | 화면 위젯을 pumpWidget하는 위젯 테스트 하니스 생성 → `flutter test` + `matchesGoldenFile` 골든 캡처 | 불필요 |
| React Native | 화면 컴포넌트만 esbuild 번들 + `react-native` → `react-native-web` alias → Chromium 렌더. 네이티브 모듈 자동 mock | 불필요 (Metro도 불필요) |
| Android Compose | 임시 하니스 Gradle 모듈 + **Paparazzi** (JVM 레이아웃 렌더) 스냅샷 | 불필요 |
| iOS SwiftUI | 하니스 XCTest 타깃 + 시뮬레이터에서 `ImageRenderer`/snapshot 캡처 | 시뮬레이터 필요 (macOS+Xcode 한정) |

### 1-2. 정직한 경계

- Tier 2는 픽셀 퍼펙트가 아닌 **구조적 근사**다. 런타임 값(폰트 메트릭, 비동기 데이터, 조건 분기 결과)은 정적으로 확정 불가.
- 잘 됨: 화면 인벤토리, 정적 레이아웃 골격, 정적 텍스트, 명시적 색/spacing, 표준 컴포넌트
- 근사: 커스텀 컴포넌트 다수 화면, 테마 토큰 간접 참조, 리스트/그리드
- 약함: 런타임 API 데이터 의존 화면(mock 근사), 차트/지도/Canvas, 애니메이션 상태, 복잡한 DI 그래프, 코드생성(build_runner/R.java) 의존 UI
- 이 경계는 **confidence score + diagnostics**로 수치화해 노출한다 (12절).

---

## 2. 아키텍처 (파이프라인)

```
projectPath
  │
  ▼
[1] Project Detector ──── 프레임워크 후보 + confidence
  │
  ▼
[2] Doctor ───────────── 환경 감지 (프레임워크별 가용 티어 판정, 누락 의존성 자동 설치)
  │
  ▼
[3] Framework Adapter ── 화면 발견 (정적 분석, 항상 수행)
  │     ├─ Route-graph 발견 (높은 신뢰도): 진입점→네비게이터 라우트
  │     └─ Heuristic 발견 (후보): 화면스러운 최상위 위젯 전수 스캔
  ▼
[4] Capture Engine ───── 화면별 티어 선택
  │     ├─ Tier 1: Compile Backend → 하니스 생성 → 화면 단위 컴파일 → 캡처
  │     └─ Tier 2: 위젯 트리 → UI IR → HTML/CSS → Playwright Chromium → PNG
  ▼
PNG + *.report.json (confidence, tierUsed, diagnostics)
```

- **[1] Project Detector**: 파일 시그니처로 감지 — `pubspec.yaml`(Flutter), `package.json`+react-native deps(RN), `*.xcodeproj`/`Package.swift`(iOS), `AndroidManifest.xml`/`build.gradle`(Android). 단일 답이 아닌 **후보 리스트 + confidence + evidence** 반환 (RN/Flutter 프로젝트는 `ios/`·`android/`를 동시 보유하므로).
- **[3] 진입점→화면 발견 경로**:
  - Flutter: `main.dart` → `runApp` → `MaterialApp` routes / `go_router` / `Navigator.push*`
  - RN: `index.js` → `AppRegistry.registerComponent` → react-navigation 스택/탭 정의
  - SwiftUI: `@main App` → `WindowGroup` → `NavigationStack`/`NavigationLink`; UIKit: Info.plist, Storyboard/XIB
  - Android: `AndroidManifest.xml` Activity → Compose `NavHost` / XML layout
  - Heuristic: `Scaffold`/`setContent`/`*Screen`·`*Page` 접미사 클래스 전수 스캔 → 발견 결과를 `route`(라우트 연결) / `candidate`(연결 불명)로 라벨링
- **[5] Mock Data Provider** (두 티어 공용): 화면 생성자 인자/상태/API 데이터는 변수명·타입 휴리스틱 + **seed 기반 결정론적** placeholder. Tier 1 하니스에는 코드로 주입.
- **[6] LLM 보강 (선택 plugin)**: confidence 낮은 노드만 LLM이 IR을 채움. **코어는 LLM 없이 결정론적으로 동작**해야 함 (테스트 가능성).

---

## 3. UI IR — 공통 중간표현 (Tier 2)

프레임워크 중립 JSON 트리. **노드 타입은 최소화하고 다양성은 role/style/layout 속성으로 흡수** (4개 어댑터가 같은 IR로 수렴하고 렌더러가 단순해짐). 4개 프레임워크 레이아웃 모델이 전부 flex 계열(Row/Column/Expanded, flexbox, HStack/VStack, Row/Column)이라 IR↔CSS 매핑이 자연스러움.

**노드 타입**:
- 레이아웃: `Box`, `Row`, `Column`, `Stack`(z-겹침), `Scroll`, `Grid`, `List`(반복 그룹), `Spacer`
- 콘텐츠: `Text`, `Image`, `Icon`, `Button`, `Input`, `Divider`
- 메타: `Unknown`(해석 실패 placeholder, componentName 보존), `Branch`(조건부 variant 그룹), `Slot`(미해석 children)
- AppBar/TabBar/SafeArea는 별도 타입이 아니라 `Box` + `role` 속성으로 표현

**스키마 뼈대** (zod로 구현):

```jsonc
// IRDocument
{
  "schemaVersion": "0.1",
  "screen": {
    "id": "HomeScreen",
    "sourceRef": { "file": "lib/home.dart", "line": 12, "symbol": "HomeScreen" },
    "device": "iphone-15",
    "discovery": "route | candidate",
    "confidence": 0.85,
    "root": { /* IRNode */ }
  },
  "designTokens": { "colors": {}, "spacing": {}, "typography": {} },
  "diagnostics": [ { "level": "warn", "code": "UNRESOLVED_COMPONENT", "message": "..." } ]
}

// IRNode
{
  "type": "Column",
  "role": "appbar | content | tabbar | null",
  "layout": {
    "direction": "row | column",
    "mainAxis": "start | center | end | spaceBetween | spaceAround",
    "crossAxis": "start | center | end | stretch",
    "flex": 1,
    "width": "fill | wrap | <number>",
    "height": "fill | wrap | <number>",
    "padding": [0, 0, 0, 0],
    "margin": [0, 0, 0, 0],
    "gap": 8
  },
  "style": { "background": "#FFFFFF | token:surface", "borderRadius": 12, "border": {}, "shadow": {}, "opacity": 1 },
  "text": { "value": "...", "token": "body", "color": "...", "maxLines": 2 },   // Text 노드만
  "src": "asset://... | network-placeholder",                                    // Image 노드만
  "confidence": 1.0,
  "sourceRef": { "file": "...", "line": 0 },
  "children": []
}
```

단위는 논리 픽셀(dp/pt 통일, 1dp=1px). 좌표는 부모 상대 + flex 레이아웃.

---

## 4. 난점별 대응 전략

| 난점 | Tier 1 (compile) | Tier 2 (static) |
|---|---|---|
| 커스텀 컴포넌트 합성 | 컴파일러가 해결 (부분 컴파일의 최대 이점) | 심볼 테이블 기반 인라이닝 (기본 깊이 6, 방문 집합으로 무한 재귀 방지). 실패 시 `Unknown` 노드 + 컴포넌트명 라벨 박스 |
| 화면 생성자 인자/필수 상태 | Mock Provider가 생성한 값을 하니스 코드로 주입. 주입 불가(복잡한 DI)면 Tier 2 fallback | Mock 값으로 IR 바인딩 |
| 조건부 렌더링 (`if/else`, `when`) | 기본 첫 분기 | 기본 첫 분기 표시 + `Branch` 메타데이터 보존 → 분기별 variant 스크린샷 옵션 |
| 반복 (`ListView.builder`, `map()`) | mock 컬렉션 3개 주입 | 대표 아이템 3개 mock 반복 렌더 |
| 테마/디자인 토큰 | 실제 테마 적용됨 | ThemeResolver가 테마 정의(ThemeData, MaterialTheme, xcassets, colors.xml)를 별도 패스로 파싱해 토큰 맵 생성. 실패 시 프레임워크 기본 테마 + `THEME_DEFAULTED` 진단 |
| 폰트 메트릭/줄바꿈 | 실제 렌더러가 계산 | Chromium에 위임, 시스템 폰트는 디바이스 프로파일별 근사 폰트 스택 |
| 이미지/Asset | 로컬 asset 실제 사용, 네트워크는 placeholder | 동일 (로컬은 인라인, 네트워크는 라벨 placeholder) |

---

## 5. 기술 스택

- **언어/런타임**: TypeScript / Node.js (MCP SDK 생태계와 일치)
- **모노레포**: pnpm workspaces
- **파싱**: tree-sitter — `tree-sitter-dart`, `tree-sitter-typescript`(tsx), `tree-sitter-swift`, `tree-sitter-kotlin`. wasm 그래머를 패키지에 번들
- **렌더/캡처**: Playwright(Chromium) + 프레임워크별 컴파일 백엔드(flutter test / esbuild+react-native-web / Paparazzi / xcodebuild)
- **스키마 검증**: zod
- **테스트**: vitest + pixelmatch(골든 이미지 diff)
- **MCP**: `@modelcontextprotocol/sdk` (stdio transport)

---

## 6. 모노레포 패키지 구조

```
screenshot-from-code/
├─ pnpm-workspace.yaml
├─ package.json                # workspace root
├─ tsconfig.base.json
├─ PLAN.md                     # 이 문서
├─ packages/
│  ├─ core/                 @sfc/core         # IR zod 스키마, Detector, 파이프라인 오케스트레이션, mock, confidence
│  ├─ adapter-api/          @sfc/adapter-api  # FrameworkAdapter·CompileBackend 인터페이스 + tree-sitter 공통 유틸(파서 로더, 심볼테이블)
│  ├─ adapter-flutter/      @sfc/adapter-flutter        # 화면 발견 + Tier 2 정적 IR
│  ├─ adapter-react-native/ @sfc/adapter-react-native
│  ├─ adapter-ios/          @sfc/adapter-ios            # SwiftUI 우선, UIKit 후순위
│  ├─ adapter-android/      @sfc/adapter-android        # Compose 우선, XML 후순위
│  ├─ compile-flutter/      @sfc/compile-flutter        # Tier 1: flutter test golden 하니스
│  ├─ compile-react-native/ @sfc/compile-react-native   # Tier 1: esbuild + react-native-web
│  ├─ compile-android/      @sfc/compile-android        # Tier 1: Paparazzi 하니스
│  ├─ compile-ios/          @sfc/compile-ios            # Tier 1: 시뮬레이터 스냅샷 (macOS)
│  ├─ renderer/             @sfc/renderer     # Tier 2: IR→HTML 변환, 디바이스 프로파일(iphone-15, pixel-8…), Playwright 캡처
│  ├─ doctor/               @sfc/doctor       # 환경 감지 + 의존성 자동 설치 + ensure 런타임
│  ├─ sdk/                  @sfc/sdk          # 공개 API 조립
│  ├─ mcp/                  @sfc/mcp          # MCP 서버 (sdk 래핑)
│  ├─ cli/                  @sfc/cli          # `sfc` 커맨드 (sdk 래핑)
│  └─ enrich-llm/           @sfc/enrich-llm   # 선택 LLM 보강 플러그인
├─ fixtures/                 # 프레임워크별 샘플 앱 소스 (빌드 안 함, 테스트 입력)
│  ├─ flutter-basic/
│  ├─ react-native-basic/
│  ├─ ios-swiftui-basic/
│  └─ android-compose-basic/
└─ docs/
```

- 의존 방향: `cli`/`mcp` → `sdk` → `core`+`renderer`+`adapter-*`+`compile-*`+`doctor` → `adapter-api` → `core`. **순환 없음** — `core`(IR 스키마)가 공통 최하위 기반이고, `core`는 `@sfc` 내부 의존이 0개(zod만 사용)다.
- `enrich-llm`은 `sdk`에 선택 주입 (코어 의존성 아님).
- 기존 빈 `packages/screenshot_sdk_flutter/`는 zero-config 요구와 안 맞으므로 M0에서 제거.

---

## 7. 의존성 자동 설치 (Doctor 시스템)

설치한 사람이 아무것도 따로 안 깔아도 되게 하는 **3중 장치**:

1. **postinstall**: npm 설치 시 Playwright Chromium 다운로드 + tree-sitter wasm 그래머 검증. 실패해도 설치 자체는 성공 처리하고 첫 실행 시 재시도.
2. **런타임 ensure**: 모든 SDK/MCP/CLI 진입점이 첫 호출 시 `ensureDependencies()` 실행:
   - **자동 설치 가능** → 그 자리에서 설치: Chromium, node 패키지, Gradle wrapper(프로젝트 동봉), CocoaPods 등
   - **자동 설치 불가** (Xcode, Android SDK, Flutter SDK 등 대형 툴체인) → 명확한 설치 안내 출력 + **Tier 2로 자동 degrade** (에러로 죽지 않음)
3. **`sfc doctor [--fix]` CLI / `doctor` MCP tool**: 환경 진단 리포트(프레임워크별 사용 가능 티어 표시) + `--fix`로 설치 가능 항목 일괄 설치. 옵션으로 Flutter SDK 자동 설치(puro/fvm 경유, 용량 고지 후) 지원.

MCP 배포는 `npx -y @sfc/mcp` 한 줄로 끝나도록 패키징. 클라이언트 설정 스니펫은 README + `sfc mcp install-config` 명령으로 제공.

---

## 8. SDK 공개 API

```ts
export interface AnalyzeOptions {
  projectPath: string;
  framework?: FrameworkId;            // 미지정 시 자동 감지
  device?: DeviceProfileId;           // 기본: 프레임워크별 대표 디바이스
  captureMode?: "auto" | "compile" | "static";  // 기본 auto
  maxInlineDepth?: number;            // Tier 2 인라인 깊이, 기본 6
  mockSeed?: number;                  // 결정론적 mock
  includeCandidates?: boolean;        // route 미연결 후보 화면 포함, 기본 true
  enrich?: EnrichmentPlugin;          // 선택 LLM 플러그인
}

export function detectFramework(projectPath: string): Promise<DetectResult>;
// → { frameworks: [{ id, confidence, evidence[] }] }

export function doctor(projectPath?: string): Promise<DoctorReport>;
// → 환경 진단 + 프레임워크별 가용 티어
export function doctorFix(report?: DoctorReport): Promise<DoctorReport>;
// → 설치 가능 항목 자동 설치 후 재진단

export function listScreens(opts: AnalyzeOptions): Promise<ScreenSummary[]>;
// → [{ id, title, discovery: "route"|"candidate", confidence, sourceRef }]

export function buildScreenIR(opts: AnalyzeOptions & { screenId?: string }): Promise<IRDocument[]>;
// → Tier 2 중간산물 직접 접근

export function captureScreen(opts: AnalyzeOptions & { screenId: string; outDir?: string }):
  Promise<{ screenId, pngPath, width, height, tierUsed: "compile"|"static", confidence }>;

export function captureAll(opts: AnalyzeOptions & { outDir: string }):
  Promise<{ screens: CaptureResult[]; report: AnalysisReport }>;
```

---

## 9. MCP tools (7개)

| tool | input | output |
|---|---|---|
| `detect_framework` | `{ projectPath }` | `{ frameworks: [{id, confidence, evidence}] }` |
| `doctor` | `{ projectPath?, fix? }` | `{ checks, tiersAvailable, installed[] }` |
| `list_screens` | `{ projectPath, framework?, includeCandidates? }` | `{ screens: ScreenSummary[] }` |
| `get_screen_ir` | `{ projectPath, screenId, maxInlineDepth?, mockSeed? }` | `{ ir: IRDocument }` |
| `capture_screen` | `{ projectPath, screenId, device?, captureMode?, outDir? }` | `{ pngPath, tierUsed, confidence, diagnostics }` + image content |
| `capture_all` | `{ projectPath, device?, captureMode?, outDir, includeCandidates? }` | `{ screens: [{screenId, pngPath, tierUsed, confidence}], report }` |
| `get_analysis_report` | `{ projectPath }` | `{ frameworks, screens, overallConfidence, limitations[] }` |

- 캡처 tool은 image content + 사이드카 `*.report.json` 반환
- 모든 캡처 tool은 `mockSeed`로 결정론 보장, 결과에 `tierUsed` 명시

---

## 10. 마일스톤 (TDD 전제)

**어댑터 순서: Flutter → RN → Compose → SwiftUI**
근거: Flutter는 진입점이 가장 명확(`main.dart`/`runApp`)하고 위젯 트리=선언적 트리라 AST→IR 매핑이 직선적이며, Tier 1 백엔드도 `flutter test`로 가장 가벼움. RN은 tree-sitter 성숙도 높고 flex 모델 동일. Compose는 Paparazzi로 에뮬레이터 불필요. SwiftUI는 macOS+Xcode 종속이라 마지막.

각 마일스톤은 **테스트 먼저 작성(Red) → 구현(Green) → 리팩토링** 사이클로 진행. 골든/스냅샷 자동 갱신 금지(명시적 리뷰 필수).

### 체크리스트 (진행 상태)

- [x] **M0 — 모노레포 스캐폴드**: pnpm workspace, tsconfig, vitest, 패키지 골격, IR zod 스키마, `FrameworkAdapter`/`CompileBackend` 인터페이스, 기존 `packages/screenshot_sdk_flutter` 제거
  - 검증: `pnpm -r build` 통과, IR 스키마 round-trip 유닛테스트(유효/무효 케이스)
- [x] **M1 — Detector + Doctor 골격 + Renderer MVP**: Detector(fixtures 4종+혼합 케이스), Doctor 감지·진단(설치는 스텁), 손으로 작성한 IR 픽스처→HTML→Playwright PNG
  - 검증: Detector 테이블 테스트, Renderer 골든 이미지 테스트(픽셀 diff 임계치). **렌더러를 어댑터보다 먼저 검증하는 게 핵심 전략**
- [x] **M2 — Flutter 화면 발견**: 라우트 그래프(MaterialApp routes/go_router/Navigator) + heuristic Scaffold 스캔
  - 검증: `flutter-basic` fixture에서 화면 목록(id/discovery/sourceRef) 스냅샷 일치
- [x] **M3 — Flutter Tier 2 (정적 IR)**: 표준 위젯 매핑(Scaffold/AppBar/Column/Row/Container/Text/Image/Padding/Expanded/ListView), 커스텀 컴포넌트 인라이닝, ThemeResolver, Mock Provider
  - 검증: IR 스냅샷 테스트, `Unknown` 노드 처리, confidence 집계 단조성 테스트, 골든 이미지
- [ ] **M4 — Flutter Tier 1 (부분 컴파일)**: 하니스 생성→`flutter test` golden→PNG 회수, 실패 시 Tier 2 fallback
  - 검증: fixture에서 Tier 1/2 캡처 비교, fallback 경로 테스트, 원본 무수정 테스트(전후 디렉토리 해시 비교)
- [ ] **M5 — SDK/CLI/MCP 조립 + 의존성 자동 설치**: `captureAll` 통합, `sfc` CLI, MCP 서버 7 tools, postinstall/ensure/doctor --fix
  - 검증: 깨끗한 환경(CI 컨테이너)에서 `npx @sfc/mcp` 설치→캡처까지 무개입 동작. **세로 슬라이스 완성 = 데모 가능 시점**
- [ ] **M6 — React Native**: 화면 발견 + Tier 2 + react-native-web 컴파일 백엔드 (M2~M4 패턴 복제)
- [ ] **M7 — Android Compose**: 화면 발견 + Tier 2 + Paparazzi 백엔드
- [ ] **M8 — iOS SwiftUI**: 화면 발견 + Tier 2 + 시뮬레이터 스냅샷 백엔드 (macOS 한정)
- [ ] **M9 — 보강**: UIKit(Storyboard/XIB)·Android XML 레거시, LLM enrich 플러그인, Branch variant 렌더 옵션, confidence 노출 강화

---

## 11. 테스트 전략 (3계층)

1. **Fixture 앱** (`fixtures/<framework>-basic`, 소스만·빌드 안 함): 의도적으로 다음 화면을 각 1개씩 포함 — 표준 위젯 화면, 커스텀 컴포넌트 화면, 조건/리스트 화면, 테마 화면, 라우트 미연결 후보 화면. 모든 어댑터 테스트의 공통 입력.
2. **IR 스냅샷 테스트** (Tier 2 회귀 1차 방어선): `buildScreenIR(fixture)` 결과 JSON을 스냅샷 비교. mockSeed 고정, sourceRef/confidence/diagnostics 포함.
3. **골든 이미지 테스트**: PNG를 골든과 pixelmatch 픽셀 diff(임계치/anti-alias 허용). CI에서 동일 컨테이너 + 고정 폰트 스택 + Chromium 버전 고정. Tier 1 백엔드는 툴체인이 설치된 CI job에서만 실행 (매트릭스 분리).

추가:
- Detector 테이블 테스트, IR zod 스키마 property 테스트
- MCP tool 계약 테스트 (입출력 스키마, image content 반환)
- Doctor "깨끗한 환경에서 자동 설치" 통합 테스트
- **원본 소스 무수정 보장 테스트**: 파이프라인 실행 전후 대상 프로젝트 디렉토리 해시 비교
- 골든/스냅샷 자동 갱신 금지 (갱신은 명시적 리뷰)

---

## 12. Confidence & 한계 노출

- **Tier 1 캡처**: confidence 기본 높음, mock 주입 비율로만 감점
- **Tier 2 노드 단위**: 표준 위젯 매핑 1.0 / 인라인 해석 0.7 / mock 바인딩 0.5 / Unknown 0.2
- **화면 단위**: 노드 confidence를 면적/노드수 가중 집계 × discovery 가중(route 1.0 / candidate 0.6)
- **프로젝트 단위**: 화면 평균 + 커버리지(해석 노드/전체 노드 비율)
- **diagnostics 코드**로 설명 가능성 확보: `UNRESOLVED_COMPONENT`, `THEME_DEFAULTED`, `DYNAMIC_DATA_MOCKED`, `COMPILE_FALLBACK`
- 노출 채널: `AnalysisReport.overallConfidence`, PNG별 사이드카 `*.report.json`, MCP `get_analysis_report`, (옵션) 낮은 신뢰 노드 하이라이트 오버레이 모드
- README에 한계 고정 문구: Tier 2는 픽셀 퍼펙트 아님 / 동적 데이터·차트·지도·애니메이션은 placeholder·근사 / 코드생성 의존 UI 누락 가능

---

## 13. 다음 세션 시작 가이드

1. 이 문서(`PLAN.md`)를 읽는다.
2. 10절 체크리스트에서 **첫 미완료 마일스톤**을 찾는다 (현재: M0).
3. **TDD 원칙 준수**: 해당 마일스톤의 "검증" 항목을 테스트 코드로 먼저 작성(Red) → 구현(Green) → 리팩토링.
4. 마일스톤 완료 시 이 문서의 체크박스를 갱신하고 커밋한다 (`docs: M{n} 완료 — 체크리스트 갱신`).
5. 설계 변경이 생기면 해당 절을 수정하고 문서 상단의 "마지막 갱신" 날짜를 갱신한다.

**M0 첫 작업 순서**:
1. `packages/screenshot_sdk_flutter/` 빈 디렉토리 제거
2. pnpm workspace + tsconfig.base.json + vitest 셋업
3. `packages/core/src/ir/schema.ts` — IR zod 스키마 (테스트 먼저: round-trip 유효/무효 케이스)
4. `packages/adapter-api/src/types.ts` — `FrameworkAdapter`/`CompileBackend` 인터페이스
5. 나머지 패키지 골격 (NoOp 스텁)

**가장 결정적인 파일들** (전 패키지의 계약):
- `packages/core/src/ir/schema.ts` — IR zod 스키마
- `packages/adapter-api/src/types.ts` — 어댑터/컴파일 백엔드 인터페이스
- `packages/renderer/src/html/irToHtml.ts` — IR→HTML/CSS 매핑 (렌더 품질의 핵심)
- `packages/adapter-flutter/src/index.ts` — 첫 세로 슬라이스 어댑터
- `packages/sdk/src/index.ts` — 공개 API 조립
