import SwiftUI

/// ProductCard — 커스텀 컴포넌트 (내부에 PriceTag 포함 — 2단 깊이 인라이닝 검증용)
struct ProductCard: View {
    let title: String
    let description: String
    let imageName: String
    let originalPrice: Double
    let discountedPrice: Double?
    let badge: String?

    init(
        title: String,
        description: String,
        imageName: String,
        originalPrice: Double,
        discountedPrice: Double? = nil,
        badge: String? = nil
    ) {
        self.title = title
        self.description = description
        self.imageName = imageName
        self.originalPrice = originalPrice
        self.discountedPrice = discountedPrice
        self.badge = badge
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // 이미지 영역
            ZStack(alignment: .topLeading) {
                Image(imageName)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity)
                    .frame(height: 160)
                    .clipped()
                    .background(Color.gray.opacity(0.15))

                if let badge = badge {
                    Text(badge)
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.red)
                        .cornerRadius(6)
                        .padding(12)
                }
            }

            // 콘텐츠 영역
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                    .lineLimit(2)

                Text(description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(3)

                // PriceTag 커스텀 컴포넌트 사용 (2단 깊이)
                PriceTag(
                    originalPrice: originalPrice,
                    discountedPrice: discountedPrice
                )
            }
            .padding(14)
        }
        .background(Color(.systemBackground))
        .cornerRadius(14)
        .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 4)
    }
}
