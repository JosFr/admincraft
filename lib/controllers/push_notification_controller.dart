import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class PushNotificationController with ChangeNotifier {
  static const MethodChannel _channel = MethodChannel('admincraft/push');

  bool _initialized = false;
  String _authorization = 'unknown';
  String? _token;
  String? _bundleId;
  String _environment = 'production';
  String? _error;
  bool _bridgeRegistered = false;
  bool _providerConfigured = false;

  bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;
  bool get initialized => _initialized;
  String get authorization => _authorization;
  String? get token => _token;
  String? get bundleId => _bundleId;
  String get environment => _environment;
  String? get error => _error;
  bool get bridgeRegistered => _bridgeRegistered;
  bool get providerConfigured => _providerConfigured;
  bool get hasDeviceToken => _token != null && _token!.isNotEmpty;

  Future<void> initialize() async {
    if (!supported) {
      _initialized = true;
      return;
    }
    _channel.setMethodCallHandler((call) async {
      final arguments = call.arguments;
      if (call.method == 'token' && arguments is Map) {
        _apply(arguments.cast<Object?, Object?>());
      } else if (call.method == 'error') {
        _error = arguments?.toString() ?? 'APNs registration failed.';
        notifyListeners();
      }
    });
    await refresh();
    _initialized = true;
    notifyListeners();
  }

  Future<void> refresh() async {
    if (!supported) return;
    try {
      final result = await _channel.invokeMapMethod<Object?, Object?>('status');
      if (result != null) _apply(result);
    } on PlatformException catch (error) {
      _error = error.message ?? error.code;
      notifyListeners();
    } on MissingPluginException {
      _error = 'Native APNs support is unavailable in this build.';
      notifyListeners();
    }
  }

  Future<void> requestPermission() async {
    if (!supported) return;
    _error = null;
    notifyListeners();
    try {
      final result = await _channel.invokeMapMethod<Object?, Object?>('request');
      if (result != null) _apply(result);
      await refresh();
    } on PlatformException catch (error) {
      _error = error.message ?? error.code;
      notifyListeners();
    } on MissingPluginException {
      _error = 'Native APNs support is unavailable in this build.';
      notifyListeners();
    }
  }

  void markBridgeRegistration({
    required bool success,
    required bool providerConfigured,
    String? message,
  }) {
    _bridgeRegistered = success;
    _providerConfigured = providerConfigured;
    if (!success && message != null && message.isNotEmpty) {
      _error = message;
    }
    notifyListeners();
  }

  void _apply(Map<Object?, Object?> values) {
    _authorization = values['authorization']?.toString() ?? _authorization;
    final token = values['token']?.toString();
    if (token != null && token.isNotEmpty) _token = token;
    _bundleId = values['bundleId']?.toString() ?? _bundleId;
    _environment = values['environment']?.toString() ?? _environment;
    _error = values['error']?.toString();
    notifyListeners();
  }
}
