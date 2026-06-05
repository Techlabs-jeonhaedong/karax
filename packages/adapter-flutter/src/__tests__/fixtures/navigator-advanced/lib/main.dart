import 'package:flutter/material.dart';
import 'screens/a_screen.dart';
import 'screens/b_screen.dart';

void main() => runApp(const App());

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: const AScreen(),
      routes: {
        '/b': (context) => const BScreen(),
      },
    );
  }
}
