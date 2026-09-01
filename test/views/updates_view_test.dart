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
    return NetworkController(
      NotificationController(preferences),
      preferences: preferences,
    );
  }

  testWidgets('update cards show independent check and download sources', (
    tester,
  ) async {
    final network = await fixture();
    addTearDown(network.dispose);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'updates': [
          {
            'serverId': 'smp',
            'serverName': 'SMP',
            'plugin': 'ExamplePlugin',
            'kind': 'plugin',
            'currentVersion': '1.0.0',
            'latestVersion': '1.1.0',
            'provider': 'github',
            'projectId': 'owner/check',
            'sourceConfirmed': true,
            'downloadProvider': 'builtByBit',
            'downloadProjectId': '12345',
            'downloadSourceConfirmed': true,
            'downloadUrl': 'https://builtbybit.com/resources/12345/',
            'status': 'updateAvailable',
            'candidates': [
              {
                'provider': 'github',
                'projectId': 'owner/check',
                'label': 'GitHub · owner/check',
              },
            ],
          },
        ],
      }),
    );
    await tester.pumpWidget(
      ChangeNotifierProvider<NetworkController>.value(
        value: network,
        child: const MaterialApp(
          home: Scaffold(body: UpdatesView(serverId: 'smp')),
        ),
      ),
    );
    await tester.pump();

    expect(find.text('ExamplePlugin'), findsOneWidget);
    expect(
      find.textContaining('Check: GitHub Releases · owner/check'),
      findsOneWidget,
    );
    expect(find.textContaining('Download: BuiltByBit · 12345'), findsOneWidget);

    await tester.tap(find.byTooltip('Update source options'));
    await tester.pumpAndSettle();
    expect(find.text('Configure check source'), findsOneWidget);
    expect(find.text('Configure download source'), findsOneWidget);
  });
}
