# no-npm: git clone만으로 MCP 서버 사용 가능하게 만들기

## Context

**What**: karax MCP 서버(`@sfc/mcp`)를 npm에 배포하지 않고, 다른 개발자가 git clone만 받으면 바로 MCP 서버로 등록·사용할 수 있게 만든다.

**Why**: 현재 README는 `npx -y @sfc/mcp`(npm 발행 전제)로 안내되어 있으나 npm 발행 계획이 없음. 모든 패키지 exports가 `./dist/*.js`이고 dist는 `.gitignore`라서, clone 직후엔 `pnpm install && pnpm -r build` 수동 2단계 없이는 실행 불가.

**How (추천안)**: **자가 부트스트랩 런처(B) + 사전 setup 스크립트(A) 하이브리드.**
- 의존성 0짜리 순수 Node 런처(`scripts/mcp-launcher.mjs`)를 커밋. 실행 시 node_modules/dist 상태를 검사해 없으면 `pnpm install` + `pnpm -r build`를 **stderr로만** 수행한 뒤 `packages/mcp/dist/bin.js`로 핸드오프.
- 루트에 `.mcp.json`을 커밋 → Claude Code가 프로젝트 열면 자동 인식. 클론 직후 추가 명령 0.
- 첫 실행 수 분 지연(MCP 클라이언트 타임아웃 가능)은 기술적으로 우회 불가 → 사전 워밍업 `scripts/setup.mjs` 병행 제공 + 문서화.

기각안: C(번들 커밋)는 playwright Chromium·tree-sitter-wasms·esbuild 네이티브 바이너리 때문에 node_modules가 어차피 필요해 "클론만으로" 달성 불가. D(tsx 직접 실행)도 install이 남고 exports가 dist 기준이라 부적합.

## 핵심 발견 (구현 시 필수 반영)

- `packages/doctor/src/ensure.ts:22` — `ensureChromium()`이 `execa("npx", ["playwright","install","chromium"], { stdio: "inherit" })`. **자식 stdout이 MCP stdout(프로토콜 채널)으로 새어 프로토콜이 깨질 수 있음.** 런처와 무관하게 반드시 함께 수정.
- `packages/cli/src/bin.ts:315-327` — `runMcpConfig()`가 `npx -y @sfc/mcp` 스니펫 출력(무용). 런처 경로 기준으로 변경 필요. `packages/cli/src/__tests__/e2e.test.ts`의 기대값도 동반 수정.
- `packages/mcp/package.json`의 postinstall 훅은 `@sfc/sdk` dist가 없으면 조용히 실패(`|| true`) — fresh clone에서 무해하므로 유지.

## 작업 항목 (TDD: 테스트 먼저 → 구현)

### 1. 신규: `scripts/lib/bootstrap.mjs` — 테스트 가능한 순수 결정 로직
부수효과(spawn/fs)와 분리한 순수 함수 모듈:
- `isInstalled(root, fs?)` — node_modules 존재 판정
- `isBuilt(root, fs?)` — `packages/mcp/dist/bin.js` + `packages/sdk/dist/index.js` 존재 판정
- `isStale(root, fs?)` — src 최신 mtime > dist mtime 휴리스틱 (git pull 후 재빌드). `SFC_FORCE_REBUILD=1` 환경변수도 지원
- `planSteps({installed, built, stale})` → `["install"?, "build"?]`
- `resolvePnpmCommand({hasPnpmOnPath, hasCorepack})` — corepack 우선(`corepack pnpm`, packageManager 필드로 10.11.0 보장), pnpm fallback, 둘 다 없으면 null

### 2. 신규: `scripts/__tests__/bootstrap.test.ts` (vitest, 먼저 작성)
- `planSteps` 8가지 조합, `resolvePnpmCommand` 3분기, `isStale`/`isBuilt`/`isInstalled` fake fs 주입 테스트
- 루트에서 이 테스트가 돌도록 루트 vitest 설정(또는 `test:scripts` 스크립트) 추가

### 3. 신규: `scripts/mcp-launcher.mjs` — 부트스트랩 런처 (의존성 0)
- ROOT는 `import.meta.url` 기준 자가 계산 → cwd 비의존 (`.mcp.json` 상대경로 문제 해결)
- 모든 로그 **stderr 전용**. install/build 자식 프로세스는 `stdio: ["ignore", 2, 2]` (stdout→stderr)
- 동시 첫 실행 가드: `node_modules/.mcp-bootstrap.lock`을 `wx` 플래그로 원자 생성, 선점 시 폴링 대기(타임아웃 상한)
- 준비 완료 후 `spawn(process.execPath, [packages/mcp/dist/bin.js], { stdio: "inherit" })`로 핸드오프, exit code 전파
- Windows: 순수 .mjs, 쉘스크립트 없음. pnpm/corepack 호출 시 Windows에서만 `shell: true` 분기

### 4. 신규: `.mcp.json` (루트, 커밋)
```json
{ "mcpServers": { "sfc": { "command": "node", "args": ["scripts/mcp-launcher.mjs"] } } }
```

### 5. 신규: `scripts/setup.mjs` — 사전 워밍업 (선택적 수동 실행)
bootstrap.mjs 로직 재사용. install + build + Chromium 설치까지 미리 수행. stdout 자유. 루트 package.json에 `"setup": "node scripts/setup.mjs"` 추가.

### 6. 수정: `packages/doctor/src/ensure.ts:22`
`stdio: "inherit"` → `stdio: ["ignore", process.stderr, process.stderr]` (Chromium 설치 로그의 stdout 오염 차단). 기존 doctor 테스트는 execa mock이므로 옵션 기대값만 반영.

### 7. 수정: `packages/cli/src/bin.ts:315-327`
`runMcpConfig` 스니펫을 `{ command: "node", args: ["<repoRoot>/scripts/mcp-launcher.mjs"] }` (절대경로 출력)로 변경. e2e 테스트 기대값 동반 수정 (테스트 먼저 빨갛게).

### 8. 문서: `README.md` (35-62행 부근), `PLAN.md`
- npx 스니펫 제거 → ① Claude Code: 클론 후 프로젝트 열면 `.mcp.json` 자동 인식 ② 기타 클라이언트: `claude mcp add sfc -- node "$(pwd)/scripts/mcp-launcher.mjs"` 또는 mcp-config 명령 ③ 첫 실행 수 분 소요 경고 + `pnpm setup` 사전 워밍업 권장
- PLAN.md에 "no-npm 배포 전략" 결정 기록 추가
- 계획 사본을 `./plans/no-npm_plan.md`로 저장 (프로젝트 CLAUDE.md 규칙)

## 검증

1. **fresh clone 시뮬레이션**: `git archive HEAD | tar -x -C /tmp/karax-fresh` (추적 파일만) → `node scripts/mcp-launcher.mjs 1>out.log 2>err.log` 실행 → 서버 기동 전까지 out.log **0바이트** 확인, err.log에 install/build 진행 로그 확인
2. **MCP 핸드셰이크**: `@modelcontextprotocol/sdk` stdio client로 런처를 띄워 initialize + `tools/list` 7종 반환 확인
3. **동시 기동**: 런처 2개 동시 실행 → install 1회만 수행, 둘 다 정상 진입 (락 검증)
4. **stale 재빌드**: `touch packages/mcp/src/bin.ts` → 런처가 build만 재수행
5. **단위 테스트**: `bootstrap.test.ts` + 기존 `pnpm -r test` 전체 그린
6. **Claude Code 통합**: fresh 디렉터리에서 `/mcp`로 sfc 서버 connected 확인

## 구현 노트

### zod 직접 의존성 필요 여부 (검증: 2026-06-05)

**결론**: zod를 직접 import하지 않는 패키지(adapter-android, adapter-api, adapter-flutter, adapter-ios, adapter-react-native, compile-android, compile-flutter, compile-ios, compile-react-native, renderer, doctor, sdk, cli 13개)에서 zod를 제거해도 빌드가 정상 통과한다.

검증 방법: fresh `/tmp/karax-verify-zod` 환경(node_modules·dist 제외 rsync)에서 adapter-flutter의 zod를 제거 후 `pnpm install` + 의존성 순서대로 tsc 빌드 → 성공 확인.

**why 직접 import 없는데 zod가 추가됐었나**: `@sfc/core`의 `packages/core/src/ir/schema.ts`가 `IRDocument`, `NodeTypeSchema` 등 zod 타입을 export한다. consumer 패키지가 이를 import할 때 tsc가 zod 타입을 해석하지만, workspace pnpm 환경에서는 hoisting 또는 core의 node_modules를 통해 zod를 찾으므로 consumer package.json에 zod가 없어도 빌드된다. 단 standalone 환경(각 패키지를 개별 배포할 경우)에서는 peer 의존이 필요할 수 있다.

**조치**: 직접 import 없는 13개 패키지에서 zod 제거, pnpm install로 lockfile 갱신.

### tsconfig exclude: ["src/**/__tests__"] 근거 (검증: 2026-06-05)

**결론**: exclude 없으면 `dist/` 안에 `__tests__/` 폴더가 그대로 포함된다.

검증 방법: fresh 환경 adapter-flutter tsconfig에서 exclude 제거 후 tsc 빌드 → `dist/__tests__/` 생성 확인.

**이유**: `__tests__` 파일이 vitest를 import하는데, vitest는 devDependency라 배포 패키지에 포함되면 안 된다. 또한 테스트 코드가 dist에 들어가면 패키지 배포 시 불필요한 파일이 포함된다. 따라서 exclude 유지가 올바른 패턴이며, 기존 5개 패키지와 동일하게 11개 패키지도 동일 패턴을 적용한다.

## 작업 흐름 (사용자 CLAUDE.md 준수)

1. developer 에이전트가 TDD로 구현
2. git diff 요약 보고
3. `code-review-side-effects` + `security-auditor` + `intent-drift-checker` 3종 병렬 검수
4. 위험도 높음/중간 발견 시 developer로 수정
5. `/pr_to_develop` 실행
