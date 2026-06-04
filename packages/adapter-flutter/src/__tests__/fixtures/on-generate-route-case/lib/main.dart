import 'package:flutter/material.dart';

import 'screens/dashboard_screen.dart';
import 'screens/profile_screen.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'OnGenerateRoute Fixture',
      initialRoute: '/',
      onGenerateRoute: (settings) {
        switch (settings.name) {
          case '/':
            return MaterialPageRoute(
              builder: (_) => const DashboardScreen(),
            );
          case '/profile':
            return MaterialPageRoute(
              builder: (_) => const ProfileScreen(),
            );
          default:
            return null;
        }
      },
    );
  }
}
