import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';

enum FinancialStyle { positive, negative, neutral }

final _currency = NumberFormat.currency(symbol: '\$', decimalDigits: 0);

class FinancialRow extends StatelessWidget {
  final String label;
  final double value;
  final FinancialStyle style;

  const FinancialRow({
    super.key,
    required this.label,
    required this.value,
    this.style = FinancialStyle.neutral,
  });

  Color get _color {
    switch (style) {
      case FinancialStyle.positive: return AppColors.scoreExcellent;
      case FinancialStyle.negative: return AppColors.scoreFair;
      case FinancialStyle.neutral: return AppColors.textPrimary;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Text(label, style: const TextStyle(fontSize: 13, color: AppColors.textMuted)),
          const Spacer(),
          Text(
            _currency.format(value),
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _color),
          ),
        ],
      ),
    );
  }
}

class StatCell extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;

  const StatCell({super.key, required this.label, required this.value, this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textMuted)),
        const SizedBox(height: 1),
        Text(
          value,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: valueColor ?? AppColors.textPrimary,
          ),
        ),
      ],
    );
  }
}
