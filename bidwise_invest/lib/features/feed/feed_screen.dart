import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/deal_card.dart';
import 'feed_provider.dart';
import 'feed_filter_sheet.dart';

class FeedScreen extends ConsumerStatefulWidget {
  const FeedScreen({super.key});

  @override
  ConsumerState<FeedScreen> createState() => _FeedScreenState();
}

class _FeedScreenState extends ConsumerState<FeedScreen> {
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _loadFeed();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _loadFeed() {
    final filter = ref.read(feedFilterProvider);
    ref.read(feedProvider.notifier).load(filter);
  }

  void _onScroll() {
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 200) {
      ref.read(feedProvider.notifier).loadMore();
    }
  }

  Future<void> _showFilters() async {
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => const FeedFilterSheet(),
    );
    // Reload after filter sheet closes
    _loadFeed();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(feedProvider);
    final filter = ref.watch(feedFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('BidWise', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)),
            Text(
              filter.county ?? 'All Counties',
              style: const TextStyle(fontSize: 11, color: AppColors.textMuted, fontWeight: FontWeight.w500),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: Badge(
              isLabelVisible: filter.hasActiveFilters,
              backgroundColor: AppColors.emerald,
              child: const Icon(Icons.tune_rounded),
            ),
            tooltip: 'Filter',
            onPressed: _showFilters,
          ),
        ],
      ),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator(color: AppColors.emerald)),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline, color: AppColors.textMuted, size: 48),
                const SizedBox(height: 12),
                Text('Could not load deals', style: Theme.of(context).textTheme.titleMedium?.copyWith(color: AppColors.textPrimary)),
                const SizedBox(height: 8),
                Text(e.toString(), textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
                const SizedBox(height: 16),
                ElevatedButton(onPressed: _loadFeed, child: const Text('Retry')),
              ],
            ),
          ),
        ),
        data: (properties) {
          if (properties.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.search_off_rounded, color: AppColors.textMuted, size: 48),
                  const SizedBox(height: 12),
                  const Text('No deals match your filters', style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  const Text('Try relaxing the filter criteria.', style: TextStyle(color: AppColors.textMuted)),
                  const SizedBox(height: 16),
                  TextButton(onPressed: _showFilters, child: const Text('Adjust Filters')),
                ],
              ),
            );
          }

          return RefreshIndicator(
            color: AppColors.emerald,
            onRefresh: () => ref.read(feedProvider.notifier).refresh(),
            child: ListView.separated(
              controller: _scroll,
              padding: const EdgeInsets.all(16),
              itemCount: properties.length + 1,
              separatorBuilder: (context, _) => const SizedBox(height: 10),
              itemBuilder: (ctx, i) {
                if (i == properties.length) {
                  return ref.read(feedProvider.notifier).hasMore
                      ? const Padding(
                          padding: EdgeInsets.all(16),
                          child: Center(child: CircularProgressIndicator(color: AppColors.emerald, strokeWidth: 2)),
                        )
                      : const SizedBox(height: 32);
                }
                final property = properties[i];
                // locked comes from visible_properties_safe — the row's
                // financials are already masked server-side for this user.
                return DealCard(property: property, index: i, isLocked: property.locked);
              },
            ),
          );
        },
      ),
    );
  }
}
