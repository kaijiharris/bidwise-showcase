import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/services/supabase_service.dart';
import '../auth/auth_provider.dart';

final _svc = SupabaseService();

final _adminStatsProvider = FutureProvider.autoDispose<Map<String, dynamic>>(
  (_) => _svc.fetchAdminStats(),
);

final _countyRunsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>(
  (_) => _svc.fetchCountyRuns(),
);

class AdminDashboardScreen extends ConsumerWidget {
  const AdminDashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stats = ref.watch(_adminStatsProvider);
    final runs = ref.watch(_countyRunsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Admin Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout_rounded),
            tooltip: 'Sign out',
            onPressed: () => ref.read(authNotifierProvider.notifier).signOut(),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: AppColors.emerald,
        onRefresh: () async {
          ref.invalidate(_adminStatsProvider);
          ref.invalidate(_countyRunsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // Stats row
            stats.when(
              loading: () => const _StatsShimmer(),
              error: (e, _) => _ErrorTile(message: e.toString()),
              data: (s) => Row(
                children: [
                  Expanded(child: _StatCard(
                    label: 'Active Subscribers',
                    value: '${s['active_subscribers']}',
                    icon: Icons.people_rounded,
                  )),
                  const SizedBox(width: 12),
                  Expanded(child: _StatCard(
                    label: 'Published Deals',
                    value: '${s['published_properties']}',
                    icon: Icons.home_work_rounded,
                  )),
                ],
              ),
            ),
            const SizedBox(height: 24),

            const Text(
              'County Batches',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
            ),
            const SizedBox(height: 12),

            runs.when(
              loading: () => const Center(
                child: Padding(
                  padding: EdgeInsets.all(32),
                  child: CircularProgressIndicator(color: AppColors.emerald),
                ),
              ),
              error: (e, _) => _ErrorTile(message: e.toString()),
              data: (list) => list.isEmpty
                  ? const _EmptyBatches()
                  : Column(
                      children: list
                          .map((run) => Padding(
                                padding: const EdgeInsets.only(bottom: 10),
                                child: _BatchCard(
                                  run: run,
                                  onPublish: () => _confirmPublish(context, ref, run),
                                ),
                              ))
                          .toList(),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmPublish(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> run,
  ) async {
    final county = run['county'] as String? ?? '';
    final count = run['property_count'] as int? ?? 0;
    final batchId = run['batch_id'] as String? ?? '';

    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Publish $county Batch?',
          style: const TextStyle(color: AppColors.textPrimary)),
        content: Text(
          'This will publish $count properties to the live feed. '
          'Subscribers will see them immediately. This cannot be undone.',
          style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Publish'),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    try {
      await _svc.publishBatch(batchId);
      ref.invalidate(_countyRunsProvider);
      ref.invalidate(_adminStatsProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Batch published successfully'),
            backgroundColor: AppColors.emerald,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;

  const _StatCard({required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.emerald),
          const SizedBox(height: 8),
          Text(value,
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.textPrimary)),
          const SizedBox(height: 2),
          Text(label,
            style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
        ],
      ),
    );
  }
}

class _BatchCard extends StatefulWidget {
  final Map<String, dynamic> run;
  final Future<void> Function() onPublish;

  const _BatchCard({required this.run, required this.onPublish});

  @override
  State<_BatchCard> createState() => _BatchCardState();
}

class _BatchCardState extends State<_BatchCard> {
  bool _publishing = false;

  @override
  Widget build(BuildContext context) {
    final county = widget.run['county'] as String? ?? '—';
    final status = widget.run['status'] as String? ?? 'unknown';
    final count = widget.run['property_count'] as int? ?? 0;
    final rawDate = widget.run['run_date'] as String?;
    final date = rawDate != null
        ? DateFormat('MMM d, yyyy').format(DateTime.parse(rawDate))
        : '—';

    final isReview = status == 'review';
    final isPublished = status == 'published';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isReview ? AppColors.emerald.withAlpha(80) : AppColors.border,
          width: isReview ? 1.5 : 1,
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(county,
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
                    const SizedBox(width: 8),
                    _StatusBadge(status: status),
                  ],
                ),
                const SizedBox(height: 4),
                Text('$count properties · $date',
                  style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
              ],
            ),
          ),
          if (isReview)
            _publishing
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.emerald),
                  )
                : ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                    ),
                    onPressed: () async {
                      setState(() => _publishing = true);
                      await widget.onPublish();
                      if (mounted) setState(() => _publishing = false);
                    },
                    child: const Text('Publish'),
                  ),
          if (isPublished)
            const Icon(Icons.check_circle_rounded, color: AppColors.emerald, size: 20),
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'review' => ('READY', AppColors.emerald),
      'published' => ('LIVE', AppColors.cyan),
      'processing' => ('PROCESSING', Colors.orange),
      'stale' => ('STALE', AppColors.textMuted),
      _ => (status.toUpperCase(), AppColors.textMuted),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withAlpha(25),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label,
        style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: color)),
    );
  }
}

class _StatsShimmer extends StatelessWidget {
  const _StatsShimmer();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _shimmerBox(80)),
        const SizedBox(width: 12),
        Expanded(child: _shimmerBox(80)),
      ],
    );
  }

  Widget _shimmerBox(double height) => Container(
    height: height,
    decoration: BoxDecoration(
      color: AppColors.surfaceElevated,
      borderRadius: BorderRadius.circular(14),
    ),
  );
}

class _EmptyBatches extends StatelessWidget {
  const _EmptyBatches();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Column(
          children: [
            const Icon(Icons.inbox_rounded, size: 48, color: AppColors.textMuted),
            const SizedBox(height: 12),
            const Text('No batches yet', style: TextStyle(color: AppColors.textPrimary, fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            const Text('Run the pipeline and push to Supabase to see batches here.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}

class _ErrorTile extends StatelessWidget {
  final String message;
  const _ErrorTile({required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.red.withAlpha(15),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.red.withAlpha(60)),
      ),
      child: Text(message, style: const TextStyle(color: Colors.red, fontSize: 13)),
    );
  }
}
