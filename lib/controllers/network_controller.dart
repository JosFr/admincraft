import 'dart:async';
import 'dart:convert';

import 'package:admincraft/controllers/notification_controller.dart';
import 'package:admincraft/controllers/push_notification_controller.dart';
import 'package:admincraft/models/connection_security.dart';
import 'package:admincraft/models/app_notification.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/models/management_state.dart';
import 'package:admincraft/models/network_access_entry.dart';
import 'package:admincraft/models/network_snapshot.dart';
import 'package:admincraft/models/server_profile.dart';
import 'package:admincraft/services/websocket_connector.dart';
import 'package:admincraft/utils/toast_utils.dart';
import 'package:dart_jsonwebtoken/dart_jsonwebtoken.dart';
import 'package:flutter/widgets.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:shared_preferences/shared_preferences.dart';

class NetworkController with ChangeNotifier, WidgetsBindingObserver {
  static const _retryDelay = Duration(seconds: 8);
  static const _connectTimeout = Duration(seconds: 12);

  final NotificationController notifications;
  final PushNotificationController? push;
  final SharedPreferences? preferences;
  Model? _model;
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  Timer? _retryTimer;
  String? _profileFingerprint;
  String? _pushRegistrationFingerprint;
  bool _connecting = false;
  bool _connected = false;
  bool _disposed = false;
  String? _error;
  Set<String> _capabilities = {};
  String? _bridgeVersion;
  String? _bridgeScope;
  DateTime? _bridgeConnectedAt;
  NetworkSnapshot _snapshot = const NetworkSnapshot();
  List<NetworkAccessEntry> _access = const [];
  bool _accessSnapshotInitialized = false;
  ManagementSnapshot _management = const ManagementSnapshot();
  bool _managementSnapshotInitialized = false;
  List<PerformanceSample> _performance = const [];
  PerformanceSource _performanceSource = const PerformanceSource();
  String? _managementMessage;
  bool? _managementSuccess;

  NetworkController(this.notifications, {this.push, this.preferences}) {
    WidgetsBinding.instance.addObserver(this);
    push?.addListener(_pushChanged);
    notifications.addListener(_notificationPreferencesChanged);
  }

  bool get connected => _connected;
  bool get connecting => _connecting;
  String? get error => _error;
  NetworkSnapshot get snapshot => _snapshot;
  List<NetworkAccessEntry> get access => List.unmodifiable(_access);
  bool get accessAvailable => _capabilities.contains('access');
  bool get networkAvailable => _capabilities.contains('network');
  bool get managementAvailable => _capabilities.contains('management');
  Set<String> get capabilities => Set.unmodifiable(_capabilities);
  String? get bridgeVersion => _bridgeVersion;
  String? get bridgeScope => _bridgeScope;
  DateTime? get bridgeConnectedAt => _bridgeConnectedAt;
  ManagementSnapshot get management => _management;
  List<PerformanceSample> get performance => List.unmodifiable(_performance);
  PerformanceSource get performanceSource => _performanceSource;
  String? get managementMessage => _managementMessage;
  bool? get managementSuccess => _managementSuccess;
  void start(Model model) {
    if (identical(_model, model)) return;
    _model?.removeListener(_modelChanged);
    _model = model;
    model.addListener(_modelChanged);
    _modelChanged();
  }

  ServerProfile? _lobbyProfile(Model model) {
    for (final server in model.servers) {
      final alias = server.alias.trim().toLowerCase();
      final path = server.bridgePath.trim().toLowerCase();
      if ((alias == 'lobby' || path == '/lobby') && server.isComplete) {
        return server;
      }
    }
    return null;
  }

  String _fingerprint(ServerProfile profile) => [
    profile.id,
    profile.ip,
    profile.port,
    profile.bridgePath,
    profile.secretKey,
    profile.certificate,
    profile.security.name,
    profile.edition.name,
  ].join('|');

  void _modelChanged() {
    final model = _model;
    if (model == null || _disposed) return;
    final lobby = _lobbyProfile(model);
    if (lobby == null) {
      _profileFingerprint = null;
      _teardown();
      _error = 'No configured Lobby profile found.';
      notifyListeners();
      return;
    }
    final fingerprint = _fingerprint(lobby);
    if (_profileFingerprint == fingerprint && (_connected || _connecting)) {
      return;
    }
    _profileFingerprint = fingerprint;
    unawaited(_connect(lobby));
  }

  Future<void> _connect(ServerProfile profile) async {
    _teardown(keepRetry: true);
    _connecting = true;
    _error = null;
    notifyListeners();

    final protocol = profile.security.usesTls ? 'wss' : 'ws';
    final rawPath = profile.bridgePath.trim();
    final path = rawPath.isEmpty
        ? ''
        : (rawPath.startsWith('/') ? rawPath : '/$rawPath');
    final uri = Uri.parse('$protocol://${profile.ip}:${profile.port}$path');
    final channel = connectWebSocket(
      uri: uri,
      security: profile.security,
      certificate: profile.certificate,
    );
    _channel = channel;

    try {
      await channel.ready.timeout(_connectTimeout);
    } catch (error) {
      if (identical(_channel, channel)) {
        _connecting = false;
        _connected = false;
        _error = 'Network connection failed.';
        _channel = null;
        notifyListeners();
        _scheduleRetry();
      }
      unawaited(channel.sink.close());
      return;
    }

    if (!identical(_channel, channel) || _disposed) {
      unawaited(channel.sink.close());
      return;
    }

    _subscription = channel.stream.listen(
      (message) => _receive(message.toString()),
      onError: (_) => _connectionEnded(),
      onDone: _connectionEnded,
      cancelOnError: true,
    );
    final jwt = JWT({
      'userId': 'Admincraft Network',
      'edition': profile.edition.name,
      'protocol': 2,
      'logTail': 0,
      'exp':
          DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch ~/
          1000,
    }).sign(SecretKey(profile.secretKey));
    channel.sink.add(jsonEncode({'type': 'admincraft.auth', 'token': jwt}));
  }

  @visibleForTesting
  void debugReceive(String raw) => _receive(raw);

  void _receive(String raw) {
    Map<String, dynamic> decoded;
    try {
      final value = jsonDecode(raw);
      if (value is! Map<String, dynamic>) return;
      decoded = value;
    } catch (_) {
      return;
    }

    switch (decoded['type']) {
      case 'admincraft.hello':
        final rawCapabilities = decoded['capabilities'];
        _capabilities = rawCapabilities is List
            ? rawCapabilities.map((value) => value.toString()).toSet()
            : {};
        _bridgeVersion = decoded['version']?.toString();
        _bridgeScope = decoded['scope']?.toString();
        _bridgeConnectedAt = DateTime.tryParse(
          decoded['connectedAt']?.toString() ?? '',
        )?.toLocal();
        _connecting = false;
        _connected = true;
        _error = null;
        _managementMessage = null;
        _managementSuccess = null;
        notifyListeners();
        _syncPushRegistration();
        if (managementAvailable) refreshManagement();
        return;
      case 'admincraft.network-state':
        _updateNetwork(NetworkSnapshot.fromJson(decoded));
        return;
      case 'admincraft.access-state':
        final rawEntries = decoded['entries'];
        if (rawEntries is List) {
          final entries = rawEntries
              .whereType<Map<String, dynamic>>()
              .map(NetworkAccessEntry.fromJson)
              .where((entry) => entry.uuid.isNotEmpty)
              .toList();
          _updateAccess(entries);
        }
        return;
      case 'admincraft.management-state':
        _updateManagement(ManagementSnapshot.fromJson(decoded));
        return;
      case 'admincraft.performance-history':
        final rawSource = decoded['source'];
        _performanceSource = rawSource is Map<String, dynamic>
            ? PerformanceSource.fromJson(rawSource)
            : const PerformanceSource();
        final rawSamples = decoded['samples'];
        _performance = rawSamples is List
            ? rawSamples
                  .whereType<Map<String, dynamic>>()
                  .map(PerformanceSample.fromJson)
                  .toList()
            : const [];
        notifyListeners();
        return;
      case 'admincraft.management-result':
        _managementMessage = decoded['message']?.toString();
        _managementSuccess = decoded['success'] == true;
        if (_managementSuccess != true) {
          ToastUtils.showToastError(
            _managementMessage ?? 'Management action failed.',
          );
        }
        notifyListeners();
        if (decoded['refresh'] != false) refreshManagement();
        return;
      case 'admincraft.push-result':
        push?.markBridgeRegistration(
          success: decoded['success'] == true,
          providerConfigured: decoded['providerConfigured'] == true,
          message: decoded['message']?.toString(),
        );
        return;
      case 'admincraft.access-result':
        final accessMessage =
            decoded['message']?.toString() ?? 'Access action completed.';
        if (decoded['success'] == true) {
          ToastUtils.showToastSuccess(accessMessage);
        } else {
          ToastUtils.showToastError(accessMessage);
        }
        return;
    }
  }

  void _updateManagement(ManagementSnapshot next) {
    final previous = _management;
    final wasInitialized = _managementSnapshotInitialized;
    _management = next;
    _managementSnapshotInitialized = true;

    if (wasInitialized) {
      final previousBackups = {
        for (final backup in previous.backups) backup.id: backup.status,
      };
      if (notifications.ruleEnabled(NotificationRule.backupFailures)) {
        for (final backup in next.backups) {
          if (backup.status != BackupStatus.failed ||
              previousBackups[backup.id] == BackupStatus.failed) {
            continue;
          }
          notifications.add(
            kind: AppNotificationKind.error,
            title: '${backup.serverName} backup failed',
            message: backup.message?.trim().isNotEmpty == true
                ? backup.message!.trim()
                : '${backup.engineLabel.isEmpty ? backup.engine.name : backup.engineLabel} backup failed.',
          );
        }
      }

      final previousJobs = {for (final job in previous.jobHistory) job.id};
      if (notifications.ruleEnabled(NotificationRule.scheduledFailures)) {
        for (final job in next.jobHistory) {
          if (previousJobs.contains(job.id) ||
              job.success != false ||
              job.source != 'scheduled' ||
              job.action == ScheduledActionType.backup) {
            continue;
          }
          notifications.add(
            kind: AppNotificationKind.error,
            title: '${job.serverName} scheduled action failed',
            message: job.message.isEmpty
                ? '${job.action.name} failed.'
                : job.message,
          );
        }
      }

      final previousMaintenance = {
        for (final item in previous.maintenance) item.serverId: item.stage,
      };
      if (notifications.ruleEnabled(NotificationRule.maintenanceProblems)) {
        for (final item in next.maintenance) {
          if (item.stage != 'failed' ||
              previousMaintenance[item.serverId] == 'failed') {
            continue;
          }
          notifications.add(
            kind: AppNotificationKind.error,
            title: '${item.serverName} maintenance failed',
            message: item.message.isEmpty
                ? 'Maintenance did not complete successfully.'
                : item.message,
          );
        }
      }

      String updateKey(PluginUpdate update) =>
          '${update.serverId}\u0000${update.kind}\u0000${update.plugin}';
      final previousUpdates = {
        for (final update in previous.updates)
          updateKey(update): (update.status, update.latestVersion),
      };
      if (notifications.ruleEnabled(NotificationRule.updateAvailable)) {
        for (final update in next.updates) {
          if (update.status != PluginUpdateStatus.updateAvailable) continue;
          final old = previousUpdates[updateKey(update)];
          if (old != null &&
              old.$1 == PluginUpdateStatus.updateAvailable &&
              old.$2 == update.latestVersion) {
            continue;
          }
          final versions = [
            if (update.currentVersion.isNotEmpty) update.currentVersion,
            if (update.latestVersion?.trim().isNotEmpty == true)
              update.latestVersion!.trim(),
          ];
          notifications.add(
            kind: AppNotificationKind.info,
            title: '${update.plugin} update available',
            message:
                '${update.serverName}${versions.isEmpty ? '' : ' · ${versions.join(' → ')}'}',
          );
        }
      }
    }
    notifyListeners();
  }

  void _updateNetwork(NetworkSnapshot next) {
    final previousByName = {
      for (final server in _snapshot.servers) server.name: server,
    };
    final hadSnapshot = _snapshot.observedAt != null;
    _snapshot = next;

    if (hadSnapshot) {
      for (final server in next.servers) {
        final previous = previousByName[server.name];
        if (previous == null) continue;
        if (previous.state == server.state) continue;
        if (server.state == NetworkServerState.error &&
            notifications.ruleEnabled(NotificationRule.health)) {
          notifications.add(
            kind: AppNotificationKind.error,
            title: '${server.label} health alert',
            message: '${previous.state.name} → error',
          );
        } else if (server.state == NetworkServerState.offline &&
            previous.state != NetworkServerState.standby &&
            notifications.ruleEnabled(NotificationRule.serverStatus)) {
          notifications.add(
            kind: AppNotificationKind.warning,
            title: '${server.label} offline',
            message: 'The server became unavailable unexpectedly.',
          );
        }
      }
    }
    notifyListeners();
  }

  void _updateAccess(List<NetworkAccessEntry> next) {
    final previousPending = _access
        .where((entry) => entry.status == NetworkAccessStatus.pending)
        .map((entry) => entry.uuid)
        .toSet();
    final wasInitialized = _accessSnapshotInitialized;
    _access = [...next]
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    _accessSnapshotInitialized = true;

    if (wasInitialized &&
        notifications.ruleEnabled(NotificationRule.accessRequests)) {
      final pending = _access
          .where((entry) => entry.status == NetworkAccessStatus.pending)
          .toList();
      for (final entry in pending) {
        if (previousPending.contains(entry.uuid)) continue;
        notifications.add(
          kind: AppNotificationKind.info,
          title: 'Nieuw toegangsverzoek',
          message: '${entry.name} vraagt toegang tot het netwerk.',
        );
      }
    }
    notifyListeners();
  }

  bool executeAccessAction(String action, String uuid) {
    if (!_connected || !accessAvailable) return false;
    _channel?.sink.add('admincraft access $action $uuid');
    return true;
  }

  bool updateProviderEnabled(UpdateProvider provider) =>
      preferences?.getBool('updateProvider.${provider.name}') ?? true;

  Future<void> setUpdateProviderEnabled(
    UpdateProvider provider,
    bool enabled,
  ) async {
    await preferences?.setBool('updateProvider.${provider.name}', enabled);
    notifyListeners();
  }

  bool _manage(String action, [Map<String, dynamic> payload = const {}]) {
    if (!_connected || !managementAvailable) return false;
    final raw = jsonEncode(payload);
    final encoded = base64Url.encode(utf8.encode(raw)).replaceAll('=', '');
    _channel?.sink.add('admincraft manage $action $encoded');
    return true;
  }

  bool refreshManagement() => _manage('snapshot');

  bool createBackup(
    String serverId, {
    String engineId = 'multicraft',
    List<String> destinationIds = const [],
  }) => _manage('backup-create', {
    'serverId': serverId,
    'engineId': engineId,
    if (destinationIds.isNotEmpty) 'destinationIds': destinationIds,
  });

  bool deleteBackup(String backupId) =>
      _manage('backup-delete', {'backupId': backupId});

  bool restoreBackup(String backupId) =>
      _manage('backup-restore', {'backupId': backupId});

  bool downloadBackup(String backupId) =>
      _manage('backup-download', {'backupId': backupId});

  bool verifyBackup(String backupId) =>
      _manage('backup-verify', {'backupId': backupId});

  bool copyBackup(String backupId, List<String> destinationIds) => _manage(
    'backup-copy',
    {'backupId': backupId, 'destinationIds': destinationIds},
  );

  bool saveBackupStorage({
    required String id,
    required String name,
    required StorageProviderType type,
    String path = '',
    String remote = '',
    String basePath = '',
    String url = '',
    String username = '',
    String password = '',
    bool clearPassword = false,
    int? softLimitBytes,
    int? minimumFreeBytes,
    double warningFreePercent = 15,
    double criticalFreePercent = 5,
  }) => _manage('storage-upsert', {
    'id': id,
    'name': name,
    'type': type.name,
    'path': path,
    'remote': remote,
    'basePath': basePath,
    'url': url,
    'username': username,
    if (password.isNotEmpty) 'password': password,
    if (clearPassword) 'clearPassword': true,
    'softLimitBytes': softLimitBytes,
    'minimumFreeBytes': minimumFreeBytes,
    'warningFreePercent': warningFreePercent,
    'criticalFreePercent': criticalFreePercent,
  });

  bool testBackupStorage(String storageId) =>
      _manage('storage-test', {'storageId': storageId});

  bool deleteBackupStorage(String storageId) =>
      _manage('storage-delete', {'storageId': storageId});

  bool setBackupDestinationDefaults({
    String? serverId,
    List<String> storageIds = const [],
    bool inherit = false,
  }) => _manage('storage-defaults-set', {
    if (serverId != null) 'serverId': serverId,
    'storageIds': storageIds,
    if (inherit) 'inherit': true,
  });

  bool setBackupRetention({
    String? serverId,
    required int daily,
    required int weekly,
    required int monthly,
    required bool enforce,
    bool inherit = false,
  }) => _manage('retention-set', {
    if (serverId != null) 'serverId': serverId,
    if (!inherit) 'daily': daily,
    if (!inherit) 'weekly': weekly,
    if (!inherit) 'monthly': monthly,
    if (!inherit) 'enforce': enforce,
    if (inherit) 'inherit': true,
  });
  bool saveBackupEngine({
    required BackupEngineDescriptor engine,
    String label = '',
    String command = '',
    String backupType = 'custom',
    String completionRegex = '',
    String failureRegex = '',
    int? completionTimeoutSeconds,
  }) => _manage('engine-upsert', {
    'id': engine.id,
    'type': engine.type.name,
    'serverId': engine.serverIds.first,
    'label': label.trim().isEmpty ? engine.label : label.trim(),
    'backupType': backupType,
    if (command.trim().isNotEmpty) 'command': command.trim(),
    if (completionRegex.trim().isNotEmpty)
      'completionRegex': completionRegex.trim(),
    if (failureRegex.trim().isNotEmpty) 'failureRegex': failureRegex.trim(),
    if (completionTimeoutSeconds != null)
      'completionTimeoutSeconds': completionTimeoutSeconds,
  });

  bool resetBackupEngine(String engineId) =>
      _manage('engine-delete', {'engineId': engineId});

  bool createSchedule({
    required String serverId,
    required String action,
    String schedule = '',
    DateTime? runAt,
    String? backupEngineId,
  }) => _manage('schedule-create', {
    'serverId': serverId,
    'action': action,
    if (backupEngineId != null && backupEngineId.isNotEmpty)
      'backupEngineId': backupEngineId,
    if (schedule.isNotEmpty) 'schedule': schedule,
    if (runAt != null) 'runAt': runAt.toUtc().toIso8601String(),
  });

  bool toggleSchedule(String id, bool enabled) =>
      _manage('schedule-toggle', {'id': id, 'enabled': enabled});

  bool deleteSchedule(String id) => _manage('schedule-delete', {'id': id});

  bool startMaintenance(
    String serverId, {
    String action = 'restart',
    int countdownSeconds = 600,
    bool backup = true,
    String? backupEngineId,
    bool restartWhenEmpty = false,
  }) => _manage('maintenance-start', {
    'serverId': serverId,
    'action': action,
    'countdownSeconds': countdownSeconds,
    'backup': backup,
    if (backupEngineId != null && backupEngineId.isNotEmpty)
      'backupEngineId': backupEngineId,
    'restartWhenEmpty': restartWhenEmpty,
  });

  bool cancelMaintenance(String serverId) =>
      _manage('maintenance-cancel', {'serverId': serverId});

  bool requestPerformance(String serverId, String range) =>
      _manage('performance-history', {'serverId': serverId, 'range': range});

  bool checkUpdates([String? serverId]) => _manage('updates-check', {
    if (serverId != null) 'serverId': serverId,
    'providers': {
      for (final provider in UpdateProvider.values)
        provider.name: updateProviderEnabled(provider),
    },
  });

  bool setUpdateSource({
    required PluginUpdate update,
    required UpdateProvider provider,
    required String projectId,
    String role = 'check',
    String? url,
  }) => _manage('updates-source-set', {
    'serverId': update.serverId,
    'plugin': update.plugin,
    'provider': provider.name,
    'projectId': projectId,
    'role': role,
    if (url != null && url.trim().isNotEmpty) 'url': url.trim(),
    'providers': {
      for (final provider in UpdateProvider.values)
        provider.name: updateProviderEnabled(provider),
    },
  });

  bool confirmUpdateSource(
    PluginUpdate update,
    UpdateSourceCandidate candidate, {
    String role = 'check',
  }) => setUpdateSource(
    update: update,
    provider: candidate.provider,
    projectId: candidate.projectId,
    role: role,
    url: candidate.url,
  );

  void _pushChanged() => _syncPushRegistration();
  void _notificationPreferencesChanged() => _syncPushRegistration();

  void _syncPushRegistration() {
    final controller = push;
    if (!_connected || controller == null || !_capabilities.contains('push')) {
      return;
    }
    final token = controller.token;
    final topic = controller.bundleId;
    if (token == null || token.isEmpty || topic == null || topic.isEmpty) {
      return;
    }
    final rules = {
      for (final rule in NotificationRule.values)
        rule.name: notifications.ruleEnabled(rule),
    };
    final payload = {
      'token': token,
      'topic': topic,
      'environment': controller.environment,
      'rules': rules,
    };
    final fingerprint = jsonEncode(payload);
    if (_pushRegistrationFingerprint == fingerprint) return;
    final encoded = base64Url
        .encode(utf8.encode(fingerprint))
        .replaceAll('=', '');
    _channel?.sink.add('admincraft push-register $encoded');
    _pushRegistrationFingerprint = fingerprint;
  }

  void reconnect() {
    final model = _model;
    if (model == null) return;
    _profileFingerprint = null;
    _modelChanged();
  }

  void _connectionEnded() {
    if (_disposed) return;
    _connected = false;
    _connecting = false;
    _capabilities = {};
    _bridgeVersion = null;
    _bridgeScope = null;
    _bridgeConnectedAt = null;
    _managementMessage = null;
    _managementSuccess = null;
    _performance = const [];
    _performanceSource = const PerformanceSource();
    _error = 'Network connection closed.';
    _subscription = null;
    _channel = null;
    notifyListeners();
    _scheduleRetry();
  }

  void _scheduleRetry() {
    if (_disposed || _retryTimer != null) return;
    _retryTimer = Timer(_retryDelay, () {
      _retryTimer = null;
      if (_disposed) return;
      _profileFingerprint = null;
      _modelChanged();
    });
  }

  void _teardown({bool keepRetry = false}) {
    _pushRegistrationFingerprint = null;
    if (!keepRetry) _retryTimer?.cancel();
    if (!keepRetry) _retryTimer = null;
    _subscription?.cancel();
    _subscription = null;
    _channel?.sink.close();
    _channel = null;
    _connecting = false;
    _connected = false;
    _capabilities = {};
    _bridgeVersion = null;
    _bridgeScope = null;
    _bridgeConnectedAt = null;
    _managementMessage = null;
    _managementSuccess = null;
    _performance = const [];
    _performanceSource = const PerformanceSource();
    _accessSnapshotInitialized = false;
    _managementSnapshotInitialized = false;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      reconnect();
    } else if (state == AppLifecycleState.detached) {
      _teardown();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _model?.removeListener(_modelChanged);
    push?.removeListener(_pushChanged);
    notifications.removeListener(_notificationPreferencesChanged);
    _teardown();
    super.dispose();
  }
}
