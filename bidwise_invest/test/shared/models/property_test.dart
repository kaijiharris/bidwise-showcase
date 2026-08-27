import 'package:bidwise_invest/shared/models/property.dart';
import 'package:flutter_test/flutter_test.dart';

/// Payload shaped like a `visible_properties_safe` row (migration 022):
/// financials are NULL when `locked` is true; guardrail signals
/// (score_tier / is_no_bid / estimate_only) stay visible either way.
Map<String, dynamic> summaryJson({bool locked = false}) => {
      'parcel_id': '15-123-45-678',
      'address': '123 Main St',
      'city': 'Decatur',
      'zip': '30030',
      'county': 'DeKalb',
      'property_type': 'Single Family',
      'deal_score': 82,
      'roi_pct': locked ? null : 42.5,
      'arv': locked ? null : 250000,
      'tax_due': locked ? null : 4200,
      'rehab_cost': locked ? null : 35000,
      'net_profit': locked ? null : 61000,
      'score_tier': 'STRONG',
      'arv_confidence': locked ? null : 'HIGH',
      'is_no_bid': false,
      'no_bid_reason': null,
      'estimate_only': false,
      'created_at': '2026-07-01T00:00:00Z',
      'locked': locked,
    };

void main() {
  group('PropertySummary.fromJson locked mapping', () {
    test('maps locked=false from an unlocked visible_properties_safe row', () {
      final summary = PropertySummary.fromJson(summaryJson(locked: false));

      expect(summary.locked, isFalse);
      expect(summary.roiPct, 42.5);
      expect(summary.arv, 250000);
      expect(summary.netProfit, 61000);
    });

    test('maps locked=true and parses masked (null) financials without crashing', () {
      final summary = PropertySummary.fromJson(summaryJson(locked: true));

      expect(summary.locked, isTrue);
      // Masked columns come back NULL from the view — model must absorb them.
      expect(summary.roiPct, 0);
      expect(summary.arv, isNull);
      expect(summary.taxDue, isNull);
      expect(summary.rehabCost, isNull);
      expect(summary.netProfit, isNull);
      expect(summary.arvConfidence, isNull);
      // Guardrail signals stay visible on locked rows.
      expect(summary.scoreTier, 'STRONG');
      expect(summary.estimateOnly, isFalse);
    });

    test('defaults locked to false when the column is absent (base-table payloads)', () {
      final json = summaryJson()..remove('locked');

      final summary = PropertySummary.fromJson(json);

      expect(summary.locked, isFalse);
    });
  });

  group('PropertyDetail.fromJson locked passthrough', () {
    test('carries locked=true from the row into the detail model', () {
      final json = summaryJson(locked: true)
        ..addAll({
          'beds': 3,
          'baths': 2,
          'sqft': 1450,
          'year_built': 1962,
          // Masked on locked rows, exactly like the summary financials.
          'all_in_cost': null,
          'max_bid': null,
          'risk_score': null,
          'analysis_notes': null,
        });

      final detail = PropertyDetail.fromJson(json);

      expect(detail.locked, isTrue);
      expect(detail.beds, 3);
      expect(detail.maxBid, isNull);
      expect(detail.analysisNotes, isNull);
    });

    test('carries locked=false for an unlocked row', () {
      final detail = PropertyDetail.fromJson(summaryJson(locked: false));

      expect(detail.locked, isFalse);
    });
  });
}
