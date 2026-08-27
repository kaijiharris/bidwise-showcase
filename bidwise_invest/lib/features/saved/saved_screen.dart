import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../shared/theme/app_theme.dart';
import '../../shared/widgets/deal_card.dart';
import 'saved_provider.dart';

class SavedScreen extends ConsumerWidget {
  const SavedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(savedPropertiesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Saved Properties'),
        automaticallyImplyLeading: false,
      ),
      body: state.when(
        loading: () => const Center(child: CircularProgressIndicator(color: AppColors.emerald)),
        error: (e, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline, color: AppColors.textMuted, size: 48),
                const SizedBox(height: 12),
                Text(
                  'Could not load saved properties',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(color: AppColors.textPrimary),
                ),
                const SizedBox(height: 8),
                Text(
                  e.toString(),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => ref.invalidate(savedPropertiesProvider),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
        data: (properties) {
          if (properties.isEmpty) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.bookmark_border_rounded, color: AppColors.textMuted, size: 48),
                    SizedBox(height: 12),
                    Text(
                      'No saved properties yet',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                    ),
                    SizedBox(height: 8),
                    Text(
                      'Tap the bookmark icon on any deal to save it here.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textMuted, fontSize: 13),
                    ),
                  ],
                ),
              ),
            );
          }

          return RefreshIndicator(
            color: AppColors.emerald,
            onRefresh: () async => ref.invalidate(savedPropertiesProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: properties.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (_, i) {
                final property = properties[i];
                return DealCard(property: property, index: i, isLocked: property.locked);
              },
            ),
          );
        },
      ),
    );
  }
}
