/**
 * OrphanScreen
 *
 * 이 화면은 어떤 네비게이터 라우트에도 등록되어 있지 않다.
 * heuristic 발견 알고리즘이 *Screen 접미사 스캔으로 이 화면을 candidate로 식별하는지
 * 검증하기 위한 fixture다.
 *
 * discovery 라벨: "candidate" (route 그래프에 미연결)
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';

interface NoticeItem {
  id: string;
  title: string;
  body: string;
  date: string;
  unread: boolean;
}

const NOTICES: NoticeItem[] = [
  {
    id: 'n1',
    title: 'System Maintenance',
    body: 'Scheduled maintenance on Sunday 02:00–04:00 UTC. Some features may be unavailable.',
    date: '2026-05-30',
    unread: true,
  },
  {
    id: 'n2',
    title: 'New Feature: Wishlist',
    body: 'You can now save products to your wishlist and receive price drop alerts.',
    date: '2026-05-22',
    unread: true,
  },
  {
    id: 'n3',
    title: 'Terms Update',
    body: 'We have updated our Terms of Service effective June 1, 2026. Please review the changes.',
    date: '2026-05-15',
    unread: false,
  },
  {
    id: 'n4',
    title: 'Referral Program',
    body: 'Invite friends and earn $10 credit for each successful referral.',
    date: '2026-05-01',
    unread: false,
  },
];

export default function OrphanScreen(): React.JSX.Element {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notices</Text>
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadCount}>
            {NOTICES.filter((n) => n.unread).length}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {NOTICES.map((notice) => (
          <View
            key={notice.id}
            style={[styles.noticeCard, notice.unread && styles.noticeCardUnread]}
          >
            <View style={styles.noticeHeader}>
              <Text style={styles.noticeTitle}>{notice.title}</Text>
              {notice.unread && <View style={styles.unreadDot} />}
            </View>
            <Text style={styles.noticeBody}>{notice.body}</Text>
            <Text style={styles.noticeDate}>{notice.date}</Text>
          </View>
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
    gap: 10,
    backgroundColor: '#B00020',
    paddingHorizontal: 16,
    paddingVertical: 16,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  unreadBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadCount: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B00020',
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  noticeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    elevation: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    marginBottom: 12,
  },
  noticeCardUnread: {
    borderLeftWidth: 3,
    borderLeftColor: '#B00020',
    backgroundColor: '#FFF5F5',
  },
  noticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  noticeTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#212121',
    flex: 1,
    marginRight: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B00020',
  },
  noticeBody: {
    fontSize: 13,
    color: '#555555',
    lineHeight: 19,
    marginBottom: 10,
  },
  noticeDate: {
    fontSize: 11,
    color: '#9E9E9E',
  },
});
