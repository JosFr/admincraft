import 'dart:convert';

import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
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
}
