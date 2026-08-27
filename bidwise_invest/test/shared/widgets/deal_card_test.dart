import 'package:bidwise_invest/shared/models/property.dart';
import 'package:bidwise_invest/shared/widgets/deal_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

/// Mirrors what a visible_properties_safe row looks like client-side:
/// locked rows carry null financials (the view masks them server-side).
PropertySummary property({bool locked = false}) => PropertySummary(
      parcelId: '15-123-45-678',
      address: '123 Main St',
      city: 'Decatur',
      zip: '30030',
      county: 'DeKalb',
      dealScore: 82,
      roiPct: locked ? 0 : 42,
      arv: locked ? null : 250000,
      netProfit: locked ? null : 61000,
      locked: locked,
    );

Widget wrap(Widget child) => ProviderScope(
      child: MaterialApp(home: Scaffold(body: child)),
    );

void main() {
  testWidgets('unlocked card shows real financials and no upgrade CTA', (tester) async {
    final prop = property();
    await tester.pumpWidget(wrap(DealCard(property: prop, isLocked: prop.locked)));
    await tester.pumpAndSettle();

    expect(find.text('42%'), findsOneWidget);
    expect(find.textContaining('Unlock'), findsNothing);
    expect(find.byIcon(Icons.lock), findsNothing);
  });

  testWidgets('locked card hides financials behind the upgrade CTA', (tester) async {
    final prop = property(locked: true);
    await tester.pumpWidget(wrap(DealCard(property: prop, isLocked: prop.locked)));
    await tester.pumpAndSettle();

    expect(find.textContaining('Unlock — Upgrade to'), findsOneWidget);
    expect(find.byIcon(Icons.lock), findsOneWidget);
    // Real figures must not render — only the masked placeholders.
    expect(find.text('42%'), findsNothing);
    expect(find.text('••%'), findsOneWidget);
  });

  testWidgets('locked card routes to /pricing instead of property detail', (tester) async {
    final prop = property(locked: true);
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (_, _) => Scaffold(body: DealCard(property: prop, isLocked: prop.locked)),
        ),
        GoRoute(path: '/pricing', builder: (_, _) => const Scaffold(body: Text('PRICING'))),
        GoRoute(
          path: '/property/:id',
          builder: (_, _) => const Scaffold(body: Text('DETAIL')),
        ),
      ],
    );
    await tester.pumpWidget(ProviderScope(child: MaterialApp.router(routerConfig: router)));
    await tester.pumpAndSettle();

    // warnIfMissed off: flutter_animate's settled transform trips the
    // hit-test heuristic even though the tap lands (the route assertion below
    // is the real check).
    await tester.tap(find.byType(DealCard), warnIfMissed: false);
    await tester.pumpAndSettle();

    expect(find.text('PRICING'), findsOneWidget);
    expect(find.text('DETAIL'), findsNothing);
  });

  testWidgets('unlocked card routes to property detail', (tester) async {
    final prop = property();
    final router = GoRouter(
      routes: [
        GoRoute(
          path: '/',
          builder: (_, _) => Scaffold(body: DealCard(property: prop, isLocked: prop.locked)),
        ),
        GoRoute(path: '/pricing', builder: (_, _) => const Scaffold(body: Text('PRICING'))),
        GoRoute(
          path: '/property/:id',
          builder: (_, _) => const Scaffold(body: Text('DETAIL')),
        ),
      ],
    );
    await tester.pumpWidget(ProviderScope(child: MaterialApp.router(routerConfig: router)));
    await tester.pumpAndSettle();

    // warnIfMissed off: flutter_animate's settled transform trips the
    // hit-test heuristic even though the tap lands (the route assertion below
    // is the real check).
    await tester.tap(find.byType(DealCard), warnIfMissed: false);
    await tester.pumpAndSettle();

    expect(find.text('DETAIL'), findsOneWidget);
  });
}
