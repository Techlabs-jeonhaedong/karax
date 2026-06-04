import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../App';
import ProductCard, { type Product } from '../components/ProductCard';

type DetailScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'Detail'>;
type DetailScreenRouteProp = RouteProp<RootStackParamList, 'Detail'>;

interface Props {
  navigation: DetailScreenNavigationProp;
  route: DetailScreenRouteProp;
}

const SAMPLE_PRODUCTS: Product[] = [
  {
    id: 'product-1',
    name: 'Premium Wireless Headphones',
    description:
      'Experience crystal-clear audio with active noise cancellation and 30-hour battery life.',
    price: 199.99,
    discountPercent: 20,
    rating: 4.5,
    reviewCount: 1248,
    imageUri: 'https://picsum.photos/seed/headphones/400/300',
    category: 'Electronics',
    inStock: true,
  },
  {
    id: 'product-2',
    name: 'Ergonomic Office Chair',
    description:
      'Lumbar support and adjustable armrests designed for all-day comfort during long work sessions.',
    price: 349.00,
    rating: 4.2,
    reviewCount: 562,
    imageUri: 'https://picsum.photos/seed/chair/400/300',
    category: 'Furniture',
    inStock: false,
  },
  {
    id: 'product-3',
    name: 'Artisan Coffee Blend',
    description:
      'Single-origin Ethiopian Yirgacheffe beans, medium roast with notes of jasmine and blueberry.',
    price: 24.99,
    discountPercent: 10,
    rating: 4.8,
    reviewCount: 3401,
    imageUri: 'https://picsum.photos/seed/coffee/400/300',
    category: 'Food & Drink',
    inStock: true,
  },
];

export default function DetailScreen({ navigation }: Props): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Custom header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Product Details</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Featured Collection</Text>
          <Text style={styles.sectionSubtitle}>
            Hand-picked products just for you — curated by our editorial team.
          </Text>
        </View>

        {/*
          ProductCard 컴포넌트 3회 사용.
          ProductCard 내부에 PriceTag가 있어 2단 깊이 커스텀 컴포넌트 인라이닝 검증.
        */}
        {SAMPLE_PRODUCTS.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            onPress={() => {}}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#3700B3',
    paddingHorizontal: 16,
    paddingVertical: 14,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  backButton: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  backButtonText: {
    fontSize: 15,
    color: '#E0E0E0',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  headerRight: {
    width: 60,
  },
  scrollContent: {
    padding: 16,
  },
  sectionHeader: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#212121',
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#757575',
    lineHeight: 20,
  },
});
