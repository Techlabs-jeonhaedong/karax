import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface PriceTagProps {
  price: number;
  currency?: string;
  discountPercent?: number;
}

export default function PriceTag({
  price,
  currency = 'USD',
  discountPercent,
}: PriceTagProps): React.JSX.Element {
  const originalPrice = discountPercent
    ? Math.round(price / (1 - discountPercent / 100))
    : null;

  return (
    <View style={styles.container}>
      {originalPrice !== null && (
        <Text style={styles.originalPrice}>
          {currency} {originalPrice.toFixed(2)}
        </Text>
      )}
      <View style={styles.priceRow}>
        <Text style={styles.price}>
          {currency} {price.toFixed(2)}
        </Text>
        {discountPercent !== undefined && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>-{discountPercent}%</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'flex-start',
  },
  originalPrice: {
    fontSize: 12,
    color: '#9E9E9E',
    textDecorationLine: 'line-through',
    marginBottom: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  price: {
    fontSize: 18,
    fontWeight: '700',
    color: '#6200EE',
  },
  discountBadge: {
    backgroundColor: '#FF5252',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  discountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
