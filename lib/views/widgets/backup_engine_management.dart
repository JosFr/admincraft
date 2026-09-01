import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/models/management_state.dart';
import 'package:admincraft/utils/toast_utils.dart';
import 'package:flutter/material.dart';

Future<bool?> showBackupEngineEditor(
  BuildContext context,
  NetworkController network,
  BackupEngineDescriptor engine,
) async {
  final labelController = TextEditingController(text: engine.label);
  final commandController = TextEditingController();
  final completionController = TextEditingController();
  final failureController = TextEditingController();
  final timeoutController = TextEditingController();
  var backupType = engine.backupType.isEmpty ? 'custom' : engine.backupType;
  var commandEntered = engine.managed;

  final result = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(
          engine.managed ? 'Edit backup engine' : 'Configure backup engine',
        ),
        content: SizedBox(
          width: 480,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: labelController,
                  decoration: const InputDecoration(labelText: 'Label'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: commandController,
                  decoration: InputDecoration(
                    labelText: 'Console command',
                    hintText: engine.managed
                        ? 'Leave blank to keep current command'
                        : 'backup start',
                  ),
                  onChanged: (value) => setState(
                    () => commandEntered =
                        engine.managed || value.trim().isNotEmpty,
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: backupType,
                  decoration: const InputDecoration(labelText: 'Backup type'),
                  items: const [
                    DropdownMenuItem(
                      value: 'full-server',
                      child: Text('Full server'),
                    ),
                    DropdownMenuItem(
                      value: 'world-only',
                      child: Text('World only'),
                    ),
                    DropdownMenuItem(
                      value: 'custom',
                      child: Text('Custom/plugin-defined'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) setState(() => backupType = value);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: completionController,
                  decoration: InputDecoration(
                    labelText: 'Completion regex (optional)',
                    hintText: engine.managed
                        ? 'Leave blank to keep current regex'
                        : 'Backup complete',
                    helperText:
                        'When configured, AdminCraft watches new Multicraft log lines.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: failureController,
                  decoration: InputDecoration(
                    labelText: 'Failure regex (optional)',
                    hintText: engine.managed
                        ? 'Leave blank to keep current regex'
                        : 'Backup failed',
                    helperText: 'Failure matching requires a completion regex.',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: timeoutController,
                  keyboardType: TextInputType.number,
                  decoration: InputDecoration(
                    labelText: 'Completion timeout (seconds)',
                    hintText: engine.managed
                        ? 'Leave blank to keep current timeout'
                        : '600',
                  ),
                ),
                if (engine.managed) ...[
                  const SizedBox(height: 12),
                  const Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      'Blank command/regex/timeout fields preserve the current managed values. '
                      'Use Reset to clear the managed configuration completely.',
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        actions: [
          if (engine.managed)
            TextButton.icon(
              onPressed: () {
                final sent = network.resetBackupEngine(engine.id);
                if (!sent) {
                  ToastUtils.showToastError(
                    'The management bridge is not connected.',
                  );
                  return;
                }
                Navigator.pop(dialogContext, true);
              },
              icon: const Icon(Icons.restart_alt),
              label: const Text('Reset'),
            ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton.icon(
            onPressed: commandEntered
                ? () {
                    final timeout = int.tryParse(timeoutController.text.trim());
                    final sent = network.saveBackupEngine(
                      engine: engine,
                      label: labelController.text,
                      command: commandController.text,
                      backupType: backupType,
                      completionRegex: completionController.text,
                      failureRegex: failureController.text,
                      completionTimeoutSeconds: timeout,
                    );
                    if (!sent) {
                      ToastUtils.showToastError(
                        'The management bridge is not connected.',
                      );
                      return;
                    }
                    Navigator.pop(dialogContext, true);
                  }
                : null,
            icon: const Icon(Icons.save_outlined),
            label: const Text('Save'),
          ),
        ],
      ),
    ),
  );

  // showDialog completes when pop starts; wait for the route transition before disposing.
  await Future<void>.delayed(const Duration(milliseconds: 300));
  labelController.dispose();
  commandController.dispose();
  completionController.dispose();
  failureController.dispose();
  timeoutController.dispose();
  return result;
}
