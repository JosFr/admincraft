import 'package:admincraft/models/management_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parses the complete RC4 management snapshot contract', () {
    final snapshot = ManagementSnapshot.fromJson({
      'observedAt': '2026-08-29T13:00:00Z',
      'schedules': [
        {
          'id': 'schedule-1',
          'serverId': 'lobby',
          'serverName': 'Lobby',
          'action': 'backup',
          'schedule': '0 4 * * *',
          'nextRun': '2026-08-30T02:00:00Z',
          'enabled': true,
          'lastResult': 'Success',
        },
      ],
      'maintenance': [
        {
          'serverId': 'lobby',
          'serverName': 'Lobby',
          'active': true,
          'endsAt': '2026-08-29T13:10:00Z',
          'stage': 'countdown',
          'message': 'Restart scheduled.',
        },
      ],
      'updates': [
        {
          'serverId': 'lobby',
          'serverName': 'Lobby',
          'plugin': 'ViaVersion',
          'currentVersion': '5.11.0',
          'latestVersion': '5.12.0',
          'provider': 'hangar',
          'projectId': 'ViaVersion',
          'status': 'updateAvailable',
          'url': 'https://hangar.papermc.io/ViaVersion/versions',
        },
      ],
      'activity': [
        {
          'id': 'activity-1',
          'at': '2026-08-29T12:59:00Z',
          'serverName': 'Lobby',
          'title': 'Backup completed',
          'detail': 'Multicraft backup completed.',
          'error': false,
        },
      ],
    });

    expect(snapshot.schedules.single.action, ScheduledActionType.backup);
    expect(snapshot.schedules.single.enabled, isTrue);
    expect(snapshot.maintenance.single.active, isTrue);
    expect(snapshot.maintenance.single.stage, 'countdown');
    expect(snapshot.updates.single.provider, UpdateProvider.hangar);
    expect(snapshot.updates.single.status, PluginUpdateStatus.updateAvailable);
    expect(snapshot.activity.single.title, 'Backup completed');
    expect(snapshot.activity.single.error, isFalse);
  });

  test('parses RC4 performance history samples', () {
    final sample = PerformanceSample.fromJson({
      'serverId': 'smp',
      'at': '2026-08-29T12:00:00Z',
      'tps': 19.8,
      'mspt': 31.4,
      'players': 8,
      'cpuPercent': 42.5,
      'memoryMb': 4096,
    });

    expect(sample.serverId, 'smp');
    expect(sample.tps, 19.8);
    expect(sample.mspt, 31.4);
    expect(sample.players, 8);
    expect(sample.cpuPercent, 42.5);
    expect(sample.memoryMb, 4096);
  });

  test('parses advertised RC4 backup engines without private config', () {
    final engine = BackupEngineDescriptor.fromJson({
      'id': 'native-smp',
      'type': 'native',
      'label': 'AdminCraft Native',
      'serverIds': ['smp'],
      'destinationIds': ['nextcloud'],
      'availableDestinationIds': ['nextcloud', 'local'],
      'capabilities': {
        'create': true,
        'list': true,
        'progress': true,
        'restore': true,
        'delete': true,
        'remoteDestination': true,
        'verify': true,
        'copy': true,
      },
    });

    expect(engine.id, 'native-smp');
    expect(engine.type, BackupEngineType.native);
    expect(engine.supportsServer('smp'), isTrue);
    expect(engine.destinationIds, ['nextcloud']);
    expect(engine.availableDestinationIds, ['nextcloud', 'local']);
    expect(engine.capabilities.restore, isTrue);
  });

  test('parses retention and minimum-free-space safeguards', () {
    final snapshot = ManagementSnapshot.fromJson({
      'storages': [
        {
          'id': 'nextcloud',
          'name': 'Nextcloud',
          'type': 'nextcloud',
          'backupBytes': 1024,
          'minimumFreeBytes': 161061273600,
          'safeguardBlocked': true,
        },
      ],
      'retention': {
        'global': {'daily': 7, 'weekly': 4, 'monthly': 6, 'enforce': false},
        'servers': {
          'smp': {'daily': 14, 'weekly': 8, 'monthly': 12, 'enforce': true},
        },
        'summaries': [
          {
            'serverId': 'smp',
            'daily': 14,
            'weekly': 8,
            'monthly': 12,
            'enforce': true,
            'kept': 20,
            'prunable': 3,
          },
        ],
      },
    });

    expect(snapshot.storages.single.minimumFreeBytes, 161061273600);
    expect(snapshot.storages.single.safeguardBlocked, isTrue);
    expect(snapshot.retention.forServer('smp').daily, 14);
    expect(snapshot.retention.forServer('smp').enforce, isTrue);
    expect(snapshot.retention.summaryFor('smp')?.prunable, 3);
  });
  test('parses one-time schedules and job history', () {
    final snapshot = ManagementSnapshot.fromJson({
      'schedules': [
        {
          'id': 'once-1',
          'serverId': 'smp',
          'serverName': 'SMP',
          'action': 'restart',
          'schedule': '',
          'recurring': false,
          'runAt': '2026-08-30T19:00:00Z',
          'nextRun': '2026-08-30T19:00:00Z',
          'enabled': true,
        },
      ],
      'jobHistory': [
        {
          'id': 'job-1',
          'scheduleId': 'once-1',
          'serverId': 'smp',
          'serverName': 'SMP',
          'action': 'restart',
          'source': 'scheduled',
          'startedAt': '2026-08-30T19:00:00Z',
          'finishedAt': '2026-08-30T19:00:02Z',
          'success': true,
          'message': 'restart completed.',
        },
      ],
    });
    final schedule = snapshot.schedules.single;
    expect(schedule.recurring, isFalse);
    expect(schedule.runAt, isNotNull);
    final job = snapshot.jobHistory.single;
    expect(job.scheduleId, 'once-1');
    expect(job.action, ScheduledActionType.restart);
    expect(job.success, isTrue);
    expect(job.message, 'restart completed.');
  });
  test('parses advertised maintenance policies', () {
    final snapshot = ManagementSnapshot.fromJson({
      'maintenancePolicies': {
        'global': {
          'countdownOptionsSeconds': [60, 300, 600],
          'milestonesSeconds': [300, 60, 10],
          'healthcheckAttempts': 9,
          'healthcheckIntervalSeconds': 4,
        },
        'servers': {
          'smp': {'healthcheckAttempts': 15},
        },
      },
    });
    expect(snapshot.maintenancePolicies.global.healthcheckAttempts, 9);
    expect(snapshot.maintenancePolicies.global.countdownOptionsSeconds, [
      60,
      300,
      600,
    ]);
    expect(
      snapshot.maintenancePolicies.forServer('smp').healthcheckAttempts,
      15,
    );
    expect(
      snapshot.maintenancePolicies.forServer('lobby').healthcheckAttempts,
      9,
    );
  });
}
