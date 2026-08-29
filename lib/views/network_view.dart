import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/models/network_access_entry.dart';
import 'package:admincraft/models/network_snapshot.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

enum NetworkQuickAction { open, console, players, start, stop, restart }

class NetworkView extends StatelessWidget {
  final Future<void> Function(String serverName, NetworkQuickAction action)
      onServerAction;

  const NetworkView({super.key, required this.onServerAction});

  @override
  Widget build(BuildContext context) {
    final model = context.watch<Model>();
    final network = context.watch<NetworkController?>();
    if (network == null) {
      return const Center(child: Text('Network controller is unavailable.'));
    }
    final pending = network.access
        .where((entry) => entry.status == NetworkAccessStatus.pending)
        .length;

    return RefreshIndicator(
      onRefresh: () async {
        network.reconnect();
        await Future<void>.delayed(const Duration(milliseconds: 500));
      },      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(20),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 960),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _Header(network: network),
                  const SizedBox(height: 14),
                  _Summary(snapshot: network.snapshot, pending: pending),
                  const SizedBox(height: 14),
                  _Servers(
                    snapshot: network.snapshot,
                    onAction: onServerAction,
                  ),
                  const SizedBox(height: 14),
                  _Access(network: network),
                  const SizedBox(height: 14),
                  _Activity(model: model),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
class _Header extends StatelessWidget {
  final NetworkController network;

  const _Header({required this.network});

  @override
  Widget build(BuildContext context) {
    final status = network.connected
        ? 'Live from Velocity'
        : network.connecting
            ? 'Connecting to Lobby…'
            : network.error ?? 'Network feed unavailable';
    final color = network.connected
        ? Colors.green
        : network.connecting
            ? Colors.orange
            : Theme.of(context).colorScheme.error;
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Network', style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 3),
              Text(status, style: Theme.of(context).textTheme.bodyMedium),
            ],
          ),
        ),        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        IconButton(
          tooltip: 'Refresh network',
          onPressed: network.reconnect,
          icon: const Icon(Icons.refresh),
        ),
      ],
    );
  }
}

class _Summary extends StatelessWidget {
  final NetworkSnapshot snapshot;
  final int pending;

  const _Summary({required this.snapshot, required this.pending});

  @override
  Widget build(BuildContext context) {
    final online = snapshot.servers
        .where((server) => server.state == NetworkServerState.online)
        .length;
    final via = snapshot.clientMin.isEmpty || snapshot.clientMax.isEmpty
        ? 'Unknown'
        : '${snapshot.clientMin} → ${snapshot.clientMax}';
    final items = [      (
        'Players',
        '${snapshot.playersOnline}/${snapshot.playerLimit}',
        Icons.people_outline,
      ),
      ('Online', '$online/${snapshot.servers.length}', Icons.dns_outlined),
      ('Access', '$pending pending', Icons.admin_panel_settings_outlined),
      ('Clients', via, Icons.swap_horiz),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 720 ? 4 : 2;
        final width = (constraints.maxWidth - 10 * (columns - 1)) / columns;
        return Wrap(
          spacing: 10,
          runSpacing: 10,
          children: [
            for (final item in items)
              SizedBox(
                width: width,
                child: Card(
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Icon(item.$3, size: 24),
                        const SizedBox(width: 10),                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.$1,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                              FittedBox(
                                fit: BoxFit.scaleDown,
                                alignment: Alignment.centerLeft,
                                child: Text(
                                  item.$2,
                                  style: Theme.of(context)
                                      .textTheme
                                      .titleMedium
                                      ?.copyWith(fontWeight: FontWeight.w700),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}
class _Servers extends StatelessWidget {
  final NetworkSnapshot snapshot;
  final Future<void> Function(String, NetworkQuickAction) onAction;

  const _Servers({required this.snapshot, required this.onAction});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Velocity backends',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            if (snapshot.servers.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Text('Waiting for network state…'),
              )
            else
              for (final server in snapshot.servers)
                _NetworkServerTile(server: server, onAction: onAction),
          ],
        ),      ),
    );
  }
}

class _NetworkServerTile extends StatelessWidget {
  final NetworkServerEntry server;
  final Future<void> Function(String, NetworkQuickAction) onAction;

  const _NetworkServerTile({required this.server, required this.onAction});

  @override
  Widget build(BuildContext context) {
    final stateColor = switch (server.state) {
      NetworkServerState.online => Colors.green,
      NetworkServerState.starting => Colors.orange,
      NetworkServerState.standby => Colors.blueGrey,
      NetworkServerState.error => Theme.of(context).colorScheme.error,
      NetworkServerState.offline => Theme.of(context).colorScheme.outline,
      NetworkServerState.unknown => Theme.of(context).colorScheme.outline,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(color: stateColor, shape: BoxShape.circle),
          ),          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(server.label, style: Theme.of(context).textTheme.titleSmall),
                Text(
                  '${server.state.label} · ${server.players} players'
                  '${server.version.isEmpty ? '' : ' · ${server.version}'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          PopupMenuButton<NetworkQuickAction>(
            tooltip: 'Quick actions',
            onSelected: (action) => onAction(server.name, action),
            itemBuilder: (context) => [
              const PopupMenuItem(
                value: NetworkQuickAction.open,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.dashboard_outlined),
                  title: Text('Open dashboard'),
                ),
              ),
              const PopupMenuItem(
                value: NetworkQuickAction.console,
                child: ListTile(                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.terminal_outlined),
                  title: Text('Console'),
                ),
              ),
              const PopupMenuItem(
                value: NetworkQuickAction.players,
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(Icons.people_alt_outlined),
                  title: Text('Players'),
                ),
              ),
              const PopupMenuDivider(),
              if (server.state != NetworkServerState.online)
                const PopupMenuItem(
                  value: NetworkQuickAction.start,
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.play_arrow_rounded),
                    title: Text('Start'),
                  ),
                ),
              if (server.state == NetworkServerState.online)
                const PopupMenuItem(
                  value: NetworkQuickAction.restart,
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.restart_alt),
                    title: Text('Restart'),
                  ),
                ),              if (server.state == NetworkServerState.online)
                const PopupMenuItem(
                  value: NetworkQuickAction.stop,
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.stop_circle_outlined),
                    title: Text('Stop'),
                  ),
                ),
            ],
            icon: const Icon(Icons.more_horiz),
          ),
        ],
      ),
    );
  }
}

class _Access extends StatelessWidget {
  final NetworkController network;

  const _Access({required this.network});

  @override
  Widget build(BuildContext context) {
    final pending = network.access
        .where((entry) => entry.status == NetworkAccessStatus.pending)
        .toList();
    final trusted = network.access
        .where((entry) => entry.status == NetworkAccessStatus.trusted)
        .toList();    final denied = network.access
        .where((entry) => entry.status == NetworkAccessStatus.denied)
        .toList();
    return Card(
      margin: EdgeInsets.zero,
      child: ExpansionTile(
        initiallyExpanded: pending.isNotEmpty,
        leading: const Icon(Icons.admin_panel_settings_outlined),
        title: const Text('Network access'),
        subtitle: Text(
          '${pending.length} pending · ${trusted.length} trusted · ${denied.length} denied',
        ),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          if (!network.accessAvailable)
            const Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text('Access management is unavailable on this bridge.'),
              ),
            )
          else ...[
            _AccessGroup(
              title: 'Pending',
              entries: pending,
              actions: const [('Allow', 'allow'), ('Deny', 'deny')],
              network: network,
            ),
            _AccessGroup(
              title: 'Trusted',              entries: trusted,
              actions: const [('Revoke', 'revoke'), ('Blacklist', 'blacklist')],
              network: network,
            ),
            _AccessGroup(
              title: 'Denied / blacklisted',
              entries: denied,
              actions: const [('Revoke', 'revoke')],
              network: network,
            ),
          ],
        ],
      ),
    );
  }
}

class _AccessGroup extends StatelessWidget {
  final String title;
  final List<NetworkAccessEntry> entries;
  final List<(String, String)> actions;
  final NetworkController network;

  const _AccessGroup({
    required this.title,
    required this.entries,
    required this.actions,
    required this.network,
  });

  @override
  Widget build(BuildContext context) {    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 5),
          if (entries.isEmpty)
            Text('None', style: Theme.of(context).textTheme.bodySmall)
          else
            for (final entry in entries)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(entry.name),
                          if ((entry.requestedTarget ?? '').isNotEmpty)
                            Text(
                              entry.requestedTarget!,
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                        ],
                      ),
                    ),
                    Wrap(
                      spacing: 6,
                      children: [                        for (final action in actions)
                          OutlinedButton(
                            onPressed: () {
                              network.executeAccessAction(action.$2, entry.uuid);
                            },
                            child: Text(action.$1),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

class _Activity extends StatelessWidget {
  final Model model;

  const _Activity({required this.model});

  @override
  Widget build(BuildContext context) {
    final entries = model.networkAudit.take(12).toList();
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Recent activity', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (entries.isEmpty)
              const Text('No Admincraft actions have been recorded yet.')
            else
              for (final item in entries)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.history, size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${item.serverName} · ${item.entry.command}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              '${item.entry.source} · ${item.entry.outcome} · ${_time(item.entry.occurredAt)}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }

  String _time(DateTime value) {
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(value.hour)}:${two(value.minute)}:${two(value.second)}';
  }
}
