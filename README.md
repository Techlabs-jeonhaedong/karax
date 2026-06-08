# karax

**English** | [한국어](README.ko.md)

**Mobile app test automation tool.** Give it a scenario and it runs fully automated E2E tests on an Android emulator / iOS simulator and writes a report. Without a scenario, it freely explores your app and reports anomalies as findings.

- **Zero-config**: works without touching the target project
- **Read-only**: never modifies the target project's source
- **Auto-installs dependencies**: Chromium is installed automatically on first capture/E2E run (or upfront with `pnpm bootstrap`)
- **Honest about limitations**: every result ships with a confidence score + diagnostics codes

Supported frameworks: **Flutter / React Native / Android (Compose·XML) / iOS (SwiftUI·UIKit)**
Distribution: **SDK + MCP server + CLI**

Screenshot extraction and App Map generation are foundational features for test automation. An App Map (a map of screen-to-screen navigation) is generated automatically at session start and injected into the agent prompt, so the LLM agent doesn't waste time hunting for buttons and can reliably identify ever-changing UI like ads.

---

## Quick Start

```bash
# 1. Clone and set up (install + build + register karax CLI globally)
git clone <repo-url> karax && cd karax
./setup.sh          # install → build → karax CLI global registration (one shot)

# 2. Diagnose your environment (auto-install what's missing)
node packages/cli/dist/bin.js doctor --fix

# 3. Capture every screen of your app
node packages/cli/dist/bin.js capture ./my-app --out ./screenshots

# 4. Run an E2E test (boots emulator, builds, installs, drives the app with an LLM agent)
node packages/cli/dist/bin.js test ./my-app --platform android --agent claude
```

> In the examples below, `karax` stands for `node packages/cli/dist/bin.js`.

---

## Installation

### As an MCP server — git clone only (not published to npm)

karax is not published to npm. **Just clone the repo and you can register it as an MCP server right away.**

#### Claude Code (recommended)

```bash
git clone <repo-url> karax
```

Open the project and the root `.mcp.json` is picked up automatically. **The first run performs `pnpm install` + build automatically, which can take a few minutes.** To avoid the delay, warm up first:

```bash
# Optional pre-warm — install + build + Chromium install, all upfront
# (setup.sh only registers the CLI; it does NOT pre-install Chromium)
pnpm bootstrap
```

#### Other MCP clients (Cursor, manual registration)

```bash
# Option 1: claude mcp add
claude mcp add karax -- node "$(pwd)/scripts/mcp-launcher.mjs"

# Option 2: generate a config snippet
node packages/cli/dist/bin.js mcp-config        # alias: karax mcp install-config
```

Option 2 prints:

```json
{
  "mcpServers": {
    "karax": {
      "command": "node",
      "args": ["/absolute/path/karax/scripts/mcp-launcher.mjs"]
    }
  }
}
```

Paste this JSON into your client's configuration file.

> **First-run delay**: if `node_modules` or `dist` is missing, the launcher installs + builds automatically (progress logs go to stderr only — the MCP stdout protocol channel stays clean). If your MCP client has a short connection timeout, run `pnpm bootstrap` first (install + build + Chromium pre-warm). `./setup.sh` also installs and builds, but additionally registers the `karax` CLI globally — it does **not** pre-install Chromium.

> **Security**: the launcher runs `pnpm install` on first start, which executes dependency postinstall scripts. Only use it when cloned from a trusted source (the official repository).

### CLI directly

```bash
# Install dependencies and build (once)
pnpm install && pnpm -r build

node packages/cli/dist/bin.js <command>
```

---

## CLI Usage

```
karax detect <path>                      Detect framework
karax doctor [path] [--fix]              Diagnose environment + auto-install
karax list <path> [--json] [--no-candidates]   List discovered screens
karax capture <path>                     Capture all screens
  --screen <id>                        Capture a single screen
  --mode auto|compile|static           Capture mode (default: auto)
  --device <id>                        Device profile (default: iphone-15)
  --out <dir>                          Output directory (default: /tmp/karax-out)
  --seed <n>                           Deterministic mock seed
  --variants                           Extra PNG per Branch variant (Tier 2 only)
  --overlay                            Extra confidence-overlay debug PNG
  --json                               JSON output
karax map <path>                         Generate the App Map markdown
  --out <dir>                          Output directory (default: ./)
  --framework <id>                     Force framework: flutter|react-native|android|ios
  --max-chars <n>                      Max characters per document before splitting
  --stdout                             Print markdown to stdout instead of files (mutually exclusive with --out)
  --no-layout                          Disable static coordinate measurement (no Chromium)
  --json                               Output the AppMap as JSON
karax test <path>                        LLM-agent E2E test (real device build & install)
  --platform android|ios               Target platform (required)
  --scenario <file|dir>                Scenario markdown or directory (omit for exploratory mode)
  --agent claude|codex|gemini          LLM agent CLI (default: claude)
  --api-key <key>                      API key (falls back to CLI login)
  --device <id>                        Device/emulator ID
  --out <dir>                          Output directory (default: /tmp/karax-e2e-out)
  --timeout <ms>                       Overall agent timeout (default: 900000)
  --max-steps <n>                      Max agent steps (default: 20)
  --keep-booted                        Keep the device booted after the test
  --reuse-build                        Reuse the previous build when source fingerprint matches
  --no-build                           Skip building; use cached artifact only (errors if missing)
  --grant-permissions                  Auto-grant the scenario's permissions[]
  --record-video                       Record the session as video
  --no-fail-on-crash                   Don't downgrade outcome to fail on crash detection
  --build-command <cmd>                Run this shell command instead of the default build command
karax ui dump --device <id>              Agent UI helper — dump current screen elements
karax ui locate --device <id> --label <text>   Resolve element coordinates by text/role
karax ui which-screen --device <id>      Match current screen to an AppMap ID
karax mcp-config                         Print MCP client config snippet (alias: karax mcp install-config)
```

Every command accepts `--debug` (see [Debug mode](#debug-mode)).

### Examples

```bash
# Capture every screen of a Flutter project (auto mode)
karax capture ./my-flutter-app --out ./screenshots

# Capture one screen in static mode
karax capture ./my-app --screen HomeScreen --mode static --out ./out

# Per-Branch variant screenshots
karax capture ./my-app --screen ListScreen --mode static --variants --out ./out
# → ListScreen_iphone-15.png, ListScreen__arm1_iphone-15.png, ...

# Confidence-overlay debug PNG
karax capture ./my-app --screen HomeScreen --mode static --overlay --out ./out
# → HomeScreen_iphone-15.png, HomeScreen_iphone-15__overlay.png

# App Map — navigation graph + trigger text/style/coordinates
karax map ./my-app --out ./docs
# → {app name}_map_1.md (splits into _2, _3, ... with cross-links when long)

# E2E test — boot emulator + full build + LLM agent drive
karax test ./my-app --platform android --agent claude

# With a scenario
karax test ./my-app --platform ios --scenario ./scenarios/login.md

# Run a whole directory as a suite
karax test ./my-app --platform android --scenario ./scenarios/

# Reuse build cache + record video
karax test ./my-app --platform android --reuse-build --record-video --out ./reports

# Exploratory test (no scenario) — produces a findings report
karax test ./my-app --platform ios --agent claude --out ./reports

# Custom build command (e.g. FVM flavor build)
karax test ./my-app --platform android --build-command "fvm flutter build apk --debug --flavor dev"
```

---

## E2E Testing (`karax test`)

Boots a real emulator/simulator, fully builds·installs·launches the app, then an **LLM agent (Claude Code / Codex / Gemini CLI) drives the E2E test via adb·simctl**.

- **Single agent-CLI path**: spawns the `claude -p` / `codex exec` / `gemini -p` headless CLIs. Subscription users keep their existing login; API-key users get env injection.
- **Automatic App Map injection**: the App Map is generated at session start and injected into the agent prompt. Three-stage compression (full → summary → core) adapts to context size. Ad regions are tagged `role:"ad"`.
- **Agent vision**: Claude reads screenshots directly to understand the UI visually (Read scoped to `claude`). Budget auto-scales with App Map screen count.
- **Scenario v2**: declare `title` / `mode` / `preconditions` / `testData` / `steps(action+expect)` / `permissions` in frontmatter. Omit the file entirely for exploratory mode.
- **Directory suites**: `--scenario <dir>` runs every `*.md` file as a suite.
- **Exploratory testing / findings**: without a scenario, the agent freely explores the app and classifies findings into a 10-type anomaly taxonomy (`crash` / `layout-overflow` / `untranslated-text` / `dead-button` / `navigation-inconsistency` / `slow-response` / `accessibility` / `visual-glitch` / `error-state` / `other`). Coverage ratio is tracked too.
- **Reliability**: crash detection (logcat / idb crash), partial recovery (`outcome: partial`), report v2 (`findings` / `coverage` / `crashes` / `videos` / `qualityWarnings` sections).
- **Operations**: build caching (`--reuse-build` / `--no-build`), permission auto-grant (`--grant-permissions`; individual grants when the scenario declares `permissions`), video recording (`--record-video`).
- **iOS input**: tap/swipe/text injection when idb is installed; falls back to coordinate estimation otherwise.
- **Artifacts**: session directory with `report.json` + `report.md` + `screenshots/` (+ `videos/` with `--record-video`).
- **Exit codes**: pass = 0, infra error = 1, test failure = 2.
- **RN iOS**: `pod install` is never run automatically (read-only principle) — only a `COCOAPODS_REQUIRED` diagnostic is reported.

13 error codes: `FRAMEWORK_NOT_DETECTED`, `SCENARIO_PARSE_ERROR`, `NO_DEVICE_AVAILABLE`, `EMULATOR_BOOT_TIMEOUT`, `COCOAPODS_REQUIRED`, `BUILD_FAILED`, `ARTIFACT_NOT_FOUND`, `INSTALL_FAILED`, `LAUNCH_FAILED`, `AGENT_CLI_MISSING`, `AGENT_OUTPUT_INVALID`, `AGENT_TIMEOUT`, `INVALID_ARGUMENT`

### Scenario v2 example

```markdown
---
title: Login happy path
platform: android
appId: com.example.app
mode: scenario
preconditions:
  - App is installed
  - Network is connected
testData:
  email: test@example.com
  password: "{{SECRET:TEST_PASSWORD}}"
permissions:
  - android.permission.CAMERA
steps:
  - action: Type {{testData.email}} into the email field
    expect: The email field shows the text
  - action: Tap the login button
    expect: Navigates to the home screen, welcome message shown
---

Verify the default home screen renders correctly after login.
```

See [docs/scenario-guide.md](docs/scenario-guide.md) for the full scenario authoring guide.

### Exploratory test example

```bash
# Run without a scenario → exploratory mode is selected automatically
karax test ./my-app --platform android --agent claude --out ./reports
```

The `## Findings` section of `report.md` records severity (critical/major/minor) · category · reproSteps.

```ts
import { runE2eTest } from "@karax/sdk";

const result = await runE2eTest({
  projectPath: "./my-app",
  platform: "android",
  agent: "claude",
  scenarioPath: "./scenarios/login.md", // omit for exploratory mode
});
```

> The `run_e2e_test` MCP tool includes the build & boot, so it **can take several minutes**. Pass `buildCommand` to override the default build command (e.g. `"fvm flutter build apk --debug --flavor dev"`).
>
> **iOS + `--build-command`**: karax injects `KARAX_DERIVED_DATA_PATH` (a temp dir) into the build environment. Include `-derivedDataPath "$KARAX_DERIVED_DATA_PATH"` in your command so karax can locate the `.app` artifact. Without it, karax falls back to `build/ios/iphonesimulator` and `ios/build/Build/Products`, but using the env var is more reliable.

### `karax ui` — deterministic helpers for agents

Subcommands that let the agent deterministically inspect the current screen state during an E2E test. Matches uiautomator (Android) / idb (iOS) output against the App Map at runtime.

```bash
# Dump every interactable element on the current screen
karax ui dump --device emulator-5554

# Resolve element coordinates by text/role
karax ui locate --device emulator-5554 --label "Login"

# Match the current screen to an AppMap ID
karax ui which-screen --device emulator-5554 --appmap ./appmap.json
```

Common flags: `--device <id>` (required), `--platform android|ios` (default: android). `locate` also takes `--label <text>` / `--appmap <path>` / `--screen <id>`.

---

## App Map

Extracts the **navigation relations** between screens (which element leads to which screen) via static analysis and builds a "program map".

- **Output**: Mermaid `flowchart TD` graph + screen list table + per-screen detail sections (element table · navigation table). Splits into multiple cross-linked documents when `--max-chars` is exceeded.
- **Detailed mapping**: records the trigger element's text, style (background color, corner radius, …) and position/size (coordinates). Coordinates are **approximations** from the Tier 2 static render, flagged with the `LAYOUT_APPROX` diagnostic.
- **Graceful degradation**: without Chromium only the coordinates are omitted (`LAYOUT_UNAVAILABLE`); if the adapter doesn't support navigation tracking you get an empty graph + `NAV_UNSUPPORTED`.
- **Confidence**: resolved 1.0 / heuristic 0.6 / unresolved 0.3 (`DYNAMIC_NAV` / `UNRESOLVED_NAV` diagnostics).

```ts
import { generateAppMap, renderAppMapMarkdown } from "@karax/sdk";

const appMap = await generateAppMap({
  projectPath: "./my-app",
  includeLayout: true, // default ON; false skips Chromium
});
const docs = renderAppMapMarkdown(appMap, { maxChars: 20000 });
```

---

## Screen Capture (2-tier strategy)

| Tier | Condition | Method | Fidelity |
|---|---|---|---|
| **Tier 1: Partial Compile** | framework toolchain detected | compile a per-screen harness, capture with the real renderer | high |
| **Tier 2: Static IR** | no toolchain / Tier 1 failed | static analysis → UI IR → HTML/CSS → Chromium capture | structural approximation + confidence score |

The default mode (`auto`) tries Tier 1 and falls back to Tier 2 per screen on failure (recorded as a `COMPILE_FALLBACK` diagnostic). Screen **discovery is always static analysis**; only capture is tiered.

### Framework support matrix

| Framework | Discovery | Tier 2 (static IR) | Tier 1 (compile) |
|---|---|---|---|
| Flutter | route-graph + heuristic | widget tree | `flutter test` golden |
| React Native | react-navigation stacks/tabs | react-native-web alias | esbuild + Chromium |
| Android Compose | NavHost route-graph + heuristic | Compose function tree | Paparazzi (JVM) |
| Android XML (legacy) | setContentView links | parses res/layout/*.xml | — |
| iOS SwiftUI | NavigationStack + WindowGroup | SwiftUI view tree | xcodebuild + simulator (macOS) |
| iOS UIKit (legacy) | Storyboard/XIB + segue graph | view hierarchy parsing | — |

---

## Capability map

| Capability | CLI | MCP tool | SDK |
|---|---|---|---|
| Framework detection | `detect` | `detect_framework` | `detectFramework` |
| Environment diagnosis + auto-install | `doctor` | `doctor` | `doctor` / `doctorFix` |
| Screen discovery (static analysis) | `list` | `list_screens` | `listScreens` |
| Screen capture (2-tier) | `capture` | `capture_screen` / `capture_all` | `captureScreen` / `captureAll` |
| UI IR extraction | — | `get_screen_ir` | `buildScreenIR` |
| Full analysis report | — | `get_analysis_report` | — |
| **App Map** | `map` | `generate_app_map` | `generateAppMap` |
| **E2E test (LLM agent)** | `test` | `run_e2e_test` | `runE2eTest` / `runE2eSuite` |

---

## SDK API summary

```ts
import {
  detectFramework,
  doctor, doctorFix,
  listScreens,
  buildScreenIR,
  captureScreen,
  captureAll,
  generateAppMap, renderAppMapMarkdown,
  runE2eTest, runE2eSuite,
} from "@karax/sdk";

// Detect framework
const { frameworks } = await detectFramework("./my-app");

// List screens
const screens = await listScreens({ projectPath: "./my-app" });

// Capture one screen
const result = await captureScreen({
  projectPath: "./my-app",
  screenId: "HomeScreen",
  outDir: "./out",
  captureMode: "auto",    // "auto" | "compile" | "static"
  device: "iphone-15",
  variants: true,         // extra PNG per Branch variant (Tier 2 only)
  overlay: "confidence",  // extra confidence-overlay PNG
});

// Capture everything
const { screens: captured, report } = await captureAll({
  projectPath: "./my-app",
  outDir: "./out",
});

// Optional LLM enrichment plugin
import { createLlmEnrichmentPlugin } from "@karax/enrich-llm";

const enrich = createLlmEnrichmentPlugin({
  complete: async (prompt) => { /* your LLM call */ return response; },
  threshold: 0.5, // only nodes below this confidence are enriched
});

await captureScreen({ projectPath: "./my-app", screenId: "HomeScreen", outDir: "./out", enrich });
```

### AnalyzeOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `projectPath` | `string` | required | project to analyze |
| `framework` | `FrameworkId` | auto-detected | `"flutter"` \| `"react-native"` \| `"android"` \| `"ios"` |
| `device` | `DeviceProfileId` | `"iphone-15"` | device profile |
| `captureMode` | `CaptureMode` | `"auto"` | `"auto"` \| `"compile"` \| `"static"` |
| `mockSeed` | `number` | `0` | deterministic mock seed |
| `includeCandidates` | `boolean` | `true` | include route-unconnected candidate screens |
| `enrich` | `EnrichmentPlugin` | — | LLM enrichment plugin |

---

## MCP Tools (9)

| Tool | Description |
|---|---|
| `detect_framework` | detect framework |
| `doctor` | diagnose environment + auto-install (fix option) |
| `list_screens` | return screen list |
| `get_screen_ir` | return the UI IR of a screen |
| `capture_screen` | capture a screen (image content + sidecar JSON) |
| `capture_all` | capture every screen |
| `get_analysis_report` | full project analysis report |
| `generate_app_map` | App Map — nav graph + trigger details (`includeLayout`, `maxCharsPerDoc`, `write`+`outDir` options) |
| `run_e2e_test` | real-device E2E test (takes minutes) |

Options shared by `capture_screen` / `capture_all`:
- `variants: boolean` — extra PNG per Branch variant
- `overlay: "confidence"` — extra confidence-overlay PNG

---

## Debug mode

Every CLI command accepts `--debug`; alternatively set the `KARAX_DEBUG` env var. In debug mode, errors include full stack traces and intermediate artifacts are preserved for inspection. The flag/env propagates to child processes automatically.

```bash
karax capture ./my-app --debug
KARAX_DEBUG=1 karax test ./my-app --platform android
```

---

## Confidence & Diagnostics

### Tier 2 confidence

| Situation | confidence |
|---|---|
| standard widget mapping | 1.0 |
| inline resolution success | 0.7 |
| mock data binding | 0.5 |
| Unknown node | 0.2 |
| route discovery weight | 1.0 |
| candidate discovery weight | 0.6 |

### Diagnostics codes

| Code | Meaning |
|---|---|
| `UNRESOLVED_COMPONENT` | failed to resolve a custom component symbol |
| `THEME_DEFAULTED` | theme token resolution failed → default theme used |
| `DYNAMIC_DATA_MOCKED` | runtime data replaced with mock values |
| `COMPILE_FALLBACK` | Tier 1 failed → Tier 2 fallback |
| `BRANCH_VARIANT_EXPANDED` | Branch variants expanded |
| `ENRICHED` | LLM enrichment applied |
| `ENRICH_REJECTED` | LLM enrichment failed / schema violation |
| `NAV_UNSUPPORTED` | adapter lacks navigation tracking → empty graph |
| `DYNAMIC_NAV` | dynamic navigation → heuristic resolution (lower conf) |
| `UNRESOLVED_NAV` | failed to resolve navigation target |
| `TRIGGER_UNMATCHED` | failed to match trigger ↔ element |
| `LAYOUT_APPROX` | coordinates approximated from Tier 2 static render |
| `LAYOUT_UNAVAILABLE` | Chromium measurement failed → coordinates omitted |
| `COCOAPODS_REQUIRED` | RN iOS — run `pod install` manually |

### Confidence overlay

With `--overlay` (CLI) / `overlay: "confidence"` (SDK/MCP), an extra debug PNG highlights low-confidence nodes on each screen.

- `confidence < 0.5`: translucent orange border + corner score label
- `Unknown` node: red border
- File name: `<screenId>_<device>__overlay.png`

---

## Limitations

> Tier 2 is a **structural approximation**, not pixel-perfect.

- **Strong**: screen inventory, static layout skeleton, static text, explicit colors/spacing, standard components
- **Approximate**: screens dominated by custom components, indirect theme token references, lists/grids
- **Weak**: screens dependent on runtime API data, charts/maps/Canvas, animation states, complex DI graphs, codegen-dependent UI (`build_runner`/`R.java`)
- **App Map coordinates are approximate** — may differ from real-device pixels (`LAYOUT_APPROX`)
- **Android nav tracking goes up to 2 levels of indirection** — 3+ levels of callback passing are reported with conf 0.3
- **Agent CLI flags are version-dependent** — flags like `--permission-mode bypassPermissions` need runtime verification

Dynamic data, charts, maps, and animations are handled as placeholders/approximations. Codegen-dependent UI may be missed.

---

## Development guide

```bash
pnpm install              # install dependencies (once)
pnpm -r build             # build all packages
pnpm test                 # all tests (packages + scripts launcher tests)

# Single package
pnpm --filter @karax/core test
pnpm --filter @karax/renderer test  # requires Playwright

# Integration test env var
KARAX_SKIP_ENSURE=1 pnpm --filter @karax/sdk test   # skip Chromium auto-install

# Update golden/snapshot images (only after explicit review — no blind updates)
UPDATE_GOLDEN=1 pnpm --filter @karax/renderer test
```

### Package layout

```
packages/
  core/           IR schema, detector, pipeline, confidence, appmap
  adapter-api/    FrameworkAdapter/CompileBackend interfaces
  adapter-flutter/
  adapter-react-native/
  adapter-ios/    SwiftUI + UIKit legacy
  adapter-android/ Compose + XML legacy
  compile-flutter/
  compile-react-native/
  compile-android/
  compile-ios/
  renderer/       IR → HTML → Playwright PNG, coordinate measurement
  doctor/         environment detection + dependency auto-install
  sdk/            public API assembly
  mcp/            MCP server (9 tools)
  cli/            karax command
  e2e/            E2E testing (device/build/agent/scenario/report)
  enrich-llm/     optional LLM enrichment plugin
scripts/
  mcp-launcher.mjs  self-bootstrapping MCP launcher (zero deps)
  setup.mjs         pre-warm (pnpm bootstrap)
```

See `PLAN.md` for the self-contained design document behind the architecture decisions.
