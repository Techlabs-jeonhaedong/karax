import 'package:flutter/material.dart';

import 'b_screen.dart';

class AScreen extends StatelessWidget {
  const AScreen({super.key});

  void _clearToB(BuildContext context) {
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const BScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: [
          ElevatedButton(
            onPressed: () {
              Navigator.pushReplacementNamed(context, '/b');
            },
            child: const Text('Replace Named B'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const BScreen()),
            ),
            child: const Text('Of Push B'),
          ),
          ElevatedButton(
            onPressed: () => _clearToB(context),
            child: const Text('Clear To B'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.maybePop(context);
            },
            child: const Text('Maybe Back'),
          ),
        ],
      ),
    );
  }
}
