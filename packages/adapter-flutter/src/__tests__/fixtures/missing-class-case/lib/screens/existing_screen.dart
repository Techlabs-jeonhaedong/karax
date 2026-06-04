import 'package:flutter/material.dart';

/// ExistingScreen — the only real screen in this fixture.
/// Used to verify that the adapter finds it as a route while emitting
/// UNRESOLVED_CLASS diagnostic for MissingScreen.
class ExistingScreen extends StatelessWidget {
  const ExistingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Existing Screen')),
      body: const Center(child: Text('This screen exists.')),
    );
  }
}
