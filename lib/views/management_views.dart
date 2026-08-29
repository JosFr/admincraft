import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/models/management_state.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

class NetworkActivityView extends StatelessWidget {
  const NetworkActivityView({super.key});

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) return const _ManagementUnavailable();
    final entries = network.management.activity;
    return _ManagementList(
      title: 'Network activity',
      count: entries.length,
      onRefresh: network.refreshManagement,
      emptyIcon: Icons.history_outlined,
      emptyTitle: 'No activity yet',
      emptyMessage: 'Management jobs and technical audit events appear here.',
      children: [
        for (final entry in entries)
          Card(
            child: ListTile(
              leading: Icon(
                entry.error ? Icons.error_outline : Icons.history_outlined,
                color: entry.error ? Theme.of(context).colorScheme.error : null,
              ),
              title: Text(entry.title),
              subtitle: Text(
                '${entry.serverName} · ${entry.detail}\n'
                '${_formatDateTime(entry.at)}',
              ),
              isThreeLine: true,
            ),
          ),
      ],
    );
  }
}

class SchedulesView extends StatelessWidget {
  final String? serverId;

  const SchedulesView({super.key, this.serverId});

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) return const _ManagementUnavailable();
    final schedules = network.management.schedules
        .where((schedule) => serverId == null || schedule.serverId == serverId)
        .toList();
    return _ManagementList(
      title: serverId == null ? 'Scheduled actions' : 'Server schedules',
      count: schedules.length,
      onRefresh: network.refreshManagement,
      emptyIcon: Icons.schedule_outlined,
      emptyTitle: 'No schedules',
      emptyMessage: 'Persistent start, stop, restart, backup and maintenance jobs appear here.',
      children: [
        for (final schedule in schedules)
          Card(
            child: SwitchListTile(
              value: schedule.enabled,
              onChanged: network.managementAvailable
                  ? (enabled) => network.toggleSchedule(schedule.id, enabled)
                  : null,
              secondary: Icon(_scheduleIcon(schedule.action)),
              title: Text('${schedule.serverName} · ${schedule.action.name}'),
              subtitle: Text(
                '${schedule.schedule}'
                '${schedule.nextRun == null ? '' : '\nNext: ${_formatDateTime(schedule.nextRun!)}'}',
              ),
            ),
          ),
      ],
    );
  }
}

class UpdatesView extends StatelessWidget {
  final String? serverId;

  const UpdatesView({super.key, this.serverId});

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) return const _ManagementUnavailable();
    final updates = network.management.updates
        .where((update) => serverId == null || update.serverId == serverId)
        .toList();
    return _ManagementList(
      title: serverId == null ? 'Network updates' : 'Plugin updates',
      count: updates.length,
      onRefresh: network.refreshManagement,
      action: FilledButton.icon(
        onPressed: network.managementAvailable
            ? () => network.checkUpdates(serverId)
            : null,
        icon: const Icon(Icons.refresh),
        label: const Text('Check now'),
      ),
      emptyIcon: Icons.system_update_alt_outlined,
      emptyTitle: 'No update results',
      emptyMessage: 'Enabled providers will report plugin and platform updates here.',
      children: [
        for (final update in updates)
          Card(
            child: ListTile(
              leading: Icon(_updateIcon(update.status)),
              title: Text(update.plugin),
              subtitle: Text(
                '${update.serverName} · ${update.currentVersion}'
                '${update.latestVersion == null ? '' : ' → ${update.latestVersion}'}',
              ),
              trailing: Chip(label: Text(update.status.name)),
            ),
          ),
      ],
    );
  }
}

class MaintenanceView extends StatelessWidget {
  final String serverId;
  const MaintenanceView({super.key, required this.serverId});

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) return const _ManagementUnavailable();
    MaintenanceState? state;
    for (final item in network.management.maintenance) {
      if (item.serverId == serverId) {
        state = item;
        break;
      }
    }
    final active = state?.active == true;
    return _ManagementList(
      title: 'Maintenance',
      count: active ? 1 : 0,
      onRefresh: network.refreshManagement,
      action: FilledButton.icon(
        onPressed: !network.managementAvailable
            ? null
            : active
                ? () => network.cancelMaintenance(serverId)
                : () => network.startMaintenance(serverId),
        icon: Icon(active ? Icons.cancel_outlined : Icons.play_arrow),
        label: Text(active ? 'Cancel' : 'Start'),
      ),
      emptyIcon: Icons.build_circle_outlined,
      emptyTitle: 'No maintenance running',
      emptyMessage: 'Start the default countdown, backup and restart flow when the bridge supports it.',
      children: active
          ? [
              Card(
                child: ListTile(
                  leading: const Icon(Icons.build_circle_outlined),
                  title: Text(state!.serverName),
                  subtitle: Text(
                    '${state.stage}${state.message.isEmpty ? '' : '\n${state.message}'}'
                    '${state.endsAt == null ? '' : '\nEnds: ${_formatDateTime(state.endsAt!)}'}',
                  ),
                ),
              ),
            ]
          : const [],
    );
  }
}

class PerformanceHistoryView extends StatefulWidget {
  final String serverId;
  const PerformanceHistoryView({super.key, required this.serverId});

  @override
  State<PerformanceHistoryView> createState() => _PerformanceHistoryViewState();
}

class _PerformanceHistoryViewState extends State<PerformanceHistoryView> {
  String range = '1h';

  void _request(NetworkController network, String next) {
    setState(() => range = next);
    network.requestPerformance(widget.serverId, next);
  }

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) return const _ManagementUnavailable();
    final samples = network.performance
        .where((sample) => sample.serverId == widget.serverId)
        .toList()
      ..sort((a, b) => a.at.compareTo(b.at));
    final latest = samples.isEmpty ? null : samples.last;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Performance history',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
            ),
            IconButton(
              tooltip: 'Refresh performance',
              onPressed: network.managementAvailable
                  ? () => network.requestPerformance(widget.serverId, range)
                  : null,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final option in const ['1h', '6h', '24h', '7d', '30d'])
              ChoiceChip(
                label: Text(option),
                selected: range == option,
                onSelected: (_) => _request(network, option),
              ),
          ],
        ),
        const SizedBox(height: 16),
        if (latest != null)
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _MetricCard(label: 'TPS', value: latest.tps?.toStringAsFixed(1) ?? '—'),
              _MetricCard(label: 'MSPT', value: latest.mspt?.toStringAsFixed(1) ?? '—'),
              _MetricCard(label: 'Players', value: latest.players?.toString() ?? '—'),
              _MetricCard(
                label: 'CPU',
                value: latest.cpuPercent == null
                    ? '—'
                    : '${latest.cpuPercent!.toStringAsFixed(0)}%',
              ),
              _MetricCard(
                label: 'RAM',
                value: latest.memoryMb == null
                    ? '—'
                    : '${latest.memoryMb!.toStringAsFixed(0)} MB',
              ),
            ],
          ),
        const SizedBox(height: 16),
        if (samples.isEmpty)
          const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('No performance samples for this range yet.'),
            ),
          )
        else
          Card(
            child: Column(
              children: [
                for (final sample in samples.reversed.take(30))
                  ListTile(
                    dense: true,
                    title: Text(_formatDateTime(sample.at)),
                    subtitle: Text(
                      'TPS ${sample.tps?.toStringAsFixed(1) ?? '—'} · '
                      'MSPT ${sample.mspt?.toStringAsFixed(1) ?? '—'} · '
                      'Players ${sample.players ?? '—'}',
                    ),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String label;
  final String value;
  const _MetricCard({required this.label, required this.value});

  @override
  Widget build(BuildContext context) => SizedBox(
        width: 150,
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 4),
                Text(value, style: Theme.of(context).textTheme.headlineSmall),
              ],
            ),
          ),
        ),
      );
}

class ServerToolsView extends StatelessWidget {
  final VoidCallback onBackups;
  final VoidCallback onSchedules;
  final VoidCallback onMaintenance;
  final VoidCallback onPerformance;
  final VoidCallback onPlugins;
  final VoidCallback onDiagnostics;
  final VoidCallback onConfiguration;

  const ServerToolsView({
    super.key,
    required this.onBackups,
    required this.onSchedules,
    required this.onMaintenance,
    required this.onPerformance,
    required this.onPlugins,
    required this.onDiagnostics,
    required this.onConfiguration,
  });

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Server tools', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 12),
          _ToolTile(
            icon: Icons.inventory_2_outlined,
            title: 'Backups',
            subtitle: 'Browse, create, verify and restore server backups.',
            onTap: onBackups,
          ),
          _ToolTile(
            icon: Icons.schedule_outlined,
            title: 'Schedules',
            subtitle: 'Persistent actions that run without an open app.',
            onTap: onSchedules,
          ),
          _ToolTile(
            icon: Icons.build_circle_outlined,
            title: 'Maintenance',
            subtitle: 'Countdown, backup, restart and health-check flows.',
            onTap: onMaintenance,
          ),
          _ToolTile(
            icon: Icons.query_stats_outlined,
            title: 'Performance history',
            subtitle: 'TPS, MSPT, players, CPU and memory over time.',
            onTap: onPerformance,
          ),
          _ToolTile(
            icon: Icons.extension_outlined,
            title: 'Plugins & updates',
            subtitle: 'Provider matching and available versions.',
            onTap: onPlugins,
          ),
          _ToolTile(
            icon: Icons.health_and_safety_outlined,
            title: 'Diagnostics',
            subtitle: 'Connection, bridge and server health information.',
            onTap: onDiagnostics,
          ),
          _ToolTile(
            icon: Icons.tune_outlined,
            title: 'Server configuration',
            subtitle: 'Connection details and server-specific settings.',
            onTap: onConfiguration,
          ),
        ],
      );
}

class ManagementPlaceholderView extends StatelessWidget {
  final String title;
  final IconData icon;
  final String message;

  const ManagementPlaceholderView({
    super.key,
    required this.title,
    required this.icon,
    required this.message,
  });

  @override
  Widget build(BuildContext context) => Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Card(
            margin: const EdgeInsets.all(24),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 42),
                  const SizedBox(height: 12),
                  Text(title, style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 8),
                  Text(message, textAlign: TextAlign.center),
                ],
              ),
            ),
          ),
        ),
      );
}

class _ManagementUnavailable extends StatelessWidget {
  const _ManagementUnavailable();

  @override
  Widget build(BuildContext context) => const ManagementPlaceholderView(
        title: 'Management unavailable',
        icon: Icons.cloud_off_outlined,
        message: 'Connect a Network/Lobby bridge with RC4 management support.',
      );
}

class _ManagementList extends StatelessWidget {
  final String title;
  final int count;
  final bool Function() onRefresh;
  final Widget? action;
  final IconData emptyIcon;
  final String emptyTitle;
  final String emptyMessage;
  final List<Widget> children;
  const _ManagementList({
    required this.title,
    required this.count,
    required this.onRefresh,
    this.action,
    required this.emptyIcon,
    required this.emptyTitle,
    required this.emptyMessage,
    required this.children,
  });

  @override
  Widget build(BuildContext context) => RefreshIndicator(
        onRefresh: () async => onRefresh(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                ),
                if (action != null) action!,
                const SizedBox(width: 8),
                Chip(label: Text('$count')),
              ],
            ),
            const SizedBox(height: 12),
            if (children.isEmpty)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    children: [
                      Icon(emptyIcon, size: 36),
                      const SizedBox(height: 10),
                      Text(emptyTitle, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 4),
                      Text(emptyMessage, textAlign: TextAlign.center),
                    ],
                  ),
                ),
              )
            else
              ...children,
          ],
        ),
      );
}

class _ToolTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _ToolTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 10),
        child: ListTile(
          leading: Icon(icon),
          title: Text(title),
          subtitle: Text(subtitle),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
      );
}

IconData _scheduleIcon(ScheduledActionType action) => switch (action) {
      ScheduledActionType.start => Icons.play_arrow,
      ScheduledActionType.stop => Icons.stop,
      ScheduledActionType.restart => Icons.restart_alt,
      ScheduledActionType.backup => Icons.inventory_2_outlined,
      ScheduledActionType.maintenance => Icons.build_circle_outlined,
    };

IconData _updateIcon(PluginUpdateStatus status) => switch (status) {
      PluginUpdateStatus.current => Icons.check_circle_outline,
      PluginUpdateStatus.updateAvailable => Icons.system_update_alt,
      PluginUpdateStatus.unmanaged => Icons.help_outline,
      PluginUpdateStatus.sourceUnavailable => Icons.cloud_off_outlined,
      PluginUpdateStatus.checking => Icons.hourglass_top,
    };

String _formatDateTime(DateTime value) {
  String two(int number) => number.toString().padLeft(2, '0');
  return '${value.year}-${two(value.month)}-${two(value.day)} '
      '${two(value.hour)}:${two(value.minute)}';
}
