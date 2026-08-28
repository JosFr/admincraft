import 'package:admincraft/controllers/connection_controller.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/models/network_access_entry.dart';
import 'package:flutter/material.dart';

class NetworkAccessSection extends StatelessWidget {
  final Model model;
  final ConnectionController connection;

  const NetworkAccessSection({
    super.key,
    required this.model,
    required this.connection,
  });

  @override
  Widget build(BuildContext context) {
    final pending = _entries(NetworkAccessStatus.pending);
    final trusted = _entries(NetworkAccessStatus.trusted);
    final denied = _entries(NetworkAccessStatus.denied);
    final ready = model.networkAccessAvailable;

    final subtitle = ready
        ? '${pending.length} pending · ${trusted.length} trusted · ${denied.length} denied'
        : 'Waiting for Velocity Access state';

    return Card(
      margin: EdgeInsets.zero,
      child: ExpansionTile(
        key: const ValueKey('network-access-section'),
        leading: const Icon(Icons.admin_panel_settings_outlined),
        title: const Text('Network access'),
        subtitle: Text(subtitle),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          const Divider(height: 1),
          const SizedBox(height: 10),
          if (!ready)
            const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Connect to the Lobby bridge to load central Access decisions.',
              ),
            )
          else ...[
            _AccessGroup(
              title: 'Pending',
              emptyText: 'No open access requests.',
              entries: pending,
              actions: const [
                _AccessAction('Allow', 'allow', Icons.check_circle_outline),
                _AccessAction('Deny', 'deny', Icons.block_outlined),
              ],
              onAction: _act,
            ),
            const SizedBox(height: 10),
            _AccessGroup(
              title: 'Trusted',
              emptyText: 'No trusted players.',
              entries: trusted,
              actions: const [
                _AccessAction('Revoke', 'revoke', Icons.undo_outlined),
                _AccessAction('Blacklist', 'blacklist', Icons.block_outlined),
              ],
              onAction: _act,
            ),
            const SizedBox(height: 10),
            _AccessGroup(
              title: 'Denied / blacklisted',
              emptyText: 'No denied players.',
              entries: denied,
              actions: const [
                _AccessAction('Revoke', 'revoke', Icons.undo_outlined),
              ],
              onAction: _act,
            ),
          ],
        ],
      ),
    );
  }

  List<NetworkAccessEntry> _entries(NetworkAccessStatus status) => model
      .networkAccess
      .where((entry) => entry.status == status)
      .toList();

  Future<void> _act(
    NetworkAccessEntry entry,
    _AccessAction action,
  ) async {
    await connection.executeNetworkAccessAction(
      model,
      action.command,
      entry.uuid,
    );
  }
}

class _AccessGroup extends StatelessWidget {
  final String title;
  final String emptyText;
  final List<NetworkAccessEntry> entries;
  final List<_AccessAction> actions;
  final Future<void> Function(
    NetworkAccessEntry entry,
    _AccessAction action,
  ) onAction;
  const _AccessGroup({
    required this.title,
    required this.emptyText,
    required this.entries,
    required this.actions,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 5),
        if (entries.isEmpty)
          Text(emptyText, style: Theme.of(context).textTheme.bodySmall)
        else
          ...entries.map(
            (entry) => _AccessPlayerCard(
              entry: entry,
              actions: actions,
              onAction: onAction,
            ),
          ),
      ],
    );
  }
}

class _AccessPlayerCard extends StatelessWidget {
  final NetworkAccessEntry entry;
  final List<_AccessAction> actions;
  final Future<void> Function(
    NetworkAccessEntry entry,
    _AccessAction action,
  ) onAction;

  const _AccessPlayerCard({
    required this.entry,
    required this.actions,
    required this.onAction,
  });
  @override
  Widget build(BuildContext context) {
    final target = entry.requestedTarget?.trim();
    final detail = [
      if (target != null && target.isNotEmpty) 'Target: $target',
      if (entry.admin) 'Access admin',
    ].join(' · ');

    return Padding(
      padding: const EdgeInsets.only(top: 7),
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(entry.name, style: Theme.of(context).textTheme.titleSmall),
              if (detail.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(detail, style: Theme.of(context).textTheme.bodySmall),
              ],
              const SizedBox(height: 8),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: actions
                    .map(
                      (action) => OutlinedButton.icon(
                        onPressed: () => onAction(entry, action),
                        icon: Icon(action.icon, size: 17),
                        label: Text(action.label),
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AccessAction {
  final String label;
  final String command;
  final IconData icon;

  const _AccessAction(this.label, this.command, this.icon);
}
