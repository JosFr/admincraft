import 'dart:convert';

import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/views/management_views.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _UpdatesFixture extends NetworkController {
  _UpdatesFixture(super.notifications, {super.preferences});

  String? startedServerId;
  String? startedAction;
  bool? startedBackup;
  bool? startedRestartWhenEmpty;
  String? startedUpdatePlugin;

  @override
  bool startMaintenance(
    String serverId, {
    String action = 'restart',
    int countdownSeconds = 600,
    bool backup = true,
    String? backupEngineId,
    bool restartWhenEmpty = false,
    String? updatePlugin,
  }) {
    startedServerId = serverId;
    startedAction = action;
    startedBackup = backup;
    startedRestartWhenEmpty = restartWhenEmpty;
    startedUpdatePlugin = updatePlugin;
    return true;
  }
}

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

  testWidgets('unmanaged detections do not count as available updates', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final network = await fixture();
    addTearDown(network.dispose);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'updates': [
          {
            'serverId': 'lobby',
            'serverName': 'Lobby',
            'plugin': 'AdmincraftWeather',
            'kind': 'plugin',
            'currentVersion': '1.2.0-rc2',
            'status': 'unmanaged',
          },
          {
            'serverId': 'lobby',
            'serverName': 'Lobby',
            'plugin': 'Citizens',
            'kind': 'plugin',
            'currentVersion': '2.0.43-SNAPSHOT',
            'status': 'unmanaged',
          },
        ],
      }),
    );
    await tester.pumpWidget(
      ChangeNotifierProvider<NetworkController>.value(
        value: network,
        child: const MaterialApp(home: Scaffold(body: UpdatesView())),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('0 updates available'), findsOneWidget);
    expect(find.text('2 need setup'), findsOneWidget);
    expect(find.text('Needs setup (2)'), findsOneWidget);
    expect(find.text('AdmincraftWeather'), findsNothing);

    await tester.tap(find.text('Needs setup (2)'));
    await tester.pumpAndSettle();
    expect(find.text('AdmincraftWeather'), findsOneWidget);
    expect(find.text('Citizens'), findsOneWidget);
  });

  testWidgets('one-click update targets only the selected plugin', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    final notifications = NotificationController(preferences);
    final network = _UpdatesFixture(notifications, preferences: preferences);
    addTearDown(network.dispose);
    addTearDown(notifications.dispose);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.hello',
        'capabilities': ['network', 'management'],
      }),
    );
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.network-state',
        'servers': [
          {
            'name': 'smp',
            'label': 'SMP',
            'state': 'online',
            'players': 0,
            'version': 'Paper 1.21.11',
          },
        ],
      }),
    );
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'features': ['update-targeted'],
        'updateApply': {
          'configured': true,
          'pluginUpdates': true,
          'rollback': true,
        },
        'updates': [
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
        ],
      }),
    );
    await tester.pumpWidget(
      ChangeNotifierProvider<NetworkController>.value(
        value: network,
        child: const MaterialApp(home: Scaffold(body: UpdatesView())),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('1 update available'), findsOneWidget);
    expect(find.text('Update now'), findsOneWidget);
    await tester.tap(find.text('Update now'));
    await tester.pumpAndSettle();
    expect(find.text('Update ExamplePlugin?'), findsOneWidget);

    final confirm = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.text('Update now'),
    );
    await tester.tap(confirm);
    await tester.pumpAndSettle();

    expect(network.startedServerId, 'smp');
    expect(network.startedAction, 'update');
    expect(network.startedBackup, true);
    expect(network.startedRestartWhenEmpty, false);
    expect(network.startedUpdatePlugin, 'ExamplePlugin');
  });
}
