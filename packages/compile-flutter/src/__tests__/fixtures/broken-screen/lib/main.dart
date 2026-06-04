import 'package:flutter/material.dart';
import 'screens/broken_screen.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Broken Screen Fixture',
      home: const BrokenScreen(),
    );
  }
}
