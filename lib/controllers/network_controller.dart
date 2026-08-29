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
  NetworkSnapshot _snapshot = const NetworkSnapshot();
  List<NetworkAccessEntry> _access = const [];
  ManagementSnapshot _management = const ManagementSnapshot();
  List<PerformanceSample> _performance = const [];
  String? _managementMessage;

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
  ManagementSnapshot get management => _management;
  List<PerformanceSample> get performance => List.unmodifiable(_performance);
  String? get managementMessage => _managementMessage;
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
    if (_profileFingerprint == fingerprint && (_connected || _connecting)) return;
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
      'exp': DateTime.now().add(const Duration(hours: 1)).millisecondsSinceEpoch ~/ 1000,
    }).sign(SecretKey(profile.secretKey));
    channel.sink.add(jsonEncode({'type': 'admincraft.auth', 'token': jwt}));
  }
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
        _connecting = false;
        _connected = true;
        _error = null;
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
        _management = ManagementSnapshot.fromJson(decoded);
        _managementMessage = null;
        notifyListeners();
        return;
      case 'admincraft.performance-history':
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
        if (decoded['success'] != true) {
          notifications.add(
            kind: AppNotificationKind.error,
            title: 'AdminCraft management',
            message: _managementMessage ?? 'Management action failed.',
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
        notifications.add(
          kind: decoded['success'] == true
              ? AppNotificationKind.success
              : AppNotificationKind.error,
          title: 'Network access',
          message: decoded['message']?.toString() ?? 'Access action completed.',
        );
        return;
    }
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
        if (notifications.ruleEnabled(NotificationRule.playerActivity) &&
            previous.players != server.players) {
          notifications.add(
            kind: AppNotificationKind.info,
            title: server.label,
            message: 'Players: ${previous.players} → ${server.players}',
          );
        }
        if (previous.state == server.state) continue;
        if (server.state == NetworkServerState.error &&
            notifications.ruleEnabled(NotificationRule.health)) {
          notifications.add(
            kind: AppNotificationKind.error,
            title: '${server.label} health alert',
            message: '${previous.state.name} → error',
          );
        } else if (notifications.ruleEnabled(NotificationRule.serverStatus)) {
          notifications.add(
            kind: server.state == NetworkServerState.offline
                ? AppNotificationKind.warning
                : AppNotificationKind.info,
            title: server.label,
            message: '${previous.state.name} → ${server.state.name}',
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
    final hadState = _access.isNotEmpty;
    _access = [...next]..sort(
      (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
    );

    if (notifications.ruleEnabled(NotificationRule.accessRequests)) {
      final pending = _access
          .where((entry) => entry.status == NetworkAccessStatus.pending)
          .toList();
      if (!hadState && pending.isNotEmpty) {
        notifications.add(
          kind: AppNotificationKind.info,
          title: 'Network access',
          message: pending.length == 1
              ? '${pending.first.name} wacht op toegang.'
              : '${pending.length} toegangsverzoeken wachten op beoordeling.',
        );
      } else {
        for (final entry in pending) {
          if (previousPending.contains(entry.uuid)) continue;
          notifications.add(
            kind: AppNotificationKind.info,
            title: 'Nieuw toegangsverzoek',
            message: '${entry.name} vraagt toegang tot het netwerk.',
          );
        }
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

  bool createBackup(String serverId, {String engine = 'multicraft'}) =>
      _manage('backup-create', {'serverId': serverId, 'engine': engine});

  bool deleteBackup(String backupId) =>
      _manage('backup-delete', {'backupId': backupId});

  bool restoreBackup(String backupId) =>
      _manage('backup-restore', {'backupId': backupId});

  bool createSchedule({
    required String serverId,
    required String action,
    required String schedule,
  }) => _manage('schedule-create', {
    'serverId': serverId,
    'action': action,
    'schedule': schedule,
  });

  bool toggleSchedule(String id, bool enabled) =>
      _manage('schedule-toggle', {'id': id, 'enabled': enabled});

  bool deleteSchedule(String id) =>
      _manage('schedule-delete', {'id': id});

  bool startMaintenance(
    String serverId, {
    int countdownSeconds = 600,
    bool backup = true,
    bool restartWhenEmpty = false,
  }) => _manage('maintenance-start', {
    'serverId': serverId,
    'countdownSeconds': countdownSeconds,
    'backup': backup,
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

  void _pushChanged() => _syncPushRegistration();
  void _notificationPreferencesChanged() => _syncPushRegistration();

  void _syncPushRegistration() {
    final controller = push;
    if (!_connected || controller == null || !_capabilities.contains('push')) return;
    final token = controller.token;
    final topic = controller.bundleId;
    if (token == null || token.isEmpty || topic == null || topic.isEmpty) return;
    final rules = {
      for (final rule in NotificationRule.values) rule.name: notifications.ruleEnabled(rule),
    };
    final payload = {
      'token': token,
      'topic': topic,
      'environment': controller.environment,
      'rules': rules,
    };
    final fingerprint = jsonEncode(payload);
    if (_pushRegistrationFingerprint == fingerprint) return;
    final encoded = base64Url.encode(utf8.encode(fingerprint)).replaceAll('=', '');
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
