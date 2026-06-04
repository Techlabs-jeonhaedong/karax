import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { buildSymbolTable } from "../parse/scanner.js";
import { discoverRouteGraph } from "../discover/routeGraph.js";
import { findHeuristicCandidates } from "../discover/heuristic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "../../../..", "fixtures/react-native-basic");

describe("heuristic — OrphanScreen 후보 발견", () => {
  it("OrphanScreen을 candidate로 발견한다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    const { routes } = await discoverRouteGraph(FIXTURE_PATH, table);
    const routeNames = new Set(routes.map(r => r.componentName));

    const candidates = findHeuristicCandidates(table, routeNames);
    const candidateNames = candidates.map(c => c.componentName);
    expect(candidateNames).toContain("OrphanScreen");
  });

  it("라우트 화면은 heuristic 결과에서 제외된다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    const { routes } = await discoverRouteGraph(FIXTURE_PATH, table);
    const routeNames = new Set(routes.map(r => r.componentName));

    const candidates = findHeuristicCandidates(table, routeNames);
    const candidateNames = candidates.map(c => c.componentName);

    expect(candidateNames).not.toContain("HomeScreen");
    expect(candidateNames).not.toContain("DetailScreen");
  });

  it("reason이 올바르게 설정된다", async () => {
    const table = await buildSymbolTable(FIXTURE_PATH);
    const { routes } = await discoverRouteGraph(FIXTURE_PATH, table);
    const routeNames = new Set(routes.map(r => r.componentName));

    const candidates = findHeuristicCandidates(table, routeNames);
    const orphan = candidates.find(c => c.componentName === "OrphanScreen");

    expect(orphan).toBeDefined();
    // OrphanScreen은 이름 접미사 + 경로 모두 해당
    expect(["name-suffix", "screen-dir", "both"]).toContain(orphan?.reason);
  });
});
