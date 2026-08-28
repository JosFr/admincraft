import 'dart:convert';
import 'dart:io';

import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/models/server_profile.dart';
import 'package:admincraft/services/connection_service.dart';
import 'package:admincraft/services/persistence_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('protocol 2 connection receives history before live output', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.transform(WebSocketTransformer()).listen((socket) {
      socket.add(
        jsonEncode({
          'type': 'admincraft.hello',
          'protocol': 2,
          'edition': 'bedrock',
          'capabilities': ['commands', 'logs', 'status'],
          'scope': 'command',
          'version': '1.2.0',
          'connectedAt': '2026-08-17T10:00:00Z',
        }),
      );
      socket.add(
        jsonEncode({
          'type': 'admincraft.log',
          'id': 'history-1',
          'at': '2026-08-17T10:00:00Z',
          'stream': 'stdout',
          'message': 'Historical server line',
        }),
      );
      socket.add(
        jsonEncode({'type': 'admincraft.history-complete', 'requested': 1000}),
      );
      socket.add(
        jsonEncode({
          'type': 'admincraft.server-state',
          'state': 'running',
          'observedAt': '2026-08-17T10:00:01Z',
          'daytime': 7076,
          'playersOnline': 2,
          'playerLimit': 10,
          'onlinePlayers': ['Alex', 'Steve'],
          'difficulty': 'normal',
          'pluginCount': 2,
          'pluginNames': ['AdmincraftWeather', 'LuckPerms'],
        }),
      );
      socket.add(
        jsonEncode({
          'type': 'admincraft.access-state',
          'observedAt': '2026-08-17T10:00:02Z',
          'entries': [
            {
              'uuid': '11111111-1111-1111-1111-111111111111',
              'name': 'PendingPlayer',
              'status': 'PENDING',
              'requestedTarget': 'smp',
            },
          ],
        }),
      );
    });

    final profile = ServerProfile(
      id: 'history-test',
      alias: 'History test',
      ip: InternetAddress.loopbackIPv4.address,
      port: server.port,
      secretKey: 'test-secret',
      certificate: '',
      security: ConnectionSecurity.privateNetwork,
    );
    SharedPreferences.setMockInitialValues({
      'servers': [jsonEncode(profile.toJson())],
      'selectedServer': profile.id,
      'onboardingCompleted': true,
    });
    final preferences = await SharedPreferences.getInstance();
    final model = Model(PersistenceService(preferences));
    final service = ConnectionService();
    String? notificationTitle;
    String? notificationMessage;
    bool? notificationError;
    service.onBridgeNotification = (title, message, isError) {
      notificationTitle = title;
      notificationMessage = message;
      notificationError = isError;
    };
    addTearDown(() => service.disconnect(model));

    await service.connect(model);
    await Future<void>.delayed(const Duration(milliseconds: 50));

    expect(model.output, contains('Historical server line'));
    expect(model.consoleHistoryLoading, isFalse);
    expect(model.bridgeVersion, '1.2.0');
    expect(model.bridgePermission, 'command');
    expect(model.bridgeCapabilities, contains('status'));
    expect(model.serverRuntimeState, 'running');
    expect(model.world.daytime, 7076);
    expect(model.world.playersOnline, 2);
    expect(model.world.playerLimit, 10);
    expect(model.world.lastDifficulty, 'normal');
    expect(model.world.pluginNames, containsAll(['AdmincraftWeather', 'LuckPerms']));
    expect(model.networkAccess, hasLength(1));
    expect(model.networkAccess.single.name, 'PendingPlayer');
    expect(notificationTitle, 'Network access');
    expect(notificationMessage, contains('PendingPlayer'));
    expect(notificationError, isFalse);
    expect(model.onlinePlayers, containsAll(['Alex', 'Steve']));
    expect(model.lastLogAt, isNotNull);
  });
}
