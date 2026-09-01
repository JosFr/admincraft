import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/models/management_state.dart';
import 'package:admincraft/utils/toast_utils.dart';
import 'package:flutter/material.dart';

int? _gibToBytes(String value) {
  final number = double.tryParse(value.trim().replaceAll(',', '.'));
  if (number == null || number < 0) return null;
  return (number * 1024 * 1024 * 1024).round();
}

String _bytesToGiB(int? value) => value == null
    ? ''
    : (value / 1024 / 1024 / 1024).toStringAsFixed(1).replaceFirst('.0', '');

String _slug(String value) {
  final slug = value.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-');
  return slug.replaceAll(RegExp(r'^-+|-+$'), '');
}

Future<void> showBackupStorageEditor(
  BuildContext context,
  NetworkController network, {
  BackupStorageSnapshot? storage,
}) async {
  final formKey = GlobalKey<FormState>();
  var type = storage?.type ?? StorageProviderType.nextcloud;
  var clearPassword = false;
  final id = TextEditingController(text: storage?.id ?? '');
  final name = TextEditingController(text: storage?.name ?? '');
  final path = TextEditingController(text: storage?.path ?? '');
  final remote = TextEditingController(text: storage?.remote ?? '');
  final basePath = TextEditingController(text: storage?.basePath ?? '');
  final url = TextEditingController(text: storage?.url ?? '');
  final username = TextEditingController(text: storage?.username ?? '');
  final password = TextEditingController();
  final softLimit = TextEditingController(
    text: _bytesToGiB(storage?.softLimitBytes),
  );
  final minimumFree = TextEditingController(
    text: _bytesToGiB(storage?.minimumFreeBytes),
  );
  final warning = TextEditingController(
    text: (storage?.warningFreePercent ?? 15).toStringAsFixed(0),
  );
  final critical = TextEditingController(
    text: (storage?.criticalFreePercent ?? 5).toStringAsFixed(0),
  );
  final controllers = [
    id,
    name,
    path,
    remote,
    basePath,
    url,
    username,
    password,
    softLimit,
    minimumFree,
    warning,
    critical,
  ];
  try {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) {
          final mountType = const {
            StorageProviderType.local,
            StorageProviderType.smb,
            StorageProviderType.nfs,
          }.contains(type);
          final davType = const {
            StorageProviderType.nextcloud,
            StorageProviderType.webdav,
          }.contains(type);
          final remoteType = const {
            StorageProviderType.sftp,
            StorageProviderType.s3,
            StorageProviderType.rclone,
          }.contains(type);
          return AlertDialog(
            title: Text(
              storage == null ? 'Add backup storage' : 'Edit backup storage',
            ),
            content: SizedBox(
              width: 520,
              child: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      DropdownButtonFormField<StorageProviderType>(
                        initialValue: type,
                        decoration: const InputDecoration(
                          labelText: 'Storage type',
                        ),
                        items: [
                          for (final value in StorageProviderType.values)
                            DropdownMenuItem(
                              value: value,
                              child: Text(value.label),
                            ),
                        ],
                        onChanged: storage == null
                            ? (value) {
                                if (value != null) setState(() => type = value);
                              }
                            : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: name,
                        decoration: const InputDecoration(labelText: 'Name'),
                        validator: (value) =>
                            value == null || value.trim().isEmpty
                            ? 'Enter a storage name.'
                            : null,
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: id,
                        enabled: storage == null,
                        decoration: const InputDecoration(
                          labelText: 'Storage ID',
                          helperText: 'Leave blank to derive it from the name.',
                        ),
                      ),
                      if (mountType) ...[
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: path,
                          decoration: InputDecoration(
                            labelText: type == StorageProviderType.local
                                ? 'Filesystem path'
                                : '${type.label} mounted path',
                          ),
                          validator: (value) =>
                              value == null || value.trim().isEmpty
                              ? 'Enter the mounted path visible to the management bridge.'
                              : null,
                        ),
                      ],
                      if (mountType && type != StorageProviderType.local) ...[
                        const SizedBox(height: 6),
                        Align(
                          alignment: Alignment.centerLeft,
                          child: Text(
                            '${type.label} must already be mounted on the management host/container. AdminCraft does not mount network filesystems with elevated privileges.',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
                      if (davType) ...[
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: url,
                          keyboardType: TextInputType.url,
                          decoration: InputDecoration(
                            labelText: type == StorageProviderType.nextcloud
                                ? 'Nextcloud URL'
                                : 'WebDAV URL',
                          ),
                          validator: (value) =>
                              value == null || value.trim().isEmpty
                              ? 'Enter the endpoint URL.'
                              : null,
                        ),
                      ],
                      if (davType) ...[
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: username,
                          decoration: InputDecoration(
                            labelText: 'Username',
                            helperText: storage?.managed == true
                                ? 'Leave blank to keep the stored username.'
                                : null,
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: password,
                          obscureText: true,
                          decoration: InputDecoration(
                            labelText: type == StorageProviderType.nextcloud
                                ? 'App password'
                                : 'Password',
                            helperText: storage?.credentialConfigured == true
                                ? 'Leave blank to keep the stored credential.'
                                : null,
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: basePath,
                          decoration: const InputDecoration(
                            labelText: 'Backup folder (optional)',
                          ),
                        ),
                        if (storage?.credentialConfigured == true)
                          SwitchListTile(
                            contentPadding: EdgeInsets.zero,
                            title: const Text('Clear stored credential'),
                            value: clearPassword,
                            onChanged: (value) =>
                                setState(() => clearPassword = value),
                          ),
                      ],
                      if (remoteType) ...[
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: remote,
                          decoration: InputDecoration(
                            labelText: '${type.label} rclone remote',
                            helperText: 'Example: backup-sftp: or minio:',
                          ),
                          validator: (value) =>
                              value == null || value.trim().isEmpty
                              ? 'Enter a configured rclone remote.'
                              : null,
                        ),
                        const SizedBox(height: 12),
                        TextFormField(
                          controller: basePath,
                          decoration: const InputDecoration(
                            labelText: 'Remote folder (optional)',
                          ),
                        ),
                      ],
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: minimumFree,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                labelText: 'Keep free (GiB)',
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextFormField(
                              controller: softLimit,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                labelText: 'Backup soft limit (GiB)',
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextFormField(
                              controller: warning,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                labelText: 'Warning below % free',
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: TextFormField(
                              controller: critical,
                              keyboardType: TextInputType.number,
                              decoration: const InputDecoration(
                                labelText: 'Critical below % free',
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('Cancel'),
              ),
              FilledButton.icon(
                onPressed: () {
                  if (formKey.currentState?.validate() != true) return;
                  Navigator.pop(dialogContext, true);
                },
                icon: const Icon(Icons.save_outlined),
                label: const Text('Save'),
              ),
            ],
          );
        },
      ),
    );
    if (saved != true || !context.mounted) return;
    final storageId =
        storage?.id ?? _slug(id.text.isEmpty ? name.text : id.text);
    if (storageId.isEmpty) {
      ToastUtils.showToastError('Storage ID could not be derived.');
      return;
    }
    final warningValue = double.tryParse(warning.text.trim()) ?? 15;
    final criticalValue = double.tryParse(critical.text.trim()) ?? 5;
    if (criticalValue < 0 || warningValue < 0 || criticalValue > warningValue) {
      ToastUtils.showToastError(
        'Storage thresholds are invalid: critical must be at or below warning.',
      );
      return;
    }
    final sent = network.saveBackupStorage(
      id: storageId,
      name: name.text.trim(),
      type: type,
      path: path.text.trim(),
      remote: remote.text.trim(),
      basePath: basePath.text.trim(),
      url: url.text.trim(),
      username: username.text.trim(),
      password: password.text,
      clearPassword: clearPassword,
      softLimitBytes: softLimit.text.trim().isEmpty
          ? null
          : _gibToBytes(softLimit.text),
      minimumFreeBytes: minimumFree.text.trim().isEmpty
          ? null
          : _gibToBytes(minimumFree.text),
      warningFreePercent: warningValue,
      criticalFreePercent: criticalValue,
    );
    if (!sent) {
      ToastUtils.showToastError('Storage configuration could not be sent.');
    }
  } finally {
    for (final controller in controllers) {
      controller.dispose();
    }
  }
}

Future<void> showBackupDestinationDefaultsDialog(
  BuildContext context,
  NetworkController network, {
  String? serverId,
}) async {
  final snapshot = network.management;
  final storages = snapshot.storages;
  final serverMode = serverId != null;
  var inherit =
      serverMode && snapshot.backupDestinationDefaults.inherits(serverId);
  final selected = <String>{
    ...(serverMode
        ? snapshot.backupDestinationDefaults.forServer(serverId)
        : snapshot.backupDestinationDefaults.global),
  };
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(
          serverMode
              ? 'Server backup destinations'
              : 'Global backup destinations',
        ),
        content: SizedBox(
          width: 430,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (serverMode)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Inherit global destinations'),
                  subtitle: const Text(
                    'New global destination choices will automatically apply to this server.',
                  ),
                  value: inherit,
                  onChanged: (value) => setState(() => inherit = value),
                ),
              if (storages.isEmpty)
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('No backup storage is configured yet.'),
                )
              else
                for (final storage in storages)
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    title: Text(storage.name),
                    subtitle: Text(storage.type.label),
                    value: selected.contains(storage.id),
                    onChanged: inherit
                        ? null
                        : (checked) {
                            setState(() {
                              if (checked == true) {
                                selected.add(storage.id);
                              } else {
                                selected.remove(storage.id);
                              }
                            });
                          },
                  ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: () => Navigator.pop(dialogContext, true),
            icon: const Icon(Icons.save_outlined),
            label: const Text('Save defaults'),
          ),
        ],
      ),
    ),
  );
  if (confirmed != true || !context.mounted) return;
  final sent = network.setBackupDestinationDefaults(
    serverId: serverId,
    storageIds: selected.toList(),
    inherit: serverMode && inherit,
  );
  if (!sent) {
    ToastUtils.showToastError('Backup destination defaults could not be sent.');
  }
}
