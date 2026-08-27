import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/server_profile.dart';
import 'package:admincraft/services/legacy_endpoint_migration.dart';
import 'package:flutter_test/flutter_test.dart';

ServerProfile profile({
  required String host,
  required int port,
}) => ServerProfile(
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
}
