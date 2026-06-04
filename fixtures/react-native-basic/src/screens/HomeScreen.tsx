import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';

type HomeScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Home'>;

interface Props {
  navigation: HomeScreenNavigationProp;
}

export default function HomeScreen({ navigation }: Props): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#6200EE" />

      {/* AppBar / Header */}
      <View style={styles.appBar}>
        <Text style={styles.appBarTitle}>My Shop</Text>
        <Text style={styles.appBarSubtitle}>Welcome back</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero section */}
        <View style={styles.heroSection}>
          <Text style={styles.heroTitle}>Discover Products</Text>
          <Text style={styles.heroBody}>
            Browse our curated collection of premium products.{'\n'}
            Find exactly what you are looking for today.
          </Text>
        </View>

        {/* Local asset image */}
        <View style={styles.imageRow}>
          <View style={styles.imageCard}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.localImage}
              resizeMode="contain"
            />
            <Text style={styles.imageLabel}>App Logo</Text>
          </View>

          {/* Network image */}
          <View style={styles.imageCard}>
            <Image
              source={{ uri: 'https://picsum.photos/64/64?grayscale' }}
              style={styles.networkImage}
              resizeMode="cover"
            />
            <Text style={styles.imageLabel}>Network Image</Text>
          </View>
        </View>

        {/* CTA Buttons */}
        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.navigate('List')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Browse Products</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.navigate('Detail', { productId: 'product-1' })}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryButtonText}>View Featured</Text>
          </TouchableOpacity>
        </View>

        {/* Settings link */}
        <TouchableOpacity
          style={styles.settingsLink}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.settingsLinkText}>Go to Settings</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  appBar: {
    backgroundColor: '#6200EE',
    paddingHorizontal: 16,
    paddingVertical: 16,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  appBarTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  appBarSubtitle: {
    fontSize: 13,
    color: '#E0E0E0',
    marginTop: 2,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  heroSection: {
    backgroundColor: '#EDE7F6',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    borderLeftWidth: 4,
    borderLeftColor: '#6200EE',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#212121',
    marginBottom: 8,
  },
  heroBody: {
    fontSize: 15,
    color: '#555555',
    lineHeight: 22,
  },
  imageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 12,
  },
  imageCard: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#BDBDBD',
  },
  localImage: {
    width: 64,
    height: 64,
  },
  networkImage: {
    width: 64,
    height: 64,
    borderRadius: 4,
  },
  imageLabel: {
    fontSize: 11,
    color: '#757575',
    marginTop: 8,
    textAlign: 'center',
  },
  buttonGroup: {
    gap: 12,
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: '#6200EE',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    elevation: 2,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#6200EE',
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6200EE',
    letterSpacing: 0.3,
  },
  settingsLink: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  settingsLinkText: {
    fontSize: 14,
    color: '#03DAC6',
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});
