import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../shared/theme/app_theme.dart';
import 'auth_provider.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _email = TextEditingController();
  bool _loading = false;
  bool _sent = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() { _loading = true; _error = null; });
    try {
      await ref.read(authNotifierProvider.notifier).resetPassword(_email.text.trim());
      if (mounted) setState(() => _sent = true);
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset Password')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _sent ? _successView(context) : _formView(),
        ),
      ),
    );
  }

  Widget _formView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        const Text(
          'Enter your account email and we\'ll send a reset link.',
          style: TextStyle(fontSize: 14, color: AppColors.textMuted, height: 1.5),
        ),
        const SizedBox(height: 24),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _submit(),
          style: const TextStyle(color: AppColors.textPrimary),
          decoration: const InputDecoration(
            labelText: 'Email',
            hintText: 'you@example.com',
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: AppColors.scoreFair, fontSize: 13)),
        ],
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: (_loading || _email.text.isEmpty) ? null : _submit,
          child: _loading
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Send Reset Link'),
        ),
      ],
    );
  }

  Widget _successView(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        const Icon(Icons.mark_email_read_outlined, color: AppColors.emerald, size: 56),
        const SizedBox(height: 16),
        const Text(
          'Check your inbox',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: AppColors.textPrimary),
        ),
        const SizedBox(height: 8),
        Text(
          'A reset link was sent to ${_email.text}.',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 14, color: AppColors.textMuted, height: 1.5),
        ),
        const SizedBox(height: 32),
        TextButton(
          onPressed: () => context.go('/login'),
          child: const Text('Back to sign in'),
        ),
      ],
    );
  }
}
