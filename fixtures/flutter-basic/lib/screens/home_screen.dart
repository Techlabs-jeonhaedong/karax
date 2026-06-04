import 'package:flutter/material.dart';

import 'detail_screen.dart';

/// HomeScreen — 표준 위젯만 사용하는 기준 화면.
/// 아키타입 1: 앱바/헤더, 제목·본문 Text, 로컬 asset 이미지 + 네트워크 이미지, 버튼 2개, 명시적 padding/색상.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F4FF),
      appBar: AppBar(
        backgroundColor: const Color(0xFF6750A4),
        foregroundColor: Colors.white,
        title: const Text(
          'Flutter Basic Fixture',
          style: TextStyle(
            fontWeight: FontWeight.bold,
            fontSize: 20,
          ),
        ),
        centerTitle: false,
        elevation: 2,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 제목
            const Text(
              'Welcome to the Fixture App',
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1C1B1F),
              ),
            ),
            const SizedBox(height: 12),
            // 본문 텍스트
            const Text(
              'This is a reference fixture app for the screenshot-from-code tool. '
              'Each screen demonstrates a specific UI archetype used for static analysis and rendering tests.',
              style: TextStyle(
                fontSize: 16,
                color: Color(0xFF49454F),
                height: 1.6,
              ),
            ),
            const SizedBox(height: 32),
            // 로컬 asset 이미지
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.asset(
                'assets/images/logo.png',
                width: 64,
                height: 64,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Logo (local asset)',
              style: TextStyle(fontSize: 12, color: Color(0xFF79747E)),
            ),
            const SizedBox(height: 24),
            // 네트워크 이미지
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.network(
                'https://picsum.photos/seed/fixture/300/180',
                width: double.infinity,
                height: 180,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) {
                  return Container(
                    width: double.infinity,
                    height: 180,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE8DEF8),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.image_outlined, size: 40, color: Color(0xFF6750A4)),
                          SizedBox(height: 8),
                          Text(
                            'Network image placeholder',
                            style: TextStyle(color: Color(0xFF6750A4), fontSize: 13),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Cover photo (network)',
              style: TextStyle(fontSize: 12, color: Color(0xFF79747E)),
            ),
            const SizedBox(height: 40),
            // 버튼 1: Navigator.push(MaterialPageRoute) — 두 발견 경로 검증용
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => const DetailScreen(),
                    ),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF6750A4),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text(
                  'View Product Details',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                ),
              ),
            ),
            const SizedBox(height: 12),
            // 버튼 2: Named route
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.pushNamed(context, '/list');
                    },
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF6750A4),
                      side: const BorderSide(color: Color(0xFF6750A4), width: 1.5),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const Text(
                      'Browse List',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.pushNamed(context, '/settings');
                    },
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF6750A4),
                      side: const BorderSide(color: Color(0xFF6750A4), width: 1.5),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const Text(
                      'Settings',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
