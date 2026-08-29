import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/models/management_state.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/utils/dialog_utils.dart';
import 'package:admincraft/utils/toast_utils.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

class BackupView extends StatelessWidget {
  final String? serverId;

  const BackupView({super.key, this.serverId});

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) {
      return const Center(
        child: Text('Connect a Network/Lobby bridge with RC4 management support.'),
      );
    }
    final model = context.watch<Model>();
    final snapshot = network.management;
    final backups = snapshot.backups.where((backup) {
      return serverId == null || backup.serverId == serverId;
    }).toList()
      ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

    return RefreshIndicator(
      onRefresh: () async => network.refreshManagement(),
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _Header(
            title: serverId == null ? 'Network backups' : 'Backups',
            available: network.managementAvailable,
            onBackup: network.managementAvailable
                ? () => _createBackup(context, network, model)
                : null,
          ),
          const SizedBox(height: 16),
          if (!network.managementAvailable)
            const _InfoCard(
              icon: Icons.cloud_off_outlined,
              title: 'Management backend not available',
              message:
                  'RC4 backup controls appear when the Network/Lobby bridge advertises management support.',
            ),
          if (snapshot.storages.isNotEmpty) ...[
            Text('Storage', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            ...snapshot.storages.map((storage) => _StorageCard(
                  storage: storage,
                  backups: snapshot.backups,
                  storageCount: snapshot.storages.length,
                )),
            const SizedBox(height: 12),
          ],
          if (serverId == null && backups.isNotEmpty) ...[
            _BackupFootprintCard(backups: backups),
            const SizedBox(height: 12),
          ],
          Row(
            children: [
              Expanded(
                child: Text(
                  'Backups',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              Text('${backups.length}'),
            ],
          ),
          const SizedBox(height: 8),
          if (backups.isEmpty)
            const _InfoCard(
              icon: Icons.inventory_2_outlined,
              title: 'No backups yet',
              message: 'Manual, scheduled and maintenance backups will appear here.',
            )
          else
            ...backups.map(
              (backup) => _BackupCard(
                backup: backup,
                onRestore: backup.status == BackupStatus.completed &&
                        backup.capabilities.restore
                    ? () => _restore(context, network, backup)
                    : null,
                onDownload: backup.capabilities.download
                    ? () => _send(
                          network.downloadBackup(backup.id),
                          'Download request could not be sent.',
                        )
                    : null,
                onVerify: backup.capabilities.verify
                    ? () => _send(
                          network.verifyBackup(backup.id),
                          'Verification could not be started.',
                        )
                    : null,
                onCopy: backup.capabilities.copy
                    ? () => _send(
                          network.copyBackup(backup.id),
                          'Copy request could not be sent.',
                        )
                    : null,
                onDelete: backup.capabilities.delete
                    ? () => _delete(context, network, backup)
                    : null,
              ),
            ),
        ],
      ),
    );
  }
  Future<void> _createBackup(
    BuildContext context,
    NetworkController network,
    Model model,
  ) async {
    String selectedServer = serverId ?? model.selectedServerId;
    BackupEngineType engine = BackupEngineType.multicraft;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Create backup'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (serverId == null)
                DropdownButtonFormField<String>(
                  initialValue: selectedServer,
                  decoration: const InputDecoration(labelText: 'Server'),
                  items: model.servers
                      .where((server) => server.isComplete)
                      .map(
                        (server) => DropdownMenuItem(
                          value: server.id,
                          child: Text(server.alias),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) setState(() => selectedServer = value);
                  },
                ),
              if (serverId == null) const SizedBox(height: 12),
              DropdownButtonFormField<BackupEngineType>(
                initialValue: engine,
                decoration: const InputDecoration(labelText: 'Backup engine'),
                items: BackupEngineType.values
                    .map(
                      (value) => DropdownMenuItem(
                        value: value,
                        child: Text(value.label),
                      ),
                    )
                    .toList(),
                onChanged: (value) {
                  if (value != null) setState(() => engine = value);
                },
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            FilledButton.icon(
              onPressed: () => Navigator.pop(context, true),
              icon: const Icon(Icons.backup_outlined),
              label: const Text('Backup now'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || !context.mounted) return;
    if (!network.createBackup(selectedServer, engine: engine.name)) {
      ToastUtils.showToastError('The management bridge is not connected.');
    }
  }

  Future<void> _restore(
    BuildContext context,
    NetworkController network,
    BackupRecord backup,
  ) async {
    final confirmed = await DialogUtils.confirmAction(
      context,
      title: 'Restore ${backup.serverName}?',
      message:
          'This replaces server data with the selected backup. A pre-restore safety backup is created when supported.',
      confirmLabel: 'Restore',
    );
    if (confirmed && !network.restoreBackup(backup.id)) {
      ToastUtils.showToastError('Restore could not be sent to the management backend.');
    }
  }

  void _send(bool sent, String failureMessage) {
    if (!sent) ToastUtils.showToastError(failureMessage);
  }

  Future<void> _delete(
    BuildContext context,
    NetworkController network,
    BackupRecord backup,
  ) async {
    final confirmed = await DialogUtils.confirmAction(
      context,
      title: 'Delete backup?',
      message: 'This removes this backup from all destinations managed by AdminCraft.',
      confirmLabel: 'Delete',
    );
    if (confirmed && !network.deleteBackup(backup.id)) {
      ToastUtils.showToastError('Delete could not be sent to the management backend.');
    }
  }
}

class _Header extends StatelessWidget {
  final String title;
  final bool available;
  final VoidCallback? onBackup;

  const _Header({
    required this.title,
    required this.available,
    required this.onBackup,
  });

  @override
  Widget build(BuildContext context) => Row(
        children: [
          Expanded(
            child: Text(title, style: Theme.of(context).textTheme.headlineMedium),
          ),
          FilledButton.icon(
            onPressed: available ? onBackup : null,
            icon: const Icon(Icons.add),
            label: const Text('Create backup'),
          ),
        ],
      );
}

class _InfoCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;

  const _InfoCard({
    required this.icon,
    required this.title,
    required this.message,
  });

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: ListTile(
          leading: Icon(icon),
          title: Text(title),
          subtitle: Text(message),
        ),
      );
}

class _StorageCard extends StatelessWidget {
  final BackupStorageSnapshot storage;
  final List<BackupRecord> backups;
  final int storageCount;

  const _StorageCard({
    required this.storage,
    required this.backups,
    required this.storageCount,
  });

  @override
  Widget build(BuildContext context) {
    final used = storage.usedBytes;
    final fraction = storage.usedFraction;
    final recentBytes = _recentBackupBytes(storage, backups, storageCount);
    final weeksRemaining = recentBytes > 0 && storage.freeBytes != null
        ? storage.freeBytes! / recentBytes
        : null;
    final color = storage.critical
        ? Theme.of(context).colorScheme.error
        : storage.warning
            ? Colors.orange
            : Theme.of(context).colorScheme.primary;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.storage_outlined),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    storage.name,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                Text(storage.type.name.toUpperCase()),
              ],
            ),
            const SizedBox(height: 12),
            if (fraction != null)
              LinearProgressIndicator(
                value: fraction.clamp(0, 1).toDouble(),
                color: color,
              ),
            const SizedBox(height: 8),
            Text(
              used == null || storage.totalBytes == null
                  ? '${_formatBytes(storage.backupBytes)} in backups'
                  : '${_formatBytes(used)} used of '
                      '${_formatBytes(storage.totalBytes!)} · '
                      '${_formatBytes(storage.freeBytes ?? 0)} free',
            ),
            if (storage.otherBytes != null)
              Text(
                '${_formatBytes(storage.backupBytes)} backups · '
                '${_formatBytes(storage.otherBytes!)} other data',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            if (storage.softLimitBytes != null) ...[
              const SizedBox(height: 6),
              Text(
                'Backup soft limit: ${_formatBytes(storage.softLimitBytes!)}'
                '${storage.backupBytes >= storage.softLimitBytes! ? ' · reached' : ''}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (recentBytes > 0) ...[
              const SizedBox(height: 6),
              Text(
                '${_formatBytes(recentBytes)} of completed backups created in the last 7 days',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (weeksRemaining != null)
                Text(
                  _weeksRemainingLabel(weeksRemaining),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
            ],
            if (storage.critical || storage.warning ||
                (storage.softLimitBytes != null &&
                    storage.backupBytes >= storage.softLimitBytes!)) ...[
              const SizedBox(height: 10),
              DecoratedBox(
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Text(
                    storage.critical
                        ? 'Critical: storage is below the configured free-space threshold.'
                        : storage.warning
                            ? 'Warning: storage is approaching the configured free-space threshold.'
                            : 'Warning: backup storage has reached its configured soft limit.',
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _BackupFootprintCard extends StatelessWidget {
  final List<BackupRecord> backups;

  const _BackupFootprintCard({required this.backups});

  @override
  Widget build(BuildContext context) {
    final totals = <String, int>{};
    for (final backup in backups) {
      if (backup.status != BackupStatus.completed) continue;
      totals.update(
        backup.serverName,
        (value) => value + backup.sizeBytes,
        ifAbsent: () => backup.sizeBytes,
      );
    }
    final rows = totals.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    if (rows.isEmpty) return const SizedBox.shrink();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Backup footprint by server',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final row in rows)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  children: [
                    Expanded(child: Text(row.key)),
                    Text(_formatBytes(row.value)),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _BackupCard extends StatelessWidget {
  final BackupRecord backup;
  final VoidCallback? onRestore;
  final VoidCallback? onDownload;
  final VoidCallback? onVerify;
  final VoidCallback? onCopy;
  final VoidCallback? onDelete;

  const _BackupCard({
    required this.backup,
    required this.onRestore,
    required this.onDownload,
    required this.onVerify,
    required this.onCopy,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final statusColor = switch (backup.status) {

      BackupStatus.completed => Colors.green,
      BackupStatus.failed => Theme.of(context).colorScheme.error,
      BackupStatus.running || BackupStatus.verifying => Colors.orange,
      BackupStatus.queued || BackupStatus.unknown =>
        Theme.of(context).colorScheme.outline,
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.inventory_2_outlined, color: statusColor),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        backup.serverName,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      Text(_formatDateTime(backup.createdAt)),
                    ],
                  ),
                ),

                Chip(
                  avatar: Icon(Icons.circle, size: 10, color: statusColor),
                  label: Text(backup.status.name),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _DetailChip(
                  icon: Icons.memory_outlined,
                  label: backup.engine.label,
                ),
                _DetailChip(
                  icon: Icons.category_outlined,
                  label: backup.kind,
                ),
                _DetailChip(
                  icon: Icons.data_usage_outlined,
                  label: _formatBytes(backup.sizeBytes),
                ),
                _DetailChip(
                  icon: backup.verified
                      ? Icons.verified_outlined
                      : Icons.help_outline,
                  label: backup.verified ? 'Verified' : 'Not verified',
                ),
              ],
            ),

            if (backup.destinations.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(
                'Destinations: ${backup.destinations.join(', ')}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (backup.message?.isNotEmpty == true) ...[
              const SizedBox(height: 6),
              Text(
                backup.message!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (backup.capabilities.hasRecordActions) ...[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: PopupMenuButton<String>(
                  tooltip: 'Backup actions',
                  onSelected: (value) {
                    if (value == 'restore') onRestore?.call();
                    if (value == 'download') onDownload?.call();
                    if (value == 'verify') onVerify?.call();
                    if (value == 'copy') onCopy?.call();
                    if (value == 'delete') onDelete?.call();
                  },
                  itemBuilder: (context) => [
                    if (onRestore != null)
                      _actionItem('restore', Icons.restore, 'Restore'),
                    if (onDownload != null)
                      _actionItem('download', Icons.download_outlined, 'Download'),
                    if (onVerify != null)
                      _actionItem('verify', Icons.verified_outlined, 'Verify'),
                    if (onCopy != null)
                      _actionItem('copy', Icons.copy_outlined, 'Copy'),
                    if (onDelete != null)
                      _actionItem('delete', Icons.delete_outline, 'Delete'),
                  ],
                  child: const Chip(
                    avatar: Icon(Icons.more_horiz, size: 18),
                    label: Text('Actions'),
                  ),
                ),
              ),
            ],

          ],
        ),
      ),
    );
  }
}

PopupMenuItem<String> _actionItem(
  String value,
  IconData icon,
  String label,
) =>
    PopupMenuItem(
      value: value,
      child: ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(icon),
        title: Text(label),
      ),
    );

class _DetailChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _DetailChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) => Chip(
        avatar: Icon(icon, size: 16),
        label: Text(label),
        visualDensity: VisualDensity.compact,
      );
}

int _recentBackupBytes(
  BackupStorageSnapshot storage,
  List<BackupRecord> backups,
  int storageCount,
) {
  final cutoff = DateTime.now().subtract(const Duration(days: 7));
  var total = 0;
  for (final backup in backups) {
    if (backup.status != BackupStatus.completed || backup.createdAt.isBefore(cutoff)) {
      continue;
    }
    final destinations = backup.destinations
        .map((value) => value.trim().toLowerCase())
        .where((value) => value.isNotEmpty)
        .toSet();
    final storageId = storage.id.trim().toLowerCase();
    final storageName = storage.name.trim().toLowerCase();
    final matched = destinations.contains(storageId) || destinations.contains(storageName);
    final implicitSingleStorage = storageCount == 1 && destinations.isEmpty;
    if (matched || implicitSingleStorage) total += backup.sizeBytes;
  }
  return total;
}

String _weeksRemainingLabel(double weeks) {
  if (!weeks.isFinite) return 'Capacity forecast unavailable';
  if (weeks < 1) return 'Estimated capacity: less than 1 week at the current backup creation pace';
  if (weeks < 10) {
    return 'Estimated capacity: ${weeks.toStringAsFixed(1)} weeks at the current backup creation pace';
  }
  return 'Estimated capacity: ${weeks.round()} weeks at the current backup creation pace';
}

String _formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  var value = bytes / 1024;
  var unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  final digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return '${value.toStringAsFixed(digits)} ${units[unit]}';
}

String _formatDateTime(DateTime value) {
  String two(int number) => number.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}';
}
