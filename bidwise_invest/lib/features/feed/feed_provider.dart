import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../shared/models/property.dart';
import '../../shared/services/supabase_service.dart';

final _svc = SupabaseService();

// Feed filter state
class FeedFilter {
  final String? county;
  final double? minDealScore;
  final double? minRoi;
  final double? maxRisk;
  final String sortBy;

  const FeedFilter({
    this.county,
    this.minDealScore,
    this.minRoi,
    this.maxRisk,
    this.sortBy = 'deal_score',
  });

  FeedFilter copyWith({
    String? county,
    double? minDealScore,
    double? minRoi,
    double? maxRisk,
    String? sortBy,
    bool clearCounty = false,
  }) {
    return FeedFilter(
      county: clearCounty ? null : county ?? this.county,
      minDealScore: minDealScore ?? this.minDealScore,
      minRoi: minRoi ?? this.minRoi,
      maxRisk: maxRisk ?? this.maxRisk,
      sortBy: sortBy ?? this.sortBy,
    );
  }

  bool get hasActiveFilters =>
      county != null ||
      (minDealScore ?? 0) > 0 ||
      (minRoi ?? 0) > 0 ||
      (maxRisk ?? 100) < 100;
}

final feedFilterProvider = StateProvider<FeedFilter>((ref) => const FeedFilter());

// Properties list
class FeedNotifier extends StateNotifier<AsyncValue<List<PropertySummary>>> {
  FeedNotifier() : super(const AsyncValue.loading());

  int _page = 0;
  bool _hasMore = true;
  List<PropertySummary> _items = [];
  FeedFilter _filter = const FeedFilter();

  Future<void> load(FeedFilter filter) async {
    _filter = filter;
    _page = 0;
    _items = [];
    _hasMore = true;
    state = const AsyncValue.loading();
    await _fetchPage();
  }

  Future<void> loadMore() async {
    if (!_hasMore || state is AsyncLoading) return;
    _page++;
    await _fetchPage();
  }

  Future<void> refresh() => load(_filter);

  Future<void> _fetchPage() async {
    try {
      final fresh = await _svc.fetchProperties(
        county: _filter.county,
        minDealScore: _filter.minDealScore,
        minRoi: _filter.minRoi,
        maxRisk: _filter.maxRisk,
        sortBy: _filter.sortBy,
        page: _page,
      );
      _hasMore = fresh.length == 50;
      _items = _page == 0 ? fresh : [..._items, ...fresh];
      state = AsyncValue.data(List.unmodifiable(_items));
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  bool get hasMore => _hasMore;
}

final feedProvider = StateNotifierProvider.autoDispose<FeedNotifier, AsyncValue<List<PropertySummary>>>(
  (ref) => FeedNotifier(),
);

// Saved property IDs set
final savedPropertyIdsProvider = FutureProvider.autoDispose<Set<String>>((ref) async {
  return _svc.fetchSavedParcelIds();
});
