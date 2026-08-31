import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/server_profile.dart';
import 'package:admincraft/services/legacy_endpoint_migration.dart';
import 'package:flutter_test/flutter_test.dart';

ServerProfile profile({required String host, required int port}) =>
    ServerProfile(
      id: 'server-1',
      alias: 'Test server',
      ip: host,
      port: port,
      secretKey: 'keep-this-key',
      certificate: 'legacy-cert',
      security: ConnectionSecurity.privateNetwork,
    );

void main() {
  test('migrates every known legacy bridge port to its gateway path', () {
    const expected = <int, String>{
      8080: '/lobby',
      8082: '/fraanje-202404',
      8083: '/fraanje-202201',
      8084: '/fraanje-202207',
      8085: '/jolien-joas',
      8086: '/skeerekippen',
      8087: '/smp',
      8088: '/skeerekippen-old',
    };

    for (final entry in expected.entries) {
      final migrated = migrateLegacyAdmincraftEndpoint(
        profile(host: 'minecraft.fraanje.net', port: entry.key),
      );

      expect(migrated.ip, 'admincraft.fraanje.net');
      expect(migrated.port, 443);
      expect(migrated.bridgePath, entry.value);
      expect(migrated.security, ConnectionSecurity.trustedCertificate);
      expect(migrated.secretKey, 'keep-this-key');
      expect(migrated.certificate, isEmpty);
    }
  });

  test('also recognizes the former LAN and public IP endpoints', () {
    for (final host in ['192.168.2.11', '31.14.181.135']) {
      final migrated = migrateLegacyAdmincraftEndpoint(
        profile(host: host, port: 8087),
      );
      expect(migrated.bridgePath, '/smp');
      expect(migrated.ip, 'admincraft.fraanje.net');
    }
  });

  test('does not touch an unrelated profile', () {
    final original = profile(host: 'other.example.net', port: 8080);
    final migrated = migrateLegacyAdmincraftEndpoint(original);

    expect(identical(migrated, original), isTrue);
  });

  test('does not migrate an unused bridge port', () {
    final original = profile(host: 'minecraft.fraanje.net', port: 8081);
    final migrated = migrateLegacyAdmincraftEndpoint(original);

    expect(identical(migrated, original), isTrue);
  });

  test('repairs missing legacy icon once for an existing gateway profile', () {
    const original = ServerProfile(
      id: 'smp',
      alias: 'Minecraft SMP',
      ip: 'admincraft.fraanje.net',
      port: 443,
      bridgePath: '/smp',
      secretKey: 'key',
      certificate: '',
      security: ConnectionSecurity.trustedCertificate,
      iconMigrationVersion: 0,
    );

    final migrated = migrateLegacyAdmincraftEndpoint(original);

    expect(migrated.iconAsset, 'docs/logo/variants/grass.png');
    expect(migrated.iconMigrationVersion, 1);
  });

  test(
    'never replaces an explicit icon or custom image during icon migration',
    () {
      const explicit = ServerProfile(
        id: 'lobby',
        alias: 'Lobby',
        ip: 'admincraft.fraanje.net',
        port: 443,
        bridgePath: '/lobby',
        secretKey: 'key',
        certificate: '',
        security: ConnectionSecurity.trustedCertificate,
        iconAsset: 'assets/mcicons/beacon.png',
        iconMigrationVersion: 0,
      );
      const custom = ServerProfile(
        id: 'lobby-custom',
        alias: 'Lobby custom',
        ip: 'admincraft.fraanje.net',
        port: 443,
        bridgePath: '/lobby',
        secretKey: 'key',
        certificate: '',
        security: ConnectionSecurity.trustedCertificate,
        customIconBase64: 'aWNvbg==',
        iconMigrationVersion: 0,
      );

      final explicitMigrated = migrateLegacyAdmincraftEndpoint(explicit);
      final customMigrated = migrateLegacyAdmincraftEndpoint(custom);

      expect(explicitMigrated.iconAsset, 'assets/mcicons/beacon.png');
      expect(customMigrated.iconAsset, 'docs/logo/variants/dirt.png');
      expect(customMigrated.customIconBase64, 'aWNvbg==');
      expect(explicitMigrated.iconMigrationVersion, 1);
      expect(customMigrated.iconMigrationVersion, 1);
    },
  );
}
