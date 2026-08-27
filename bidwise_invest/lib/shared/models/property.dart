// Data models ported from iOS BidWiseAI Swift Models.swift
// Matches the Supabase `properties` table schema and Flask API responses.

class PropertySummary {
  final String parcelId;
  final String address;
  final String city;
  final String? zip;
  final String county;
  final String? propertyType;
  final double dealScore;
  final double roiPct;
  final double? arv;
  final double? taxDue;
  final double? rehabCost;
  final double? netProfit;
  final bool isNew; // true if added within last 7 days
  // Guardrail / trust signals (Supabase migrations 020 + 022). Null on rows
  // pushed before the pipeline exported them — null means "never screened",
  // and such rows must render as normal deals, not as screened-out ones.
  final String? scoreTier;
  final String? arvConfidence;
  final bool? isNoBid;
  final String? noBidReason;
  final bool? estimateOnly;
  // Per-user paywall flag from visible_properties_safe (migration 022): true
  // when the view masked this row's financials for the caller's tier. Rows
  // fetched outside the view (admin/base-table paths) carry no column and
  // default to false — the masking itself always happens server-side.
  final bool locked;

  const PropertySummary({
    required this.parcelId,
    required this.address,
    required this.city,
    this.zip,
    required this.county,
    this.propertyType,
    required this.dealScore,
    required this.roiPct,
    this.arv,
    this.taxDue,
    this.rehabCost,
    this.netProfit,
    this.isNew = false,
    this.scoreTier,
    this.arvConfidence,
    this.isNoBid,
    this.noBidReason,
    this.estimateOnly,
    this.locked = false,
  });

  factory PropertySummary.fromJson(Map<String, dynamic> json) {
    return PropertySummary(
      parcelId: json['parcel_id'] as String,
      address: json['address'] as String? ?? '',
      city: json['city'] as String? ?? '',
      zip: json['zip'] as String?,
      county: json['county'] as String? ?? '',
      propertyType: json['property_type'] as String?,
      dealScore: (json['deal_score'] as num?)?.toDouble() ?? 0,
      roiPct: (json['roi_pct'] as num?)?.toDouble() ?? 0,
      arv: (json['arv'] as num?)?.toDouble(),
      taxDue: (json['tax_due'] as num?)?.toDouble(),
      rehabCost: (json['rehab_cost'] as num?)?.toDouble(),
      netProfit: (json['net_profit'] as num?)?.toDouble(),
      isNew: _isNewProperty(json['created_at'] as String?),
      scoreTier: json['score_tier'] as String?,
      arvConfidence: json['arv_confidence'] as String?,
      isNoBid: json['is_no_bid'] as bool?,
      noBidReason: json['no_bid_reason'] as String?,
      estimateOnly: json['estimate_only'] as bool?,
      locked: json['locked'] as bool? ?? false,
    );
  }

  static bool _isNewProperty(String? createdAt) {
    if (createdAt == null) return false;
    try {
      final date = DateTime.parse(createdAt);
      return DateTime.now().difference(date).inDays <= 7;
    } catch (_) {
      return false;
    }
  }

  String get scoreLabel {
    if (dealScore >= 75) return 'Excellent';
    if (dealScore >= 50) return 'Good';
    return 'Review';
  }

  // Pipeline emits upper-, lower-, and mixed-case tiers; normalise like the
  // web's ConfidenceBadge does before comparing.
  String get _normalizedArvConfidence => (arvConfidence ?? '')
      .trim()
      .toUpperCase()
      .replaceAll(RegExp(r'[\s-]+'), '_');

  /// Mirrors the web dashboard's isNoBidState: ROI/profit figures are
  /// untrustworthy when the guardrail screened the parcel out (is_no_bid),
  /// the land model flagged it estimate-only, or the valuation itself is
  /// ESTIMATE_ONLY. Suppressed rows must show a label instead of returns.
  bool get isSuppressed =>
      isNoBid == true ||
      estimateOnly == true ||
      _normalizedArvConfidence == 'ESTIMATE_ONLY';

  /// Label for the suppressed-ROI slot — is_no_bid wins over the softer
  /// estimate-only signal (mirrors the web's noBidLabel).
  String get suppressionLabel => isNoBid == true ? 'NO BID' : 'ESTIMATE ONLY';
}

class PropertyDetail extends PropertySummary {
  final int? beds;
  final double? baths;
  final int? sqft;
  final int? yearBuilt;
  final String? rehabCategory;
  final double? allInCost;
  final double? maxBid;
  final double? crimeScore;
  final String? floodZone;
  final double? compositeRiskScore;
  final int? compCount;
  final String? sourceUrl;
  final String? auctionDate;
  final double? minBid;
  // Pipeline reasoning trail + redemption dual-ROI (migrations 020 + 022).
  final String? analysisNotes;
  final double? roiIfRedeemedYear1Pct;
  final double? roiIfDeedMatures;

  const PropertyDetail({
    required super.parcelId,
    required super.address,
    required super.city,
    super.zip,
    required super.county,
    super.propertyType,
    required super.dealScore,
    required super.roiPct,
    super.arv,
    super.taxDue,
    super.rehabCost,
    super.netProfit,
    super.isNew,
    super.scoreTier,
    super.arvConfidence,
    super.isNoBid,
    super.noBidReason,
    super.estimateOnly,
    super.locked,
    this.beds,
    this.baths,
    this.sqft,
    this.yearBuilt,
    this.rehabCategory,
    this.allInCost,
    this.maxBid,
    this.crimeScore,
    this.floodZone,
    this.compositeRiskScore,
    this.compCount,
    this.sourceUrl,
    this.auctionDate,
    this.minBid,
    this.analysisNotes,
    this.roiIfRedeemedYear1Pct,
    this.roiIfDeedMatures,
  });

  factory PropertyDetail.fromJson(Map<String, dynamic> json) {
    final base = PropertySummary.fromJson(json);
    return PropertyDetail(
      parcelId: base.parcelId,
      address: base.address,
      city: base.city,
      zip: base.zip,
      county: base.county,
      propertyType: base.propertyType,
      dealScore: base.dealScore,
      roiPct: base.roiPct,
      arv: base.arv,
      taxDue: base.taxDue,
      rehabCost: base.rehabCost,
      netProfit: base.netProfit,
      isNew: base.isNew,
      scoreTier: base.scoreTier,
      arvConfidence: base.arvConfidence,
      isNoBid: base.isNoBid,
      noBidReason: base.noBidReason,
      estimateOnly: base.estimateOnly,
      locked: base.locked,
      beds: json['beds'] as int?,
      baths: (json['baths'] as num?)?.toDouble(),
      sqft: json['sqft'] as int?,
      yearBuilt: json['year_built'] as int?,
      rehabCategory: json['rehab_category'] as String?,
      allInCost: (json['all_in_cost'] as num?)?.toDouble(),
      maxBid: (json['max_bid'] as num?)?.toDouble(),
      crimeScore: (json['crime_score'] as num?)?.toDouble(),
      floodZone: json['flood_zone'] as String?,
      compositeRiskScore: (json['risk_score'] as num?)?.toDouble(),
      compCount: json['comp_count'] as int?,
      sourceUrl: json['source_url'] as String?,
      auctionDate: json['auction_date'] as String?,
      minBid: (json['min_bid'] as num?)?.toDouble(),
      analysisNotes: json['analysis_notes'] as String?,
      roiIfRedeemedYear1Pct: (json['roi_if_redeemed_year1_pct'] as num?)?.toDouble(),
      roiIfDeedMatures: (json['roi_if_deed_matures'] as num?)?.toDouble(),
    );
  }
}
