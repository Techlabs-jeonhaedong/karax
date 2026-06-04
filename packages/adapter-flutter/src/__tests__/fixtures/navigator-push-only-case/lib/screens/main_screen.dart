import 'package:flutter/material.dart';

import 'secondary_screen.dart';

class MainScreen extends StatelessWidget {
  const MainScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Main')),
      body: ElevatedButton(
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (context) => const SecondaryScreen(),
            ),
          );
        },
        child: const Text('Go to Secondary'),
      ),
    );
  }
}
