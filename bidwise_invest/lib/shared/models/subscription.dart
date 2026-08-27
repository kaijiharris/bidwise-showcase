enum SubscriptionPlan { starter, pro, expert }
enum SubscriptionStatus { trialing, active, pastDue, canceled, incomplete }

class Subscription {
  final String id;
  final String userId;
  final SubscriptionPlan plan;
  final SubscriptionStatus status;
  final String? billingCycle;
  final DateTime? trialEnd;
  final DateTime? currentPeriodEnd;
  final String? stripeSubscriptionId;

  const Subscription({
    required this.id,
    required this.userId,
    required this.plan,
    required this.status,
    this.billingCycle,
    this.trialEnd,
    this.currentPeriodEnd,
    this.stripeSubscriptionId,
  });

  bool get isActive => status == SubscriptionStatus.active || status == SubscriptionStatus.trialing;
  bool get isTrialing => status == SubscriptionStatus.trialing;
  bool get hasAllCounties => plan == SubscriptionPlan.pro || plan == SubscriptionPlan.expert;
  bool get hasCsvExport => plan == SubscriptionPlan.expert;

  factory Subscription.fromJson(Map<String, dynamic> json) {
    return Subscription(
      id: json['id'] as String,
      userId: json['user_id'] as String,
      plan: _parsePlan(json['plan'] as String?),
      status: _parseStatus(json['status'] as String?),
      billingCycle: json['billing_cycle'] as String?,
      trialEnd: json['trial_end'] != null ? DateTime.parse(json['trial_end'] as String) : null,
      currentPeriodEnd: json['current_period_end'] != null
          ? DateTime.parse(json['current_period_end'] as String)
          : null,
      stripeSubscriptionId: json['stripe_subscription_id'] as String?,
    );
  }

  static SubscriptionPlan _parsePlan(String? raw) {
    switch (raw) {
      case 'pro': return SubscriptionPlan.pro;
      case 'expert': return SubscriptionPlan.expert;
      default: return SubscriptionPlan.starter;
    }
  }

  static SubscriptionStatus _parseStatus(String? raw) {
    switch (raw) {
      case 'trialing': return SubscriptionStatus.trialing;
      case 'active': return SubscriptionStatus.active;
      case 'past_due': return SubscriptionStatus.pastDue;
      case 'canceled': return SubscriptionStatus.canceled;
      default: return SubscriptionStatus.incomplete;
    }
  }

  String get planDisplayName {
    switch (plan) {
      case SubscriptionPlan.starter: return 'Starter';
      case SubscriptionPlan.pro: return 'Pro';
      case SubscriptionPlan.expert: return 'Expert';
    }
  }
}
