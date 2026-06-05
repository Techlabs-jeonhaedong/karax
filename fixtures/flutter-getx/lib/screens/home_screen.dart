import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../controller/home_controller.dart';
import '../route/app_path.dart';

/// 홈 — 인라인 onPressed(Get.toNamed 상수), 컨트롤러 메서드 경유 onTap 혼재.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(HomeController());
    return Scaffold(
      appBar: AppBar(title: const Text('Home')),
      body: Column(
        children: [
          ElevatedButton(
            onPressed: () {
              Get.toNamed(AppPath.DETAIL);
            },
            child: const Text('Open Detail'),
          ),
          const SizedBox(height: 16),
          GestureDetector(
            onTap: () => controller.openSettings(),
            child: const Text('Open Settings'),
          ),
        ],
      ),
    );
  }
}
