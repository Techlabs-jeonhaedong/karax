import 'package:get/get.dart';

import 'app_path.dart';
import '../screens/splash_screen.dart';
import '../screens/home_screen.dart';
import '../screens/detail_screen.dart';
import '../screens/settings_screen.dart';

/// 라우트 테이블 — main.dart가 아닌 별도 파일 (youandi_front의 UnIRoute 패턴).
class AppRoutes {
  static final routes = [
    GetPage(name: AppPath.SPLASH, page: () => const SplashScreen()),
    GetPage(
      name: AppPath.HOME,
      page: () {
        return const HomeScreen();
      },
    ),
    GetPage(name: AppPath.DETAIL, page: () => const DetailScreen()),
    GetPage(name: AppPath.SETTINGS, page: () => const SettingsScreen()),
  ];
}
