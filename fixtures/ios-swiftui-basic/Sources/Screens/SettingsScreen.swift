import SwiftUI

/// SettingsScreen — 테마 토큰 참조 화면
/// 하드코딩 색 금지, 프레임워크 테마 시스템 사용(.foregroundStyle(.tint), Color(.systemBackground) 등)
struct SettingsScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("darkModeOverride") private var darkModeOverride = false
    @AppStorage("fontSize") private var fontSize: Double = 16
    @AppStorage("selectedAccent") private var selectedAccent = "blue"

    private let accentOptions = ["blue", "purple", "orange", "green", "red"]

    var body: some View {
        Form {
            // 섹션 1: 외관
            Section {
                Toggle(isOn: $darkModeOverride) {
                    Label("Dark Mode", systemImage: "moon.fill")
                        .foregroundStyle(.primary)
                }
                .tint(.tint)

                HStack {
                    Label("Font Size", systemImage: "textformat.size")
                        .foregroundStyle(.primary)
                    Spacer()
                    Slider(value: $fontSize, in: 12...24, step: 1)
                        .frame(width: 120)
                        .tint(.tint)
                    Text("\(Int(fontSize))pt")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 36)
                }

                HStack {
                    Label("Accent Color", systemImage: "paintpalette.fill")
                        .foregroundStyle(.primary)
                    Spacer()
                    ForEach(accentOptions, id: \.self) { accent in
                        Circle()
                            .fill(colorForAccent(accent))
                            .frame(width: 22, height: 22)
                            .overlay(
                                Circle()
                                    .stroke(selectedAccent == accent ? Color.primary : Color.clear, lineWidth: 2)
                            )
                            .onTapGesture { selectedAccent = accent }
                    }
                }
            } header: {
                Text("Appearance")
                    .foregroundStyle(.secondary)
            }

            // 섹션 2: 알림
            Section {
                Toggle(isOn: $notificationsEnabled) {
                    Label("Push Notifications", systemImage: "bell.fill")
                        .foregroundStyle(.primary)
                }
                .tint(.tint)

                if notificationsEnabled {
                    Label("Sound & Haptics", systemImage: "speaker.wave.2.fill")
                        .foregroundStyle(.primary)
                    Label("Badge Count", systemImage: "app.badge.fill")
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Notifications")
                    .foregroundStyle(.secondary)
            }

            // 섹션 3: 계정
            Section {
                HStack {
                    Circle()
                        .fill(.tint.opacity(0.2))
                        .frame(width: 44, height: 44)
                        .overlay(
                            Image(systemName: "person.fill")
                                .foregroundStyle(.tint)
                        )
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Alex Johnson")
                            .font(.headline)
                            .foregroundStyle(.primary)
                        Text("alex@example.com")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)

                Button(role: .destructive) {
                    // 로그아웃 액션
                } label: {
                    Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                        .foregroundStyle(.red)
                }
            } header: {
                Text("Account")
                    .foregroundStyle(.secondary)
            }

            // 섹션 4: 앱 정보
            Section {
                HStack {
                    Text("Version")
                        .foregroundStyle(.primary)
                    Spacer()
                    Text("1.0.0 (42)")
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Text("Color Scheme")
                        .foregroundStyle(.primary)
                    Spacer()
                    Text(colorScheme == .dark ? "Dark" : "Light")
                        .foregroundStyle(.secondary)
                }
                // LogoColor 토큰 사용 — Assets.xcassets 컬러셋 참조 검증용
                HStack {
                    Circle()
                        .fill(Color("LogoColor"))
                        .frame(width: 16, height: 16)
                    Text("Brand Color")
                        .foregroundStyle(Color("LogoColor"))
                }
                Link(destination: URL(string: "https://example.com/privacy")!) {
                    Label("Privacy Policy", systemImage: "hand.raised.fill")
                        .foregroundStyle(.tint)
                }
            } header: {
                Text("About")
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
    }

    private func colorForAccent(_ name: String) -> Color {
        switch name {
        case "blue": return .blue
        case "purple": return .purple
        case "orange": return .orange
        case "green": return .green
        case "red": return .red
        default: return .blue
        }
    }
}
