import 'package:admincraft/controllers/connection_controller.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/utils/command_utils.dart';
import 'package:admincraft/utils/dialog_utils.dart';
import 'package:admincraft/utils/toast_utils.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

class PlayersView extends StatefulWidget {
  final bool isEnabled;

  const PlayersView({super.key, required this.isEnabled});

  @override
  State<PlayersView> createState() => _PlayersViewState();
}

class _PlayersViewState extends State<PlayersView> {
  ConnectionController get _connection =>
      Provider.of<ConnectionController>(context, listen: false);
  Model get _model => Provider.of<Model>(context, listen: false);

  Future<void> _send(String command) async {
    if (!CommandUtils.isAccepted(command)) {
      ToastUtils.showToastError(CommandUtils.rejectionMessage);
      return;
    }
    await _connection.executeMinecraftCommand(
      _model,
      command,
      source: 'players',
    );
  }

  Future<void> _addToWhitelist() async {
    final name = await DialogUtils.promptForInput(
      context,
      'player',
      suggestions: _model.onlinePlayers,
    );
    if (name == null || !mounted) return;
    final trimmed = name.trim();
    if (trimmed.isEmpty) return;
    await _send('whitelist add $trimmed');
  }

  Future<void> _managePlayer(String name) async {
    final world = _model.world;
    bool has(Iterable<String> values) =>
        values.any((value) => value.toLowerCase() == name.toLowerCase());
    final isOperator = has(world.operators);
    final isWhitelisted = has(world.whitelistedPlayers);
    final isOnline = has(_model.onlinePlayers);

    final command = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(name, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              if (isOnline)
                ListTile(
                  leading: const Icon(Icons.logout),
                  title: const Text('Kick'),
                  onTap: () => Navigator.pop(context, 'kick $name'),
                ),
              ListTile(
                leading: Icon(isOperator ? Icons.shield_outlined : Icons.shield),
                title: Text(isOperator ? 'Deop' : 'Make operator'),
                onTap: () => Navigator.pop(
                  context,
                  isOperator ? 'deop $name' : 'op $name',
                ),
              ),
              ListTile(
                leading: Icon(
                  isWhitelisted ? Icons.person_remove : Icons.person_add,
                ),
                title: Text(
                  isWhitelisted
                      ? 'Remove from whitelist'
                      : 'Add to whitelist',
                ),
                onTap: () => Navigator.pop(
                  context,
                  isWhitelisted
                      ? 'whitelist remove $name'
                      : 'whitelist add $name',
                ),
              ),
              if (isOnline) ...[
                const SizedBox(height: 8),
                Text('Gamemode', style: Theme.of(context).textTheme.labelLarge),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: ['survival', 'creative', 'adventure', 'spectator']
                      .map(
                        (mode) => ActionChip(
                          label: Text(mode),
                          onPressed: () => Navigator.pop(
                            context,
                            'gamemode $mode $name',
                          ),
                        ),
                      )
                      .toList(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
    if (command == null || !mounted) return;
    await _send(command);
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.isEnabled) {
      return const Center(child: Text('Connect to manage players'));
    }

    final model = context.watch<Model>();
    if (!model.connectionSecurity.isDirectRcon &&
        !model.supportsBridgeCapability('commands')) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'This bridge credential is read-only. Player actions are unavailable.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    final world = model.world;
    final online = model.onlinePlayers.toList()..sort();
    final whitelist = world.whitelistedPlayers.toList()..sort();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Players', style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 4),
        Text(
          world.playersOnline == null
              ? '${online.length} tracked'
              : '${world.playersOnline} of ${world.playerLimit} online',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
        const SizedBox(height: 12),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.tonalIcon(
            onPressed: _addToWhitelist,
            icon: const Icon(Icons.person_add_alt_1),
            label: const Text('Add to whitelist'),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.people_outline),
                    const SizedBox(width: 10),
                    Text('Online now', style: Theme.of(context).textTheme.titleMedium),
                    const Spacer(),
                    IconButton(
                      tooltip: 'Refresh player list',
                      onPressed: () => _connection.sendQuietly('list'),
                      icon: const Icon(Icons.refresh),
                    ),
                  ],
                ),
                if (online.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text('No players online.'),
                  )
                else
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: online
                        .map(
                          (name) => ActionChip(
                            avatar: const Icon(Icons.person, size: 16),
                            label: Text(name),
                            onPressed: () => _managePlayer(name),
                          ),
                        )
                        .toList(),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          child: ExpansionTile(
            leading: const Icon(Icons.verified_user_outlined),
            title: const Text('Whitelist & operators'),
            subtitle: Text(
              world.whitelistEnabled == null
                  ? 'Status unknown'
                  : '${world.whitelistEnabled! ? 'Enabled' : 'Disabled'} · ${whitelist.length} whitelisted · ${world.operators.length} operators',
            ),
            childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            children: [
              if (whitelist.isEmpty)
                const Align(
                  alignment: Alignment.centerLeft,
                  child: Text('No whitelisted players.'),
                )
              else
                Align(
                  alignment: Alignment.centerLeft,
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: whitelist
                        .map(
                          (name) => ActionChip(
                            avatar: Icon(
                              world.operators.any(
                                (op) => op.toLowerCase() == name.toLowerCase(),
                              )
                                  ? Icons.shield
                                  : Icons.person_outline,
                              size: 16,
                            ),
                            label: Text(name),
                            onPressed: () => _managePlayer(name),
                          ),
                        )
                        .toList(),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
