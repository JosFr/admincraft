import 'dart:math' as math;

import 'package:admincraft/models/management_state.dart';
import 'package:flutter/material.dart';

typedef PerformanceValueSelector = double? Function(PerformanceSample sample);

class PerformanceMetricChart extends StatelessWidget {
  final String title;
  final List<PerformanceSample> samples;
  final PerformanceValueSelector valueOf;
  final String unit;
  final double? minimumCeiling;
  final double? fixedCeiling;
  final double? warningThreshold;

  const PerformanceMetricChart({
    super.key,
    required this.title,
    required this.samples,
    required this.valueOf,
    this.unit = '',
    this.minimumCeiling,
    this.fixedCeiling,
    this.warningThreshold,
  });

  @override
  Widget build(BuildContext context) {
    final points = <_MetricPoint>[
      for (final sample in samples)
        if (valueOf(sample) case final value?) _MetricPoint(sample.at, value),
    ];
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: theme.textTheme.titleMedium),
            const SizedBox(height: 8),
            SizedBox(
              height: 180,
              child: points.isEmpty
                  ? const Center(child: Text('No samples in this range.'))
                  : CustomPaint(
                      painter: _MetricChartPainter(
                        points: points,
                        unit: unit,
                        minimumCeiling: minimumCeiling,
                        fixedCeiling: fixedCeiling,
                        warningThreshold: warningThreshold,
                        colorScheme: theme.colorScheme,
                        textStyle:
                            theme.textTheme.labelSmall ??
                            const TextStyle(fontSize: 11),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricPoint {
  final DateTime at;
  final double value;
  const _MetricPoint(this.at, this.value);
}

class _MetricChartPainter extends CustomPainter {
  static const _left = 48.0;
  static const _right = 8.0;
  static const _top = 8.0;
  static const _bottom = 26.0;

  final List<_MetricPoint> points;
  final String unit;
  final double? minimumCeiling;
  final double? fixedCeiling;
  final double? warningThreshold;
  final ColorScheme colorScheme;
  final TextStyle textStyle;

  const _MetricChartPainter({
    required this.points,
    required this.unit,
    required this.minimumCeiling,
    required this.fixedCeiling,
    required this.warningThreshold,
    required this.colorScheme,
    required this.textStyle,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTRB(
      _left,
      _top,
      math.max(_left + 1, size.width - _right),
      math.max(_top + 1, size.height - _bottom),
    );
    final values = points.map((point) => point.value).toList();
    final maxValue = values.reduce(math.max);
    final ceiling =
        fixedCeiling ??
        math.max(minimumCeiling ?? 1, maxValue <= 0 ? 1 : maxValue * 1.08);
    const floor = 0.0;

    final gridPaint = Paint()
      ..color = colorScheme.outlineVariant.withValues(alpha: 0.65)
      ..strokeWidth = 1;
    for (var step = 0; step <= 4; step++) {
      final fraction = step / 4;
      final y = plot.bottom - plot.height * fraction;
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), gridPaint);
      final value = floor + (ceiling - floor) * fraction;
      _label(
        canvas,
        '${_number(value)}$unit',
        Offset(0, y - 7),
        maxWidth: _left - 5,
        align: TextAlign.right,
      );
    }

    final warning = warningThreshold;
    if (warning != null && warning >= floor && warning <= ceiling) {
      final y = _yFor(warning, plot, floor, ceiling);
      final warningPaint = Paint()
        ..color = colorScheme.error.withValues(alpha: 0.70)
        ..strokeWidth = 1.2;
      canvas.drawLine(
        Offset(plot.left, y),
        Offset(plot.right, y),
        warningPaint,
      );
    }

    final firstAt = points.first.at.millisecondsSinceEpoch.toDouble();
    final lastAt = points.last.at.millisecondsSinceEpoch.toDouble();
    final duration = math.max(1, lastAt - firstAt);
    final line = Path();
    for (var index = 0; index < points.length; index++) {
      final point = points[index];
      final x =
          plot.left +
          plot.width * ((point.at.millisecondsSinceEpoch - firstAt) / duration);
      final y = _yFor(point.value, plot, floor, ceiling);
      if (index == 0) {
        line.moveTo(x, y);
      } else {
        line.lineTo(x, y);
      }
    }
    final seriesPaint = Paint()
      ..color = colorScheme.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(line, seriesPaint);

    if (points.length == 1) {
      canvas.drawCircle(
        Offset(plot.left, _yFor(points.first.value, plot, floor, ceiling)),
        3,
        Paint()..color = colorScheme.primary,
      );
    }

    _label(
      canvas,
      _timeLabel(points.first.at),
      Offset(plot.left, plot.bottom + 5),
    );
    final endLabel = _timeLabel(points.last.at);
    final endPainter = _textPainter(endLabel);
    endPainter.layout();
    endPainter.paint(
      canvas,
      Offset(plot.right - endPainter.width, plot.bottom + 5),
    );
  }

  double _yFor(double value, Rect plot, double floor, double ceiling) {
    final fraction = ((value - floor) / (ceiling - floor)).clamp(0.0, 1.0);
    return plot.bottom - plot.height * fraction;
  }

  String _number(double value) {
    if (value.abs() >= 100 || value == value.roundToDouble()) {
      return value.toStringAsFixed(0);
    }
    return value.toStringAsFixed(1);
  }

  String _timeLabel(DateTime value) {
    final local = value.toLocal();
    String two(int part) => part.toString().padLeft(2, '0');
    if (points.last.at.difference(points.first.at).inHours >= 24) {
      return '${two(local.day)}-${two(local.month)} ${two(local.hour)}:${two(local.minute)}';
    }
    return '${two(local.hour)}:${two(local.minute)}';
  }

  TextPainter _textPainter(String text, {TextAlign align = TextAlign.left}) =>
      TextPainter(
        text: TextSpan(
          text: text,
          style: textStyle.copyWith(color: colorScheme.onSurfaceVariant),
        ),
        textDirection: TextDirection.ltr,
        textAlign: align,
        maxLines: 1,
      );

  void _label(
    Canvas canvas,
    String text,
    Offset offset, {
    double? maxWidth,
    TextAlign align = TextAlign.left,
  }) {
    final painter = _textPainter(text, align: align);
    painter.layout(maxWidth: maxWidth ?? double.infinity);
    painter.paint(canvas, offset);
  }

  @override
  bool shouldRepaint(covariant _MetricChartPainter oldDelegate) =>
      oldDelegate.points != points ||
      oldDelegate.unit != unit ||
      oldDelegate.minimumCeiling != minimumCeiling ||
      oldDelegate.fixedCeiling != fixedCeiling ||
      oldDelegate.warningThreshold != warningThreshold ||
      oldDelegate.colorScheme != colorScheme ||
      oldDelegate.textStyle != textStyle;
}
