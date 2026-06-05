import 'package:get/get.dart';

import '../route/app_path.dart';

/// 컨트롤러 — 화면 밖(컨트롤러 메서드)에서 네비게이션 (youandi_front 패턴).
class HomeController extends GetxController {
  void openSettings() {
    Get.toNamed(AppPath.SETTINGS);
  }
}
