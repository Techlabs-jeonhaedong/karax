import SwiftUI

/// ListScreen — 조건부 렌더링(로딩/빈/데이터 3분기) + 컬렉션 반복 렌더
struct ListScreen: View {
    @State private var viewState: ListViewState = .loading
    @State private var searchText = ""

    private var filteredItems: [CatalogItem] {
        guard case .data(let items) = viewState else { return [] }
        if searchText.isEmpty { return items }
        return items.filter { $0.name.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        Group {
            // 조건부 렌더링 3분기: 로딩 / 빈 / 데이터
            switch viewState {
            case .loading:
                loadingView

            case .empty:
                emptyView

            case .data:
                dataView
            }
        }
        .navigationTitle("Catalog")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button("Show Loading") { viewState = .loading }
                    Button("Show Empty") { viewState = .empty }
                    Button("Show Data") { viewState = .data(CatalogItem.samples) }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .searchable(text: $searchText, prompt: "Search items")
        .onAppear {
            simulateLoad()
        }
    }

    // MARK: - 분기 뷰

    private var loadingView: some View {
        VStack(spacing: 20) {
            ProgressView()
                .scaleEffect(1.5)
            Text("Loading catalog...")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyView: some View {
        VStack(spacing: 16) {
            Image(systemName: "tray.fill")
                .font(.system(size: 56))
                .foregroundColor(.gray.opacity(0.4))
            Text("No Items Found")
                .font(.headline)
                .foregroundColor(.primary)
            Text("Try adjusting your search or check back later.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Button("Refresh") {
                viewState = .loading
                simulateLoad()
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var dataView: some View {
        List(filteredItems) { item in
            CatalogRow(item: item)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - 헬퍼

    private func simulateLoad() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            viewState = .data(CatalogItem.samples)
        }
    }
}

// MARK: - 행 뷰

private struct CatalogRow: View {
    let item: CatalogItem

    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 10)
                .fill(item.color.opacity(0.15))
                .frame(width: 56, height: 56)
                .overlay(
                    Image(systemName: item.systemIcon)
                        .font(.title2)
                        .foregroundColor(item.color)
                )

            VStack(alignment: .leading, spacing: 4) {
                Text(item.name)
                    .font(.headline)
                    .foregroundColor(.primary)
                Text(item.category)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text("$\(item.price, specifier: "%.2f")")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                if item.isOnSale {
                    Text("SALE")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.red)
                        .cornerRadius(4)
                }
            }
        }
        .padding(14)
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 2)
    }
}

// MARK: - 상태 & 모델

private enum ListViewState {
    case loading
    case empty
    case data([CatalogItem])
}

private struct CatalogItem: Identifiable {
    let id = UUID()
    let name: String
    let category: String
    let price: Double
    let systemIcon: String
    let color: Color
    let isOnSale: Bool

    static let samples: [CatalogItem] = [
        CatalogItem(name: "Wireless Earbuds", category: "Audio", price: 79.99, systemIcon: "airpodspro", color: .blue, isOnSale: false),
        CatalogItem(name: "Smart Watch", category: "Wearables", price: 249.00, systemIcon: "applewatch", color: .green, isOnSale: true),
        CatalogItem(name: "Laptop Stand", category: "Accessories", price: 39.99, systemIcon: "macbook.and.ipad", color: .purple, isOnSale: false),
        CatalogItem(name: "Portable Charger", category: "Power", price: 49.99, systemIcon: "battery.100.bolt", color: .orange, isOnSale: true),
        CatalogItem(name: "Webcam HD", category: "Cameras", price: 89.00, systemIcon: "camera.fill", color: .red, isOnSale: false),
        CatalogItem(name: "Mouse Pad XL", category: "Accessories", price: 19.99, systemIcon: "rectangle.fill", color: .indigo, isOnSale: false),
        CatalogItem(name: "USB-C Cable", category: "Cables", price: 14.99, systemIcon: "cable.connector", color: .teal, isOnSale: true)
    ]
}
