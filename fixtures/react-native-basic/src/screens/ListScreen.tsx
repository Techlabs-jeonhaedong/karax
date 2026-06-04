import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  ListRenderItemInfo,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';

type ListScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, 'List'>;

interface Props {
  navigation: ListScreenNavigationProp;
}

interface ListItem {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  tagColor: string;
}

type LoadState = 'loading' | 'empty' | 'data';

const ITEMS: ListItem[] = [
  {
    id: '1',
    title: 'Bluetooth Speaker',
    subtitle: 'Portable waterproof design, 12h playtime, deep bass',
    tag: 'New',
    tagColor: '#4CAF50',
  },
  {
    id: '2',
    title: 'Standing Desk Mat',
    subtitle: 'Anti-fatigue cushion with beveled edges and grooves',
    tag: 'Popular',
    tagColor: '#FF9800',
  },
  {
    id: '3',
    title: 'Mechanical Keyboard',
    subtitle: 'Tactile brown switches, RGB backlight, TKL layout',
    tag: 'Sale',
    tagColor: '#F44336',
  },
  {
    id: '4',
    title: 'USB-C Hub 7-in-1',
    subtitle: 'HDMI 4K, 100W PD, SD card, 3x USB-A, Ethernet',
    tag: 'Top Rated',
    tagColor: '#6200EE',
  },
  {
    id: '5',
    title: 'Notebook Set',
    subtitle: 'Dotted grid, 200 pages, lay-flat binding, A5 size',
    tag: 'New',
    tagColor: '#4CAF50',
  },
  {
    id: '6',
    title: 'Desk Lamp',
    subtitle: 'LED with color temperature control and USB charging port',
    tag: 'Popular',
    tagColor: '#FF9800',
  },
];

function renderItem({ item }: ListRenderItemInfo<ListItem>): React.JSX.Element {
  return (
    <View style={styles.listItem}>
      <View style={styles.listItemLeft}>
        <Text style={styles.listItemTitle}>{item.title}</Text>
        <Text style={styles.listItemSubtitle} numberOfLines={2}>
          {item.subtitle}
        </Text>
      </View>
      <View style={[styles.tagBadge, { backgroundColor: item.tagColor }]}>
        <Text style={styles.tagText}>{item.tag}</Text>
      </View>
    </View>
  );
}

function keyExtractor(item: ListItem): string {
  return item.id;
}

function LoadingState(): React.JSX.Element {
  return (
    <View style={styles.centeredState}>
      <ActivityIndicator size="large" color="#6200EE" />
      <Text style={styles.stateText}>Loading products...</Text>
    </View>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <View style={styles.centeredState}>
      <Text style={styles.emptyIcon}>📦</Text>
      <Text style={styles.emptyTitle}>No products found</Text>
      <Text style={styles.emptySubtitle}>
        Try adjusting your filters or check back later.
      </Text>
    </View>
  );
}

export default function ListScreen({ navigation }: Props): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>('data');

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
        <Text style={styles.headerTitle}>All Products</Text>
        <View style={styles.headerRight} />
      </View>

      {/* State switcher (for fixture / demo purposes) */}
      <View style={styles.stateBar}>
        {(['loading', 'empty', 'data'] as LoadState[]).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.stateChip, loadState === s && styles.stateChipActive]}
            onPress={() => setLoadState(s)}
          >
            <Text
              style={[styles.stateChipText, loadState === s && styles.stateChipTextActive]}
            >
              {s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Conditional rendering — 3-branch */}
      {loadState === 'loading' && <LoadingState />}
      {loadState === 'empty' && <EmptyState />}
      {loadState === 'data' && (
        <FlatList
          data={ITEMS}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={
            <Text style={styles.listCount}>{ITEMS.length} items found</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#018786',
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
  stateBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
    backgroundColor: '#F9F9F9',
  },
  stateChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BDBDBD',
    backgroundColor: '#FFFFFF',
  },
  stateChipActive: {
    backgroundColor: '#6200EE',
    borderColor: '#6200EE',
  },
  stateChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#757575',
  },
  stateChipTextActive: {
    color: '#FFFFFF',
  },
  centeredState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  stateText: {
    fontSize: 15,
    color: '#757575',
    marginTop: 12,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#212121',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9E9E9E',
    textAlign: 'center',
    lineHeight: 20,
  },
  listContent: {
    padding: 16,
  },
  listCount: {
    fontSize: 13,
    color: '#9E9E9E',
    marginBottom: 12,
    fontWeight: '500',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    elevation: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  listItemLeft: {
    flex: 1,
    marginRight: 12,
  },
  listItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#212121',
    marginBottom: 4,
  },
  listItemSubtitle: {
    fontSize: 12,
    color: '#757575',
    lineHeight: 17,
  },
  tagBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  separator: {
    height: 10,
  },
});
