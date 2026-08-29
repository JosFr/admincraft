import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/server_profile.dart';
import 'package:admincraft/services/legacy_endpoint_migration.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('community build leaves every saved endpoint unchanged', () {
    const original = ServerProfile(
      id: 'server-1',
      alias: 'Example server',
      ip: 'minecraft.example.net',
      port: 8080,
      bridgePath: '/example',
      secretKey: 'keep-this-key',
      certificate: 'keep-this-certificate',
      security: ConnectionSecurity.privateNetwork,
    );

    final migrated = migrateLegacyAdmincraftEndpoint(original);
    expect(identical(migrated, original), isTrue);
  });
}
