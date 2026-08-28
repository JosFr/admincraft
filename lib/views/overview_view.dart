import 'package:admincraft/controllers/connection_controller.dart';
import 'package:admincraft/models/connection_status.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/views/widgets/network_access_section.dart';
import 'package:admincraft/views/widgets/server_icon.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

class OverviewView extends StatelessWidget {
  final VoidCallback onOpenConsole;
  final VoidCallback onEditServer;

  const OverviewView({
    super.key,
    required this.onOpenConsole,
    required this.onEditServer,
  });

  @override
  Widget build(BuildContext context) {
    final model = context.watch<Model>();
    final connection = context.watch<ConnectionController>();
    final world = model.world;
    final connected = connection.status == ConnectionStatus.connected;
    final compatibilityFailure = connection.compatibilityFailure(model);

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
        if (!model.selectedServer.isComplete)
          _NoticeCard(
            icon: Icons.rocket_launch_outlined,
            title: 'Finish setting up this server',
            subtitle: 'Add its address and bridge access key before connecting.',
            actionLabel: 'Set up',
            onAction: onEditServer,
          )
        else if (compatibilityFailure != null)
          _NoticeCard(
            icon: Icons.browser_not_supported,
            title: 'Connection unavailable',
            subtitle: compatibilityFailure.message,
            actionLabel: 'Review connection',
            onAction: onEditServer,
          )
        else ...[
          _ServerHero(model: model, connected: connected),
          const SizedBox(height: 14),
          _LiveMetrics(model: model),
          const SizedBox(height: 14),
          _SectionCard(
            icon: Icons.public,
            title: 'Server & world',
            subtitle: _serverWorldSummary(model),
            children: [
              _InfoRow('Minecraft', world.minecraftVersion ?? 'Unknown'),
              _InfoRow('Server', world.serverVersion ?? 'Unknown'),
              _InfoRow('Primary world', world.worldName ?? 'Unknown'),
              if (world.worlds.isNotEmpty)
                _InfoRow('Worlds', world.worlds.join(', ')),
              _InfoRow('Seed', world.worldSeed ?? 'Unknown'),
              _InfoRow(
                'Whitelist',
                world.whitelistEnabled == null
                    ? 'Unknown'
                    : world.whitelistEnabled! ? 'Enabled' : 'Disabled',
              ),
            ],
          ),
          const SizedBox(height: 12),
          _SectionCard(
            icon: Icons.extension_outlined,
            title: 'Plugins',
            subtitle: _pluginSummary(model),
            children: [
              _InfoRow(
                'Loaded',
                world.pluginCount?.toString() ?? 'Unknown',
              ),
              if (world.pluginNames.isEmpty)
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('Plugin names have not been reported yet.'),
                )
              else
                _PluginList(
                  names: world.pluginNames,
                  disabled: world.disabledPlugins,
                ),
              const SizedBox(height: 6),
              _InfoRow(
                'Disabled',
                world.disabledPlugins.isEmpty
                    ? 'None'
                    : world.disabledPlugins.join(', '),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _SectionCard(
            icon: Icons.people_outline,
            title: 'Players',
            subtitle: _playerSummary(model),
            children: [
              if (model.onlinePlayers.isEmpty)
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('No players online.'),
                )
              else
                Align(
                  alignment: Alignment.centerLeft,
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: model.onlinePlayers
                        .map((name) => Chip(label: Text(name)))
                        .toList(),
                  ),
                ),
              const SizedBox(height: 8),
              _InfoRow(
                'Whitelisted',
                world.whitelistedPlayers.length.toString(),
              ),
              _InfoRow('Operators', world.operators.length.toString()),
            ],
          ),
          if (_isLobby(model)) ...[
            const SizedBox(height: 12),
            NetworkAccessSection(model: model, connection: connection),
          ],
          const SizedBox(height: 12),
          _DiagnosticsSection(model: model, connection: connection),
        ],
        ],
      ),
    );
  }
}
bool _isLobby(Model model) {
  final path = model.bridgePath.trim().toLowerCase();
  final alias = model.alias.trim().toLowerCase();
  return path == '/lobby' || alias == 'lobby';
}

String _memoryLabel(double? usedMb, double? limitMb) {
  if (usedMb == null) return 'Not observed';
  String format(double value) => value >= 1024
      ? '${(value / 1024).toStringAsFixed(1)} GB'
      : '${value.toStringAsFixed(0)} MB';
  if (limitMb == null || limitMb <= 0) return format(usedMb);
  return '${format(usedMb)} / ${format(limitMb)}';
}

String _serverWorldSummary(Model model) {
  final world = model.world;
  final version = world.minecraftVersion ?? 'Unknown version';
  final name = world.worldName ?? 'Unknown world';
  return '$version · $name';
}

String _pluginSummary(Model model) {
  final world = model.world;
  if (world.pluginCount == null) return 'Plugin state unknown';
  if (world.disabledPlugins.isEmpty) {
    return '${world.pluginCount} loaded · all enabled';
  }
  return '${world.pluginCount} loaded · ${world.disabledPlugins.length} disabled';
}

String _playerSummary(Model model) {
  final world = model.world;
  if (world.playersOnline == null) return '${model.onlinePlayers.length} tracked';
  return '${world.playersOnline} online';
}
class _ServerHero extends StatelessWidget {
  final Model model;
  final bool connected;

  const _ServerHero({required this.model, required this.connected});

  @override
  Widget build(BuildContext context) {
    final world = model.world;
    final runtime = model.serverRuntimeState?.trim();
    final status = runtime == null || runtime.isEmpty
        ? (connected ? 'Running' : 'Disconnected')
        : '${runtime[0].toUpperCase()}${runtime.substring(1)}';
    final statusColor = status.toLowerCase() == 'running'
        ? Colors.green
        : Theme.of(context).colorScheme.outline;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: ServerIcon(server: model.selectedServer, size: 54),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    model.alias.isEmpty ? 'Unnamed server' : model.alias,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    world.playersOnline == null
                        ? '${model.onlinePlayers.length} tracked players'
                        : '${world.playersOnline} of ${world.playerLimit} players',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 9,
                      height: 9,
                      decoration: BoxDecoration(
                        color: statusColor,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(status, style: TextStyle(color: statusColor)),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '${world.timeLabel} · ${world.clock}',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
class _LiveMetrics extends StatelessWidget {
  final Model model;

  const _LiveMetrics({required this.model});

  String _updatedLabel() {
    final updated = model.lastServerStateAt;
    if (updated == null) return 'Waiting for state';
    final age = DateTime.now().difference(updated.toLocal());
    if (age.inSeconds < 5) return 'Updated now';
    if (age.inMinutes < 1) return 'Updated ${age.inSeconds}s ago';
    return 'Updated ${age.inMinutes}m ago';
  }

  @override
  Widget build(BuildContext context) {
    final world = model.world;
    final metrics = <_MetricData>[
      _MetricData(
        Icons.people_outline,
        'Players',
        world.playersOnline == null
            ? '${model.onlinePlayers.length}'
            : '${world.playersOnline} / ${world.playerLimit}',
      ),
      _MetricData(
        Icons.monitor_heart_outlined,
        'TPS',
        world.tps1m?.toStringAsFixed(2) ?? '—',
        healthy: world.tps1m != null && world.tps1m! >= 19,
      ),
      _MetricData(
        Icons.timer_outlined,
        'MSPT',
        world.mspt == null ? '—' : '${world.mspt!.toStringAsFixed(1)} ms',
        healthy: world.mspt != null && world.mspt! < 50,
      ),
      _MetricData(
        Icons.memory_outlined,
        'CPU',
        world.cpuPercent == null ? '—' : '${world.cpuPercent!.toStringAsFixed(1)}%',
      ),
      _MetricData(
        Icons.storage_outlined,
        'Memory',
        _memoryLabel(world.memoryMb, world.memoryLimitMb),
      ),
      _MetricData(
        Icons.cloud_outlined,
        'Weather',
        world.lastWeather ?? '—',
      ),
      _MetricData(
        Icons.sports_esports_outlined,
        'Difficulty',
        world.lastDifficulty ?? '—',
      ),
      _MetricData(
        Icons.view_in_ar_outlined,
        'Chunks / Entities',
        '${world.loadedChunks ?? '—'} / ${world.entityCount ?? '—'}',
      ),
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Live metrics',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
                Text(
                  _updatedLabel(),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                const gap = 10.0;
                final columns = constraints.maxWidth >= 760 ? 4 : 2;
                final width =
                    (constraints.maxWidth - gap * (columns - 1)) / columns;
                return Wrap(
                  spacing: gap,
                  runSpacing: gap,
                  children: metrics
                      .map((metric) => _MetricTile(width: width, data: metric))
                      .toList(),
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricData {
  final IconData icon;
  final String label;
  final String value;
  final bool healthy;

  const _MetricData(
    this.icon,
    this.label,
    this.value, {
    this.healthy = false,
  });
}

class _MetricTile extends StatelessWidget {
  final double width;
  final _MetricData data;

  const _MetricTile({required this.width, required this.data});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      key: ValueKey('metric-${data.label}'),
      width: width,
      height: 82,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: theme.colorScheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: theme.colorScheme.outlineVariant),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              Icon(data.icon, size: 26),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(data.label, style: theme.textTheme.bodySmall),
                    const SizedBox(height: 2),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        data.value,
                        maxLines: 1,
                        style: theme.textTheme.titleMedium?.copyWith(
                          color: data.healthy ? Colors.green : null,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PluginList extends StatelessWidget {
  final List<String> names;
  final List<String> disabled;

  const _PluginList({required this.names, required this.disabled});

  @override
  Widget build(BuildContext context) {
    final disabledSet = disabled.map((name) => name.toLowerCase()).toSet();
    final sorted = [...names]
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return Align(
      alignment: Alignment.centerLeft,
      child: Wrap(
        spacing: 7,
        runSpacing: 7,
        children: sorted.map((name) {
          final isDisabled = disabledSet.contains(name.toLowerCase());
          return Chip(
            avatar: Icon(
              isDisabled ? Icons.pause_circle_outline : Icons.check_circle_outline,
              size: 16,
            ),
            label: Text(name),
          );
        }).toList(),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;

  const _SectionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: ExpansionTile(
        leading: Icon(icon),
        title: Text(
          title,
          style: Theme.of(context).textTheme.titleMedium,
        ),
        subtitle: Text(
          subtitle,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          const Divider(height: 1),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 115,
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
          Expanded(
            child: SelectableText(
              value,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}
class _DiagnosticsSection extends StatelessWidget {
  final Model model;
  final ConnectionController connection;

  const _DiagnosticsSection({
    required this.model,
    required this.connection,
  });

  String _time(DateTime? value) =>
      value == null ? 'Not observed' : value.toLocal().toIso8601String();

  String _diagnosticText() => [
    'Server: ${model.alias}',
    'Endpoint: ${model.ip}:${model.port}${model.bridgePath}',
    'Connection: ${connection.status.name}',
    'Security: ${model.connectionSecurity.name}',
    'Edition: ${model.minecraftEdition.name}',
    'Bridge version: ${model.bridgeVersion ?? 'Unknown'}',
    'Protocol: ${model.bridgeProtocol?.toString() ?? 'Unknown'}',
    'Permission: ${model.bridgePermission ?? 'Unknown'}',
    'Server state: ${model.serverRuntimeState ?? 'Unknown'}',
    'Last heartbeat: ${_time(model.lastHeartbeatAt)}',
    'Last state event: ${_time(model.lastServerStateAt)}',
    'Capabilities: ${model.bridgeCapabilities.join(', ')}',
    if (model.bridgeLastError != null) 'Last error: ${model.bridgeLastError}',
  ].join('\n');

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: ExpansionTile(
        leading: const Icon(Icons.build_outlined),
        title: const Text('Diagnostics'),
        subtitle: Text(
          [
            model.serverRuntimeState ?? connection.status.name,
            if (model.bridgeVersion != null) 'bridge v${model.bridgeVersion}',
          ].join(' · '),
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          const Divider(height: 1),
          const SizedBox(height: 10),
          _InfoRow('Bridge', connection.status.name),
          _InfoRow('Minecraft', model.serverRuntimeState ?? 'Unknown'),
          _InfoRow(
            'RCON',
            model.lastServerStateAt == null
                ? 'Not observed'
                : 'Runtime state received',
          ),
          _InfoRow(
            'Multicraft',
            model.supportsBridgeCapability('restart')
                ? 'Lifecycle available'
                : 'Not advertised',
          ),
          _InfoRow('Bridge version', model.bridgeVersion ?? 'Unknown'),
          _InfoRow(
            'Protocol',
            model.bridgeProtocol?.toString() ?? 'Unknown',
          ),
          _InfoRow('Permission', model.bridgePermission ?? 'Unknown'),
          _InfoRow(
            'Endpoint',
            '${model.ip}:${model.port}${model.bridgePath}',
          ),
          _InfoRow('Last heartbeat', _time(model.lastHeartbeatAt)),
          _InfoRow('Last state', _time(model.lastServerStateAt)),
          if (model.bridgeLastError != null)
            _InfoRow('Last error', model.bridgeLastError!),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Capabilities',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          const SizedBox(height: 6),
          if (model.bridgeCapabilities.isEmpty)
            const Align(
              alignment: Alignment.centerLeft,
              child: Text('No capabilities advertised.'),
            )
          else
            Align(
              alignment: Alignment.centerLeft,
              child: Wrap(
                spacing: 6,
                runSpacing: 6,
                children: model.bridgeCapabilities
                    .map((capability) => Chip(label: Text(capability)))
                    .toList(),
              ),
            ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Command audit',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          const SizedBox(height: 4),
          if (model.commandAudit.isEmpty)
            const Align(
              alignment: Alignment.centerLeft,
              child: Text('No user-issued commands recorded.'),
            )
          else
            for (final entry in model.commandAudit.reversed.take(10))
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.terminal, size: 18),
                title: Text(entry.command),
                subtitle: Text('${entry.source} · ${entry.outcome}'),
              ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () async {
                await Clipboard.setData(
                  ClipboardData(text: _diagnosticText()),
                );
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Diagnostics copied.')),
                );
              },
              icon: const Icon(Icons.copy_all_outlined),
              label: const Text('Copy diagnostics'),
            ),
          ),
        ],
      ),
    );
  }
}
class _NoticeCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String actionLabel;
  final VoidCallback onAction;

  const _NoticeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(subtitle),
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton(
                      onPressed: onAction,
                      child: Text(actionLabel),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
