enum BackupEngineType { multicraft, native, plugin, custom }

enum StorageProviderType {
  local,
  nextcloud,
  webdav,
  smb,
  nfs,
  sftp,
  s3,
  rclone,
}

enum BackupStatus { queued, running, completed, failed, verifying, unknown }

enum ScheduledActionType { start, stop, restart, backup, maintenance }

enum UpdateProvider { hangar, modrinth, spigot, builtByBit, github }

enum PluginUpdateStatus {
  current,
  updateAvailable,
  unmanaged,
  sourceUnavailable,
  checking,
}

T _enumByName<T extends Enum>(Iterable<T> values, Object? raw, T fallback) {
  final name = raw?.toString();
  for (final value in values) {
    if (value.name.toLowerCase() == name?.toLowerCase()) return value;
  }
  return fallback;
}

class BackupStorageSnapshot {
  final String id;
  final String name;
  final StorageProviderType type;
  final int? totalBytes;
  final int? freeBytes;
  final int backupBytes;
  final int? softLimitBytes;
  final double warningFreePercent;
  final double criticalFreePercent;
  const BackupStorageSnapshot({
    required this.id,
    required this.name,
    required this.type,
    required this.totalBytes,
    required this.freeBytes,
    required this.backupBytes,
    required this.softLimitBytes,
    required this.warningFreePercent,
    required this.criticalFreePercent,
  });

  factory BackupStorageSnapshot.fromJson(
    Map<String, dynamic> json,
  ) => BackupStorageSnapshot(
    id: json['id']?.toString() ?? '',
    name: json['name']?.toString() ?? 'Storage',
    type: _enumByName(
      StorageProviderType.values,
      json['type'],
      StorageProviderType.local,
    ),
    totalBytes: (json['totalBytes'] as num?)?.toInt(),
    freeBytes: (json['freeBytes'] as num?)?.toInt(),
    backupBytes: (json['backupBytes'] as num?)?.toInt() ?? 0,
    softLimitBytes: (json['softLimitBytes'] as num?)?.toInt(),
    warningFreePercent: (json['warningFreePercent'] as num?)?.toDouble() ?? 15,
    criticalFreePercent: (json['criticalFreePercent'] as num?)?.toDouble() ?? 5,
  );

  int? get usedBytes =>
      totalBytes == null || freeBytes == null ? null : totalBytes! - freeBytes!;
  int? get otherBytes => usedBytes == null
      ? null
      : (usedBytes! - backupBytes).clamp(0, usedBytes!).toInt();
  double? get usedFraction =>
      totalBytes == null || totalBytes == 0 || usedBytes == null
      ? null
      : usedBytes! / totalBytes!;

  double? get freePercent =>
      totalBytes == null || totalBytes == 0 || freeBytes == null
      ? null
      : freeBytes! * 100 / totalBytes!;

  bool get critical =>
      freePercent != null && freePercent! <= criticalFreePercent;
  bool get warning =>
      !critical && freePercent != null && freePercent! <= warningFreePercent;
}

class BackupCapabilities {
  final bool create;
  final bool list;
  final bool progress;
  final bool restore;
  final bool download;
  final bool delete;
  final bool remoteDestination;
  final bool verify;
  final bool copy;

  const BackupCapabilities({
    this.create = false,
    this.list = false,
    this.progress = false,
    this.restore = false,
    this.download = false,
    this.delete = false,
    this.remoteDestination = false,
    this.verify = false,
    this.copy = false,
  });

  factory BackupCapabilities.fromJson(Object? raw) {
    final json = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    bool enabled(String key) => json[key] == true;
    return BackupCapabilities(
      create: enabled('create'),
      list: enabled('list'),
      progress: enabled('progress'),
      restore: enabled('restore'),
      download: enabled('download'),
      delete: enabled('delete'),
      remoteDestination: enabled('remoteDestination'),
      verify: enabled('verify'),
      copy: enabled('copy'),
    );
  }

  bool get hasRecordActions => restore || download || delete || verify || copy;
}

class BackupEngineDescriptor {
  final String id;
  final BackupEngineType type;
  final String label;
  final String backupType;
  final List<String> serverIds;
  final List<String> destinationIds;
  final List<String> availableDestinationIds;
  final BackupCapabilities capabilities;

  const BackupEngineDescriptor({
    required this.id,
    required this.type,
    required this.label,
    required this.backupType,
    required this.serverIds,
    required this.destinationIds,
    required this.availableDestinationIds,
    required this.capabilities,
  });

  factory BackupEngineDescriptor.fromJson(Map<String, dynamic> json) =>
      BackupEngineDescriptor(
        id: json['id']?.toString() ?? '',
        type: _enumByName(
          BackupEngineType.values,
          json['type'],
          BackupEngineType.multicraft,
        ),
        label: json['label']?.toString() ?? 'Backup engine',
        backupType: json['backupType']?.toString() ?? 'server-backup',
        serverIds: json['serverIds'] is List
            ? (json['serverIds'] as List)
                  .map((value) => value.toString())
                  .toList()
            : const [],
        destinationIds: json['destinationIds'] is List
            ? (json['destinationIds'] as List)
                  .map((value) => value.toString())
                  .toList()
            : const [],
        availableDestinationIds: json['availableDestinationIds'] is List
            ? (json['availableDestinationIds'] as List)
                  .map((value) => value.toString())
                  .toList()
            : const [],
        capabilities: BackupCapabilities.fromJson(json['capabilities']),
      );

  bool supportsServer(String serverId) => serverIds.contains(serverId);
}

class BackupRecord {
  final String id;
  final String serverId;
  final String serverName;
  final DateTime createdAt;
  final int sizeBytes;
  final BackupStatus status;
  final BackupEngineType engine;
  final String engineId;
  final String engineLabel;
  final String backupType;
  final String kind;
  final bool verified;
  final List<String> destinations;
  final BackupCapabilities capabilities;
  final String? message;

  const BackupRecord({
    required this.id,
    required this.serverId,
    required this.serverName,
    required this.createdAt,
    required this.sizeBytes,
    required this.status,
    required this.engine,
    required this.engineId,
    required this.engineLabel,
    required this.backupType,
    required this.kind,
    required this.verified,
    required this.destinations,
    this.capabilities = const BackupCapabilities(),
    this.message,
  });

  factory BackupRecord.fromJson(Map<String, dynamic> json) => BackupRecord(
    id: json['id']?.toString() ?? '',
    serverId: json['serverId']?.toString() ?? '',
    serverName: json['serverName']?.toString() ?? 'Server',
    createdAt:
        DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ??
        DateTime.fromMillisecondsSinceEpoch(0),
    sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
    status: _enumByName(
      BackupStatus.values,
      json['status'],
      BackupStatus.unknown,
    ),
    engine: _enumByName(
      BackupEngineType.values,
      json['engine'],
      BackupEngineType.multicraft,
    ),
    engineId:
        json['engineId']?.toString() ??
        json['engine']?.toString() ??
        'multicraft',
    engineLabel: json['engineLabel']?.toString() ?? '',
    backupType: json['backupType']?.toString() ?? 'server-backup',
    kind: json['kind']?.toString() ?? 'manual',
    verified: json['verified'] == true,
    destinations: json['destinations'] is List
        ? (json['destinations'] as List)
              .map((value) => value.toString())
              .toList()
        : const [],
    capabilities: BackupCapabilities.fromJson(json['capabilities']),
    message: json['message']?.toString(),
  );
}

class ScheduledAction {
  final String id;
  final String serverId;
  final String serverName;
  final ScheduledActionType action;
  final String schedule;
  final DateTime? nextRun;
  final bool enabled;
  final String? lastResult;

  const ScheduledAction({
    required this.id,
    required this.serverId,
    required this.serverName,
    required this.action,
    required this.schedule,
    required this.nextRun,
    required this.enabled,
    this.lastResult,
  });

  factory ScheduledAction.fromJson(Map<String, dynamic> json) =>
      ScheduledAction(
        id: json['id']?.toString() ?? '',
        serverId: json['serverId']?.toString() ?? '',
        serverName: json['serverName']?.toString() ?? 'Server',
        action: _enumByName(
          ScheduledActionType.values,
          json['action'],
          ScheduledActionType.restart,
        ),
        schedule: json['schedule']?.toString() ?? '',
        nextRun: DateTime.tryParse(
          json['nextRun']?.toString() ?? '',
        )?.toLocal(),
        enabled: json['enabled'] != false,
        lastResult: json['lastResult']?.toString(),
      );
}

class MaintenanceState {
  final String serverId;
  final String serverName;
  final bool active;
  final DateTime? endsAt;
  final String stage;
  final String message;

  const MaintenanceState({
    required this.serverId,
    required this.serverName,
    required this.active,
    required this.endsAt,
    required this.stage,
    required this.message,
  });

  factory MaintenanceState.fromJson(Map<String, dynamic> json) =>
      MaintenanceState(
        serverId: json['serverId']?.toString() ?? '',
        serverName: json['serverName']?.toString() ?? 'Server',
        active: json['active'] == true,
        endsAt: DateTime.tryParse(json['endsAt']?.toString() ?? '')?.toLocal(),
        stage: json['stage']?.toString() ?? 'idle',
        message: json['message']?.toString() ?? '',
      );
}

class PerformanceSample {
  final String serverId;
  final DateTime at;
  final double? tps;
  final double? mspt;
  final int? players;
  final double? cpuPercent;
  final double? memoryMb;

  const PerformanceSample({
    required this.serverId,
    required this.at,
    this.tps,
    this.mspt,
    this.players,
    this.cpuPercent,
    this.memoryMb,
  });
  factory PerformanceSample.fromJson(Map<String, dynamic> json) =>
      PerformanceSample(
        serverId: json['serverId']?.toString() ?? '',
        at:
            DateTime.tryParse(json['at']?.toString() ?? '')?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
        tps: (json['tps'] as num?)?.toDouble(),
        mspt: (json['mspt'] as num?)?.toDouble(),
        players: (json['players'] as num?)?.toInt(),
        cpuPercent: (json['cpuPercent'] as num?)?.toDouble(),
        memoryMb: (json['memoryMb'] as num?)?.toDouble(),
      );
}

class PluginUpdate {
  final String serverId;
  final String serverName;
  final String plugin;
  final String currentVersion;
  final String? latestVersion;
  final UpdateProvider? provider;
  final String? projectId;
  final PluginUpdateStatus status;
  final String? url;

  const PluginUpdate({
    required this.serverId,
    required this.serverName,
    required this.plugin,
    required this.currentVersion,
    required this.latestVersion,
    required this.provider,
    required this.projectId,
    required this.status,
    required this.url,
  });
  factory PluginUpdate.fromJson(Map<String, dynamic> json) {
    UpdateProvider? provider;
    final rawProvider = json['provider']?.toString();
    if (rawProvider != null) {
      for (final value in UpdateProvider.values) {
        if (value.name.toLowerCase() == rawProvider.toLowerCase()) {
          provider = value;
          break;
        }
      }
    }
    return PluginUpdate(
      serverId: json['serverId']?.toString() ?? '',
      serverName: json['serverName']?.toString() ?? 'Server',
      plugin: json['plugin']?.toString() ?? 'Plugin',
      currentVersion: json['currentVersion']?.toString() ?? '',
      latestVersion: json['latestVersion']?.toString(),
      provider: provider,
      projectId: json['projectId']?.toString(),
      status: _enumByName(
        PluginUpdateStatus.values,
        json['status'],
        PluginUpdateStatus.unmanaged,
      ),
      url: json['url']?.toString(),
    );
  }
}

class ManagementActivity {
  final String id;
  final DateTime at;
  final String serverName;
  final String title;
  final String detail;
  final bool error;
  const ManagementActivity({
    required this.id,
    required this.at,
    required this.serverName,
    required this.title,
    required this.detail,
    required this.error,
  });

  factory ManagementActivity.fromJson(Map<String, dynamic> json) =>
      ManagementActivity(
        id: json['id']?.toString() ?? '',
        at:
            DateTime.tryParse(json['at']?.toString() ?? '')?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
        serverName: json['serverName']?.toString() ?? 'Network',
        title: json['title']?.toString() ?? 'Activity',
        detail: json['detail']?.toString() ?? '',
        error: json['error'] == true,
      );
}

class ManagementSnapshot {
  final DateTime? observedAt;
  final List<BackupStorageSnapshot> storages;
  final List<BackupEngineDescriptor> backupEngines;
  final List<BackupRecord> backups;
  final List<ScheduledAction> schedules;
  final List<MaintenanceState> maintenance;
  final List<PluginUpdate> updates;
  final List<ManagementActivity> activity;

  const ManagementSnapshot({
    this.observedAt,
    this.storages = const [],
    this.backupEngines = const [],
    this.backups = const [],
    this.schedules = const [],
    this.maintenance = const [],
    this.updates = const [],
    this.activity = const [],
  });
  factory ManagementSnapshot.fromJson(Map<String, dynamic> json) {
    List<T> parseList<T>(String key, T Function(Map<String, dynamic>) parse) {
      final raw = json[key];
      if (raw is! List) return const [];
      return raw.whereType<Map<String, dynamic>>().map(parse).toList();
    }

    return ManagementSnapshot(
      observedAt: DateTime.tryParse(
        json['observedAt']?.toString() ?? '',
      )?.toLocal(),
      storages: parseList('storages', BackupStorageSnapshot.fromJson),
      backupEngines: parseList(
        'backupEngines',
        BackupEngineDescriptor.fromJson,
      ),
      backups: parseList('backups', BackupRecord.fromJson),
      schedules: parseList('schedules', ScheduledAction.fromJson),
      maintenance: parseList('maintenance', MaintenanceState.fromJson),
      updates: parseList('updates', PluginUpdate.fromJson),
      activity: parseList('activity', ManagementActivity.fromJson),
    );
  }
}

extension UpdateProviderLabel on UpdateProvider {
  String get label => switch (this) {
    UpdateProvider.hangar => 'Hangar',
    UpdateProvider.modrinth => 'Modrinth',
    UpdateProvider.spigot => 'Spigot',
    UpdateProvider.builtByBit => 'BuiltByBit',
    UpdateProvider.github => 'GitHub Releases',
  };
}

extension StorageProviderLabel on StorageProviderType {
  String get label => switch (this) {
    StorageProviderType.local => 'Local filesystem',
    StorageProviderType.nextcloud => 'Nextcloud',
    StorageProviderType.webdav => 'WebDAV',
    StorageProviderType.smb => 'SMB',
    StorageProviderType.nfs => 'NFS',
    StorageProviderType.sftp => 'SFTP',
    StorageProviderType.s3 => 'S3-compatible',
    StorageProviderType.rclone => 'rclone remote',
  };
}

extension BackupEngineLabel on BackupEngineType {
  String get label => switch (this) {
    BackupEngineType.multicraft => 'Multicraft',
    BackupEngineType.native => 'AdminCraft Native',
    BackupEngineType.plugin => 'Backup plugin',
    BackupEngineType.custom => 'Custom command',
  };
}
