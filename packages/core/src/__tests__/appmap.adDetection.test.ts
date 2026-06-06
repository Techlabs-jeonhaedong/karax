import { describe, it, expect } from "vitest";
import { classifyElementRole } from "../appmap/adDetection.js";

describe("classifyElementRole", () => {
  // ── 광고 위젯 분류 ─────────────────────────────────────────────────

  describe("광고(ad) 분류", () => {
    it("Flutter AdWidget → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:AdWidget" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "AdWidget" });
    });

    it("Flutter BannerAd → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:BannerAd" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "BannerAd" });
    });

    it("Flutter BannerAdWidget → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:BannerAdWidget" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "BannerAdWidget" });
    });

    it("Flutter AdmobBanner → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:AdmobBanner" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "AdmobBanner" });
    });

    it("iOS GADBannerView → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:GADBannerView" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "GADBannerView" });
    });

    it("iOS GAMBannerView → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:GAMBannerView" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "GAMBannerView" });
    });

    it("iOS/Android BannerView → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:BannerView" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "BannerView" });
    });

    it("Android AdView → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:AdView" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "AdView" });
    });

    it("Android AdManagerAdView → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:AdManagerAdView" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "AdManagerAdView" });
    });

    it("Android NativeAd → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:NativeAd" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "NativeAd" });
    });

    it("Android NativeAdView → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:NativeAdView" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "NativeAdView" });
    });

    it("UnityAds → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:UnityAds" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "UnityAds" });
    });

    it("MaxAdView → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:MaxAdView" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "MaxAdView" });
    });

    it("IronSource → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:IronSource" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "IronSource" });
    });

    it("AppLovin → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:AppLovin" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "AppLovin" });
    });

    it("RewardedAd → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:RewardedAd" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "RewardedAd" });
    });

    it("InterstitialAd → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:InterstitialAd" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "InterstitialAd" });
    });

    it("대소문자 무시 — gadbannerView → role:ad", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:gadbannerView" });
      expect(result?.role).toBe("ad");
      expect(result?.dynamic).toBe(true);
    });
  });

  // ── 동적 콘텐츠 분류 ───────────────────────────────────────────────

  describe("dynamic-content 분류", () => {
    it("FutureBuilder → role:dynamic-content", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:FutureBuilder" });
      expect(result).toEqual({ dynamic: true, role: "dynamic-content", dynamicSource: "FutureBuilder" });
    });

    it("StreamBuilder → role:dynamic-content", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:StreamBuilder" });
      expect(result).toEqual({ dynamic: true, role: "dynamic-content", dynamicSource: "StreamBuilder" });
    });
  });

  // ── WebView 분류 ───────────────────────────────────────────────────

  describe("webview 분류", () => {
    it("WebView → role:webview", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:WebView" });
      expect(result).toEqual({ dynamic: true, role: "webview", dynamicSource: "WebView" });
    });

    it("WKWebView → role:webview", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:WKWebView" });
      expect(result).toEqual({ dynamic: true, role: "webview", dynamicSource: "WKWebView" });
    });

    it("InAppWebView → role:webview", () => {
      const result = classifyElementRole({ type: "Unknown", role: "component:InAppWebView" });
      expect(result).toEqual({ dynamic: true, role: "webview", dynamicSource: "InAppWebView" });
    });
  });

  // ── 오탐(false positive) 방지 ──────────────────────────────────────

  describe("오탐 없음 (일반 위젯 → null)", () => {
    it("Button → null", () => {
      expect(classifyElementRole({ type: "Button", role: null })).toBeNull();
    });

    it("Card → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "component:Card" })).toBeNull();
    });

    it("AddButton — 'Ad' 패턴에 걸리면 안 됨 → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "component:AddButton" })).toBeNull();
    });

    it("Badge — 'Ad' 패턴에 걸리면 안 됨 → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "component:Badge" })).toBeNull();
    });

    it("Container → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "component:Container" })).toBeNull();
    });

    it("Text → null", () => {
      expect(classifyElementRole({ type: "Text", role: null })).toBeNull();
    });

    it("ListView → null (list는 별도 role 없음)", () => {
      expect(classifyElementRole({ type: "List", role: "component:ListView" })).toBeNull();
    });

    it("GridView → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "component:GridView" })).toBeNull();
    });

    it("AdaptiveButton — 'Ad' 접두로 시작하지만 별개 위젯 → null", () => {
      // AdaptiveButton은 Ad로 시작하지 않음, 단어 경계 외 Ad 포함도 아님
      expect(classifyElementRole({ type: "Unknown", role: "component:AdaptiveButton" })).toBeNull();
    });

    it("LoadingIndicator — 'Loading'은 동적이지만 분류 대상 아님 → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "component:LoadingIndicator" })).toBeNull();
    });
  });

  // ── component: 접두 없는 role → null ─────────────────────────────

  describe("component: 접두 없는 role → null", () => {
    it("role이 null이면 null", () => {
      expect(classifyElementRole({ type: "Unknown", role: null })).toBeNull();
    });

    it("role이 undefined이면 null", () => {
      expect(classifyElementRole({ type: "Unknown", role: undefined })).toBeNull();
    });

    it("role이 'ad' (접두 없음) → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "ad" })).toBeNull();
    });

    it("role이 'GADBannerView' (접두 없음) → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "GADBannerView" })).toBeNull();
    });

    it("role이 빈 문자열 → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "" })).toBeNull();
    });

    it("role이 'component:' (위젯명 없음) → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "component:" })).toBeNull();
    });
  });

  // ── 엣지 케이스 ──────────────────────────────────────────────────

  describe("엣지 케이스", () => {
    it("role에 공백이 포함된 경우 → null", () => {
      expect(classifyElementRole({ type: "Unknown", role: "component:Ad Widget" })).toBeNull();
    });

    it("type이 Unknown이 아닌 일반 타입에도 classifyElementRole 적용 가능", () => {
      // Button 타입의 노드가 component:AdWidget role을 가진 경우 (이상한 상황이지만)
      const result = classifyElementRole({ type: "Button", role: "component:AdWidget" });
      expect(result).toEqual({ dynamic: true, role: "ad", dynamicSource: "AdWidget" });
    });

    it("매우 긴 위젯명 → null", () => {
      const longName = "A".repeat(1000);
      expect(classifyElementRole({ type: "Unknown", role: `component:${longName}` })).toBeNull();
    });
  });
});
