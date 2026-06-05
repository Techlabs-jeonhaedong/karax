/**
 * build/artifact.ts 단위 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  extractAndroidAppId,
  extractIosBundleId,
} from "../build/artifact.js";

// ── extractAndroidAppId ───────────────────────────────────────────

describe("extractAndroidAppId", () => {
  it("applicationId를 파싱한다 (큰따옴표)", () => {
    const content = `android {\n  defaultConfig {\n    applicationId "com.example.myapp"\n  }\n}`;
    expect(extractAndroidAppId(content)).toBe("com.example.myapp");
  });

  it("applicationId를 파싱한다 (작은따옴표)", () => {
    const content = `applicationId 'com.example.app'`;
    expect(extractAndroidAppId(content)).toBe("com.example.app");
  });

  it("Kotlin DSL 형식도 지원", () => {
    const content = `applicationId = "com.example.kts"`;
    expect(extractAndroidAppId(content)).toBe("com.example.kts");
  });

  it("applicationId 없으면 null 반환", () => {
    expect(extractAndroidAppId("compileSdk = 34")).toBeNull();
  });

  it("빈 문자열이면 null 반환", () => {
    expect(extractAndroidAppId("")).toBeNull();
  });
});

// ── extractIosBundleId ─────────────────────────────────────────────

describe("extractIosBundleId", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "karax-e2e-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Info.plist에서 CFBundleIdentifier를 파싱한다", () => {
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.example.iosapp</string>
</dict>
</plist>`;
    const plistPath = path.join(tmpDir, "Info.plist");
    fs.writeFileSync(plistPath, plistContent);

    const result = extractIosBundleId(plistContent);
    expect(result).toBe("com.example.iosapp");
  });

  it("CFBundleIdentifier 없으면 null 반환", () => {
    const plistContent = `<plist version="1.0"><dict></dict></plist>`;
    expect(extractIosBundleId(plistContent)).toBeNull();
  });

  it("빈 문자열이면 null 반환", () => {
    expect(extractIosBundleId("")).toBeNull();
  });

  it("$(PRODUCT_BUNDLE_IDENTIFIER) 같은 변수 치환 전 값도 반환한다", () => {
    const content = `<key>CFBundleIdentifier</key>\n<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>`;
    const result = extractIosBundleId(content);
    // 변수 형태라도 일단 값을 반환
    expect(result).toBe("$(PRODUCT_BUNDLE_IDENTIFIER)");
  });
});
