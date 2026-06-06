/**
 * IR 노드의 role 필드에서 광고·동적 UI 역할을 분류하는 순수 함수.
 *
 * 어댑터가 모르는 위젯을 { type: "Unknown", role: "component:<위젯명>" } 으로
 * 떨어뜨리는 것을 활용한다.
 */

export type MapElementRole = "ad" | "dynamic-content" | "list-item" | "media" | "webview";

export interface ElementRoleInfo {
  dynamic?: boolean;
  role?: MapElementRole;
  dynamicSource?: string;
}

/**
 * 광고 위젯명 패턴 — 단어 경계(^, $, 또는 대문자 경계)를 고려한 소문자 매칭.
 *
 * 오탐 방지 설계:
 * - "AddButton"처럼 "ad"를 포함하지만 별개 위젯은 전체 소문자 이름이 패턴과 불일치해야 함.
 * - 각 패턴은 완전한 위젯명(toLowerCase)을 정규식으로 검사한다.
 * - /^adwidget$/ 식의 완전 일치를 사용하지 않고, 패턴 목록으로 관리한다.
 *   이유: "BannerAdWidget", "AdmobBanner" 등 복합명도 커버해야 하기 때문.
 * - 단어 단위 매칭: 패턴에 \b를 사용해 "ad"가 "addbutton"에 걸리지 않도록 함.
 *   단, \b는 단어 문자(a-z,0-9,_) 경계라서 대소문자 무시 매칭(toLowerCase) 시 동작함.
 */

// 소문자화된 위젯명을 테스트하는 정규식 목록
// 각 항목: [패턴, 역할]
type RolePattern = [RegExp, MapElementRole];

const ROLE_PATTERNS: RolePattern[] = [
  // 광고 패턴 — \b로 단어 경계 보장
  [/\badwidget\b/i, "ad"],
  [/\bbannerad(widget)?\b/i, "ad"], // BannerAd, BannerAdWidget
  [/\bbannerview\b/i, "ad"],
  [/\badmob/i, "ad"],               // AdmobBanner 등 Admob 계열
  [/\bg[ad][dm].*view\b/i, "ad"],   // GADBannerView, GAMBannerView
  [/\b(admanager)?adview\b/i, "ad"], // AdView, AdManagerAdView
  [/\bnativead(view)?\b/i, "ad"],   // NativeAd, NativeAdView
  [/\bunityads\b/i, "ad"],
  [/\bmaxadview\b/i, "ad"],
  [/\bironsource\b/i, "ad"],
  [/\bapplovin\b/i, "ad"],
  [/\brewardedad\b/i, "ad"],
  [/\binterstitialad\b/i, "ad"],

  // 동적 콘텐츠 패턴
  [/\bfuturebuilder\b/i, "dynamic-content"],
  [/\bstreambuilder\b/i, "dynamic-content"],

  // WebView 패턴
  [/\bwebview\b/i, "webview"],
  [/\bwkwebview\b/i, "webview"],
  [/\binappwebview\b/i, "webview"],
];

/**
 * IR 노드에서 광고·동적 UI 역할 정보를 추출한다.
 *
 * @param node - type과 role을 가진 객체 (IRNode 호환)
 * @returns ElementRoleInfo (dynamic/role/dynamicSource) 또는 null (해당 없음)
 */
export function classifyElementRole(node: {
  type: string;
  role?: string | null;
}): ElementRoleInfo | null {
  const roleStr = node.role;

  // component: 접두 없으면 즉시 null
  if (!roleStr || !roleStr.startsWith("component:")) {
    return null;
  }

  const widgetName = roleStr.slice("component:".length);

  // 위젯명이 비어있으면 null
  if (!widgetName) {
    return null;
  }

  // 위젯명에 공백이 있으면 유효하지 않은 위젯명 → null
  if (/\s/.test(widgetName)) {
    return null;
  }

  // 패턴 매칭 (소문자화 후 테스트)
  for (const [pattern, role] of ROLE_PATTERNS) {
    if (pattern.test(widgetName)) {
      return { dynamic: true, role, dynamicSource: widgetName };
    }
  }

  return null;
}
