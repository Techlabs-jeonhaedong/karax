import 'package:flutter/material.dart';
import 'package:get/get.dart';

import '../route/app_path.dart';

/// 스플래시 — 분리 메서드 핸들러에서 Get.offAllNamed (replace 액션).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  void _goHome() {
    Get.offAllNamed(AppPath.HOME);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF6750A4),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'GetX Fixture',
              style: TextStyle(fontSize: 28, color: Colors.white),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _goHome,
              child: const Text('Start'),
            ),
          ],
        ),
      ),
    );
  }
}
