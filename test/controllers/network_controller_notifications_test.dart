import 'dart:convert';

import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/utils/toast_utils.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<(NetworkController, NotificationController)> fixture() async {
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    final notifications = NotificationController(preferences);
    ToastUtils.initialize(notifications);
    return (
      NetworkController(notifications, preferences: preferences),
      notifications,
    );
  }

  test('first access snapshot establishes a quiet baseline', () async {
    final (network, notifications) = await fixture();
    addTearDown(() {
      ToastUtils.detach(notifications);
      network.dispose();
    });
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.access-state',
        'entries': [
          {'uuid': 'old', 'name': 'Existing', 'status': 'pending'},
        ],
      }),
    );
    expect(notifications.entries, isEmpty);
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.access-state',
        'entries': [
          {'uuid': 'old', 'name': 'Existing', 'status': 'pending'},
          {'uuid': 'new', 'name': 'New player', 'status': 'pending'},
        ],
      }),
    );
    expect(notifications.entries, hasLength(1));
    expect(notifications.entries.single.title, 'Nieuw toegangsverzoek');
    expect(notifications.entries.single.message, contains('New player'));
  });

  test(
    'an empty baseline still allows the next new request to notify',
    () async {
      final (network, notifications) = await fixture();
      addTearDown(() {
        ToastUtils.detach(notifications);
        network.dispose();
      });
      network.debugReceive(
        jsonEncode({'type': 'admincraft.access-state', 'entries': const []}),
      );
      network.debugReceive(
        jsonEncode({
          'type': 'admincraft.access-state',
          'entries': [
            {'uuid': 'new', 'name': 'New player', 'status': 'pending'},
          ],
        }),
      );
      expect(notifications.entries, hasLength(1));
    },
  );

  test('successful access actions stay out of the durable inbox', () async {
    final (network, notifications) = await fixture();
    addTearDown(() {
      ToastUtils.detach(notifications);
      network.dispose();
    });
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.access-result',
        'success': true,
        'message': 'Access granted.',
      }),
    );
    expect(notifications.entries, isEmpty);

    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.access-result',
        'success': false,
        'message': 'Access update failed.',
      }),
    );
    expect(notifications.entries, isEmpty);
  });

  test('direct management failures stay out of the durable inbox', () async {
    final (network, notifications) = await fixture();
    addTearDown(() {
      ToastUtils.detach(notifications);
      network.dispose();
    });
    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-result',
        'success': false,
        'message': 'Backup failed on storage.',
        'refresh': false,
      }),
    );
    expect(notifications.entries, isEmpty);
  });

  test('management state promotes only new attention events', () async {
    final (network, notifications) = await fixture();
    addTearDown(() {
      ToastUtils.detach(notifications);
      network.dispose();
    });

    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'backups': const [],
        'jobHistory': const [],
        'maintenance': const [],
        'updates': const [],
      }),
    );
    expect(notifications.entries, isEmpty);

    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'backups': [
          {
            'id': 'backup-failed',
            'serverId': 'smp',
            'serverName': 'SMP',
            'createdAt': '2026-08-31T18:00:00Z',
            'status': 'failed',
            'engine': 'native',
            'engineId': 'native-smp',
            'engineLabel': 'AdminCraft Native',
            'message': 'Storage safeguard blocked the backup.',
          },
        ],
        'jobHistory': [
          {
            'id': 'job-failed',
            'serverId': 'lobby',
            'serverName': 'Lobby',
            'action': 'restart',
            'source': 'scheduled',
            'startedAt': '2026-08-31T18:01:00Z',
            'success': false,
            'message': 'Scheduled restart failed.',
          },
        ],
        'maintenance': [
          {
            'serverId': 'skeerekippen',
            'serverName': 'Skeerekippen',
            'active': false,
            'stage': 'failed',
            'message': 'Health check failed.',
          },
        ],
        'updates': [
          {
            'serverId': 'smp',
            'serverName': 'SMP',
            'plugin': 'CMI',
            'kind': 'plugin',
            'currentVersion': '9.7.0',
            'latestVersion': '9.8.0',
            'provider': 'spigot',
            'status': 'updateAvailable',
          },
        ],
      }),
    );

    expect(notifications.entries, hasLength(4));
    expect(
      notifications.entries.map((entry) => entry.title),
      containsAll([
        'SMP backup failed',
        'Lobby scheduled action failed',
        'Skeerekippen maintenance failed',
        'CMI update available',
      ]),
    );

    network.debugReceive(
      jsonEncode({
        'type': 'admincraft.management-state',
        'backups': [
          {
            'id': 'backup-failed',
            'serverId': 'smp',
            'serverName': 'SMP',
            'createdAt': '2026-08-31T18:00:00Z',
            'status': 'failed',
            'engine': 'native',
            'engineId': 'native-smp',
            'engineLabel': 'AdminCraft Native',
          },
        ],
        'jobHistory': [
          {
            'id': 'job-failed',
            'serverId': 'lobby',
            'serverName': 'Lobby',
            'action': 'restart',
            'source': 'scheduled',
            'startedAt': '2026-08-31T18:01:00Z',
            'success': false,
            'message': 'Scheduled restart failed.',
          },
        ],
        'maintenance': [
          {
            'serverId': 'skeerekippen',
            'serverName': 'Skeerekippen',
            'active': false,
            'stage': 'failed',
            'message': 'Health check failed.',
          },
        ],
        'updates': [
          {
            'serverId': 'smp',
            'serverName': 'SMP',
            'plugin': 'CMI',
            'kind': 'plugin',
            'currentVersion': '9.7.0',
            'latestVersion': '9.8.0',
            'provider': 'spigot',
            'status': 'updateAvailable',
          },
        ],
      }),
    );
    expect(notifications.entries, hasLength(4));
  });
}
