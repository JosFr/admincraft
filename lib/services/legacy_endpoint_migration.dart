import 'package:admincraft/models/server_profile.dart';

/// Community builds never rewrite saved endpoints automatically.
///
/// Private deployments can maintain their own migration layer, but a reusable
/// client must not assume any hostname, LAN address, port map, or reverse-proxy
/// path belonging to somebody else's Minecraft network.
ServerProfile migrateLegacyAdmincraftEndpoint(ServerProfile server) => server;
