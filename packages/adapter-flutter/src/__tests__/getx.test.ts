import { describe, it, expect } from "vitest";
import {
  parseDartSource,
  createSymbolTable,
  addParsedFile,
  type SymbolTable,
} from "../parse/scanner.js";
import { discoverGetxRoutes } from "../discover/getx.js";

// 인라인 소스들로 SymbolTable 구축
async function makeTable(sources: Record<string, string>): Promise<SymbolTable> {
  const table = createSymbolTable();
  for (const [file, src] of Object.entries(sources)) {
    addParsedFile(table, await parseDartSource(src, file));
  }
  return table;
}

const PATH_SRC = `
class UnIPath {
  static const String SPLASH = "/splash";
  static const String MAIN = "/main";
  static const String DETAIL = "/detail";
}
`;

const SCREENS_SRC = `
import 'package:flutter/material.dart';
class SplashScreen extends StatelessWidget {}
class MainScreen extends StatelessWidget {}
class DetailScreen extends StatelessWidget {}
`;

describe("discoverGetxRoutes — GetPage 파싱", () => {
  it("리터럴 name + arrow page 빌더를 파싱한다", async () => {
    const routeSrc = `
      class AppRoutes {
        static final routes = [
          GetPage(name: "/splash", page: () => const SplashScreen()),
        ];
      }
    `;
    const table = await makeTable({
      "lib/routes.dart": routeSrc,
      "lib/screens.dart": SCREENS_SRC,
    });
    const result = discoverGetxRoutes(table);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.route).toBe("/splash");
    expect(result.pages[0]!.className).toBe("SplashScreen");
    expect(result.routeMap.get("/splash")).toBe("SplashScreen");
  });

  it("상수 참조 name + block 바디 page를 해석한다", async () => {
    const routeSrc = `
      class AppRoutes {
        static final routes = [
          GetPage(name: UnIPath.MAIN, page: () { return const MainScreen(); }),
        ];
      }
    `;
    const table = await makeTable({
      "lib/path.dart": PATH_SRC,
      "lib/routes.dart": routeSrc,
      "lib/screens.dart": SCREENS_SRC,
    });
    const result = discoverGetxRoutes(table);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.route).toBe("/main");
    expect(result.pages[0]!.className).toBe("MainScreen");
    expect(result.routeMap.get("/main")).toBe("MainScreen");
  });

  it("GetPage 위치(file/line)를 기록한다", async () => {
    const routeSrc = `class R {
  static final routes = [
    GetPage(name: "/a", page: () => const SplashScreen()),
  ];
}`;
    const table = await makeTable({
      "lib/r.dart": routeSrc,
      "lib/screens.dart": SCREENS_SRC,
    });
    const result = discoverGetxRoutes(table);
    expect(result.pages[0]!.file).toBe("lib/r.dart");
    expect(result.pages[0]!.line).toBe(3);
  });

  it("미해석 name(변수)은 route=undefined + routeRaw 보존", async () => {
    const routeSrc = `
      class R {
        static final routes = [
          GetPage(name: dynamicRoute, page: () => const DetailScreen()),
        ];
      }
    `;
    const table = await makeTable({
      "lib/r.dart": routeSrc,
      "lib/screens.dart": SCREENS_SRC,
    });
    const result = discoverGetxRoutes(table);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.route).toBeUndefined();
    expect(result.pages[0]!.routeRaw).toBe("dynamicRoute");
    expect(result.pages[0]!.className).toBe("DetailScreen");
  });

  it("동일 라우트 중복 시 첫 번째 클래스를 유지한다 (결정론)", async () => {
    const routeSrc = `
      class R {
        static final routes = [
          GetPage(name: "/x", page: () => const SplashScreen()),
          GetPage(name: "/x", page: () => const MainScreen()),
        ];
      }
    `;
    const table = await makeTable({
      "lib/r.dart": routeSrc,
      "lib/screens.dart": SCREENS_SRC,
    });
    const result = discoverGetxRoutes(table);
    expect(result.routeMap.get("/x")).toBe("SplashScreen");
  });
});

describe("discoverGetxRoutes — GetMaterialApp / entry", () => {
  it("GetMaterialApp이 있으면 isGetxApp=true, initialRoute 상수를 해석해 entryClass를 찾는다", async () => {
    const mainSrc = `
      import 'package:get/get.dart';
      void main() {
        runApp(GetMaterialApp(
          initialRoute: UnIPath.SPLASH,
          getPages: AppRoutes.routes,
        ));
      }
    `;
    const routeSrc = `
      class AppRoutes {
        static final routes = [
          GetPage(name: UnIPath.SPLASH, page: () => const SplashScreen()),
          GetPage(name: UnIPath.MAIN, page: () => const MainScreen()),
        ];
      }
    `;
    const table = await makeTable({
      "lib/main.dart": mainSrc,
      "lib/path.dart": PATH_SRC,
      "lib/routes.dart": routeSrc,
      "lib/screens.dart": SCREENS_SRC,
    });
    const result = discoverGetxRoutes(table);
    expect(result.isGetxApp).toBe(true);
    expect(result.initialRoute).toBe("/splash");
    expect(result.entryClass).toBe("SplashScreen");
  });

  it("GetMaterialApp 없는 프로젝트는 isGetxApp=false", async () => {
    const table = await makeTable({ "lib/screens.dart": SCREENS_SRC });
    const result = discoverGetxRoutes(table);
    expect(result.isGetxApp).toBe(false);
    expect(result.pages).toHaveLength(0);
  });

  it("initialRoute가 리터럴이어도 해석한다", async () => {
    const mainSrc = `
      void main() {
        runApp(GetMaterialApp(initialRoute: "/main", getPages: R.routes));
      }
    `;
    const routeSrc = `
      class R {
        static final routes = [
          GetPage(name: "/main", page: () => const MainScreen()),
        ];
      }
    `;
    const table = await makeTable({
      "lib/main.dart": mainSrc,
      "lib/routes.dart": routeSrc,
      "lib/screens.dart": SCREENS_SRC,
    });
    const result = discoverGetxRoutes(table);
    expect(result.initialRoute).toBe("/main");
    expect(result.entryClass).toBe("MainScreen");
  });
});
