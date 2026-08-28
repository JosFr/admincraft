enum NetworkAccessStatus { pending, trusted, denied, unknown }

class NetworkAccessEntry {
  final String uuid;
  final String name;
  final NetworkAccessStatus status;
  final bool admin;
  final String? requestedAt;
  final String? requestedTarget;
  final String? decidedAt;
  final String? decidedBy;

  const NetworkAccessEntry({
    required this.uuid,
    required this.name,
    required this.status,
    this.admin = false,
    this.requestedAt,
    this.requestedTarget,
    this.decidedAt,
    this.decidedBy,
  });

  factory NetworkAccessEntry.fromJson(Map<String, dynamic> json) {
    final raw = json['status']?.toString().toLowerCase();
    final status = switch (raw) {
      'pending' => NetworkAccessStatus.pending,
      'trusted' => NetworkAccessStatus.trusted,
      'denied' => NetworkAccessStatus.denied,
      _ => NetworkAccessStatus.unknown,
    };

    return NetworkAccessEntry(
      uuid: json['uuid']?.toString() ?? '',
      name: json['name']?.toString() ?? 'Unknown player',
      status: status,
      admin: json['admin'] == true,
      requestedAt: json['requestedAt']?.toString(),
      requestedTarget: json['requestedTarget']?.toString(),
      decidedAt: json['decidedAt']?.toString(),
      decidedBy: json['decidedBy']?.toString(),
    );
  }

  String get statusLabel => switch (status) {
    NetworkAccessStatus.pending => 'Pending',
    NetworkAccessStatus.trusted => 'Trusted',
    NetworkAccessStatus.denied => 'Denied',
    NetworkAccessStatus.unknown => 'Unknown',
  };
}
