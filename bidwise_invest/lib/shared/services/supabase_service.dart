import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/property.dart';
import '../models/user_profile.dart';
import '../models/subscription.dart';

// Singleton accessor — call after Supabase.initialize() in main.dart
SupabaseClient get supabase => Supabase.instance.client;

class SupabaseService {
  // ── Auth ────────────────────────────────────────────────────────────────────

  Stream<AuthState> get authStateChanges => supabase.auth.onAuthStateChange;
  User? get currentUser => supabase.auth.currentUser;
  bool get isSignedIn => currentUser != null;

  Future<void> signInWithEmail(String email, String password) async {
    await supabase.auth.signInWithPassword(email: email, password: password);
  }

  Future<void> signUpWithEmail(String email, String password) async {
    await supabase.auth.signUp(email: email, password: password);
  }

  Future<void> signInWithGoogle() async {
    await supabase.auth.signInWithOAuth(OAuthProvider.google);
  }

  Future<void> resetPassword(String email) async {
    await supabase.auth.resetPasswordForEmail(email);
  }

  Future<void> signOut() async {
    await supabase.auth.signOut();
  }

  // ── User Profile ─────────────────────────────────────────────────────────────

  Future<UserProfile?> fetchUserProfile() async {
    final uid = currentUser?.id;
    if (uid == null) return null;

    final data = await supabase
        .from('user_profiles')
        .select()
        .eq('id', uid)
        .maybeSingle();

    return data != null ? UserProfile.fromJson(data) : null;
  }

  // ── Subscription ─────────────────────────────────────────────────────────────

  Future<Subscription?> fetchSubscription() async {
    final uid = currentUser?.id;
    if (uid == null) return null;

    final data = await supabase
        .from('subscriptions')
        .select()
        .eq('user_id', uid)
        .inFilter('status', ['trialing', 'active', 'past_due'])
        .order('created_at', ascending: false)
        .limit(1)
        .maybeSingle();

    return data != null ? Subscription.fromJson(data) : null;
  }

  // ── Properties (Deal Feed) ───────────────────────────────────────────────────
  //
  // Tier enforcement: every subscriber-facing property read goes through the
  // visible_properties_safe view (migration 022), never the base table. The
  // view nulls the financial chain (roi_pct/arv/net_profit/tax_due/...) on
  // rows the caller's plan hasn't unlocked, exposes the per-user `locked`
  // flag that drives DealCard's paywall UI, and already restricts to
  // published + approved rows — so no `published` filter belongs here.

  static const _summaryColumns =
      'parcel_id, address, city, zip, county, property_type, '
      'deal_score, roi_pct, arv, tax_due, rehab_cost, net_profit, '
      'score_tier, arv_confidence, is_no_bid, no_bid_reason, estimate_only, '
      'created_at, locked';

  Future<List<PropertySummary>> fetchProperties({
    String? county,
    double? minDealScore,
    double? minRoi,
    double? maxRisk,
    String sortBy = 'deal_score',
    bool ascending = false,
    int page = 0,
    int pageSize = 50,
  }) async {
    var query = supabase
        .from('visible_properties_safe')
        .select(_summaryColumns)
        // Land-never-ranks contract: estimate-only (land-model) parcels never
        // appear in the ranked feed — their ROI is a rough heuristic, not a
        // scoreable signal, so an ROI sort would surface them as false top
        // deals. NULL (rows pushed before the flag existed) stays visible.
        .or('estimate_only.is.null,estimate_only.eq.false');

    if (county != null && county.isNotEmpty) {
      query = query.eq('county', county);
    }
    if (minDealScore != null) {
      query = query.gte('deal_score', minDealScore);
    }
    if (minRoi != null) {
      query = query.gte('roi_pct', minRoi);
    }
    if (maxRisk != null) {
      query = query.lte('risk_score', maxRisk);
    }

    final data = await query
        .order(sortBy, ascending: ascending)
        .range(page * pageSize, (page + 1) * pageSize - 1);

    return (data as List).map((e) => PropertySummary.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<PropertyDetail?> fetchPropertyDetail(String parcelId) async {
    // Through the masked view: a locked row reached directly (deep link,
    // stale route) returns null financials + locked=true instead of the deal.
    final data = await supabase
        .from('visible_properties_safe')
        .select()
        .eq('parcel_id', parcelId)
        .maybeSingle();

    return data != null ? PropertyDetail.fromJson(data) : null;
  }

  // ── Saved Properties ─────────────────────────────────────────────────────────
  //
  // id/parcel_id resolution also goes through the view: migration 025 revokes
  // client SELECT on the base table outright, and a user should only be able
  // to act on rows the view shows them anyway.

  // parcel_id → properties.id (null when the row isn't visible to this user).
  Future<String?> _resolvePropertyId(String parcelId) async {
    final prop = await supabase
        .from('visible_properties_safe')
        .select('id')
        .eq('parcel_id', parcelId)
        .maybeSingle();
    return prop?['id'] as String?;
  }

  Future<List<String>> _savedPropertyIds(String uid) async {
    final saved = await supabase
        .from('saved_properties')
        .select('property_id')
        .eq('user_id', uid);

    return (saved as List)
        .map((e) => e['property_id'] as String?)
        .whereType<String>()
        .toList();
  }

  Future<Set<String>> fetchSavedParcelIds() async {
    final uid = currentUser?.id;
    if (uid == null) return {};

    final ids = await _savedPropertyIds(uid);
    if (ids.isEmpty) return {};

    final rows = await supabase
        .from('visible_properties_safe')
        .select('parcel_id')
        .inFilter('id', ids);

    return (rows as List)
        .map((e) => e['parcel_id'] as String?)
        .whereType<String>()
        .toSet();
  }

  Future<void> saveProperty(String parcelId) async {
    final uid = currentUser?.id;
    if (uid == null) return;

    final propertyId = await _resolvePropertyId(parcelId);
    if (propertyId == null) return;

    await supabase.from('saved_properties').upsert({
      'user_id': uid,
      'property_id': propertyId,
    });
  }

  Future<List<PropertySummary>> fetchSavedProperties() async {
    final uid = currentUser?.id;
    if (uid == null) return [];

    // Two-step on purpose: an embedded properties(...) join would read the
    // base table (client-unreadable since 025, unmasked before that), and
    // PostgREST can't infer the saved_properties -> visible_properties_safe
    // relationship through the view's CTEs. Resolve ids first, then read
    // through the masked view — rows no longer visible simply drop out.
    final ids = await _savedPropertyIds(uid);
    if (ids.isEmpty) return [];

    final data = await supabase
        .from('visible_properties_safe')
        .select(_summaryColumns)
        .inFilter('id', ids);

    return (data as List)
        .map((e) => PropertySummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> unsaveProperty(String parcelId) async {
    final uid = currentUser?.id;
    if (uid == null) return;

    final propertyId = await _resolvePropertyId(parcelId);
    if (propertyId == null) return;

    await supabase
        .from('saved_properties')
        .delete()
        .eq('user_id', uid)
        .eq('property_id', propertyId);
  }

  // ── Admin ────────────────────────────────────────────────────────────────────

  Future<List<Map<String, dynamic>>> fetchCountyRuns() async {
    final data = await supabase
        .from('county_runs')
        .select()
        .order('run_date', ascending: false)
        .limit(20);
    return (data as List).cast<Map<String, dynamic>>();
  }

  Future<void> publishBatch(String batchId) async {
    await supabase
        .from('properties')
        .update({'published': true})
        .eq('batch_id', batchId);

    await supabase
        .from('county_runs')
        .update({
          'status': 'published',
          'published_at': DateTime.now().toIso8601String(),
        })
        .eq('batch_id', batchId);
  }

  Future<void> flagProperty(String parcelId, {bool flagged = true, String? notes}) async {
    await supabase
        .from('properties')
        .update({'flagged': flagged, 'admin_notes': notes})
        .eq('parcel_id', parcelId);
  }

  Future<Map<String, dynamic>> fetchAdminStats() async {
    final activeResponse = await supabase
        .from('subscriptions')
        .select('id')
        .inFilter('status', ['trialing', 'active'])
        .count(CountOption.exact);

    final publishedResponse = await supabase
        .from('properties')
        .select('id')
        .eq('published', true)
        .count(CountOption.exact);

    return {
      'active_subscribers': activeResponse.count,
      'published_properties': publishedResponse.count,
    };
  }
}
