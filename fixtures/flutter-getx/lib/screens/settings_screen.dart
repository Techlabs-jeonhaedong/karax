import 'package:flutter/material.dart';
import 'package:get/get.dart';

import 'detail_screen.dart';

/// 설정 — Get.to(() => 위젯) 빌더 패턴.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: Column(
        children: [
          ElevatedButton(
            onPressed: () {
              Get.to(() => const DetailScreen());
            },
            child: const Text('Open Detail Directly'),
          ),
        ],
      ),
    );
  }
}
