import SwiftUI

/// DetailScreen — 커스텀 컴포넌트 합성 화면
/// ProductCard 커스텀 컴포넌트(내부에 PriceTag 포함 — 2단 깊이)를 3회 사용
struct DetailScreen: View {
    private let products: [ProductItem] = [
        ProductItem(
            title: "Wireless Noise-Cancelling Headphones",
            description: "Premium over-ear headphones with 30-hour battery life and advanced ANC technology.",
            imageName: "product-headphones",
            originalPrice: 299.99,
            discountedPrice: 199.99,
            badge: "SALE"
        ),
        ProductItem(
            title: "Mechanical Keyboard Pro",
            description: "Tactile typing experience with RGB backlight. Compatible with Mac and Windows.",
            imageName: "product-keyboard",
            originalPrice: 149.00,
            discountedPrice: nil,
            badge: "NEW"
        ),
        ProductItem(
            title: "USB-C Hub 7-in-1",
            description: "Expand your laptop ports. Supports 4K HDMI, 100W PD, SD card, and 3x USB-A.",
            imageName: "product-hub",
            originalPrice: 89.99,
            discountedPrice: 69.99,
            badge: nil
        )
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Featured Products")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
                    .padding(.horizontal, 20)
                    .padding(.top, 16)

                Text("Hand-picked by our team this week")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 20)

                // ProductCard 3회 사용 (커스텀 컴포넌트 합성 검증)
                ForEach(products) { product in
                    ProductCard(
                        title: product.title,
                        description: product.description,
                        imageName: product.imageName,
                        originalPrice: product.originalPrice,
                        discountedPrice: product.discountedPrice,
                        badge: product.badge
                    )
                    .padding(.horizontal, 20)
                }

                Spacer(minLength: 32)
            }
        }
        .navigationTitle("Detail")
        .navigationBarTitleDisplayMode(.large)
        .background(Color(.systemGroupedBackground))
    }
}

// MARK: - 내부 모델

private struct ProductItem: Identifiable {
    let id = UUID()
    let title: String
    let description: String
    let imageName: String
    let originalPrice: Double
    let discountedPrice: Double?
    let badge: String?
}
