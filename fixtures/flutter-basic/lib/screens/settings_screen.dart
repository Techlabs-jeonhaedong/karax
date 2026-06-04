import 'package:flutter/material.dart';

/// SettingsScreen — 테마 토큰 참조 화면.
/// 아키타입 4: 하드코딩 색 금지, Theme.of(context).colorScheme 전용.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _notificationsEnabled = true;
  bool _darkModeEnabled = false;
  bool _analyticsEnabled = false;
  String _selectedLanguage = 'English';
  double _textScaleFactor = 1.0;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      backgroundColor: colorScheme.surface,
      appBar: AppBar(
        backgroundColor: colorScheme.primaryContainer,
        foregroundColor: colorScheme.onPrimaryContainer,
        title: Text(
          'Settings',
          style: textTheme.titleLarge?.copyWith(
            color: colorScheme.onPrimaryContainer,
          ),
        ),
        leading: BackButton(color: colorScheme.onPrimaryContainer),
        elevation: 0,
      ),
      body: ListView(
        children: [
          _SectionHeader(
            label: 'Appearance',
            colorScheme: colorScheme,
            textTheme: textTheme,
          ),
          _SettingsTile(
            icon: Icons.dark_mode_outlined,
            title: 'Dark Mode',
            subtitle: 'Switch to dark theme',
            colorScheme: colorScheme,
            textTheme: textTheme,
            trailing: Switch(
              value: _darkModeEnabled,
              onChanged: (value) => setState(() => _darkModeEnabled = value),
              activeThumbColor: colorScheme.primary,
            ),
          ),
          _SettingsTile(
            icon: Icons.text_fields,
            title: 'Text Size',
            subtitle: 'Scale: ${_textScaleFactor.toStringAsFixed(1)}x',
            colorScheme: colorScheme,
            textTheme: textTheme,
            trailing: SizedBox(
              width: 120,
              child: Slider(
                value: _textScaleFactor,
                min: 0.8,
                max: 1.4,
                divisions: 6,
                onChanged: (value) => setState(() => _textScaleFactor = value),
                activeColor: colorScheme.primary,
              ),
            ),
          ),
          _SectionHeader(
            label: 'Notifications',
            colorScheme: colorScheme,
            textTheme: textTheme,
          ),
          _SettingsTile(
            icon: Icons.notifications_outlined,
            title: 'Push Notifications',
            subtitle: _notificationsEnabled ? 'Enabled' : 'Disabled',
            colorScheme: colorScheme,
            textTheme: textTheme,
            trailing: Switch(
              value: _notificationsEnabled,
              onChanged: (value) => setState(() => _notificationsEnabled = value),
              activeThumbColor: colorScheme.primary,
            ),
          ),
          _SectionHeader(
            label: 'Privacy',
            colorScheme: colorScheme,
            textTheme: textTheme,
          ),
          _SettingsTile(
            icon: Icons.analytics_outlined,
            title: 'Analytics',
            subtitle: 'Help improve the app',
            colorScheme: colorScheme,
            textTheme: textTheme,
            trailing: Switch(
              value: _analyticsEnabled,
              onChanged: (value) => setState(() => _analyticsEnabled = value),
              activeThumbColor: colorScheme.primary,
            ),
          ),
          _SectionHeader(
            label: 'Localization',
            colorScheme: colorScheme,
            textTheme: textTheme,
          ),
          _SettingsTile(
            icon: Icons.language,
            title: 'Language',
            subtitle: _selectedLanguage,
            colorScheme: colorScheme,
            textTheme: textTheme,
            trailing: DropdownButton<String>(
              value: _selectedLanguage,
              underline: const SizedBox(),
              style: TextStyle(color: colorScheme.primary, fontSize: 14),
              items: const [
                DropdownMenuItem(value: 'English', child: Text('English')),
                DropdownMenuItem(value: 'Korean', child: Text('Korean')),
                DropdownMenuItem(value: 'Japanese', child: Text('Japanese')),
              ],
              onChanged: (value) {
                if (value != null) setState(() => _selectedLanguage = value);
              },
            ),
          ),
          const SizedBox(height: 24),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton.icon(
              onPressed: () {},
              icon: Icon(Icons.logout, color: colorScheme.error),
              label: Text(
                'Sign Out',
                style: TextStyle(color: colorScheme.error),
              ),
              style: OutlinedButton.styleFrom(
                side: BorderSide(color: colorScheme.error),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
            ),
          ),
          const SizedBox(height: 40),
          Center(
            child: Text(
              'Version 1.0.0 (fixture)',
              style: textTheme.bodyMedium?.copyWith(
                color: colorScheme.outline,
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}

// ─── Shared sub-widgets ──────────────────────────────────────────────────────

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.label,
    required this.colorScheme,
    required this.textTheme,
  });

  final String label;
  final ColorScheme colorScheme;
  final TextTheme textTheme;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
      child: Text(
        label.toUpperCase(),
        style: textTheme.bodyMedium?.copyWith(
          color: colorScheme.primary,
          fontWeight: FontWeight.bold,
          letterSpacing: 1.2,
          fontSize: 12,
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.colorScheme,
    required this.textTheme,
    required this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final ColorScheme colorScheme;
  final TextTheme textTheme;
  final Widget trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
      ),
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: colorScheme.primaryContainer,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: colorScheme.onPrimaryContainer, size: 20),
        ),
        title: Text(
          title,
          style: textTheme.bodyLarge?.copyWith(
            fontWeight: FontWeight.w600,
            color: colorScheme.onSurface,
          ),
        ),
        subtitle: Text(
          subtitle,
          style: textTheme.bodyMedium?.copyWith(
            color: colorScheme.onSurfaceVariant,
          ),
        ),
        trailing: trailing,
      ),
    );
  }
}
