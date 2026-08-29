import 'package:admincraft/controllers/connection_controller.dart';
import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/models/management_state.dart';
import 'package:admincraft/utils/url_utils.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

class NetworkActivityView extends StatelessWidget {
  const NetworkActivityView({super.key});

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) return const _ManagementUnavailable();
    final entries = [...network.management.activity]
      ..sort((a, b) => b.at.compareTo(a.at));
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

  Future<void> _createSchedule(
    BuildContext context,
    NetworkController network,
  ) async {
    final model = context.read<Model>();
    final completeServers = model.servers
        .where((server) => server.isComplete)
        .toList();
    var selectedServer =
        serverId ?? model.selectedServer.effectiveManagementServerId;
    if (serverId == null &&
        !completeServers.any(
          (server) => server.effectiveManagementServerId == selectedServer,
        )) {
      selectedServer = completeServers.isEmpty
          ? ''
          : completeServers.first.effectiveManagementServerId;
    }
    final scheduleController = TextEditingController();
    var action = ScheduledActionType.restart;
    var recurring = true;
    var preset = 'custom';
    var runAt = DateTime.now().add(const Duration(hours: 1));

    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Create scheduled action'),
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (serverId == null)
                  DropdownButtonFormField<String>(
                    initialValue: selectedServer.isEmpty
                        ? null
                        : selectedServer,
                    decoration: const InputDecoration(labelText: 'Server'),
                    items: completeServers
                        .map(
                          (server) => DropdownMenuItem(
                            value: server.effectiveManagementServerId,
                            child: Text(server.alias),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) setState(() => selectedServer = value);
                    },
                  ),
                if (serverId == null) const SizedBox(height: 12),
                DropdownButtonFormField<ScheduledActionType>(
                  initialValue: action,
                  decoration: const InputDecoration(labelText: 'Action'),
                  items: [
                    for (final value in ScheduledActionType.values)
                      DropdownMenuItem(
                        value: value,
                        child: Text(_scheduleActionLabel(value)),
                      ),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => action = value);
                  },
                ),
                const SizedBox(height: 12),
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(
                      value: true,
                      label: Text('Recurring'),
                      icon: Icon(Icons.repeat),
                    ),
                    ButtonSegment(
                      value: false,
                      label: Text('One-time'),
                      icon: Icon(Icons.event_outlined),
                    ),
                  ],
                  selected: {recurring},
                  onSelectionChanged: (value) =>
                      setState(() => recurring = value.first),
                ),
                const SizedBox(height: 12),
                if (recurring) ...[
                  DropdownButtonFormField<String>(
                    initialValue: preset,
                    decoration: const InputDecoration(labelText: 'Cron preset'),
                    items: const [
                      DropdownMenuItem(value: 'custom', child: Text('Custom')),
                      DropdownMenuItem(
                        value: 'daily4',
                        child: Text('Daily at 04:00'),
                      ),
                      DropdownMenuItem(
                        value: 'weekly4',
                        child: Text('Sunday at 04:00'),
                      ),
                      DropdownMenuItem(
                        value: 'sixhour',
                        child: Text('Every 6 hours'),
                      ),
                    ],
                    onChanged: (value) {
                      if (value == null) return;
                      setState(() {
                        preset = value;
                        scheduleController.text = switch (value) {
                          'daily4' => '0 4 * * *',
                          'weekly4' => '0 4 * * 0',
                          'sixhour' => '0 */6 * * *',
                          _ => scheduleController.text,
                        };
                      });
                    },
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: scheduleController,
                    decoration: const InputDecoration(
                      labelText: 'Schedule expression',
                      hintText: '0 4 * * *',
                      helperText: 'Cron uses the bridge/server timezone.',
                    ),
                    onChanged: (_) {
                      if (preset != 'custom') setState(() => preset = 'custom');
                    },
                  ),
                ] else ...[
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.event_outlined),
                    title: const Text('Run once at'),
                    subtitle: Text(_formatDateTime(runAt)),
                    trailing: const Icon(Icons.edit_calendar_outlined),
                    onTap: () async {
                      final date = await showDatePicker(
                        context: context,
                        initialDate: runAt,
                        firstDate: DateTime.now(),
                        lastDate: DateTime.now().add(const Duration(days: 366)),
                      );
                      if (date == null || !context.mounted) return;
                      final time = await showTimePicker(
                        context: context,
                        initialTime: TimeOfDay.fromDateTime(runAt),
                      );
                      if (time == null) return;
                      setState(
                        () => runAt = DateTime(
                          date.year,
                          date.month,
                          date.day,
                          time.hour,
                          time.minute,
                        ),
                      );
                    },
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                if (selectedServer.isEmpty) return;
                if (recurring && scheduleController.text.trim().isEmpty) return;
                if (!recurring && !runAt.isAfter(DateTime.now())) return;
                Navigator.pop(dialogContext, true);
              },
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );
    if (created == true) {
      network.createSchedule(
        serverId: selectedServer,
        action: action.name,
        schedule: recurring ? scheduleController.text.trim() : '',
        runAt: recurring ? null : runAt,
      );
    }
    scheduleController.dispose();
  }

  Future<void> _deleteSchedule(
    BuildContext context,
    NetworkController network,
    ScheduledAction schedule,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Delete schedule?'),
        content: Text(
          '${schedule.serverName} · ${_scheduleActionLabel(schedule.action)}\n'
          '${schedule.recurring ? schedule.schedule : 'Once: ${schedule.runAt == null ? 'unknown time' : _formatDateTime(schedule.runAt!)}'}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) network.deleteSchedule(schedule.id);
  }

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) return const _ManagementUnavailable();
    final schedules =
        network.management.schedules
            .where(
              (schedule) => serverId == null || schedule.serverId == serverId,
            )
            .toList()
          ..sort((a, b) {
            if (a.enabled != b.enabled) return a.enabled ? -1 : 1;
            if (a.nextRun == null && b.nextRun != null) return 1;
            if (a.nextRun != null && b.nextRun == null) return -1;
            if (a.nextRun != null && b.nextRun != null) {
              return a.nextRun!.compareTo(b.nextRun!);
            }
            return a.serverName.compareTo(b.serverName);
          });
    final jobs =
        network.management.jobHistory
            .where((job) => serverId == null || job.serverId == serverId)
            .toList()
          ..sort((a, b) => b.startedAt.compareTo(a.startedAt));
    return _ManagementList(
      title: serverId == null ? 'Scheduled actions' : 'Server schedules',
      count: schedules.length,
      onRefresh: network.refreshManagement,
      action: FilledButton.icon(
        onPressed: network.managementAvailable
            ? () => _createSchedule(context, network)
            : null,
        icon: const Icon(Icons.add),
        label: const Text('New schedule'),
      ),
      emptyIcon: Icons.schedule_outlined,
      emptyTitle: 'No schedules',
      emptyMessage:
          'Persistent start, stop, restart, backup and maintenance jobs appear here.',
      children: [
        for (final schedule in schedules)
          Card(
            child: ListTile(
              leading: Icon(_scheduleIcon(schedule.action)),
              title: Text(
                '${schedule.serverName} · ${_scheduleActionLabel(schedule.action)}',
              ),
              subtitle: Text(
                '${schedule.recurring ? schedule.schedule : 'One-time'}'
                '${schedule.nextRun == null ? '' : '\nNext: ${_formatDateTime(schedule.nextRun!)}'}'
                '${schedule.lastResult == null || schedule.lastResult!.trim().isEmpty ? '' : '\nLast: ${schedule.lastResult}'}',
              ),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Switch(
                    value: schedule.enabled,
                    onChanged: network.managementAvailable
                        ? (enabled) =>
                              network.toggleSchedule(schedule.id, enabled)
                        : null,
                  ),
                  IconButton(
                    tooltip: 'Delete schedule',
                    onPressed: network.managementAvailable
                        ? () => _deleteSchedule(context, network, schedule)
                        : null,
                    icon: const Icon(Icons.delete_outline),
                  ),
                ],
              ),
            ),
          ),
        if (jobs.isNotEmpty) ...[
          const SizedBox(height: 18),
          Text('Job history', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          for (final job in jobs.take(50))
            Card(
              child: ListTile(
                leading: Icon(
                  job.success == true
                      ? Icons.check_circle_outline
                      : job.success == false
                      ? Icons.error_outline
                      : Icons.hourglass_top,
                ),
                title: Text(
                  '${job.serverName} · ${_scheduleActionLabel(job.action)}',
                ),
                subtitle: Text(
                  '${_formatDateTime(job.startedAt)} · ${job.source}\n${job.message}',
                ),
              ),
            ),
        ],
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
    final updates =
        network.management.updates
            .where((update) => serverId == null || update.serverId == serverId)
            .toList()
          ..sort(
            (a, b) =>
                _updatePriority(a.status).compareTo(_updatePriority(b.status)),
          );
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
      emptyMessage:
          'Enabled providers will report plugin and platform updates here.',
      children: [
        for (final update in updates)
          Card(
            child: ListTile(
              leading: Icon(_updateIcon(update.status)),
              title: Text(update.plugin),
              subtitle: Text(
                '${update.serverName} · ${update.currentVersion}'
                '${update.latestVersion == null ? '' : ' → ${update.latestVersion}'}'
                '\n${_updateSourceLabel(update)} · ${_updateStatusLabel(update.status)}',
              ),
              trailing: update.url == null || update.url!.trim().isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Open update source',
                      onPressed: () async {
                        await UrlUtils.openUrl(update.url!);
                      },
                      icon: const Icon(Icons.open_in_new),
                    ),
            ),
          ),
      ],
    );
  }
}

class MaintenanceView extends StatelessWidget {
  final String serverId;
  const MaintenanceView({super.key, required this.serverId});

  Future<void> _startMaintenance(
    BuildContext context,
    NetworkController network,
  ) async {
    var countdownSeconds = 600;
    var createBackup = true;
    var restartWhenEmpty = false;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: const Text('Start maintenance'),
          content: SizedBox(
            width: 430,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<int>(
                  initialValue: countdownSeconds,
                  decoration: const InputDecoration(labelText: 'Countdown'),
                  items: const [
                    DropdownMenuItem(value: 60, child: Text('1 minute')),
                    DropdownMenuItem(value: 300, child: Text('5 minutes')),
                    DropdownMenuItem(value: 600, child: Text('10 minutes')),
                    DropdownMenuItem(value: 1800, child: Text('30 minutes')),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setState(() => countdownSeconds = value);
                    }
                  },
                ),
                const SizedBox(height: 8),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Create safety backup'),
                  subtitle: const Text(
                    'Request a backup before the maintenance action continues.',
                  ),
                  value: createBackup,
                  onChanged: (value) => setState(() => createBackup = value),
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Restart when empty'),
                  subtitle: const Text(
                    'Wait for players to leave before the restart stage.',
                  ),
                  value: restartWhenEmpty,
                  onChanged: (value) =>
                      setState(() => restartWhenEmpty = value),
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
              icon: const Icon(Icons.play_arrow),
              label: const Text('Start maintenance'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true) return;
    network.startMaintenance(
      serverId,
      countdownSeconds: countdownSeconds,
      backup: createBackup,
      restartWhenEmpty: restartWhenEmpty,
    );
  }

  Future<void> _cancelMaintenance(
    BuildContext context,
    NetworkController network,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Cancel maintenance?'),
        content: const Text(
          'The active maintenance flow will be stopped. Any backup already started may still finish.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Keep running'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Cancel maintenance'),
          ),
        ],
      ),
    );
    if (confirmed == true) network.cancelMaintenance(serverId);
  }

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
            ? () => _cancelMaintenance(context, network)
            : () => _startMaintenance(context, network),
        icon: Icon(active ? Icons.cancel_outlined : Icons.play_arrow),
        label: Text(active ? 'Cancel' : 'Start'),
      ),
      emptyIcon: Icons.build_circle_outlined,
      emptyTitle: 'No maintenance running',
      emptyMessage:
          'Start a configurable countdown, optional safety backup and restart flow when the bridge supports it.',
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
  bool _requestedInitial = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_requestedInitial) return;
    final network = context.read<NetworkController?>();
    if (network == null || !network.managementAvailable) return;
    _requestedInitial = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) network.requestPerformance(widget.serverId, range);
    });
  }

  void _request(NetworkController network, String next) {
    setState(() => range = next);
    network.requestPerformance(widget.serverId, next);
  }

  double? _average(Iterable<double?> values) {
    final present = values.whereType<double>().toList();
    if (present.isEmpty) return null;
    return present.reduce((a, b) => a + b) / present.length;
  }

  int? _maximum(Iterable<int?> values) {
    final present = values.whereType<int>().toList();
    if (present.isEmpty) return null;
    return present.reduce((a, b) => a > b ? a : b);
  }

  String _healthSummary(List<PerformanceSample> samples) {
    final averageTps = _average(samples.map((sample) => sample.tps));
    final averageMspt = _average(samples.map((sample) => sample.mspt));
    if (averageTps != null && averageTps < 18) {
      return 'Sustained TPS is below 18 in this range.';
    }
    if (averageMspt != null && averageMspt > 50) {
      return 'Average MSPT is above the 50 ms tick budget.';
    }
    if (averageTps != null || averageMspt != null) {
      return 'No sustained tick-performance warning in this range.';
    }
    return 'Not enough tick data to assess this range.';
  }

  @override
  Widget build(BuildContext context) {
    final network = context.watch<NetworkController?>();
    if (network == null) return const _ManagementUnavailable();
    final samples =
        network.performance
            .where((sample) => sample.serverId == widget.serverId)
            .toList()
          ..sort((a, b) => a.at.compareTo(b.at));
    final latest = samples.isEmpty ? null : samples.last;
    final averageTps = _average(samples.map((sample) => sample.tps));
    final averageMspt = _average(samples.map((sample) => sample.mspt));
    final averageCpu = _average(samples.map((sample) => sample.cpuPercent));
    final averageMemory = _average(samples.map((sample) => sample.memoryMb));
    final peakPlayers = _maximum(samples.map((sample) => sample.players));

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
                onSelected: network.managementAvailable
                    ? (_) => _request(network, option)
                    : null,
              ),
          ],
        ),
        const SizedBox(height: 16),
        if (latest != null) ...[
          Text('Latest sample', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _MetricCard(
                label: 'TPS',
                value: latest.tps?.toStringAsFixed(1) ?? '—',
              ),
              _MetricCard(
                label: 'MSPT',
                value: latest.mspt?.toStringAsFixed(1) ?? '—',
              ),
              _MetricCard(
                label: 'Players',
                value: latest.players?.toString() ?? '—',
              ),
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
          Text('Range summary', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _MetricCard(
                label: 'Avg TPS',
                value: averageTps?.toStringAsFixed(1) ?? '—',
              ),
              _MetricCard(
                label: 'Avg MSPT',
                value: averageMspt?.toStringAsFixed(1) ?? '—',
              ),
              _MetricCard(
                label: 'Peak players',
                value: peakPlayers?.toString() ?? '—',
              ),
              _MetricCard(
                label: 'Avg CPU',
                value: averageCpu == null
                    ? '—'
                    : '${averageCpu.toStringAsFixed(0)}%',
              ),
              _MetricCard(
                label: 'Avg RAM',
                value: averageMemory == null
                    ? '—'
                    : '${averageMemory.toStringAsFixed(0)} MB',
              ),
            ],
          ),
          const SizedBox(height: 10),
          Card(
            child: ListTile(
              leading: const Icon(Icons.monitor_heart_outlined),
              title: const Text('Tick health'),
              subtitle: Text(_healthSummary(samples)),
            ),
          ),
        ],
        const SizedBox(height: 16),
        if (samples.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                network.managementAvailable
                    ? 'No performance samples were returned for this range.'
                    : 'Performance history requires management support.',
              ),
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

class DiagnosticsView extends StatelessWidget {
  const DiagnosticsView({super.key});

  @override
  Widget build(BuildContext context) {
    final model = context.watch<Model>();
    final connection = context.watch<ConnectionController>();
    final network = context.watch<NetworkController?>();
    final server = model.selectedServer;
    final failure = connection.lastFailure;
    final path = server.bridgePath.trim();
    final endpoint =
        '${server.ip}:${server.port}${path.isEmpty
            ? ''
            : path.startsWith('/')
            ? path
            : '/$path'}';
    final bridgeCapabilities =
        network == null ? <String>[] : network.capabilities.toList()
          ..sort();
    final managementObserved = network?.management.observedAt;
    final managementMessage = network?.managementMessage?.trim();
    final managementResultLabel = switch (network?.managementSuccess) {
      true => 'Success',
      false => 'Failed',
      _ => 'Result',
    };
    final managementResult =
        managementMessage == null || managementMessage.isEmpty
        ? null
        : '$managementResultLabel · $managementMessage';

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Diagnostics',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
            ),
            IconButton(
              tooltip: 'Refresh network management',
              onPressed: network?.managementAvailable == true
                  ? network!.refreshManagement
                  : null,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        const SizedBox(height: 12),
        _DiagnosticCard(
          title: 'Server profile',
          icon: Icons.dns_outlined,
          rows: {
            'Name': server.alias,
            'Endpoint': endpoint,
            'Security': server.security.name,
            'Edition': server.edition.name,
          },
        ),
        _DiagnosticCard(
          title: 'Direct connection',
          icon: Icons.cable_outlined,
          rows: {
            'Status': connection.status.name,
            'Platform compatible':
                connection.compatibilityFailure(model) == null ? 'Yes' : 'No',
            if (failure != null)
              'Last failure': '${failure.kind.name}: ${failure.message}',
          },
        ),
        _DiagnosticCard(
          title: 'Network hub',
          icon: Icons.hub_outlined,
          rows: {
            'Connected': network?.connected == true ? 'Yes' : 'No',
            if (network?.bridgeVersion != null)
              'Bridge version': network!.bridgeVersion!,
            if (network?.bridgeScope != null) 'Scope': network!.bridgeScope!,
            if (network?.bridgeConnectedAt != null)
              'Bridge connected': _formatDateTime(network!.bridgeConnectedAt!),
            'Capabilities': bridgeCapabilities.isEmpty
                ? 'None'
                : bridgeCapabilities.join(', '),
            'Network state': network?.networkAvailable == true
                ? 'Available'
                : 'Unavailable',
            'Access management': network?.accessAvailable == true
                ? 'Available'
                : 'Unavailable',
            'Management': network?.managementAvailable == true
                ? 'Available'
                : 'Unavailable',
            if (managementObserved != null)
              'Management snapshot': _formatDateTime(managementObserved),
            if (managementResult != null)
              'Last management result': managementResult,
            if (network?.error != null) 'Last hub error': network!.error!,
          },
        ),
      ],
    );
  }
}

class _DiagnosticCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final Map<String, String> rows;

  const _DiagnosticCard({
    required this.title,
    required this.icon,
    required this.rows,
  });

  @override
  Widget build(BuildContext context) => Card(
    margin: const EdgeInsets.only(bottom: 12),
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon),
              const SizedBox(width: 8),
              Text(title, style: Theme.of(context).textTheme.titleMedium),
            ],
          ),
          const SizedBox(height: 12),
          for (final row in rows.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 150,
                    child: Text(
                      row.key,
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                  Expanded(child: SelectableText(row.value)),
                ],
              ),
            ),
        ],
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
    message: 'Connect a Network/Lobby bridge with management support.',
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
                  Text(
                    emptyTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
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

String _scheduleActionLabel(ScheduledActionType action) => switch (action) {
  ScheduledActionType.start => 'Start',
  ScheduledActionType.stop => 'Stop',
  ScheduledActionType.restart => 'Restart',
  ScheduledActionType.backup => 'Backup',
  ScheduledActionType.maintenance => 'Maintenance',
};
IconData _scheduleIcon(ScheduledActionType action) => switch (action) {
  ScheduledActionType.start => Icons.play_arrow,
  ScheduledActionType.stop => Icons.stop,
  ScheduledActionType.restart => Icons.restart_alt,
  ScheduledActionType.backup => Icons.inventory_2_outlined,
  ScheduledActionType.maintenance => Icons.build_circle_outlined,
};

int _updatePriority(PluginUpdateStatus status) => switch (status) {
  PluginUpdateStatus.updateAvailable => 0,
  PluginUpdateStatus.sourceUnavailable => 1,
  PluginUpdateStatus.unmanaged => 2,
  PluginUpdateStatus.checking => 3,
  PluginUpdateStatus.current => 4,
};

String _updateStatusLabel(PluginUpdateStatus status) => switch (status) {
  PluginUpdateStatus.current => 'Current',
  PluginUpdateStatus.updateAvailable => 'Update available',
  PluginUpdateStatus.unmanaged => 'Unmanaged',
  PluginUpdateStatus.sourceUnavailable => 'Source unavailable',
  PluginUpdateStatus.checking => 'Checking',
};

String _updateSourceLabel(PluginUpdate update) {
  final provider = update.provider?.label ?? 'Unknown source';
  final projectId = update.projectId?.trim();
  return projectId == null || projectId.isEmpty
      ? provider
      : '$provider · $projectId';
}

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
