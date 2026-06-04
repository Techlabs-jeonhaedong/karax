/**
 * esbuild 플러그인 — react-native 네이티브 전용 모듈 자동 mock
 *
 * 번들 시 웹에서 지원되지 않는 네이티브 패키지를 빈 컴포넌트/stub으로 대체한다.
 * PLAN 1-1: "네이티브 전용 모듈(react-native-vector-icons 등 web 미지원) import 시
 *            esbuild plugin으로 자동 mock(빈 컴포넌트) + diagnostic"
 */
import type { Plugin } from "esbuild";

/** mock 처리된 모듈과 그 이유 기록 */
export interface MockedModule {
  pkg: string;
  reason: string;
}

/** web 미지원 react-native 네이티브 패키지 패턴 */
const NATIVE_ONLY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^react-native-vector-icons/, reason: "native icon font" },
  { pattern: /^react-native-maps/, reason: "native map" },
  { pattern: /^react-native-camera/, reason: "native camera" },
  { pattern: /^react-native-video/, reason: "native video" },
  { pattern: /^react-native-gesture-handler/, reason: "native gesture" },
  { pattern: /^react-native-reanimated/, reason: "native animation" },
  { pattern: /^react-native-fast-image/, reason: "native image" },
  { pattern: /^react-native-linear-gradient/, reason: "native gradient" },
  { pattern: /^react-native-svg/, reason: "native svg" },
  { pattern: /^@react-native-async-storage/, reason: "native storage" },
  { pattern: /^@react-native-community\//, reason: "native community module" },
  { pattern: /^react-native-screens/, reason: "native screens" },
  { pattern: /^react-native-safe-area-context/, reason: "native safe area" },
];

/** @react-navigation/* — navigation 관련 모듈 mock */
const NAVIGATION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^@react-navigation\//, reason: "react-navigation (mocked for web)" },
];

/** 빈 React 컴포넌트를 반환하는 mock 모듈 JS 코드 */
function makeMockModule(pkg: string): string {
  return `
// Auto-mocked by compile-react-native: ${pkg}
import React from 'react';
const _EmptyComponent = () => null;
export default _EmptyComponent;
export const NavigationContainer = ({ children }) => React.createElement(React.Fragment, null, children);
export const useNavigation = () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {} });
export const useRoute = () => ({ params: {} });
export const createNativeStackNavigator = () => ({
  Navigator: ({ children }) => React.createElement(React.Fragment, null, children),
  Screen: ({ component: C, ...props }) => React.createElement(C, { navigation: { navigate: () => {}, goBack: () => {}, setOptions: () => {} }, route: { params: {} }, ...props }),
  Group: ({ children }) => React.createElement(React.Fragment, null, children),
});
export const createStackNavigator = () => ({
  Navigator: ({ children }) => React.createElement(React.Fragment, null, children),
  Screen: ({ component: C, ...props }) => React.createElement(C, { navigation: { navigate: () => {}, goBack: () => {}, setOptions: () => {} }, route: { params: {} }, ...props }),
  Group: ({ children }) => React.createElement(React.Fragment, null, children),
});
export const createBottomTabNavigator = () => ({
  Navigator: ({ children }) => React.createElement(React.Fragment, null, children),
  Screen: ({ component: C, ...props }) => React.createElement(C, { navigation: { navigate: () => {}, goBack: () => {}, setOptions: () => {} }, route: { params: {} }, ...props }),
  Group: ({ children }) => React.createElement(React.Fragment, null, children),
});
`.trim();
}

/**
 * 네이티브 모듈 자동 mock esbuild 플러그인 생성
 */
export function createNativeMockPlugin(mockedModules: MockedModule[]): Plugin {
  return {
    name: "sfc-native-mock",
    setup(build) {
      // 네이티브 전용 패키지 가로채기
      build.onResolve({ filter: /.*/ }, (args) => {
        const pkg = args.path;

        for (const { pattern, reason } of NATIVE_ONLY_PATTERNS) {
          if (pattern.test(pkg)) {
            mockedModules.push({ pkg, reason });
            return { path: pkg, namespace: "sfc-native-mock" };
          }
        }

        for (const { pattern, reason } of NAVIGATION_PATTERNS) {
          if (pattern.test(pkg)) {
            mockedModules.push({ pkg, reason });
            return { path: pkg, namespace: "sfc-native-mock" };
          }
        }

        return undefined;
      });

      // mock 모듈 콘텐츠 반환
      build.onLoad({ filter: /.*/, namespace: "sfc-native-mock" }, (args) => {
        return {
          contents: makeMockModule(args.path),
          loader: "jsx",
        };
      });
    },
  };
}
