import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/models/property.dart';
import '../../shared/services/supabase_service.dart';
import '../../shared/widgets/score_badge.dart';
import '../../shared/widgets/financial_row.dart';
import '../feed/feed_provider.dart';

final _svc = SupabaseService();
final _currency = NumberFormat.currency(symbol: '\$', decimalDigits: 0);

final _propertyDetailProvider = FutureProvider.autoDispose.family<PropertyDetail?, String>(
  (ref, parcelId) => _svc.fetchPropertyDetail(parcelId),
);

class PropertyDetailScreen extends ConsumerWidget {
  final String parcelId;
  const PropertyDetailScreen({super.key, required this.parcelId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(_propertyDetailProvider(parcelId));

    return Scaffold(
      appBar: AppBar(
        title: state.maybeWhen(
          data: (p) => Text(p?.address ?? 'Property', maxLines: 1, overflow: TextOverflow.ellipsis),
          orElse: () => const Text('Property Detail'),
        ),
        actions: [
          if (state.value != null)
            _SaveButton(parcelId: parcelId),
        ],
      ),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator(color: AppColors.emerald)),
        error: (e, _) => Center(child: Text('Error: $e', style: const TextStyle(color: AppColors.textMuted))),
        data: (p) => p == null
            ? const Center(child: Text('Property not found', style: TextStyle(color: AppColors.textMuted)))
            : _DetailBody(property: p),
      ),
    );
  }
}

class _SaveButton extends ConsumerStatefulWidget {
  final String parcelId;
  const _SaveButton({required this.parcelId});

  @override
  ConsumerState<_SaveButton> createState() => _SaveButtonState();
}

class _SaveButtonState extends ConsumerState<_SaveButton> {
  bool _saving = false;

  @override
  Widget build(BuildContext context) {
    final savedIds = ref.watch(savedPropertyIdsProvider).value ?? {};
    final isSaved = savedIds.contains(widget.parcelId);

    return IconButton(
      icon: _saving
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.emerald))
          : Icon(isSaved ? Icons.bookmark : Icons.bookmark_outline, color: isSaved ? AppColors.emerald : null),
      onPressed: _saving ? null : () async {
        setState(() => _saving = true);
        try {
          if (isSaved) {
            await _svc.unsaveProperty(widget.parcelId);
          } else {
            await _svc.saveProperty(widget.parcelId);
          }
          ref.invalidate(savedPropertyIdsProvider);
        } finally {
          if (mounted) setState(() => _saving = false);
        }
      },
    );
  }
}

class _DetailBody extends StatelessWidget {
  final PropertyDetail property;
  const _DetailBody({required this.property});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _headerCard(),
        const SizedBox(height: 12),
        if (_hasPhysical()) _physicalCard(),
        if (_hasPhysical()) const SizedBox(height: 12),
        _financialsCard(),
        const SizedBox(height: 12),
        _riskCard(),
        const SizedBox(height: 12),
        _disclaimerCard(),
        const SizedBox(height: 32),
      ],
    );
  }

  Widget _headerCard() {
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
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(property.address, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: AppColors.textPrimary)),
                    const SizedBox(height: 4),
                    Text('${property.city}, GA${property.zip != null ? ' ${property.zip}' : ''}  ·  ${property.county} County',
                      style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
                    if (property.propertyType != null) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.cyan.withAlpha(20),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(property.propertyType!.toUpperCase(),
                          style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.cyan)),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Column(
                children: [
                  ScoreBadge(score: property.dealScore, large: true),
                  const SizedBox(height: 2),
                  const Text('Score', style: TextStyle(fontSize: 10, color: AppColors.textMuted)),
                ],
              ),
            ],
          ),
          if (property.auctionDate != null) ...[
            const Divider(height: 20),
            Row(
              children: [
                const Icon(Icons.gavel_rounded, size: 14, color: AppColors.textMuted),
                const SizedBox(width: 6),
                Text('Auction: ${property.auctionDate}',
                  style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
              ],
            ),
          ],
        ],
      ),
    );
  }

  bool _hasPhysical() =>
      property.beds != null || property.baths != null || property.sqft != null || property.yearBuilt != null;

  Widget _physicalCard() {
    return _Card(
      title: 'Property',
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          if (property.beds != null) _InfoChip(label: 'Beds', value: '${property.beds}'),
          if (property.baths != null) _InfoChip(label: 'Baths', value: property.baths!.toStringAsFixed(1)),
          if (property.sqft != null) _InfoChip(label: 'Sq Ft', value: NumberFormat('#,###').format(property.sqft)),
          if (property.yearBuilt != null) _InfoChip(label: 'Built', value: '${property.yearBuilt}'),
        ],
      ),
    );
  }

  Widget _financialsCard() {
    return _Card(
      title: 'Financials',
      child: Column(
        children: [
          if (property.taxDue != null)
            FinancialRow(label: 'Tax Due (Min Bid)', value: property.taxDue!),
          if (property.rehabCost != null)
            FinancialRow(label: 'Est. Rehab Cost', value: property.rehabCost!),
          if (property.allInCost != null)
            FinancialRow(label: 'All-In Cost', value: property.allInCost!),
          if (property.arv != null)
            FinancialRow(label: 'ARV (After Repair)', value: property.arv!, style: FinancialStyle.positive),
          if (property.netProfit != null)
            FinancialRow(
              label: 'Est. Net Profit',
              value: property.netProfit!,
              style: (property.netProfit ?? 0) >= 0 ? FinancialStyle.positive : FinancialStyle.negative,
            ),
          if (property.maxBid != null) ...[
            const Divider(height: 20),
            Row(
              children: [
                const Text('Recommended Max Bid', style: TextStyle(fontSize: 13, color: AppColors.textMuted, fontWeight: FontWeight.w600)),
                const Spacer(),
                Text(_currency.format(property.maxBid),
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w900, color: AppColors.emerald)),
              ],
            ),
          ],
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: AppColors.surfaceElevated, borderRadius: BorderRadius.circular(10)),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    children: [
                      Text('${property.roiPct.toStringAsFixed(0)}%',
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.emerald)),
                      const Text('ROI', style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
                    ],
                  ),
                ),
                if (property.compCount != null) ...[
                  Container(width: 1, height: 40, color: AppColors.border),
                  Expanded(
                    child: Column(
                      children: [
                        Text('${property.compCount}',
                          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.textPrimary)),
                        const Text('Comps', style: TextStyle(fontSize: 11, color: AppColors.textMuted)),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _riskCard() {
    return _Card(
      title: 'Risk Assessment',
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          if (property.compositeRiskScore != null)
            RiskIndicator(score: property.compositeRiskScore!, label: 'Overall Risk'),
          if (property.crimeScore != null)
            RiskIndicator(score: property.crimeScore!, label: 'Crime Risk'),
          if (property.floodZone != null && property.floodZone!.isNotEmpty)
            _InfoChip(label: 'Flood Zone', value: property.floodZone!),
        ],
      ),
    );
  }

  Widget _disclaimerCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: const Text(
        'This analysis is for informational purposes only and does not constitute investment, '
        'legal, or financial advice. All estimates — including ARV, rehab cost, and ROI — are '
        'based on publicly available data and assumptions. Actual results may differ materially. '
        'Tax deed properties are sold as-is. Consult a licensed real estate attorney and '
        'financial advisor before making any investment decision. BidWise Invest LLC makes '
        'no guarantee of accuracy or returns.',
        style: TextStyle(fontSize: 11, color: AppColors.textDisabled, height: 1.5),
      ),
    );
  }
}

class _Card extends StatelessWidget {
  final String title;
  final Widget child;

  const _Card({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
          const SizedBox(height: 12),
          child,
        ],
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final String label;
  final String value;

  const _InfoChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        ],
      ),
    );
  }
}
