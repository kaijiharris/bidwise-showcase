import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../shared/theme/app_theme.dart';
import 'auth_provider.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  String? _error;
  bool _isSignUp = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() { _loading = true; _error = null; });
    try {
      if (_isSignUp) {
        await ref.read(authNotifierProvider.notifier).signUp(_email.text.trim(), _password.text);
      } else {
        await ref.read(authNotifierProvider.notifier).signIn(_email.text.trim(), _password.text);
      }
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _googleSignIn() async {
    setState(() { _loading = true; _error = null; });
    try {
      await ref.read(authNotifierProvider.notifier).signInWithGoogle();
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            children: [
              const SizedBox(height: 64),

              // Brand
              Column(
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: BoxDecoration(
                      color: AppColors.emerald.withAlpha(20),
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: AppColors.emerald.withAlpha(60)),
                    ),
                    child: const Icon(Icons.home_work_outlined, color: AppColors.emerald, size: 30),
                  ),
                  const SizedBox(height: 16),
                  const Text('BidWise', style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900, color: AppColors.textPrimary)),
                  const SizedBox(height: 4),
                  const Text('Auction deal intelligence', style: TextStyle(fontSize: 14, color: AppColors.textMuted)),
                ],
              ),

              const SizedBox(height: 48),

              // Email
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                textInputAction: TextInputAction.next,
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: const InputDecoration(
                  labelText: 'Email',
                  hintText: 'you@example.com',
                ),
              ),
              const SizedBox(height: 12),

              // Password
              TextField(
                controller: _password,
                obscureText: true,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                style: const TextStyle(color: AppColors.textPrimary),
                decoration: const InputDecoration(labelText: 'Password'),
              ),

              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: const TextStyle(color: AppColors.scoreFair, fontSize: 13)),
              ],

              const SizedBox(height: 24),

              // Primary action
              ElevatedButton(
                onPressed: (_loading || _email.text.isEmpty || _password.text.isEmpty) ? null : _submit,
                child: _loading
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : Text(_isSignUp ? 'Create Account' : 'Sign In'),
              ),

              const SizedBox(height: 16),

              // Divider
              Row(children: [
                const Expanded(child: Divider()),
                const Padding(padding: EdgeInsets.symmetric(horizontal: 12), child: Text('or', style: TextStyle(color: AppColors.textDisabled, fontSize: 12))),
                const Expanded(child: Divider()),
              ]),

              const SizedBox(height: 16),

              // Google sign-in
              OutlinedButton.icon(
                onPressed: _loading ? null : _googleSignIn,
                icon: const Icon(Icons.g_mobiledata, size: 22),
                label: const Text('Continue with Google'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.textPrimary,
                  side: const BorderSide(color: AppColors.border),
                  minimumSize: const Size(double.infinity, 52),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),

              const SizedBox(height: 24),

              // Toggle sign in / sign up
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    _isSignUp ? 'Already have an account? ' : "Don't have an account? ",
                    style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                  ),
                  GestureDetector(
                    onTap: () => setState(() { _isSignUp = !_isSignUp; _error = null; }),
                    child: Text(
                      _isSignUp ? 'Sign in' : 'Start free trial',
                      style: const TextStyle(color: AppColors.emerald, fontSize: 13, fontWeight: FontWeight.w700),
                    ),
                  ),
                ],
              ),

              if (!_isSignUp) ...[
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => context.push('/forgot-password'),
                  child: const Text('Forgot password?', style: TextStyle(fontSize: 12)),
                ),
              ],

              const SizedBox(height: 40),

              // Legal footer
              const Text(
                'By signing in you agree that BidWise provides analysis only '
                'and does not constitute investment advice.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 11, color: AppColors.textDisabled),
              ),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}
