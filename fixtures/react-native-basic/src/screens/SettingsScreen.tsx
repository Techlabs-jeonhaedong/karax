import React, { useState } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { colors, spacing, typography, borderRadius } from '../theme';

type SettingsScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Settings'>;

interface Props {
  navigation: SettingsScreenNavigationProp;
}

interface SettingRowProps {
  label: string;
  description?: string;
  value: boolean;
  onToggle: (val: boolean) => void;
}

function SettingRow({ label, description, value, onToggle }: SettingRowProps): React.JSX.Element {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingInfo}>
        <Text style={styles.settingLabel}>{label}</Text>
        {description !== undefined && (
          <Text style={styles.settingDescription}>{description}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.divider, true: colors.primaryVariant }}
        thumbColor={value ? colors.primary : colors.surface}
      />
    </View>
  );
}

interface MenuItemProps {
  label: string;
  chevron?: boolean;
  onPress: () => void;
}

function MenuItem({ label, chevron = true, onPress }: MenuItemProps): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.menuItem} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.menuLabel}>{label}</Text>
      {chevron && <Text style={styles.chevron}>›</Text>}
    </TouchableOpacity>
  );
}

export default function SettingsScreen({ navigation }: Props): React.JSX.Element {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarInitials}>JD</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>Jane Doe</Text>
            <Text style={styles.profileEmail}>jane.doe@example.com</Text>
          </View>
        </View>

        {/* Notifications section */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.card}>
          <SettingRow
            label="Push Notifications"
            description="Receive alerts for orders and promotions"
            value={pushEnabled}
            onToggle={setPushEnabled}
          />
          <View style={styles.divider} />
          <SettingRow
            label="Email Digest"
            description="Weekly summary of activity"
            value={emailEnabled}
            onToggle={setEmailEnabled}
          />
        </View>

        {/* Appearance section */}
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.card}>
          <SettingRow
            label="Dark Mode"
            description="Use dark color scheme throughout the app"
            value={darkMode}
            onToggle={setDarkMode}
          />
        </View>

        {/* Privacy section */}
        <Text style={styles.sectionTitle}>Privacy</Text>
        <View style={styles.card}>
          <SettingRow
            label="Usage Analytics"
            description="Help improve the app with anonymous data"
            value={analyticsEnabled}
            onToggle={setAnalyticsEnabled}
          />
          <View style={styles.divider} />
          <MenuItem label="Privacy Policy" onPress={() => {}} />
          <View style={styles.divider} />
          <MenuItem label="Terms of Service" onPress={() => {}} />
        </View>

        {/* Account section */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <MenuItem label="Change Password" onPress={() => {}} />
          <View style={styles.divider} />
          <MenuItem label="Manage Devices" onPress={() => {}} />
          <View style={styles.divider} />
          <MenuItem label="Delete Account" onPress={() => {}} />
        </View>

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutButton} activeOpacity={0.8}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Version 1.0.0 (build 42)</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.cardBackground,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.secondary,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    elevation: 4,
    shadowColor: colors.onBackground,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  backButton: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  backButtonText: {
    ...typography.body1,
    color: colors.onSecondary,
    fontWeight: '500',
  },
  headerTitle: {
    ...typography.h3,
    color: colors.onSecondary,
  },
  headerRight: {
    width: 60,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    elevation: 2,
    shadowColor: colors.onBackground,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    ...typography.h3,
    color: colors.onPrimary,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  profileEmail: {
    ...typography.body2,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    elevation: 1,
    shadowColor: colors.onBackground,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    marginBottom: spacing.sm,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  settingLabel: {
    ...typography.body1,
    color: colors.textPrimary,
  },
  settingDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
  },
  menuLabel: {
    ...typography.body1,
    color: colors.textPrimary,
  },
  chevron: {
    fontSize: 20,
    color: colors.textSecondary,
    fontWeight: '300',
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginHorizontal: spacing.md,
  },
  signOutButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  signOutText: {
    ...typography.button,
    color: colors.onError,
    letterSpacing: 0.5,
  },
  versionText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
