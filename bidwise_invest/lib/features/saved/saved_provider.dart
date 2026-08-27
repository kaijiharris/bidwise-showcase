import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../shared/models/property.dart';
import '../../shared/services/supabase_service.dart';

final _svc = SupabaseService();

final savedPropertiesProvider = FutureProvider.autoDispose<List<PropertySummary>>((ref) async {
  return _svc.fetchSavedProperties();
});
