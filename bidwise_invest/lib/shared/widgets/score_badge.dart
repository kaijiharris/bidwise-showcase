import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class ScoreBadge extends StatelessWidget {
  final double score;
  final bool large;

  const ScoreBadge({super.key, required this.score, this.large = false});

  Color get _color {
    if (score >= 75) return AppColors.scoreExcellent;
    if (score >= 50) return AppColors.scoreGood;
    return AppColors.scoreFair;
  }

  @override
  Widget build(BuildContext context) {
    final size = large ? 18.0 : 13.0;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: large ? 12 : 8, vertical: large ? 5 : 3),
      decoration: BoxDecoration(
        color: _color.withAlpha(25),
        border: Border.all(color: _color.withAlpha(80)),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        score.toStringAsFixed(0),
        style: TextStyle(
          color: _color,
          fontSize: size,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class RiskIndicator extends StatelessWidget {
  final double score;
  final String label;

  const RiskIndicator({super.key, required this.score, required this.label});

  Color get _color {
    if (score < 40) return AppColors.riskLow;
    if (score < 70) return AppColors.riskMedium;
    return AppColors.riskHigh;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: AppColors.textMuted)),
          const SizedBox(height: 2),
          Text(
            '${score.toStringAsFixed(0)} / 100',
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: _color),
          ),
        ],
      ),
    );
  }
}
