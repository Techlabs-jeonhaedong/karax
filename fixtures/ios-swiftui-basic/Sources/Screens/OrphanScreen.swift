import SwiftUI

/// OrphanScreen — 어떤 라우트/네비게이션에도 연결되지 않은 화면
/// heuristic candidate 발견 검증용: NavigationLink/라우트 등록 없이 존재하는 최상위 뷰
struct OrphanScreen: View {
    private let statsData: [StatItem] = [
        StatItem(label: "Total Sales", value: "12,482", icon: "chart.bar.fill", color: .blue),
        StatItem(label: "Active Users", value: "3,701", icon: "person.3.fill", color: .green),
        StatItem(label: "Revenue", value: "$84,200", icon: "dollarsign.circle.fill", color: .orange),
        StatItem(label: "Pending Orders", value: "47", icon: "clock.fill", color: .red)
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // 헤더
                VStack(alignment: .leading, spacing: 6) {
                    Text("Analytics Dashboard")
                        .font(.largeTitle)
                        .fontWeight(.bold)
                        .foregroundColor(.primary)
                    Text("Internal metrics — not linked from navigation")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)

                // 통계 그리드
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                    ForEach(statsData) { stat in
                        StatCard(item: stat)
                    }
                }
                .padding(.horizontal, 20)

                // 차트 플레이스홀더
                VStack(alignment: .leading, spacing: 12) {
                    Text("Weekly Trend")
                        .font(.headline)
                        .foregroundColor(.primary)

                    HStack(alignment: .bottom, spacing: 8) {
                        ForEach(weeklyData, id: \.day) { point in
                            VStack(spacing: 4) {
                                RoundedRectangle(cornerRadius: 4)
                                    .fill(Color.blue.opacity(0.7))
                                    .frame(width: 32, height: CGFloat(point.value))
                                Text(point.day)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 140)
                    .padding(16)
                    .background(Color(.systemBackground))
                    .cornerRadius(12)
                }
                .padding(.horizontal, 20)

                Spacer(minLength: 32)
            }
        }
        .navigationTitle("Analytics")
        .background(Color(.systemGroupedBackground))
    }

    private let weeklyData: [WeekPoint] = [
        WeekPoint(day: "Mon", value: 80),
        WeekPoint(day: "Tue", value: 110),
        WeekPoint(day: "Wed", value: 65),
        WeekPoint(day: "Thu", value: 130),
        WeekPoint(day: "Fri", value: 95),
        WeekPoint(day: "Sat", value: 50),
        WeekPoint(day: "Sun", value: 40)
    ]
}

// MARK: - 서브 뷰

private struct StatCard: View {
    let item: StatItem

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: item.icon)
                .font(.title2)
                .foregroundColor(item.color)

            Text(item.value)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.primary)

            Text(item.label)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(2)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.06), radius: 6, x: 0, y: 3)
    }
}

// MARK: - 모델

private struct StatItem: Identifiable {
    let id = UUID()
    let label: String
    let value: String
    let icon: String
    let color: Color
}

private struct WeekPoint {
    let day: String
    let value: Int
}
