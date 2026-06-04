import 'package:flutter/material.dart';

/// OrphanScreen — 어떤 라우트/네비게이션에도 연결되지 않은 화면.
/// 아키타입 5: heuristic candidate 발견 검증용.
/// 이 화면은 main.dart의 routes 테이블과 Navigator.push 어디에도 등록되지 않는다.
/// 어댑터가 이 화면을 "route"가 아닌 "candidate"로 발견해야 한다.
class OrphanScreen extends StatelessWidget {
  const OrphanScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFFF8E1),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFF8F00),
        foregroundColor: Colors.white,
        title: const Text(
          'Orphan Screen',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20),
        ),
        elevation: 2,
      ),
      body: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                color: const Color(0xFFFFE082),
                borderRadius: BorderRadius.circular(50),
              ),
              child: const Icon(
                Icons.link_off,
                size: 52,
                color: Color(0xFFFF8F00),
              ),
            ),
            const SizedBox(height: 32),
            const Text(
              'Orphan Screen',
              style: TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1C1B1F),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            const Text(
              'This screen is not connected to any route or navigation entry. '
              'It exists as a standalone widget that the heuristic discovery '
              'algorithm should detect as a "candidate" screen.',
              style: TextStyle(
                fontSize: 15,
                color: Color(0xFF49454F),
                height: 1.6,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 40),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFFFFECB3),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFFFCC02), width: 1.5),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.info_outline, color: Color(0xFFFF8F00), size: 18),
                      SizedBox(width: 8),
                      Text(
                        'Discovery note',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFFFF8F00),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Expected discovery: candidate (not route)\n'
                    'The heuristic scanner should find this screen\n'
                    'via the *Screen class name suffix.',
                    style: TextStyle(
                      fontSize: 13,
                      color: Color(0xFF5D4037),
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
