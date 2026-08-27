import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/server_profile.dart';

const _centralHost = 'admincraft.fraanje.net';

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

/// Moves the known legacy Fraanje bridge endpoints behind the single public
/// AdminCraft gateway. Unknown profiles are returned unchanged.
ServerProfile migrateLegacyAdmincraftEndpoint(ServerProfile server) {
  final host = server.ip.trim().toLowerCase();
  final route = _routeByPort[server.port];

  if (!_legacyHosts.contains(host) || route == null) return server;

  return server.copyWith(
    ip: _centralHost,
    port: 443,
    bridgePath: route,
    security: ConnectionSecurity.trustedCertificate,
    certificate: '',
  );
}
