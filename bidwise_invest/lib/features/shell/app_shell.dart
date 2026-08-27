import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../shared/theme/app_theme.dart';

// Breakpoints from material_3_demo/constants.dart in flutter/samples
const double _kMediumBreakpoint = 1000;
const double _kLargeBreakpoint = 1500;

class AppShell extends StatelessWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  int _tabIndex(String location) {
    if (location.startsWith('/saved')) return 1;
    if (location.startsWith('/profile')) return 2;
    return 0;
  }

  void _onTabTap(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/feed');
      case 1:
        context.go('/saved');
      case 2:
        context.go('/profile');
    }
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    final index = _tabIndex(location);

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;

        if (width >= _kMediumBreakpoint) {
          return _WideShell(
            selectedIndex: index,
            extended: width >= _kLargeBreakpoint,
            onTap: (i) => _onTabTap(context, i),
            child: child,
          );
        }

        return _NarrowShell(
          selectedIndex: index,
          onTap: (i) => _onTabTap(context, i),
          child: child,
        );
      },
    );
  }
}

// ── Narrow (mobile < 1000px): bottom NavigationBar ───────────────────────────

class _NarrowShell extends StatelessWidget {
  final Widget child;
  final int selectedIndex;
  final ValueChanged<int> onTap;

  const _NarrowShell({
    required this.child,
    required this.selectedIndex,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: onTap,
        destinations: _destinations(),
      ),
    );
  }
}

// ── Wide (tablet ≥ 1000px / desktop ≥ 1500px): side NavigationRail ───────────

class _WideShell extends StatelessWidget {
  final Widget child;
  final int selectedIndex;
  final bool extended;
  final ValueChanged<int> onTap;

  const _WideShell({
    required this.child,
    required this.selectedIndex,
    required this.extended,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Row(
        children: [
          NavigationRail(
            extended: extended,
            backgroundColor: AppColors.surface,
            selectedIndex: selectedIndex,
            onDestinationSelected: onTap,
            leading: _RailLogo(extended: extended),
            labelType: extended
                ? NavigationRailLabelType.none
                : NavigationRailLabelType.selected,
            destinations: _railDestinations(),
          ),
          const VerticalDivider(width: 1, thickness: 1),
          Expanded(child: child),
        ],
      ),
    );
  }
}

// ── Shared destination definitions ───────────────────────────────────────────

List<NavigationDestination> _destinations() => const [
      NavigationDestination(
        icon: Icon(Icons.home_outlined),
        selectedIcon: Icon(Icons.home_rounded),
        label: 'Feed',
      ),
      NavigationDestination(
        icon: Icon(Icons.bookmark_outline_rounded),
        selectedIcon: Icon(Icons.bookmark_rounded),
        label: 'Saved',
      ),
      NavigationDestination(
        icon: Icon(Icons.person_outline_rounded),
        selectedIcon: Icon(Icons.person_rounded),
        label: 'Profile',
      ),
    ];

List<NavigationRailDestination> _railDestinations() => const [
      NavigationRailDestination(
        icon: Icon(Icons.home_outlined),
        selectedIcon: Icon(Icons.home_rounded),
        label: Text('Feed'),
      ),
      NavigationRailDestination(
        icon: Icon(Icons.bookmark_outline_rounded),
        selectedIcon: Icon(Icons.bookmark_rounded),
        label: Text('Saved'),
      ),
      NavigationRailDestination(
        icon: Icon(Icons.person_outline_rounded),
        selectedIcon: Icon(Icons.person_rounded),
        label: Text('Profile'),
      ),
    ];

// ── Rail logo / branding ─────────────────────────────────────────────────────

class _RailLogo extends StatelessWidget {
  final bool extended;
  const _RailLogo({required this.extended});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: extended
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const SizedBox(width: 4),
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: AppColors.emerald.withAlpha(20),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: AppColors.emerald.withAlpha(60)),
                  ),
                  child: const Icon(Icons.home_work_outlined, color: AppColors.emerald, size: 16),
                ),
                const SizedBox(width: 10),
                const Text(
                  'BidWise',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w900,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            )
          : Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: AppColors.emerald.withAlpha(20),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: AppColors.emerald.withAlpha(60)),
              ),
              child: const Icon(Icons.home_work_outlined, color: AppColors.emerald, size: 16),
            ),
    );
  }
}
