enum NetworkServerState { online, standby, starting, error, offline, unknown }

extension NetworkServerStateDetails on NetworkServerState {
  String get label => switch (this) {
    NetworkServerState.online => 'Online',
    NetworkServerState.standby => 'Standby',
    NetworkServerState.starting => 'Starting',
    NetworkServerState.error => 'Error',
    NetworkServerState.offline => 'Offline',
    NetworkServerState.unknown => 'Unknown',
  };
}

class NetworkServerEntry {
  final String name;
  final String label;
  final NetworkServerState state;
  final int players;
  final String version;

  const NetworkServerEntry({
    required this.name,
    required this.label,
    required this.state,
    required this.players,
    required this.version,
  });

  factory NetworkServerEntry.fromJson(Map<String, dynamic> json) {
    final rawState = json['state']?.toString().toLowerCase() ?? '';
    final state = NetworkServerState.values.firstWhere(
      (value) => value.name == rawState,
      orElse: () => NetworkServerState.unknown,
    );
    return NetworkServerEntry(
      name: json['name']?.toString() ?? '',
      label: json['label']?.toString() ?? json['name']?.toString() ?? '',
      state: state,
      players: (json['players'] as num?)?.toInt() ?? 0,
      version: json['version']?.toString() ?? '',
    );
  }
}
class NetworkSnapshot {
  final DateTime? observedAt;
  final int playersOnline;
  final int playerLimit;
  final String clientMin;
  final String clientMax;
  final List<NetworkServerEntry> servers;

  const NetworkSnapshot({
    this.observedAt,
    this.playersOnline = 0,
    this.playerLimit = 0,
    this.clientMin = '',
    this.clientMax = '',
    this.servers = const [],
  });

  factory NetworkSnapshot.fromJson(Map<String, dynamic> json) {
    final rawServers = json['servers'];
    return NetworkSnapshot(
      observedAt: DateTime.tryParse(json['observedAt']?.toString() ?? '')?.toLocal(),
      playersOnline: (json['playersOnline'] as num?)?.toInt() ?? 0,
      playerLimit: (json['playerLimit'] as num?)?.toInt() ?? 0,
      clientMin: json['clientMin']?.toString() ?? '',
      clientMax: json['clientMax']?.toString() ?? '',
      servers: rawServers is List
          ? rawServers
                .whereType<Map<String, dynamic>>()
                .map(NetworkServerEntry.fromJson)
                .where((entry) => entry.name.isNotEmpty)
                .toList()
          : const [],
    );
  }
}
