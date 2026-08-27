import 'package:admincraft/views/widgets/server_icon.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('server icon preset library has 40 unique pixel-art choices', () {
    expect(serverIconPresets, hasLength(40));
    expect(
      serverIconPresets.map((preset) => preset.asset).toSet(),
      hasLength(40),
    );
    expect(
      serverIconPresets.map((preset) => preset.category).toSet(),
      containsAll(['Hub', 'Mining', 'PvP', 'Farm', 'Nether', 'End']),
    );
  });
}
