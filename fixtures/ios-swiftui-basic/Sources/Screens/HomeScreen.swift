import SwiftUI

/// HomeScreen — 표준 위젯 화면
/// 앱바/헤더, Text, 로컬 asset 이미지, 네트워크 이미지, 버튼 2개, 명시적 padding/색상 포함
struct HomeScreen: View {
    @State private var isGreetingVisible = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // 헤더 섹션
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Welcome to MyApp")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                            .foregroundColor(.primary)
                            .padding(.top, 16)

                        Text("Discover the best products curated just for you.")
                            .font(.body)
                            .foregroundColor(.secondary)
                            .lineLimit(3)
                    }
                    .padding(.horizontal, 20)

                    // 로컬 asset 이미지
                    Image("hero-banner")
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity)
                        .frame(height: 200)
                        .clipped()
                        .cornerRadius(12)
                        .padding(.horizontal, 20)
                        .background(Color.gray.opacity(0.2))

                    // 네트워크 이미지 (placeholder로 표현)
                    AsyncImage(url: URL(string: "https://picsum.photos/seed/myapp/400/200")) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFill()
                        case .failure:
                            Rectangle()
                                .fill(Color.red.opacity(0.2))
                                .overlay(
                                    Text("Image failed to load")
                                        .foregroundColor(.red)
                                )
                        default:
                            Rectangle()
                                .fill(Color.gray.opacity(0.15))
                                .overlay(
                                    ProgressView()
                                )
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 180)
                    .cornerRadius(12)
                    .padding(.horizontal, 20)

                    // 네비게이션 버튼 섹션
                    VStack(spacing: 12) {
                        NavigationLink(destination: ListScreen()) {
                            HStack {
                                Image(systemName: "list.bullet")
                                    .foregroundColor(.white)
                                Text("Browse Products")
                                    .fontWeight(.semibold)
                                    .foregroundColor(.white)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundColor(.white.opacity(0.8))
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 16)
                            .background(Color.blue)
                            .cornerRadius(12)
                        }

                        NavigationLink(destination: SettingsScreen()) {
                            HStack {
                                Image(systemName: "gearshape.fill")
                                    .foregroundColor(.blue)
                                Text("Settings")
                                    .fontWeight(.semibold)
                                    .foregroundColor(.blue)
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .foregroundColor(.blue.opacity(0.8))
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 16)
                            .background(Color.blue.opacity(0.1))
                            .cornerRadius(12)
                        }
                    }
                    .padding(.horizontal, 20)

                    // Detail 화면 진입 버튼
                    NavigationLink(destination: DetailScreen()) {
                        Text("View Featured Products")
                            .font(.headline)
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color.orange)
                            .cornerRadius(10)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 32)
                }
            }
            .navigationTitle("Home")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { isGreetingVisible.toggle() }) {
                        Image(systemName: "bell.fill")
                            .foregroundColor(.blue)
                    }
                }
            }
        }
    }
}

// ContentView는 HomeScreen의 별칭
typealias ContentView = HomeScreen
