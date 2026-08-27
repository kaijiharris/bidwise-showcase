import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'app.dart';

// Supabase project credentials — set via --dart-define or replace here
const _supabaseUrl = String.fromEnvironment(
  'SUPABASE_URL',
  defaultValue: 'https://YOUR_PROJECT.supabase.co',
);
const _supabaseAnonKey = String.fromEnvironment(
  'SUPABASE_ANON_KEY',
  defaultValue: 'YOUR_ANON_KEY',
);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Supabase.initialize(
    url: _supabaseUrl,
    anonKey: _supabaseAnonKey,
  );

  runApp(const ProviderScope(child: BidWiseApp()));
}
