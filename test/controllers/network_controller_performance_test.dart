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

  test('Plan performance history exposes the full canonical sample', () async {
    final network = await fixture();
    addTearDown(network.dispose);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.performance-history',
        'source': {
          'type': 'plan',
          'canonical': true,
          'readOnly': true,
          'serverName': 'SMP',
          'serverUuid': '11111111-2222-3333-4444-555555555555',
          'planVersion': '5.8 build 3605',
        },
        'serverId': 'smp',
        'range': '1h',
        'samples': [
          {
            'serverId': 'smp',
            'at': '2026-08-29T19:59:00Z',
            'tps': 19.75,
            'mspt': 18.25,
            'msptAverage': 18.25,
            'msptP95': 27.75,
            'msptJitterAverage': 1.25,
            'msptJitterMax': 4.5,
            'players': 3,
            'cpuPercent': 24.5,
            'memoryMb': 2048,
            'entities': 150,
            'chunks': 245,
            'freeDiskBytes': 53687091200,
          },
        ],
      }),
    );
    expect(network.performanceSource.isPlan, isTrue);
    expect(network.performanceSource.canonical, isTrue);
    expect(network.performanceSource.readOnly, isTrue);
    expect(network.performanceSource.serverName, 'SMP');
    expect(network.performanceSource.planVersion, '5.8 build 3605');
    expect(network.performance, hasLength(1));
    final sample = network.performance.single;
    expect(sample.tps, 19.75);
    expect(sample.msptAverage, 18.25);
    expect(sample.msptP95, 27.75);
    expect(sample.msptJitterAverage, 1.25);
    expect(sample.msptJitterMax, 4.5);
    expect(sample.players, 3);
    expect(sample.cpuPercent, 24.5);
    expect(sample.memoryMb, 2048);
    expect(sample.entities, 150);
    expect(sample.chunks, 245);
    expect(sample.freeDiskBytes, 53687091200);
  });

  testWidgets('performance history renders Plan trend charts', (tester) async {
    final network = await fixture();
    addTearDown(network.dispose);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.performance-history',
        'source': {
          'type': 'plan',
          'canonical': true,
          'readOnly': true,
          'serverName': 'SMP',
          'planVersion': '5.8 build 3605',
        },
        'serverId': 'smp',
        'range': '1h',
        'samples': [
          {
            'serverId': 'smp',
            'at': '2026-08-31T18:00:00Z',
            'tps': 19.9,
            'mspt': 18.0,
            'msptAverage': 18.0,
            'players': 2,
            'cpuPercent': 20.0,
            'memoryMb': 1024.0,
          },
          {
            'serverId': 'smp',
            'at': '2026-08-31T18:30:00Z',
            'tps': 19.5,
            'mspt': 24.0,
            'msptAverage': 24.0,
            'players': 4,
            'cpuPercent': 35.0,
            'memoryMb': 1536.0,
          },
        ],
      }),
    );

    await tester.pumpWidget(
      ChangeNotifierProvider<NetworkController>.value(
        value: network,
        child: const MaterialApp(
          home: Scaffold(body: PerformanceHistoryView(serverId: 'smp')),
        ),
      ),
    );
    await tester.pump();

    await tester.scrollUntilVisible(
      find.text('Trends'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pump();
    expect(find.text('Trends'), findsOneWidget);
    expect(find.byKey(const ValueKey('performance-chart-tps')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('performance-chart-mspt')),
      findsOneWidget,
    );
    expect(
      find.byKey(const ValueKey('performance-chart-players')),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('performance-chart-cpu')), findsOneWidget);
    expect(
      find.byKey(const ValueKey('performance-chart-memory')),
      findsOneWidget,
    );
    expect(find.byType(CustomPaint), findsWidgets);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'server tools expose history for every managed performance server',
    (tester) async {
      final network = await fixture();
      addTearDown(network.dispose);
      network.debugReceive(
        jsonEncode({
          'type': 'admincraft.management-state',
          'performanceSource': {
            'type': 'plan',
            'canonical': true,
            'configured': true,
            'readOnlyRequired': true,
            'serverIds': ['smp', 'historisch1'],
            'planServerIds': ['smp'],
            'ranges': ['1h', '6h', '24h', '7d', '30d'],
          },
        }),
      );
      expect(network.management.performanceSource.serverIds, [
        'smp',
        'historisch1',
      ]);

      Widget tools(String serverId) =>
          ChangeNotifierProvider<NetworkController>.value(
            value: network,
            child: MaterialApp(
              home: Scaffold(
                body: ServerToolsView(
                  serverId: serverId,
                  onBackups: () {},
                  onSchedules: () {},
                  onMaintenance: () {},
                  onPerformance: () {},
                  onPlugins: () {},
                  onDiagnostics: () {},
                  onConfiguration: () {},
                ),
              ),
            ),
          );

      await tester.pumpWidget(tools('historisch1'));
      expect(find.text('Performance history'), findsOneWidget);
      expect(
        find.textContaining('Plan is used where available'),
        findsOneWidget,
      );

      await tester.pumpWidget(tools('smp'));
      await tester.pump();
      expect(find.text('Performance history'), findsOneWidget);
      expect(
        find.textContaining('Plan is used where available'),
        findsOneWidget,
      );
    },
  );
}
