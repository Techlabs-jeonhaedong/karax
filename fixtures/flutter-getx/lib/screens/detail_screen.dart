import 'package:flutter/material.dart';
import 'package:get/get.dart';

/// 상세 — Get.back(pop) + Get.to 빌더 직접 이동.
class DetailScreen extends StatelessWidget {
  const DetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Detail')),
      body: Column(
        children: [
          ElevatedButton(
            onPressed: () {
              Get.back();
            },
            child: const Text('Go Back'),
          ),
        ],
      ),
    );
  }
}
