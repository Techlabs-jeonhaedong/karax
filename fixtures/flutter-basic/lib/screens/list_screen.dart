import 'package:flutter/material.dart';

/// 화면 상태를 나타내는 enum — 3분기 조건부 렌더링용
enum _ScreenState { loading, empty, data }

/// ListScreen — 조건부 렌더링 + 컬렉션 반복 화면.
/// 아키타입 3: 로딩/빈/데이터 3분기 + ListView 반복 렌더.
class ListScreen extends StatefulWidget {
  const ListScreen({super.key});

  @override
  State<ListScreen> createState() => _ListScreenState();
}

class _ListScreenState extends State<ListScreen> {
  _ScreenState _screenState = _ScreenState.loading;

  final List<_Item> _items = const [
    _Item(id: '1', title: 'Design Patterns', subtitle: 'Gang of Four', category: 'Engineering', isFavorite: true),
    _Item(id: '2', title: 'Clean Code', subtitle: 'Robert C. Martin', category: 'Engineering', isFavorite: false),
    _Item(id: '3', title: 'The Pragmatic Programmer', subtitle: 'Hunt & Thomas', category: 'Engineering', isFavorite: true),
    _Item(id: '4', title: 'Refactoring', subtitle: 'Martin Fowler', category: 'Engineering', isFavorite: false),
    _Item(id: '5', title: 'System Design Interview', subtitle: 'Alex Xu', category: 'Architecture', isFavorite: false),
  ];

  @override
  void initState() {
    super.initState();
    // 로딩 시뮬레이션
    Future.delayed(const Duration(milliseconds: 800), () {
      if (mounted) {
        setState(() => _screenState = _ScreenState.data);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F9FA),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF1C1B1F),
        title: const Text(
          'Reading List',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 20),
        ),
        leading: const BackButton(),
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: const Color(0xFFE0E0E0)),
        ),
        actions: [
          // 상태 전환 버튼 (테스트용 토글)
          PopupMenuButton<_ScreenState>(
            icon: const Icon(Icons.tune),
            onSelected: (state) => setState(() => _screenState = state),
            itemBuilder: (context) => const [
              PopupMenuItem(value: _ScreenState.loading, child: Text('Show Loading')),
              PopupMenuItem(value: _ScreenState.empty, child: Text('Show Empty')),
              PopupMenuItem(value: _ScreenState.data, child: Text('Show Data')),
            ],
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    // 3분기 조건부 렌더링 — Branch 메타데이터 추출 검증
    if (_screenState == _ScreenState.loading) {
      return const _LoadingState();
    }

    if (_screenState == _ScreenState.empty) {
      return const _EmptyState();
    }

    return _DataState(items: _items);
  }
}

// ─── Loading state ─────────────────────────────────────────────────────────

class _LoadingState extends StatelessWidget {
  const _LoadingState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(
            color: Color(0xFF6750A4),
          ),
          SizedBox(height: 20),
          Text(
            'Loading your list...',
            style: TextStyle(
              fontSize: 16,
              color: Color(0xFF79747E),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Empty state ────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                color: const Color(0xFFE8DEF8),
                borderRadius: BorderRadius.circular(48),
              ),
              child: const Icon(
                Icons.bookmark_outline,
                size: 48,
                color: Color(0xFF6750A4),
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'No items yet',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Color(0xFF1C1B1F),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'Your reading list is empty.\nAdd books to get started.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 14, color: Color(0xFF79747E), height: 1.5),
            ),
            const SizedBox(height: 32),
            ElevatedButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.add),
              label: const Text('Add First Book'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF6750A4),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Data state ─────────────────────────────────────────────────────────────

class _DataState extends StatelessWidget {
  const _DataState({required this.items});

  final List<_Item> items;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      itemCount: items.length,
      separatorBuilder: (context, index) => const SizedBox(height: 0),
      itemBuilder: (context, index) {
        final item = items[index];
        return _ItemTile(item: item);
      },
    );
  }
}

// ─── Item tile ───────────────────────────────────────────────────────────────

class _ItemTile extends StatelessWidget {
  const _ItemTile({required this.item});

  final _Item item;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFFE0E0E0)),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: const Color(0xFFE8DEF8),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(
              item.title.substring(0, 1),
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: Color(0xFF6750A4),
              ),
            ),
          ),
        ),
        title: Text(
          item.title,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: Color(0xFF1C1B1F),
          ),
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 2),
            Text(
              item.subtitle,
              style: const TextStyle(fontSize: 13, color: Color(0xFF79747E)),
            ),
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFF3EFF4),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(
                item.category,
                style: const TextStyle(
                  fontSize: 11,
                  color: Color(0xFF6750A4),
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ],
        ),
        trailing: Icon(
          item.isFavorite ? Icons.bookmark : Icons.bookmark_outline,
          color: item.isFavorite ? const Color(0xFF6750A4) : const Color(0xFFCAC4D0),
        ),
      ),
    );
  }
}

// ─── Data model ──────────────────────────────────────────────────────────────

class _Item {
  const _Item({
    required this.id,
    required this.title,
    required this.subtitle,
    required this.category,
    required this.isFavorite,
  });

  final String id;
  final String title;
  final String subtitle;
  final String category;
  final bool isFavorite;
}
