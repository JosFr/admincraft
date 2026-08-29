import Flutter
import UIKit
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate {
  private var pushChannel: FlutterMethodChannel?
  private var deviceToken: String?
  private var pushError: String?
  private var authorization = "unknown"

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    configurePushChannel()
    refreshAuthorization()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private func configurePushChannel() {
    guard let controller = window?.rootViewController as? FlutterViewController else {
      return
    }
    let channel = FlutterMethodChannel(
      name: "admincraft/push",
      binaryMessenger: controller.binaryMessenger
    )
    pushChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self else { return }
      switch call.method {
      case "status":
        self.refreshAuthorization(result: result)
      case "request":
        self.requestPushPermission(result: result)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  private func requestPushPermission(result: @escaping FlutterResult) {
    UNUserNotificationCenter.current().requestAuthorization(
      options: [.alert, .badge, .sound]
    ) { [weak self] granted, error in
      guard let self else { return }
      if let error {
        self.pushError = error.localizedDescription
      }
      DispatchQueue.main.async {
        if granted {
          UIApplication.shared.registerForRemoteNotifications()
        }
        self.refreshAuthorization(result: result)
      }
    }
  }

  private func refreshAuthorization(result: FlutterResult? = nil) {
    UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
      guard let self else { return }
      self.authorization = self.authorizationName(settings.authorizationStatus)
      DispatchQueue.main.async {
        result?(self.statusPayload())
      }
    }
  }

  private func authorizationName(
    _ status: UNAuthorizationStatus
  ) -> String {
    switch status {
    case .notDetermined: return "notDetermined"
    case .denied: return "denied"
    case .authorized: return "authorized"
    case .provisional: return "provisional"
    case .ephemeral: return "ephemeral"
    @unknown default: return "unknown"
    }
  }

  private func statusPayload() -> [String: Any] {
    var payload: [String: Any] = [
      "authorization": authorization,
      "bundleId": Bundle.main.bundleIdentifier ?? "",
      "environment": "production"
    ]
    if let deviceToken { payload["token"] = deviceToken }
    if let pushError { payload["error"] = pushError }
    return payload
  }

  override func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    self.deviceToken = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    self.pushError = nil
    pushChannel?.invokeMethod("token", arguments: statusPayload())
    super.application(
      application,
      didRegisterForRemoteNotificationsWithDeviceToken: deviceToken
    )
  }

  override func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    pushError = error.localizedDescription
    pushChannel?.invokeMethod("error", arguments: pushError)
    super.application(
      application,
      didFailToRegisterForRemoteNotificationsWithError: error
    )
  }
}
