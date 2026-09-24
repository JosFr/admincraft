import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:admincraft/controllers/connection_controller.dart';
import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/services/persistence_service.dart';
import 'package:admincraft/views/backup_view.dart';
import 'package:admincraft/views/network_view.dart';
import 'package:admincraft/views/servers_view.dart';
import 'package:admincraft/views/management_views.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _NetworkFixture extends NetworkController {
  _NetworkFixture(super.notifications);
  final actions = <(String, String)>[];
  Map<String, Object?>? scheduleEdit;
  String? deletedSchedule;
  String? forgottenBackup;
  @override
  bool createSchedule({
    String? id,
    required String serverId,
    required String action,
    String schedule = '',
    DateTime? runAt,
    String? backupEngineId,
  }) {
    scheduleEdit = {
      'id': id,
      'serverId': serverId,
      'action': action,
      'schedule': schedule,
      'runAt': runAt,
      'backupEngineId': backupEngineId,
    };
    return true;
  }

  @override
  bool deleteSchedule(String id) {
    deletedSchedule = id;
    return true;
  }

  @override
  bool forgetBackup(String id) {
    forgottenBackup = id;
    return true;
  }

  @override
  bool executeAccessAction(String action, String uuid) {
    actions.add((action, uuid));
    return true;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await (FontLoader(
      'Monocraft',
    )..addFont(rootBundle.load('fonts/Monocraft.ttc'))).load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  Future<_NetworkFixture> pumpScreen(
    WidgetTester tester,
    Widget child, {
    double width = 390,
    double textScale = 1,
  }) async {
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    final notifications = NotificationController(preferences);
    final network = _NetworkFixture(notifications);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.hello',
        'capabilities': ['network', 'access', 'management'],
      }),
    );
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.network-state',
        'playersOnline': 3,
        'playerLimit': 15,
        'clientMin': '1.21.1',
        'clientMax': '1.21.11',
        'servers': [
          {
            'name': 'lobby',
            'label': 'Lobby',
            'state': 'online',
            'players': 1,
            'version': 'Paper 1.21.11',
          },
          {
            'name': 'smp',
            'label': 'SMP',
            'state': 'online',
            'players': 2,
            'version': 'Paper 1.21.11',
          },
          {
            'name': 'archive',
            'label': 'Fraanje-202404-202505',
            'state': 'standby',
            'players': 0,
          },
          {
            'name': 'skeerekippen',
            'label': 'Skeerekippen',
            'state': 'error',
            'players': 0,
          },
        ],
      }),
    );
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.access-state',
        'entries': [
          {
            'uuid': 'pending-player',
            'name': 'PlayerWithLongName',
            'status': 'pending',
            'requestedTarget': 'Fraanje-202404-202505',
          },
          {
            'uuid': 'trusted-player',
            'name': 'TrustedPlayer',
            'status': 'trusted',
          },
        ],
      }),
    );
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'storages': [
          {
            'id': 'local',
            'name': 'Local backup storage',
            'type': 'local',
            'totalBytes': 1000000000000,
            'freeBytes': 400000000000,
            'backupBytes': 20000000000,
            'managed': true,
          },
        ],
      }),
    );
    tester.view.physicalSize = Size(width, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(network.dispose);
    addTearDown(notifications.dispose);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider(
            create: (_) => Model(PersistenceService(preferences)),
          ),
          ChangeNotifierProvider(create: (_) => ConnectionController()),
          ChangeNotifierProvider<NetworkController>.value(value: network),
        ],
        child: MaterialApp(
          theme: ThemeData(useMaterial3: true, fontFamily: 'Monocraft'),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(textScale)),
            child: child!,
          ),
          home: RepaintBoundary(
            key: const ValueKey('capture'),
            child: Scaffold(body: SafeArea(child: child)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return network;
  }

  Future<void> capture(WidgetTester tester, String name) async {
    final directory = Platform.environment['ADMINCRAFT_CAPTURE_DIR'];
    if (directory == null) return;
    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(const ValueKey('capture')),
    );
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      await Directory(directory).create(recursive: true);
      await File(
        '$directory/$name.png',
      ).writeAsBytes(bytes!.buffer.asUint8List());
      image.dispose();
    });
  }

  for (final width in [320.0, 390.0]) {
    testWidgets(
      'populated Access fits $width with larger text and targets the correct player',
      (tester) async {
        final network = await pumpScreen(
          tester,
          const NetworkAccessView(),
          width: width,
          textScale: 1.4,
        );
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.text('Blacklist'));
        await tester.tap(find.text('Blacklist'));
        expect(network.actions, [('blacklist', 'trusted-player')]);
        expect(tester.takeException(), isNull);
        if (width == 390) await capture(tester, 'access');
      },
    );
  }

  testWidgets(
    'Home keeps standby servers out of attention and Access reachable',
    (tester) async {
      var accessed = false;
      await pumpScreen(
        tester,
        NetworkView(
          onServerAction: (_, __) async {},
          onBackups: () {},
          onActivity: () {},
          onUpdates: () {},
          onAccess: () => accessed = true,
        ),
      );
      expect(find.text('Skeerekippen'), findsOneWidget);
      expect(find.text('Fraanje-202404-202505'), findsNothing);
      await tester.tap(find.text('Access'));
      expect(accessed, isTrue);
      expect(tester.takeException(), isNull);
      await capture(tester, 'home');
    },
  );

  testWidgets(
    'Servers keeps long backend names and profile management at phone width',
    (tester) async {
      String? selected;
      await pumpScreen(
        tester,
        ServersView(
          onSelect: (_) async {},
          onAdd: () async {},
          onNetwork: () {},
          onEditSelected: () {},
          onServerAction: (name, action) async => selected = name,
        ),
        width: 320,
        textScale: 1.4,
      );
      await tester.ensureVisible(find.text('Fraanje-202404-202505'));
      await tester.tap(find.text('Fraanje-202404-202505'));
      expect(selected, 'archive');
      expect(tester.takeException(), isNull);
      await capture(tester, 'servers');
    },
  );

  testWidgets('populated Storage fits a narrow phone with larger text', (
    tester,
  ) async {
    await pumpScreen(tester, const BackupHub(), width: 320, textScale: 1.4);
    await tester.ensureVisible(find.text('Storage'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Storage'));
    await tester.pumpAndSettle();
    expect(find.text('Local backup storage'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await capture(tester, 'storage');
  });
  testWidgets('storage test shows waiting, success and failure inline', (
    tester,
  ) async {
    final network = await pumpScreen(
      tester,
      const BackupView(storageOnly: true),
    );
    await tester.tap(find.byTooltip('Storage actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Test connection'));
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Waiting for confirmation'), findsOneWidget);
    expect(find.textContaining('Testing storage connection'), findsOneWidget);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-result',
        'success': true,
        'message': 'Nextcloud connection successful.',
        'refresh': false,
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('Nextcloud connection successful.'), findsOneWidget);
    expect(find.text('Waiting for confirmation'), findsNothing);
    network.testBackupStorage('local');
    await tester.pump();
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-result',
        'success': false,
        'message': 'Nextcloud authentication failed.',
        'refresh': false,
      }),
    );
    await tester.pumpAndSettle();
    expect(find.text('Action failed'), findsOneWidget);
    expect(find.text('Nextcloud authentication failed.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'backup request and server-confirmed running state remain distinct',
    (tester) async {
      final network = await pumpScreen(
        tester,
        const BackupView(serverId: 'lobby'),
      );
      await tester.tap(find.text('Create backup'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Backup now'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.textContaining('Backup requested.'), findsOneWidget);
      expect(find.text('Lobby — running'), findsNothing);
      network.debugReceive(
        jsonEncode({
          'type': 'admincraft.management-state',
          'backups': [
            {
              'id': 'test-backup',
              'serverId': 'lobby',
              'serverName': 'Lobby',
              'status': 'running',
              'createdAt': '2026-09-24T12:00:00Z',
            },
          ],
        }),
      );
      expect(network.managementPending, isFalse);
      network.debugReceive(
        jsonEncode({
          'type': 'admincraft.management-result',
          'success': true,
          'message': 'Backup job started.',
          'refresh': false,
        }),
      );
      await tester.pump();
      expect(find.text('Lobby — running'), findsOneWidget);
      expect(find.text('Waiting for confirmation'), findsNothing);
      network.debugReceive(
        jsonEncode({
          'type': 'admincraft.management-state',
          'backups': [
            {
              'id': 'test-backup',
              'serverId': 'lobby',
              'serverName': 'Lobby',
              'status': 'completed',
              'createdAt': '2026-09-24T12:00:00Z',
            },
          ],
        }),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('backup-status-test-backup')),
        findsOneWidget,
      );
      expect(find.text('Lobby — completed'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'existing schedules expose editing and confirmed deletion on a phone',
    (tester) async {
      final network = await pumpScreen(
        tester,
        const SchedulesView(),
        width: 390,
      );
      network.debugReceive(
        jsonEncode({
          'type': 'admincraft.management-state',
          'features': ['schedule-update', 'backup-forget'],
          'schedules': [
            {
              'id': 'nightly',
              'serverId': 'skeerekippen',
              'serverName': 'Skeerekippen',
              'action': 'backup',
              'backupEngineId': 'plugin-test',
              'schedule': '0 4 * * *',
              'recurring': true,
              'enabled': false,
            },
          ],
        }),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Edit schedule'));
      await tester.tap(find.text('Edit schedule'));
      await tester.pumpAndSettle();
      expect(find.text('Edit scheduled action'), findsOneWidget);
      final cron = find.byType(TextField).first;
      expect(tester.widget<TextField>(cron).controller!.text, '0 4 * * *');
      await tester.enterText(cron, '0 6 * * *');
      await tester.tap(find.text('Save changes'));
      await tester.pumpAndSettle();
      expect(network.scheduleEdit?['id'], 'nightly');
      expect(network.scheduleEdit?['serverId'], 'skeerekippen');
      expect(network.scheduleEdit?['schedule'], '0 6 * * *');
      expect(network.scheduleEdit?['action'], 'backup');
      expect(network.scheduleEdit?['backupEngineId'], 'plugin-test');
      await tester.ensureVisible(find.text('Delete schedule'));
      await tester.tap(find.text('Delete schedule'));
      await tester.pumpAndSettle();
      expect(network.deletedSchedule, isNull);
      await tester.tap(find.text('Keep'));
      await tester.pumpAndSettle();
      expect(network.deletedSchedule, isNull);
      await tester.tap(find.text('Delete schedule'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      expect(network.deletedSchedule, 'nightly');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'unknown plugin backup offers record cleanup with explicit confirmation',
    (tester) async {
      final network = await pumpScreen(tester, const BackupView());
      network.debugReceive(
        jsonEncode({
          'type': 'admincraft.management-state',
          'backups': [
            {
              'id': 'plugin-record',
              'serverId': 'skeerekippen',
              'serverName': 'Skeerekippen',
              'engine': 'plugin',
              'engineLabel': 'WebDavBackup',
              'status': 'unknown',
              'capabilities': {'forget': true},
            },
          ],
        }),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Remove from history'),
        250,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Remove from history'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove from history'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('does not delete any backup files'),
        findsOneWidget,
      );
      expect(network.forgottenBackup, isNull);
      await tester.tap(find.text('Remove record'));
      await tester.pumpAndSettle();
      expect(network.forgottenBackup, 'plugin-record');
      expect(find.text('Delete'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
