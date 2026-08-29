import 'package:admincraft/models/management_state.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('BackupStorageSnapshot', () {
    test('derives storage use and warning state', () {
      const storage = BackupStorageSnapshot(
        id: 'nextcloud',
        name: 'Nextcloud',
        type: StorageProviderType.nextcloud,
        totalBytes: 1000,
        freeBytes: 100,
        backupBytes: 700,
        softLimitBytes: null,
        warningFreePercent: 15,
        criticalFreePercent: 5,
      );

      expect(storage.usedBytes, 900);
      expect(storage.otherBytes, 200);
      expect(storage.usedFraction, 0.9);
      expect(storage.freePercent, 10);
      expect(storage.warning, isTrue);
      expect(storage.critical, isFalse);
    });
  });

  group('ManagementSnapshot', () {
    test('parses backup inventory from a management frame', () {
      final snapshot = ManagementSnapshot.fromJson({
        'observedAt': '2026-08-29T08:00:00Z',
        'backups': [
          {
            'id': 'backup-1',
            'serverId': 'server-1',
            'serverName': 'Lobby',
            'createdAt': '2026-08-29T07:30:00Z',
            'sizeBytes': 1073741824,
            'status': 'completed',
            'engine': 'multicraft',
            'kind': 'scheduled',
            'verified': true,
            'destinations': ['Nextcloud', 'Local'],
          },
        ],
      });

      expect(snapshot.observedAt, isNotNull);
      expect(snapshot.backups, hasLength(1));
      final backup = snapshot.backups.single;
      expect(backup.id, 'backup-1');
      expect(backup.serverName, 'Lobby');
      expect(backup.sizeBytes, 1073741824);
      expect(backup.status, BackupStatus.completed);
      expect(backup.engine, BackupEngineType.multicraft);
      expect(backup.kind, 'scheduled');
      expect(backup.verified, isTrue);
      expect(backup.destinations, ['Nextcloud', 'Local']);
    });

    test('uses safe fallbacks for unknown enum values', () {
      final snapshot = ManagementSnapshot.fromJson({
        'backups': [
          {
            'status': 'future-state',
            'engine': 'future-engine',
          },
        ],
      });

      final backup = snapshot.backups.single;
      expect(backup.status, BackupStatus.unknown);
      expect(backup.engine, BackupEngineType.multicraft);
    });
  });
}
