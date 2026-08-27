import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../../shared/models/user_profile.dart';
import '../../shared/models/subscription.dart';
import '../../shared/services/supabase_service.dart';

final _svc = SupabaseService();

// Current Supabase auth user
final authUserProvider = StreamProvider<User?>((ref) {
  return _svc.authStateChanges.map((state) => state.session?.user);
});

// UserProfile (includes role)
final userProfileProvider = FutureProvider<UserProfile?>((ref) async {
  final user = ref.watch(authUserProvider).value;
  if (user == null) return null;
  return _svc.fetchUserProfile();
});

// Active subscription
final subscriptionProvider = FutureProvider<Subscription?>((ref) async {
  final user = ref.watch(authUserProvider).value;
  if (user == null) return null;
  return _svc.fetchSubscription();
});

// Convenience: is the user an admin?
final isAdminProvider = Provider<bool>((ref) {
  return ref.watch(userProfileProvider).value?.isAdmin ?? false;
});

// Convenience: does the user have an active subscription?
final hasActiveSubscriptionProvider = Provider<bool>((ref) {
  return ref.watch(subscriptionProvider).value?.isActive ?? false;
});

// Auth actions
class AuthNotifier extends Notifier<void> {
  final _svc = SupabaseService();

  @override
  void build() {}

  Future<void> signIn(String email, String password) =>
      _svc.signInWithEmail(email, password);

  Future<void> signUp(String email, String password) =>
      _svc.signUpWithEmail(email, password);

  Future<void> signInWithGoogle() => _svc.signInWithGoogle();

  Future<void> resetPassword(String email) => _svc.resetPassword(email);

  Future<void> signOut() => _svc.signOut();
}

final authNotifierProvider = NotifierProvider<AuthNotifier, void>(AuthNotifier.new);
