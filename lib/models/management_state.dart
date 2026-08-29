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
  final int? minimumFreeBytes;
  final bool safeguardBlocked;
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
    this.minimumFreeBytes,
    this.safeguardBlocked = false,
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
    minimumFreeBytes: (json['minimumFreeBytes'] as num?)?.toInt(),
    safeguardBlocked: json['safeguardBlocked'] == true,
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
  final bool recurring;
  final DateTime? runAt;
  final DateTime? nextRun;
  final bool enabled;
  final String? lastResult;

  const ScheduledAction({
    required this.id,
    required this.serverId,
    required this.serverName,
    required this.action,
    required this.schedule,
    this.recurring = true,
    this.runAt,
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
        recurring: json['recurring'] != false,
        runAt: DateTime.tryParse(json['runAt']?.toString() ?? '')?.toLocal(),
        nextRun: DateTime.tryParse(
          json['nextRun']?.toString() ?? '',
        )?.toLocal(),
        enabled: json['enabled'] != false,
        lastResult: json['lastResult']?.toString(),
      );
}

class ScheduledJobHistory {
  final String id;
  final String? scheduleId;
  final String serverId;
  final String serverName;
  final ScheduledActionType action;
  final String source;
  final DateTime startedAt;
  final DateTime? finishedAt;
  final bool? success;
  final String message;

  const ScheduledJobHistory({
    required this.id,
    required this.scheduleId,
    required this.serverId,
    required this.serverName,
    required this.action,
    required this.source,
    required this.startedAt,
    required this.finishedAt,
    required this.success,
    required this.message,
  });

  factory ScheduledJobHistory.fromJson(Map<String, dynamic> json) =>
      ScheduledJobHistory(
        id: json['id']?.toString() ?? '',
        scheduleId: json['scheduleId']?.toString(),
        serverId: json['serverId']?.toString() ?? '',
        serverName: json['serverName']?.toString() ?? 'Server',
        action: _enumByName(
          ScheduledActionType.values,
          json['action'],
          ScheduledActionType.restart,
        ),
        source: json['source']?.toString() ?? 'scheduled',
        startedAt:
            DateTime.tryParse(json['startedAt']?.toString() ?? '')?.toLocal() ??
            DateTime.fromMillisecondsSinceEpoch(0),
        finishedAt: DateTime.tryParse(
          json['finishedAt']?.toString() ?? '',
        )?.toLocal(),
        success: json['success'] is bool ? json['success'] as bool : null,
        message: json['message']?.toString() ?? '',
      );
}

class MaintenancePolicySnapshot {
  final List<int> countdownOptionsSeconds;
  final List<int> milestonesSeconds;
  final int healthcheckAttempts;
  final int healthcheckIntervalSeconds;
  const MaintenancePolicySnapshot({
    this.countdownOptionsSeconds = const [60, 300, 600, 1800],
    this.milestonesSeconds = const [600, 300, 60, 30, 10],
    this.healthcheckAttempts = 12,
    this.healthcheckIntervalSeconds = 5,
  });

  factory MaintenancePolicySnapshot.fromJson(
    Object? raw, [
    MaintenancePolicySnapshot fallback = const MaintenancePolicySnapshot(),
  ]) {
    final json = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    List<int> ints(String key, List<int> fallback) => json[key] is List
        ? (json[key] as List)
              .whereType<num>()
              .map((value) => value.toInt())
              .toList()
        : fallback;
    return MaintenancePolicySnapshot(
      countdownOptionsSeconds: ints(
        'countdownOptionsSeconds',
        fallback.countdownOptionsSeconds,
      ),
      milestonesSeconds: ints('milestonesSeconds', fallback.milestonesSeconds),
      healthcheckAttempts:
          (json['healthcheckAttempts'] as num?)?.toInt() ??
          fallback.healthcheckAttempts,
      healthcheckIntervalSeconds:
          (json['healthcheckIntervalSeconds'] as num?)?.toInt() ??
          fallback.healthcheckIntervalSeconds,
    );
  }
}

class MaintenancePoliciesSnapshot {
  final MaintenancePolicySnapshot global;
  final Map<String, MaintenancePolicySnapshot> servers;
  const MaintenancePoliciesSnapshot({
    this.global = const MaintenancePolicySnapshot(),
    this.servers = const {},
  });
  factory MaintenancePoliciesSnapshot.fromJson(Object? raw) {
    final json = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final global = MaintenancePolicySnapshot.fromJson(json['global']);
    final result = <String, MaintenancePolicySnapshot>{};
    final rawServers = json['servers'];
    if (rawServers is Map) {
      for (final entry in rawServers.entries) {
        result[entry.key.toString()] = MaintenancePolicySnapshot.fromJson(
          entry.value,
          global,
        );
      }
    }
    return MaintenancePoliciesSnapshot(global: global, servers: result);
  }
  MaintenancePolicySnapshot forServer(String serverId) =>
      servers[serverId] ?? global;
}

class MaintenanceState {
  final String serverId;
  final String serverName;
  final String action;
  final bool active;
  final DateTime? endsAt;
  final String stage;
  final String message;

  const MaintenanceState({
    required this.serverId,
    required this.serverName,
    this.action = 'restart',
    required this.active,
    required this.endsAt,
    required this.stage,
    required this.message,
  });

  factory MaintenanceState.fromJson(Map<String, dynamic> json) =>
      MaintenanceState(
        serverId: json['serverId']?.toString() ?? '',
        serverName: json['serverName']?.toString() ?? 'Server',
        action: json['action']?.toString() ?? 'restart',
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

class BackupRetentionPolicy {
  final int daily;
  final int weekly;
  final int monthly;
  final bool enforce;

  const BackupRetentionPolicy({
    this.daily = 7,
    this.weekly = 4,
    this.monthly = 6,
    this.enforce = false,
  });

  factory BackupRetentionPolicy.fromJson(Object? raw) {
    final json = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    return BackupRetentionPolicy(
      daily: (json['daily'] as num?)?.toInt() ?? 7,
      weekly: (json['weekly'] as num?)?.toInt() ?? 4,
      monthly: (json['monthly'] as num?)?.toInt() ?? 6,
      enforce: json['enforce'] == true,
    );
  }
}

class BackupRetentionSummary {
  final String serverId;
  final BackupRetentionPolicy policy;
  final int kept;
  final int prunable;
  const BackupRetentionSummary({
    required this.serverId,
    required this.policy,
    required this.kept,
    required this.prunable,
  });

  factory BackupRetentionSummary.fromJson(Map<String, dynamic> json) =>
      BackupRetentionSummary(
        serverId: json['serverId']?.toString() ?? '',
        policy: BackupRetentionPolicy.fromJson(json),
        kept: (json['kept'] as num?)?.toInt() ?? 0,
        prunable: (json['prunable'] as num?)?.toInt() ?? 0,
      );
}

class BackupRetentionState {
  final BackupRetentionPolicy global;
  final Map<String, BackupRetentionPolicy> servers;
  final List<BackupRetentionSummary> summaries;

  const BackupRetentionState({
    this.global = const BackupRetentionPolicy(),
    this.servers = const {},
    this.summaries = const [],
  });
  factory BackupRetentionState.fromJson(Object? raw) {
    final json = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    final rawServers = json['servers'];
    final servers = <String, BackupRetentionPolicy>{};
    if (rawServers is Map) {
      for (final entry in rawServers.entries) {
        servers[entry.key.toString()] = BackupRetentionPolicy.fromJson(
          entry.value,
        );
      }
    }
    final summaries = json['summaries'] is List
        ? (json['summaries'] as List)
              .whereType<Map<String, dynamic>>()
              .map(BackupRetentionSummary.fromJson)
              .toList()
        : <BackupRetentionSummary>[];
    return BackupRetentionState(
      global: BackupRetentionPolicy.fromJson(json['global']),
      servers: servers,
      summaries: summaries,
    );
  }

  BackupRetentionPolicy forServer(String serverId) =>
      servers[serverId] ?? global;

  BackupRetentionSummary? summaryFor(String serverId) {
    for (final summary in summaries) {
      if (summary.serverId == serverId) return summary;
    }
    return null;
  }
}

class ManagementSnapshot {
  final DateTime? observedAt;
  final List<BackupStorageSnapshot> storages;
  final List<BackupEngineDescriptor> backupEngines;
  final List<BackupRecord> backups;
  final List<ScheduledAction> schedules;
  final List<ScheduledJobHistory> jobHistory;
  final List<MaintenanceState> maintenance;
  final MaintenancePoliciesSnapshot maintenancePolicies;
  final List<PluginUpdate> updates;
  final List<ManagementActivity> activity;
  final BackupRetentionState retention;

  const ManagementSnapshot({
    this.observedAt,
    this.storages = const [],
    this.backupEngines = const [],
    this.backups = const [],
    this.schedules = const [],
    this.jobHistory = const [],
    this.maintenance = const [],
    this.maintenancePolicies = const MaintenancePoliciesSnapshot(),
    this.updates = const [],
    this.activity = const [],
    this.retention = const BackupRetentionState(),
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
      jobHistory: parseList('jobHistory', ScheduledJobHistory.fromJson),
      maintenance: parseList('maintenance', MaintenanceState.fromJson),
      maintenancePolicies: MaintenancePoliciesSnapshot.fromJson(
        json['maintenancePolicies'],
      ),
      updates: parseList('updates', PluginUpdate.fromJson),
      activity: parseList('activity', ManagementActivity.fromJson),
      retention: BackupRetentionState.fromJson(json['retention']),
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
