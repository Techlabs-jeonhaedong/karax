/**
 * detect 테스트 — androidAdapter.detect()
 */
import { describe, expect, it } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { androidAdapter } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../../..", "fixtures");

const FIXTURE = path.join(FIXTURES_DIR, "android-compose-basic");
const NON_ANDROID = path.join(FIXTURES_DIR, "flutter-basic");

describe("androidAdapter.detect", () => {
  it("android-compose-basic fixture를 감지한다", async () => {
    const result = await androidAdapter.detect(FIXTURE);
    expect(result.matches).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("flutter-basic fixture를 android로 감지하지 않는다", async () => {
    const result = await androidAdapter.detect(NON_ANDROID);
    expect(result.matches).toBe(false);
  });

  it("빈 디렉토리를 감지하지 않는다", async () => {
    const result = await androidAdapter.detect("/tmp/nonexistent-sfc-test");
    expect(result.matches).toBe(false);
  });
});
