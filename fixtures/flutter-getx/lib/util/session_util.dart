import 'package:get/get.dart';

import '../route/app_path.dart';

/// 유틸 — 어떤 화면에도 속하지 않는 전역 네비게이션 (from 특정 불가 케이스).
class SessionUtil {
  static void forceLogout() {
    Get.offAllNamed(AppPath.SPLASH);
  }
}
