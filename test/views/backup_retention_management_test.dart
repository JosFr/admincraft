import 'dart:convert';

import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/views/widgets/backup_retention_management.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<NetworkController> fixture() async {
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    final network = NetworkController(
      NotificationController(preferences),
      preferences: preferences,
    );
    return network;
  }

  void sendRetention(NetworkController network) {
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'retention': {
          'global': {'daily': 14, 'weekly': 8, 'monthly': 12, 'enforce': true},
          'servers': {},
          'summaries': [],
        },
      }),
    );
  }

  Future<void> pumpLauncher(
    WidgetTester tester,
    NetworkController network, {
    String? serverId,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => FilledButton(
              onPressed: () => showBackupRetentionEditor(
                context,
                network,
                serverId: serverId,
              ),
              child: const Text('Edit'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Edit'));
    await tester.pumpAndSettle();
  }

  testWidgets('global retention editor shows current policy and enforcement', (
    tester,
  ) async {
    final network = await fixture();
    addTearDown(network.dispose);
    sendRetention(network);
    await pumpLauncher(tester, network);
    expect(find.text('Global retention'), findsOneWidget);
    expect(find.text('Inherit global retention'), findsNothing);
    expect(find.text('Automatically enforce retention'), findsOneWidget);
    expect(find.text('14'), findsOneWidget);
    expect(find.text('8'), findsOneWidget);
    expect(find.text('12'), findsOneWidget);
  });

  testWidgets('server retention defaults to global inheritance', (
    tester,
  ) async {
    final network = await fixture();
    addTearDown(network.dispose);
    sendRetention(network);
    await pumpLauncher(tester, network, serverId: 'smp');

    expect(find.text('Server retention'), findsOneWidget);
    final inherit = tester.widget<SwitchListTile>(
      find.widgetWithText(SwitchListTile, 'Inherit global retention'),
    );
    expect(inherit.value, isTrue);
    expect(find.text('Automatically enforce retention'), findsOneWidget);
  });
}
