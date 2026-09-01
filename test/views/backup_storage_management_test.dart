import 'dart:convert';

import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/views/widgets/backup_storage_management.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<NetworkController> fixture() async {
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    return NetworkController(
      NotificationController(preferences),
      preferences: preferences,
    );
  }

  testWidgets('storage editor exposes provider-specific configuration', (
    tester,
  ) async {
    final network = await fixture();
    addTearDown(network.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showBackupStorageEditor(context, network),
              child: const Text('Open editor'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open editor'));
    await tester.pumpAndSettle();

    expect(find.text('Add backup storage'), findsOneWidget);
    expect(find.text('Nextcloud URL'), findsOneWidget);
    expect(find.text('App password'), findsOneWidget);
    expect(find.text('Keep free (GiB)'), findsOneWidget);
    await tester.tap(find.text('Nextcloud').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('SMB').last);
    await tester.pumpAndSettle();

    expect(find.text('SMB mounted path'), findsOneWidget);
    expect(
      find.textContaining('must already be mounted on the management host'),
      findsOneWidget,
    );
    expect(find.text('Nextcloud URL'), findsNothing);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
  });

  testWidgets('server destination defaults can inherit global defaults', (
    tester,
  ) async {
    final network = await fixture();
    addTearDown(network.dispose);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'storages': [
          {
            'id': 'local',
            'name': 'Local',
            'type': 'local',
            'backupBytes': 0,
            'warningFreePercent': 15,
            'criticalFreePercent': 5,
          },
          {
            'id': 'nextcloud',
            'name': 'Nextcloud',
            'type': 'nextcloud',
            'backupBytes': 0,
            'warningFreePercent': 15,
            'criticalFreePercent': 5,
          },
        ],
        'backupDestinationDefaults': {
          'global': ['local'],
          'servers': {},
        },
      }),
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showBackupDestinationDefaultsDialog(
                context,
                network,
                serverId: 'smp',
              ),
              child: const Text('Defaults'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Defaults'));
    await tester.pumpAndSettle();

    expect(find.text('Server backup destinations'), findsOneWidget);
    expect(find.text('Inherit global destinations'), findsOneWidget);
    expect(find.text('Local'), findsOneWidget);
    expect(find.text('Nextcloud'), findsWidgets);

    final inherit = tester.widget<SwitchListTile>(
      find.widgetWithText(SwitchListTile, 'Inherit global destinations'),
    );
    expect(inherit.value, isTrue);
  });
}
