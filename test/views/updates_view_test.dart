import 'dart:convert';

import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/models/management_state.dart';
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
  String? sourcePlugin;
  UpdateProvider? sourceProvider;
  String? sourceProjectId;
  String? sourceRole;
  bool? sourceAllMatchingServers;
  List<Map<String, String>>? bulkMappings;
  List<Map<String, String>>? downloadBulkMappings;

  @override
  bool setUpdateSource({
    required PluginUpdate update,
    required UpdateProvider provider,
    required String projectId,
    String role = 'check',
    String? url,
    bool allMatchingServers = false,
  }) {
    sourcePlugin = update.plugin;
    sourceProvider = provider;
    sourceProjectId = projectId;
    sourceRole = role;
    sourceAllMatchingServers = allMatchingServers;
    return true;
  }

  @override
  bool setVerifiedUpdateSourcesBulk(List<Map<String, String>> mappings) {
    bulkMappings = mappings;
    return true;
  }

  @override
  bool setSafeDownloadSourcesBulk(List<Map<String, String>> mappings) {
    downloadBulkMappings = mappings;
    return true;
  }

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
            'downloadReview': {
              'status': 'ready',
              'label': 'Safe direct JAR',
              'reason': 'Backend approved.',
            },
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
    expect(find.text('2 plugins need setup'), findsOneWidget);
    expect(find.text('Needs setup (2)'), findsOneWidget);
    expect(find.text('AdmincraftWeather'), findsNothing);

    await tester.tap(find.text('Needs setup (2)'));
    await tester.pumpAndSettle();
    expect(find.text('Needs choice (2)'), findsOneWidget);
    await tester.tap(find.text('Needs choice (2)'));
    await tester.pumpAndSettle();
    expect(find.text('AdmincraftWeather'), findsOneWidget);
    expect(find.text('Citizens'), findsOneWidget);
  });

  testWidgets('needs setup groups matching plugins across servers', (
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
        'type': 'admincraft.management-state',
        'features': ['update-source-group'],
        'updates': [
          {
            'serverId': 'lobby',
            'serverName': 'Lobby',
            'plugin': 'Plan',
            'kind': 'plugin',
            'currentVersion': '5.8 build 3638',
            'status': 'unmanaged',
            'candidates': [
              {
                'provider': 'github',
                'projectId': 'IceBlockMC/PLand',
                'label': 'GitHub · IceBlockMC/PLand',
                'score': 80,
              },
              {
                'provider': 'github',
                'projectId': 'plan-player-analytics/Plan',
                'label': 'GitHub · plan-player-analytics/Plan',
                'score': 100,
              },
            ],
          },
          {
            'serverId': 'smp',
            'serverName': 'SMP',
            'plugin': 'Plan',
            'kind': 'plugin',
            'currentVersion': '5.8 build 3638',
            'status': 'unmanaged',
            'candidates': [
              {
                'provider': 'github',
                'projectId': 'IceBlockMC/PLand',
                'label': 'GitHub · IceBlockMC/PLand',
                'score': 80,
              },
              {
                'provider': 'github',
                'projectId': 'plan-player-analytics/Plan',
                'label': 'GitHub · plan-player-analytics/Plan',
                'score': 100,
              },
            ],
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

    expect(find.text('2 plugins need setup'), findsOneWidget);
    expect(find.text('Needs setup (2)'), findsOneWidget);
    expect(find.text('Plan'), findsNothing);

    await tester.tap(find.text('Needs setup (2)'));
    await tester.pumpAndSettle();
    expect(find.text('Needs choice (2)'), findsOneWidget);
    await tester.tap(find.text('Needs choice (2)'));
    await tester.pumpAndSettle();
    expect(find.text('Plan'), findsOneWidget);
    expect(find.text('Citizens'), findsOneWidget);
    expect(find.text('2 servers'), findsOneWidget);
    expect(find.text('Configure for 2 servers'), findsOneWidget);

    await tester.ensureVisible(find.text('Configure for 2 servers'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Configure for 2 servers'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('validated for Plan on 2 servers'),
      findsOneWidget,
    );
    expect(
      find.text('GitHub · plan-player-analytics/Plan · exact match'),
      findsOneWidget,
    );
    expect(find.text('plan-player-analytics/Plan'), findsOneWidget);
    expect(find.text('Remember for 2 servers'), findsOneWidget);
    await tester.tap(find.text('Remember for 2 servers'));
    await tester.pumpAndSettle();

    expect(network.sourcePlugin, 'Plan');
    expect(network.sourceProvider, UpdateProvider.github);
    expect(network.sourceProjectId, 'plan-player-analytics/Plan');
    expect(network.sourceRole, 'check');
    expect(network.sourceAllMatchingServers, true);
  });

  testWidgets('source review separates verified special and unknown plugins', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    final notifications = NotificationController(preferences);
    final network = _UpdatesFixture(notifications, preferences: preferences);
    addTearDown(network.dispose);
    addTearDown(notifications.dispose);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'features': ['update-source-group', 'update-source-bulk'],
        'updates': [
          {
            'serverId': 'lobby',
            'serverName': 'Lobby',
            'plugin': 'WorldEdit',
            'kind': 'plugin',
            'currentVersion': '7.4.5',
            'status': 'unmanaged',
            'sourceReview': {
              'status': 'ready',
              'label': 'Modrinth · WorldEdit',
              'reason': 'Verified project identity.',
            },
            'candidates': [
              {
                'provider': 'modrinth',
                'projectId': '1u6JkXh5',
                'label': 'Modrinth · WorldEdit',
                'score': 120,
                'verified': true,
                'url': 'https://modrinth.com/plugin/worldedit',
              },
            ],
          },
          {
            'serverId': 'smp',
            'serverName': 'SMP',
            'plugin': 'CMI',
            'kind': 'plugin',
            'currentVersion': '9.8.9.8',
            'status': 'unmanaged',
            'sourceReview': {
              'status': 'special',
              'label': 'Spigot 3742',
              'reason': 'Premium plugin; authenticated download is separate.',
            },
          },
          {
            'serverId': 'smp',
            'serverName': 'SMP',
            'plugin': 'Lobby',
            'kind': 'plugin',
            'currentVersion': '1.2.0',
            'status': 'unmanaged',
            'sourceReview': {
              'status': 'unknown',
              'reason': 'Generic plugin name.',
            },
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
    await tester.tap(find.text('Needs setup (3)'));
    await tester.pumpAndSettle();

    expect(find.text('Ready to confirm (1)'), findsOneWidget);
    expect(find.text('Special handling (1)'), findsOneWidget);
    expect(find.text('No reliable source (1)'), findsOneWidget);
    expect(find.text('Confirm 1 verified sources'), findsOneWidget);
    expect(find.text('WorldEdit'), findsOneWidget);

    await tester.tap(find.text('Confirm 1 verified sources'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('No plugin files are downloaded or changed'),
      findsOneWidget,
    );
    expect(find.text('Confirm check sources'), findsOneWidget);
    await tester.tap(find.text('Confirm check sources'));
    await tester.pumpAndSettle();

    expect(network.bulkMappings, isNotNull);
    expect(network.bulkMappings, hasLength(1));
    expect(network.bulkMappings!.single['plugin'], 'WorldEdit');
    expect(network.bulkMappings!.single['provider'], 'modrinth');
    expect(network.bulkMappings!.single['projectId'], '1u6JkXh5');
  });

  testWidgets(
    'download review is separate from setup and unavailable sources',
    (tester) async {
      tester.view.physicalSize = const Size(390, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      SharedPreferences.setMockInitialValues({});
      final preferences = await SharedPreferences.getInstance();
      final notifications = NotificationController(preferences);
      final network = _UpdatesFixture(notifications, preferences: preferences);
      addTearDown(network.dispose);
      addTearDown(notifications.dispose);
      network.debugReceive(
        jsonEncode({
          'type': 'admincraft.management-state',
          'features': ['update-download-bulk'],
          'updates': [
            {
              'serverId': 'lobby',
              'serverName': 'Lobby',
              'plugin': 'WorldEdit',
              'kind': 'plugin',
              'currentVersion': '7.4.4',
              'latestVersion': '7.4.5',
              'provider': 'modrinth',
              'projectId': '1u6JkXh5',
              'sourceConfirmed': true,
              'downloadSourceConfirmed': false,
              'downloadReview': {
                'status': 'ready',
                'label': 'Compatible Modrinth JAR',
                'reason': 'Compatible direct artifact.',
              },
              'status': 'updateAvailable',
            },
            {
              'serverId': 'smp',
              'serverName': 'SMP',
              'plugin': 'ExcellentShop',
              'kind': 'plugin',
              'currentVersion': '5.1.6',
              'latestVersion': '5.1.7',
              'provider': 'spigot',
              'projectId': '50696',
              'sourceConfirmed': true,
              'downloadSourceConfirmed': false,
              'downloadReview': {
                'status': 'authenticated',
                'label': 'Premium Spigot resource',
                'reason': 'Licensed download required.',
              },
              'status': 'updateAvailable',
            },
            {
              'serverId': 'smp',
              'serverName': 'SMP',
              'plugin': 'AFKDummy',
              'kind': 'plugin',
              'currentVersion': '1.0.3',
              'provider': 'modrinth',
              'projectId': 'PHiV6JLQ',
              'sourceConfirmed': true,
              'status': 'sourceUnavailable',
            },
            {
              'serverId': 'smp',
              'serverName': 'SMP',
              'plugin': 'CMI',
              'kind': 'plugin',
              'currentVersion': '9.8.9.8',
              'status': 'unmanaged',
              'sourceReview': {
                'status': 'special',
                'label': 'Spigot 3742',
                'reason': 'Premium plugin.',
              },
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

      expect(find.text('2 updates available'), findsOneWidget);
      expect(find.text('1 plugin need setup'), findsOneWidget);
      expect(find.text('1 source unavailable'), findsOneWidget);
      expect(find.text('2 downloads need review'), findsOneWidget);

      await tester.tap(find.text('2 downloads need review'));
      await tester.pumpAndSettle();
      final downloadReview = find.text('Download review (2)');
      expect(downloadReview, findsOneWidget);
      expect(tester.getTopLeft(downloadReview).dy, lessThan(500));

      await tester.tap(downloadReview);
      await tester.pumpAndSettle();
      expect(find.text('Ready to confirm (1)'), findsOneWidget);
      expect(find.text('Authentication required (1)'), findsOneWidget);
      expect(find.text('Confirm 1 safe download sources'), findsOneWidget);

      await tester.tap(find.text('Confirm 1 safe download sources'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining(
          'No plugin is downloaded or installed by this action',
        ),
        findsOneWidget,
      );
      expect(find.text('Confirm download sources'), findsOneWidget);
      await tester.tap(find.text('Confirm download sources'));
      await tester.pumpAndSettle();

      expect(network.downloadBulkMappings, isNotNull);
      expect(network.downloadBulkMappings, hasLength(1));
      expect(network.downloadBulkMappings!.single['plugin'], 'WorldEdit');
      expect(network.downloadBulkMappings!.single['provider'], 'modrinth');
      expect(network.downloadBulkMappings!.single['projectId'], '1u6JkXh5');
    },
  );

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
            'downloadReview': {
              'status': 'ready',
              'label': 'Safe direct JAR',
              'reason': 'Backend approved.',
            },
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
