import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../shared/theme/app_theme.dart';
import '../auth/auth_provider.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authUser = ref.watch(authUserProvider).value;
    final profile = ref.watch(userProfileProvider).value;
    final sub = ref.watch(subscriptionProvider).value;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        automaticallyImplyLeading: false,
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _Card(
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.emerald.withAlpha(20),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.person_rounded, color: AppColors.emerald, size: 24),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (profile?.fullName != null && profile!.fullName!.isNotEmpty)
                        Text(
                          profile.fullName!,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                        ),
                      Text(
                        authUser?.email ?? '',
                        style: const TextStyle(fontSize: 13, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                ),
                if (profile?.isAdmin == true)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.cyan.withAlpha(20),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text(
                      'ADMIN',
                      style: TextStyle(fontSize: 10, fontWeight: FontWeight.w800, color: AppColors.cyan),
                    ),
                  ),
              ],
            ),
          ),

          const SizedBox(height: 12),

          if (sub != null)
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Subscription',
                    style: TextStyle(fontSize: 12, color: AppColors.textMuted, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      _PlanBadge(plan: sub.planDisplayName, isTrialing: sub.isTrialing),
                      const Spacer(),
                      if (sub.currentPeriodEnd != null)
                        Text(
                          sub.isTrialing
                              ? 'Trial ends ${_formatDate(sub.trialEnd)}'
                              : 'Renews ${_formatDate(sub.currentPeriodEnd)}',
                          style: const TextStyle(fontSize: 12, color: AppColors.textMuted),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: () => launchUrl(
                      Uri.parse('https://bidwiseinvest.com/pricing'),
                      mode: LaunchMode.externalApplication,
                    ),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textPrimary,
                      side: const BorderSide(color: AppColors.border),
                      minimumSize: const Size(double.infinity, 44),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    child: const Text('Manage Subscription'),
                  ),
                ],
              ),
            ),

          if (sub != null) const SizedBox(height: 12),

          _Card(
            child: Column(
              children: [
                _ActionRow(
                  icon: Icons.help_outline_rounded,
                  label: 'Help & Support',
                  onTap: () => launchUrl(
                    Uri.parse('mailto:support@bidwiseinvest.com'),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
                const Divider(height: 1),
                _ActionRow(
                  icon: Icons.article_outlined,
                  label: 'Terms & Privacy',
                  onTap: () => launchUrl(
                    Uri.parse('https://bidwiseinvest.com'),
                    mode: LaunchMode.externalApplication,
                  ),
                ),
                const Divider(height: 1),
                _ActionRow(
                  icon: Icons.logout_rounded,
                  label: 'Sign Out',
                  labelColor: AppColors.scoreFair,
                  onTap: () => ref.read(authNotifierProvider.notifier).signOut(),
                ),
              ],
            ),
          ),

          const SizedBox(height: 24),
          const Center(
            child: Text(
              'BidWise Invest · v1.0.0',
              style: TextStyle(fontSize: 11, color: AppColors.textDisabled),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  static String _formatDate(DateTime? d) {
    if (d == null) return '';
    return '${d.month}/${d.day}/${d.year}';
  }
}

class _Card extends StatelessWidget {
  final Widget child;
  const _Card({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: child,
    );
  }
}

class _PlanBadge extends StatelessWidget {
  final String plan;
  final bool isTrialing;
  const _PlanBadge({required this.plan, required this.isTrialing});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.emerald.withAlpha(20),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppColors.emerald.withAlpha(60)),
      ),
      child: Text(
        isTrialing ? '$plan (Trial)' : plan,
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: AppColors.emerald),
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color? labelColor;
  final VoidCallback onTap;

  const _ActionRow({required this.icon, required this.label, this.labelColor, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 14),
        child: Row(
          children: [
            Icon(icon, size: 18, color: labelColor ?? AppColors.textMuted),
            const SizedBox(width: 12),
            Text(
              label,
              style: TextStyle(fontSize: 14, color: labelColor ?? AppColors.textPrimary),
            ),
            const Spacer(),
            Icon(Icons.chevron_right_rounded, size: 18, color: labelColor ?? AppColors.textMuted),
          ],
        ),
      ),
    );
  }
}
