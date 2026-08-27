import 'package:flutter/material.dart';

// BidWise brand palette — matches the website (#04080F dark navy, emerald green)
class AppColors {
  static const background = Color(0xFF04080F);
  static const surface = Color(0xFF080D1A);
  static const surfaceElevated = Color(0xFF0E1628);
  static const border = Color(0xFF1C2740);

  static const emerald = Color(0xFF10B981);
  static const emeraldDim = Color(0xFF059669);
  static const cyan = Color(0xFF06B6D4);

  static const textPrimary = Color(0xFFFFFFFF);
  static const textSecondary = Color(0xFFCBD5E1);  // slate-300
  static const textMuted = Color(0xFF94A3B8);       // slate-400
  static const textDisabled = Color(0xFF475569);    // slate-600

  // Score colors (matching web dashboard)
  static const scoreExcellent = Color(0xFF10B981);  // green
  static const scoreGood = Color(0xFFF59E0B);       // amber
  static const scoreFair = Color(0xFFEF4444);       // red

  // Risk colors
  static const riskLow = Color(0xFF10B981);
  static const riskMedium = Color(0xFFF59E0B);
  static const riskHigh = Color(0xFFEF4444);
}

class AppTheme {
  static ThemeData get dark {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: AppColors.background,
      colorScheme: const ColorScheme.dark(
        primary: AppColors.emerald,
        secondary: AppColors.cyan,
        surface: AppColors.surface,
        onPrimary: Colors.white,
        onSurface: AppColors.textPrimary,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(
          color: AppColors.textPrimary,
          fontSize: 17,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.border, width: 1),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.surface,
        selectedItemColor: AppColors.emerald,
        unselectedItemColor: AppColors.textDisabled,
        elevation: 0,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceElevated,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.emerald, width: 1.5),
        ),
        hintStyle: const TextStyle(color: AppColors.textDisabled),
        labelStyle: const TextStyle(color: AppColors.textMuted),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.emerald,
          foregroundColor: Colors.white,
          minimumSize: const Size(double.infinity, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: AppColors.emerald),
      ),
      dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        indicatorColor: AppColors.emerald.withAlpha(30),
        labelTextStyle: WidgetStateProperty.all(
          const TextStyle(fontSize: 11, fontWeight: FontWeight.w500),
        ),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? AppColors.emerald : AppColors.textDisabled,
            size: 22,
          );
        }),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.surfaceElevated,
        selectedColor: AppColors.emerald.withAlpha(30),
        labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
        side: const BorderSide(color: AppColors.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }
}
