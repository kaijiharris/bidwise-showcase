import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../shared/theme/app_theme.dart';

class PaywallScreen extends StatelessWidget {
  const PaywallScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tiers = [
      _Tier(
        name: 'Starter',
        monthlyPrice: 39,
        annualMonthly: 27,
        annualTotal: 329,
        features: [
          '1 Georgia county feed',
          'Monthly analyzed deal batch',
          'Basic deal cards with score & ROI',
          'Email alerts when new batch drops',
          'Email support',
        ],
        highlight: false,
        planKey: 'starter',
      ),
      _Tier(
        name: 'Pro',
        monthlyPrice: 109,
        annualMonthly: 75,
        annualTotal: 899,
        features: [
          'All 3 Georgia counties',
          'Full detail: comps, risk, rehab',
          'Unlimited watchlist',
          'Auction date alerts',
          'Priority support',
        ],
        highlight: true,
        badge: 'Most Popular',
        planKey: 'pro',
      ),
      _Tier(
        name: 'Expert',
        monthlyPrice: 249,
        annualMonthly: 167,
        annualTotal: 1999,
        features: [
          'Everything in Pro',
          'CSV export',
          'Monthly analyst batch summary',
          'Live Q&A access (coming soon)',
          '24-hour support SLA',
        ],
        highlight: false,
        planKey: 'expert',
      ),
    ];

    return Scaffold(
      appBar: AppBar(title: const Text('Choose a Plan')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Unlock the full deal feed',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: AppColors.textPrimary),
          ),
          const SizedBox(height: 6),
          const Text(
            'Every plan includes a 30-day free trial. Card required — cancel before day 30 and you won\'t be charged.',
            style: TextStyle(fontSize: 13, color: AppColors.textMuted, height: 1.5),
          ),
          const SizedBox(height: 24),
          ...tiers.map((t) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _TierCard(tier: t),
          )),
          const SizedBox(height: 12),
          TextButton(
            onPressed: () => context.go('/feed'),
            child: const Text('Continue browsing (limited access)', style: TextStyle(fontSize: 12)),
          ),
        ],
      ),
    );
  }
}

class _Tier {
  final String name;
  final int monthlyPrice;
  final int annualMonthly;
  final int annualTotal;
  final List<String> features;
  final bool highlight;
  final String? badge;
  final String planKey;

  const _Tier({
    required this.name,
    required this.monthlyPrice,
    required this.annualMonthly,
    required this.annualTotal,
    required this.features,
    required this.highlight,
    this.badge,
    required this.planKey,
  });
}

class _TierCard extends StatefulWidget {
  final _Tier tier;
  const _TierCard({required this.tier});

  @override
  State<_TierCard> createState() => _TierCardState();
}

class _TierCardState extends State<_TierCard> {
  bool _annual = true;

  @override
  Widget build(BuildContext context) {
    final t = widget.tier;
    final price = _annual ? t.annualMonthly : t.monthlyPrice;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: t.highlight ? AppColors.emerald.withAlpha(100) : AppColors.border,
          width: t.highlight ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (t.badge != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.emerald,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(15)),
              ),
              child: Text(t.badge!, textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w800, color: Colors.white)),
            ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(t.name, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: AppColors.textPrimary)),
                    const Spacer(),
                    // Billing toggle
                    GestureDetector(
                      onTap: () => setState(() => _annual = !_annual),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceElevated,
                          borderRadius: BorderRadius.circular(6),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Text(
                          _annual ? 'Annual (-30%)' : 'Monthly',
                          style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700,
                            color: _annual ? AppColors.emerald : AppColors.textMuted),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                RichText(text: TextSpan(children: [
                  TextSpan(text: '\$$price', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.textPrimary)),
                  const TextSpan(text: ' /mo', style: TextStyle(fontSize: 13, color: AppColors.textMuted)),
                ])),
                if (_annual)
                  Text('\$${t.annualTotal}/yr billed annually',
                    style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
                const SizedBox(height: 14),
                ...t.features.map((f) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.check_circle_rounded, size: 14, color: AppColors.emerald),
                      const SizedBox(width: 8),
                      Expanded(child: Text(f, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary))),
                    ],
                  ),
                )),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    style: t.highlight ? null : ElevatedButton.styleFrom(
                      backgroundColor: AppColors.surfaceElevated,
                      foregroundColor: AppColors.textPrimary,
                    ),
                    onPressed: () => launchUrl(
                      Uri.parse(
                        'https://bidwiseinvest.com/signup'
                        '?plan=${t.planKey}'
                        '&cycle=${_annual ? 'annual' : 'monthly'}',
                      ),
                      mode: LaunchMode.externalApplication,
                    ),
                    child: Text('Start Free — ${t.name}'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
