import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';
import '../models/property.dart';
import 'score_badge.dart';

final _currency = NumberFormat.compactCurrency(symbol: '\$', decimalDigits: 0);

class DealCard extends ConsumerWidget {
  final PropertySummary property;

  /// Pass the list index for staggered entrance delays (optional).
  final int? index;

  /// When true, financial fields are hidden behind an upgrade CTA.
  /// Tapping the card routes to /pricing instead of property detail.
  final bool isLocked;

  /// Tier name shown on the unlock CTA (e.g., 'Pro' or 'Expert').
  /// Defaults to 'Pro' if omitted.
  final String? upgradeTarget;

  const DealCard({
    super.key,
    required this.property,
    this.index,
    this.isLocked = false,
    this.upgradeTarget,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final delay = index != null ? (40 * index!).ms : 0.ms;

    return GestureDetector(
      onTap: () => isLocked
          ? context.push('/pricing')
          : context.push('/property/${property.parcelId}'),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    property.address,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                if (property.isNew && !isLocked)
                  Container(
                    margin: const EdgeInsets.only(right: 6),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.emerald.withAlpha(25),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text('NEW', style: TextStyle(fontSize: 9, fontWeight: FontWeight.w800, color: AppColors.emerald)),
                  ),
                ScoreBadge(score: property.dealScore),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${property.city}, GA${property.zip != null ? '  ${property.zip}' : ''}  ·  ${property.county} County',
              style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
            ),
            const SizedBox(height: 12),
            isLocked
                ? _LockedFinancials(upgradeTarget: upgradeTarget ?? 'Pro')
                : _UnlockedFinancials(property: property),
          ],
        ),
      ),
    )
        .animate()
        .fadeIn(duration: 220.ms, delay: delay, curve: Curves.easeOut)
        .slideY(begin: 0.04, end: 0, duration: 220.ms, delay: delay, curve: Curves.easeOut);
  }
}

class _UnlockedFinancials extends StatelessWidget {
  final PropertySummary property;
  const _UnlockedFinancials({required this.property});

  @override
  Widget build(BuildContext context) {
    // Guardrail screen-out / estimate-only: never show a misleading ROI or
    // profit figure — render the suppression label (+ reason) instead,
    // mirroring the web dashboard's NO BID pill.
    if (property.isSuppressed) {
      return Row(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.riskHigh.withAlpha(28),
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: AppColors.riskHigh.withAlpha(90)),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.block_rounded, size: 11, color: AppColors.riskHigh),
                const SizedBox(width: 4),
                Text(
                  property.suppressionLabel,
                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.riskHigh),
                ),
              ],
            ),
          ),
          if (property.noBidReason != null) ...[
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                property.noBidReason!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 11, color: AppColors.textMuted),
              ),
            ),
          ],
        ],
      );
    }

    return Row(
      children: [
        _Stat(label: 'ROI', value: '${property.roiPct.toStringAsFixed(0)}%', color: AppColors.emerald),
        const SizedBox(width: 20),
        if (property.arv != null)
          _Stat(label: 'ARV', value: _currency.format(property.arv)),
        const SizedBox(width: 20),
        if (property.netProfit != null)
          _Stat(label: 'Profit', value: _currency.format(property.netProfit)),
      ],
    );
  }
}

class _LockedFinancials extends StatelessWidget {
  final String upgradeTarget;
  const _LockedFinancials({required this.upgradeTarget});

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
      children: [
        Opacity(
          opacity: 0.32,
          child: Row(
            children: const [
              _Stat(label: 'ROI', value: '••%', color: AppColors.textMuted),
              SizedBox(width: 20),
              _Stat(label: 'ARV', value: '\$•••K', color: AppColors.textMuted),
              SizedBox(width: 20),
              _Stat(label: 'Profit', value: '\$•••K', color: AppColors.textMuted),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: AppColors.emerald,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(color: AppColors.emerald.withAlpha(60), blurRadius: 12, offset: const Offset(0, 2)),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.lock, size: 12, color: Colors.white),
              const SizedBox(width: 6),
              Text(
                'Unlock — Upgrade to $upgradeTarget',
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Colors.white),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  final String label;
  final String value;
  final Color? color;

  const _Stat({required this.label, required this.value, this.color});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        Text(
          value,
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: color ?? AppColors.textPrimary),
        ),
      ],
    );
  }
}
