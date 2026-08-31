import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/server_profile.dart';

const _centralHost = 'admincraft.fraanje.net';
const _iconMigrationVersion = 1;
const _legacyDefaultIcon = 'docs/logo/variants/dirt.png';

const _legacyHosts = <String>{
  '192.168.2.11',
  '31.14.181.135',
  'minecraft.fraanje.net',
};

const _routeByPort = <int, String>{
  8080: '/lobby',
  8082: '/fraanje-202404',
  8083: '/fraanje-202201',
  8084: '/fraanje-202207',
  8085: '/jolien-joas',
  8086: '/skeerekippen',
  8087: '/smp',
  8088: '/skeerekippen-old',
};

const _iconByRoute = <String, String>{
  '/lobby': 'assets/mcicons/lantern.png',
  '/smp': 'docs/logo/variants/grass.png',
  '/skeerekippen': 'assets/mcicons/live_chicken.png',
  '/skeerekippen-old': 'assets/mcicons/live_chicken.png',
  '/jolien-joas': 'assets/mcicons/chest.png',
  '/fraanje-202201': 'assets/mcicons/legacy_world.png',
  '/fraanje-202207': 'assets/mcicons/legacy_world.png',
  '/fraanje-202404': 'assets/mcicons/legacy_world.png',
};

/// Moves the known legacy Fraanje bridge endpoints behind the single public
/// AdminCraft gateway and repairs the pre-icon-profile defaults once.
/// Unknown profiles keep their connection details and icon unchanged.
ServerProfile migrateLegacyAdmincraftEndpoint(ServerProfile server) {
  final host = server.ip.trim().toLowerCase();
  final legacyRoute = _routeByPort[server.port];
  var migrated = server;

  if (_legacyHosts.contains(host) && legacyRoute != null) {
    migrated = migrated.copyWith(
      ip: _centralHost,
      port: 443,
      bridgePath: legacyRoute,
      security: ConnectionSecurity.trustedCertificate,
      certificate: '',
    );
  }

  if (migrated.iconMigrationVersion < _iconMigrationVersion) {
    final desired = _iconByRoute[migrated.bridgePath.trim().toLowerCase()];
    final hasCustomImage = migrated.customIconBase64.trim().isNotEmpty;
    final isLegacyDefault =
        migrated.iconAsset.trim().isEmpty ||
        migrated.iconAsset == _legacyDefaultIcon;
    migrated = migrated.copyWith(
      iconAsset: desired != null && !hasCustomImage && isLegacyDefault
          ? desired
          : migrated.iconAsset,
      iconMigrationVersion: _iconMigrationVersion,
    );
  }

  return identical(migrated, server) ? server : migrated;
}
