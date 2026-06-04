import 'package:flutter/material.dart';

class SecondaryScreen extends StatelessWidget {
  const SecondaryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Secondary')),
      body: const Text('Secondary Screen'),
    );
  }
}
