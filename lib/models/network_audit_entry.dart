import 'package:admincraft/models/command_audit_entry.dart';

class NetworkAuditEntry {
  final String serverId;
  final String serverName;
  final CommandAuditEntry entry;

  const NetworkAuditEntry({
    required this.serverId,
    required this.serverName,
    required this.entry,
  });
}
