import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'shared/theme/app_theme.dart';
import 'features/auth/auth_provider.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/forgot_password_screen.dart';
import 'features/feed/feed_screen.dart';
import 'features/property/property_detail_screen.dart';
import 'features/saved/saved_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/subscription/paywall_screen.dart';
import 'features/admin/admin_dashboard_screen.dart';
import 'features/shell/app_shell.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authUserProvider);
  final profileState = ref.watch(userProfileProvider);
  final subState = ref.watch(subscriptionProvider);

  return GoRouter(
    initialLocation: '/feed',
    redirect: (context, state) {
      final isSignedIn = authState.value != null;
      final isLoading = authState.isLoading || profileState.isLoading || subState.isLoading;
      final path = state.matchedLocation;

      if (isLoading) return null;

      if (!isSignedIn) {
        if (path == '/login' || path == '/forgot-password') return null;
        return '/login';
      }

      // Signed in — bounce away from auth screens
      if (path == '/login' || path == '/forgot-password') return '/feed';

      final isAdmin = profileState.value?.isAdmin ?? false;
      final hasSubscription = subState.value?.isActive ?? false;

      if (path == '/admin') {
        return isAdmin ? null : '/feed';
      }

      if (!isAdmin && !hasSubscription && path != '/paywall') {
        return '/paywall';
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, _) => const LoginScreen(),
      ),
      GoRoute(
        path: '/forgot-password',
        builder: (context, _) => const ForgotPasswordScreen(),
      ),
      GoRoute(
        path: '/paywall',
        builder: (context, _) => const PaywallScreen(),
      ),
      GoRoute(
        path: '/admin',
        builder: (context, _) => const AdminDashboardScreen(),
      ),
      // Property detail is outside the shell so the bottom nav is hidden
      GoRoute(
        path: '/property/:parcelId',
        builder: (context, state) => PropertyDetailScreen(
          parcelId: state.pathParameters['parcelId']!,
        ),
      ),
      ShellRoute(
        builder: (context, state, child) => AppShell(child: child),
        routes: [
          GoRoute(
            path: '/feed',
            builder: (context, _) => const FeedScreen(),
          ),
          GoRoute(
            path: '/saved',
            builder: (context, _) => const SavedScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, _) => const ProfileScreen(),
          ),
        ],
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Text(
          'Page not found: ${state.error}',
          style: const TextStyle(color: AppColors.textMuted),
        ),
      ),
    ),
  );
});

class BidWiseApp extends ConsumerWidget {
  const BidWiseApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'BidWise Invest',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.dark,
      routerConfig: router,
    );
  }
}
