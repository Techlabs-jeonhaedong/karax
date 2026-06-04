import 'package:flutter/material.dart';

import '../widgets/product_card.dart';

/// DetailScreen — 커스텀 컴포넌트 합성 화면.
/// 아키타입 2: ProductCard(PriceTag 내포)를 3회 사용 — 2단 깊이 인라이닝 검증용.
class DetailScreen extends StatelessWidget {
  const DetailScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF3EFF4),
      appBar: AppBar(
        backgroundColor: const Color(0xFF6750A4),
        foregroundColor: Colors.white,
        title: const Text(
          'Product Catalog',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20),
        ),
        leading: const BackButton(),
        elevation: 2,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Featured Products',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1C1B1F),
              ),
            ),
            const SizedBox(height: 6),
            const Text(
              'Hand-picked items just for you',
              style: TextStyle(fontSize: 14, color: Color(0xFF79747E)),
            ),
            const SizedBox(height: 24),
            // ProductCard 1회 사용
            const ProductCard(
              name: 'Wireless Headphones',
              description: 'Premium noise-cancelling audio with 30-hour battery life and foldable design.',
              price: 79.99,
              originalPrice: 129.99,
              imageUrl: 'https://picsum.photos/seed/headphone/400/200',
              badge: 'SALE',
            ),
            // ProductCard 2회 사용
            const ProductCard(
              name: 'Mechanical Keyboard',
              description: 'Tactile switches with RGB backlight, aluminum frame, and USB-C connectivity.',
              price: 149.00,
              imageUrl: 'https://picsum.photos/seed/keyboard/400/200',
              badge: 'NEW',
            ),
            // ProductCard 3회 사용
            const ProductCard(
              name: 'USB-C Hub',
              description: '7-in-1 hub: HDMI 4K, USB 3.0 x3, SD card, PD charging. Plug and play.',
              price: 34.99,
              originalPrice: 49.99,
              imageUrl: 'https://picsum.photos/seed/hub/400/200',
            ),
          ],
        ),
      ),
    );
  }
}
