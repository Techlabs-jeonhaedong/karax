import 'package:flutter/material.dart';

import 'screens/existing_screen.dart';
// Note: MissingScreen is intentionally NOT imported/defined anywhere.
// This tests that the route graph discovery emits UNRESOLVED_CLASS diagnostic
// and excludes the missing class from the discovered screen list.

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Missing Class Fixture',
      routes: {
        '/': (context) => const ExistingScreen(),
        '/missing': (context) => const MissingScreen(), // class does not exist
      },
      initialRoute: '/',
    );
  }
}
