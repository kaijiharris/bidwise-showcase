import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../shared/theme/app_theme.dart';
import 'feed_provider.dart';

const _counties = ['DeKalb', 'Gwinnett', 'Cobb'];

class FeedFilterSheet extends ConsumerStatefulWidget {
  const FeedFilterSheet({super.key});

  @override
  ConsumerState<FeedFilterSheet> createState() => _FeedFilterSheetState();
}

class _FeedFilterSheetState extends ConsumerState<FeedFilterSheet> {
  late String? _county;
  late double _minScore;
  late double _minRoi;
  late String _sortBy;

  @override
  void initState() {
    super.initState();
    final f = ref.read(feedFilterProvider);
    _county = f.county;
    _minScore = f.minDealScore ?? 0;
    _minRoi = f.minRoi ?? 0;
    _sortBy = f.sortBy;
  }

  void _apply() {
    ref.read(feedFilterProvider.notifier).state = FeedFilter(
      county: _county,
      minDealScore: _minScore > 0 ? _minScore : null,
      minRoi: _minRoi > 0 ? _minRoi : null,
      sortBy: _sortBy,
    );
    Navigator.of(context).pop();
  }

  void _reset() {
    setState(() {
      _county = null;
      _minScore = 0;
      _minRoi = 0;
      _sortBy = 'deal_score';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Handle
            Center(child: Container(width: 36, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 20),

            Row(
              children: [
                const Text('Filters', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
                const Spacer(),
                TextButton(onPressed: _reset, child: const Text('Reset')),
              ],
            ),
            const SizedBox(height: 20),

            // County
            const Text('County', style: TextStyle(fontSize: 12, color: AppColors.textMuted, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                FilterChip(
                  label: const Text('All'),
                  selected: _county == null,
                  onSelected: (_) => setState(() => _county = null),
                ),
                ..._counties.map((c) => FilterChip(
                  label: Text(c),
                  selected: _county == c,
                  onSelected: (_) => setState(() => _county = c),
                )),
              ],
            ),

            const SizedBox(height: 20),

            // Min Deal Score
            Row(
              children: [
                const Text('Min Deal Score', style: TextStyle(fontSize: 12, color: AppColors.textMuted, fontWeight: FontWeight.w600)),
                const Spacer(),
                Text('${_minScore.toInt()}', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
              ],
            ),
            Slider(
              value: _minScore,
              min: 0,
              max: 90,
              divisions: 18,
              activeColor: AppColors.emerald,
              onChanged: (v) => setState(() => _minScore = v),
            ),

            const SizedBox(height: 8),

            // Min ROI
            Row(
              children: [
                const Text('Min ROI %', style: TextStyle(fontSize: 12, color: AppColors.textMuted, fontWeight: FontWeight.w600)),
                const Spacer(),
                Text('${_minRoi.toInt()}%', style: const TextStyle(fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
              ],
            ),
            Slider(
              value: _minRoi,
              min: 0,
              max: 150,
              divisions: 15,
              activeColor: AppColors.emerald,
              onChanged: (v) => setState(() => _minRoi = v),
            ),

            const SizedBox(height: 16),

            // Sort
            const Text('Sort By', style: TextStyle(fontSize: 12, color: AppColors.textMuted, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'deal_score', label: Text('Score')),
                ButtonSegment(value: 'roi_pct', label: Text('ROI')),
                ButtonSegment(value: 'net_profit', label: Text('Profit')),
              ],
              selected: {_sortBy},
              onSelectionChanged: (s) => setState(() => _sortBy = s.first),
              style: ButtonStyle(
                backgroundColor: WidgetStateProperty.resolveWith((states) =>
                    states.contains(WidgetState.selected) ? AppColors.emerald.withAlpha(30) : null),
              ),
            ),

            const SizedBox(height: 24),

            SizedBox(
              width: double.infinity,
              child: ElevatedButton(onPressed: _apply, child: const Text('Apply Filters')),
            ),
          ],
        ),
      ),
    );
  }
}
