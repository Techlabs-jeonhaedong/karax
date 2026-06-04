import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import PriceTag from './PriceTag';

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  discountPercent?: number;
  rating: number;
  reviewCount: number;
  imageUri: string;
  category: string;
  inStock: boolean;
}

interface ProductCardProps {
  product: Product;
  onPress?: (product: Product) => void;
}

export default function ProductCard({ product, onPress }: ProductCardProps): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => onPress?.(product)}
      activeOpacity={0.85}
    >
      {/* Product image */}
      <Image
        source={{ uri: product.imageUri }}
        style={styles.productImage}
        resizeMode="cover"
      />

      {/* Out of stock overlay */}
      {!product.inStock && (
        <View style={styles.outOfStockOverlay}>
          <Text style={styles.outOfStockText}>Out of Stock</Text>
        </View>
      )}

      {/* Category badge */}
      <View style={styles.categoryBadge}>
        <Text style={styles.categoryText}>{product.category}</Text>
      </View>

      {/* Card body */}
      <View style={styles.cardBody}>
        <Text style={styles.productName} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.productDescription} numberOfLines={2}>
          {product.description}
        </Text>

        {/* Rating row */}
        <View style={styles.ratingRow}>
          <Text style={styles.ratingStars}>{'★'.repeat(Math.round(product.rating))}</Text>
          <Text style={styles.ratingCount}>({product.reviewCount})</Text>
        </View>

        {/* Price — PriceTag 커스텀 컴포넌트 (2단 깊이 중 1단) */}
        <PriceTag
          price={product.price}
          discountPercent={product.discountPercent}
        />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  productImage: {
    width: '100%',
    height: 180,
    backgroundColor: '#F5F5F5',
  },
  outOfStockOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  outOfStockText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
  },
  categoryBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#6200EE',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardBody: {
    padding: 16,
    gap: 6,
  },
  productName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#212121',
  },
  productDescription: {
    fontSize: 13,
    color: '#757575',
    lineHeight: 18,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginVertical: 2,
  },
  ratingStars: {
    fontSize: 13,
    color: '#FFC107',
  },
  ratingCount: {
    fontSize: 12,
    color: '#9E9E9E',
  },
});
