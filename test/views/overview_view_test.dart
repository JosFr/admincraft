import 'dart:convert';

import 'package:admincraft/controllers/connection_controller.dart';
import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/models/network_access_entry.dart';
import 'package:admincraft/models/server_profile.dart';
import 'package:admincraft/services/persistence_service.dart';
import 'package:admincraft/views/overview_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _server = ServerProfile(
  id: 'lobby',
  alias: 'Lobby',
  ip: 'admincraft.example.net',
  port: 443,
  bridgePath: '/lobby',
  secretKey: 'secret',
  certificate: '',
  security: ConnectionSecurity.trustedCertificate,
);

Future<Model> _model() async {
  SharedPreferences.setMockInitialValues({
    'onboardingCompleted': true,
    'selectedServer': _server.id,
    'servers': [jsonEncode(_server.toJson())],
  });
  final prefs = await SharedPreferences.getInstance();
  final model = Model(PersistenceService(prefs));
  model.updateServerRuntimeState(
    'running',
    playersOnline: 0,
    playerLimit: 15,
    tps1m: 20,
    mspt: 0.1,
    cpuPercent: 2,
    memoryMb: 62,
    memoryLimitMb: 3994,
    minecraftVersion: '1.21.8',
    serverVersion: 'Paper 1.21.8',
    worldName: 'world',
    worldSeed: '1960381020482390555',
    loadedChunks: 0,
    entityCount: 0,
    pluginCount: 3,
    pluginNames: const ['AdmincraftWeather', 'LuckPerms', 'ViaVersion'],
    whitelistEnabled: true,
  );
  model.updateNetworkAccess(const [
    NetworkAccessEntry(
      uuid: '11111111-1111-1111-1111-111111111111',
      name: 'PendingPlayer',
      status: NetworkAccessStatus.pending,
      requestedTarget: 'smp',
    ),
    NetworkAccessEntry(
      uuid: '22222222-2222-2222-2222-222222222222',
      name: 'TrustedPlayer',
      status: NetworkAccessStatus.trusted,
    ),
    NetworkAccessEntry(
      uuid: '33333333-3333-3333-3333-333333333333',
      name: 'DeniedPlayer',
      status: NetworkAccessStatus.denied,
    ),
  ]);
  return model;
}

void main() {
  testWidgets('overview matches the compact server dashboard layout', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final model = await _model();
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: model),
          ChangeNotifierProvider(create: (_) => ConnectionController()),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: OverviewView(onOpenConsole: () {}, onEditServer: () {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Lobby'), findsOneWidget);
    expect(find.text('Live metrics'), findsOneWidget);
    expect(find.byKey(const ValueKey('metric-Players')), findsOneWidget);
    expect(find.byKey(const ValueKey('metric-TPS')), findsOneWidget);
    expect(find.byKey(const ValueKey('metric-MSPT')), findsOneWidget);
    expect(find.byKey(const ValueKey('metric-CPU')), findsOneWidget);
    expect(find.text('Server & world'), findsOneWidget);
    expect(find.text('Plugins'), findsOneWidget);
    expect(find.text('Players'), findsWidgets);
    expect(find.text('Network access'), findsOneWidget);
    expect(find.text('Diagnostics'), findsOneWidget);
    expect(find.text('Recent activity'), findsNothing);

    final players = tester.getRect(find.byKey(const ValueKey('metric-Players')));
    final tps = tester.getRect(find.byKey(const ValueKey('metric-TPS')));
    expect((players.top - tps.top).abs(), lessThan(1));
    expect(players.width, closeTo(tps.width, 1));
    expect(players.right, lessThan(tps.left));
    final difficulty = tester.getRect(find.byKey(const ValueKey('metric-Difficulty')));
    final chunks = tester.getRect(find.byKey(const ValueKey('metric-Chunks / Entities')));
    expect((difficulty.top - chunks.top).abs(), lessThan(1));
    expect(difficulty.height, closeTo(chunks.height, 0.1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('plugins and lobby access expose their detail', (tester) async {
    tester.view.physicalSize = const Size(390, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final model = await _model();
    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: model),
          ChangeNotifierProvider(create: (_) => ConnectionController()),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: OverviewView(onOpenConsole: () {}, onEditServer: () {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Plugins'));
    await tester.pumpAndSettle();
    expect(find.text('AdmincraftWeather'), findsOneWidget);
    expect(find.text('LuckPerms'), findsOneWidget);

    await tester.ensureVisible(find.text('Network access'));
    await tester.tap(find.text('Network access'));
    await tester.pumpAndSettle();
    expect(find.text('PendingPlayer'), findsOneWidget);
    expect(find.text('TrustedPlayer'), findsOneWidget);
    expect(find.text('DeniedPlayer'), findsOneWidget);
    expect(find.text('Allow'), findsOneWidget);
    expect(find.text('Blacklist'), findsOneWidget);
    expect(find.text('Revoke'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('diagnostics expands bridge details and command audit', (
    tester,
  ) async {
    final model = await _model();
    model.updateBridgeHello(
      protocol: 2,
      capabilities: const ['logs', 'status', 'commands'],
      version: '1.2.0',
      permission: 'command',
      connectedAt: DateTime.utc(2026, 8, 27, 18),
    );
    await model.recordCommandAudit('list', source: 'terminal', outcome: 'sent');

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: model),
          ChangeNotifierProvider(create: (_) => ConnectionController()),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: OverviewView(onOpenConsole: () {}, onEditServer: () {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Diagnostics'));
    await tester.tap(find.text('Diagnostics'));
    await tester.pumpAndSettle();

    expect(find.text('1.2.0'), findsOneWidget);
    expect(find.text('command'), findsOneWidget);
    expect(find.text('Capabilities'), findsOneWidget);
    expect(find.text('logs'), findsOneWidget);
    expect(find.text('Command audit'), findsOneWidget);
    expect(find.text('list'), findsOneWidget);
    expect(find.text('terminal · sent'), findsOneWidget);
    expect(find.text('Copy diagnostics'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
