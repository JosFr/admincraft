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

  test('management failures remain durable attention notifications', () async {
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
    expect(notifications.entries, hasLength(1));
    expect(notifications.entries.single.kind.name, 'error');
    expect(notifications.entries.single.message, contains('Backup failed'));
  });
}
