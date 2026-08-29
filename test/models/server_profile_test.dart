import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/minecraft_edition.dart';
import 'package:admincraft/models/server_profile.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('old profiles migrate to Bedrock Edition', () {
    final profile = ServerProfile.fromJson({
      'id': 'legacy',
      'alias': 'Old server',
      'ip': '192.0.2.1',
      'port': 8080,
      'secretKey': 'secret',
      'certificate': '',
      'security': ConnectionSecurity.privateNetwork.name,
    });

    expect(profile.edition, MinecraftEdition.bedrock);
  });

  test('Java Edition survives profile serialization', () {
    const profile = ServerProfile(
      id: 'java',
      alias: 'Paper server',
      ip: 'java.example.com',
      port: 8080,
      secretKey: 'secret',
      certificate: '',
      security: ConnectionSecurity.privateNetwork,
      edition: MinecraftEdition.java,
    );

    expect(
      ServerProfile.fromJson(profile.toJson()).edition,
      MinecraftEdition.java,
    );
  });

  test('bridge path survives profile serialization', () {
    const profile = ServerProfile(
      id: 'proxy',
      alias: 'Proxied server',
      ip: 'admincraft.example.com',
      port: 443,
      bridgePath: '/smp',
      secretKey: 'secret',
      certificate: '',
      security: ConnectionSecurity.trustedCertificate,
    );

    expect(ServerProfile.fromJson(profile.toJson()).bridgePath, '/smp');
  });

  test('custom server logo survives profile serialization', () {
    const profile = ServerProfile(
      id: 'logo',
      alias: 'Logo server',
      ip: 'example.com',
      port: 8080,
      secretKey: 'secret',
      certificate: '',
      security: ConnectionSecurity.privateNetwork,
      iconAsset: '',
      customIconBase64: 'aWNvbg==',
    );

    final restored = ServerProfile.fromJson(profile.toJson());
    expect(restored.iconAsset, isEmpty);
    expect(restored.customIconBase64, 'aWNvbg==');
  });
  test('network hub flag survives profile serialization', () {
    const profile = ServerProfile(
      id: 'hub',
      alias: 'Lobby',
      ip: 'admincraft.example.com',
      port: 443,
      secretKey: 'secret',
      certificate: '',
      security: ConnectionSecurity.trustedCertificate,
      networkHub: true,
    );
    expect(ServerProfile.fromJson(profile.toJson()).networkHub, isTrue);
  });

}
