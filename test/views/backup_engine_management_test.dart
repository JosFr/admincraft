import 'dart:convert';

import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/models/management_state.dart';
import 'package:admincraft/views/widgets/backup_engine_management.dart';
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
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.hello',
        'protocol': 2,
        'edition': 'java',
        'capabilities': ['management'],
        'scope': 'admin',
        'version': '1.4.0-rc4',
      }),
    );
    return network;
  }

  testWidgets('configurable engine exposes command and regex settings', (
    tester,
  ) async {
    final network = await fixture();
    addTearDown(network.dispose);
    const engine = BackupEngineDescriptor(
      id: 'custom-smp',
      type: BackupEngineType.custom,
      label: 'Custom command',
      backupType: 'custom',
      serverIds: ['smp'],
      destinationIds: [],
      availableDestinationIds: [],
      capabilities: BackupCapabilities(),
      available: false,
      configurable: true,
      availability: 'configurationRequired',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => showBackupEngineEditor(context, network, engine),
              child: const Text('Configure'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Configure'));
    await tester.pumpAndSettle();
    expect(find.text('Configure backup engine'), findsOneWidget);
    expect(find.text('Console command'), findsOneWidget);
    expect(find.text('Completion regex (optional)'), findsOneWidget);
    expect(find.text('Failure regex (optional)'), findsOneWidget);
    expect(find.text('Completion timeout (seconds)'), findsOneWidget);

    var save = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Save'),
    );
    expect(save.onPressed, isNull);

    await tester.enterText(
      find.widgetWithText(TextField, 'Console command'),
      'backup start',
    );
    await tester.pump();
    save = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Save'),
    );
    expect(save.onPressed, isNotNull);

    await tester.tap(find.widgetWithText(FilledButton, 'Save'));
    await tester.pumpAndSettle();
    expect(find.text('Configure backup engine'), findsNothing);
  });
}
