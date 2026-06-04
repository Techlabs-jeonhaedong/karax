import SwiftUI

/// PriceTag — 가격 표시 커스텀 컴포넌트 (ProductCard 내부에서 사용 — 2단 깊이 인라이닝 검증용)
struct PriceTag: View {
    let originalPrice: Double
    let discountedPrice: Double?

    private var hasDiscount: Bool {
        discountedPrice != nil && discountedPrice! < originalPrice
    }

    var body: some View {
        HStack(spacing: 6) {
            if let discounted = discountedPrice, hasDiscount {
                Text(formatPrice(discounted))
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundColor(.red)

                Text(formatPrice(originalPrice))
                    .font(.subheadline)
                    .strikethrough(true, color: .gray)
                    .foregroundColor(.gray)
            } else {
                Text(formatPrice(originalPrice))
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
            }
        }
    }

    private func formatPrice(_ price: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        return formatter.string(from: NSNumber(value: price)) ?? "$\(price)"
    }
}
