import 'package:flutter/material.dart';
import 'package:get/get.dart';

import 'route/app_path.dart';
import 'route/app_routes.dart';

void main() {
  runApp(const GetxFixtureApp());
}

class GetxFixtureApp extends StatelessWidget {
  const GetxFixtureApp({super.key});

  @override
  Widget build(BuildContext context) {
    return GetMaterialApp(
      title: 'GetX Fixture',
      initialRoute: AppPath.SPLASH,
      getPages: AppRoutes.routes,
    );
  }
}
