import 'dart:convert';

import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/views/management_views.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
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

  void managementState(
    NetworkController network, {
    required bool updateApply,
    required bool readyUpdate,
  }) {
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'maintenancePolicies': {
          'global': {
            'countdownOptionsSeconds': [60, 600],
            'milestonesSeconds': [60, 10],
            'healthcheckAttempts': 12,
            'healthcheckIntervalSeconds': 5,
          },
          'servers': {},
        },
        'updateApply': {
          'configured': updateApply,
          'pluginUpdates': updateApply,
          'rollback': updateApply,
        },
        'backupEngines': [
          {
            'id': 'multicraft',
            'label': 'Multicraft',
            'type': 'multicraft',
            'serverIds': ['smp'],
            'capabilities': {'create': true, 'progress': true},
          },
        ],
        'updates': readyUpdate
            ? [
                {
                  'serverId': 'smp',
                  'serverName': 'SMP',
                  'plugin': 'ExamplePlugin',
                  'kind': 'plugin',
                  'currentVersion': '1.0.0',
                  'latestVersion': '1.1.0',
                  'provider': 'github',
                  'projectId': 'owner/repo',
                  'sourceConfirmed': true,
                  'downloadProvider': 'github',
                  'downloadProjectId': 'owner/repo',
                  'downloadSourceConfirmed': true,
                  'downloadUrl': 'https://example.test/ExamplePlugin.jar',
                  'status': 'updateAvailable',
                },
              ]
            : [],
      }),
    );
  }

  Future<void> pumpMaintenance(
    WidgetTester tester,
    NetworkController network,
  ) async {
    await tester.pumpWidget(
      ChangeNotifierProvider<NetworkController>.value(
        value: network,
        child: const MaterialApp(
          home: Scaffold(body: MaintenanceView(serverId: 'smp')),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets(
    'update maintenance is offered when a validated update is ready',
    (tester) async {
      final network = await fixture();
      addTearDown(network.dispose);
      managementState(network, updateApply: true, readyUpdate: true);
      await pumpMaintenance(tester, network);

      await tester.tap(find.text('Start'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Restart and health-check'));
      await tester.pumpAndSettle();
      expect(find.text('Apply plugin updates + restart'), findsOneWidget);
      await tester.tap(find.text('Apply plugin updates + restart'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('1 validated plugin update(s) will be applied'),
        findsOneWidget,
      );
    },
  );
  testWidgets('update maintenance is hidden without backend capability', (
    tester,
  ) async {
    final network = await fixture();
    addTearDown(network.dispose);
    managementState(network, updateApply: false, readyUpdate: true);
    await pumpMaintenance(tester, network);

    await tester.tap(find.text('Start'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Restart and health-check'));
    await tester.pumpAndSettle();
    expect(find.text('Apply plugin updates + restart'), findsNothing);
  });
}
