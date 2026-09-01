import 'package:admincraft/controllers/network_controller.dart';
import 'package:admincraft/utils/toast_utils.dart';
import 'package:flutter/material.dart';

Future<void> showBackupRetentionEditor(
  BuildContext context,
  NetworkController network, {
  String? serverId,
}) async {
  final retention = network.management.retention;
  final serverMode = serverId != null;
  var inherit = serverMode && !retention.servers.containsKey(serverId);
  final policy = serverMode ? retention.forServer(serverId) : retention.global;
  var enforce = policy.enforce;
  final daily = TextEditingController(text: policy.daily.toString());
  final weekly = TextEditingController(text: policy.weekly.toString());
  final monthly = TextEditingController(text: policy.monthly.toString());
  final formKey = GlobalKey<FormState>();

  int? validCount(String? value) {
    final parsed = int.tryParse(value?.trim() ?? '');
    if (parsed == null || parsed < 0 || parsed > 3650) return null;
    return parsed;
  }

  try {
    final saved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: Text(serverMode ? 'Server retention' : 'Global retention'),
          content: SizedBox(
            width: 420,
            child: Form(
              key: formKey,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (serverMode)
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('Inherit global retention'),
                        subtitle: const Text(
                          'Future global retention changes automatically apply to this server.',
                        ),
                        value: inherit,
                        onChanged: (value) => setState(() => inherit = value),
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: daily,
                            enabled: !inherit,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: 'Daily',
                            ),
                            validator: (value) =>
                                inherit || validCount(value) != null
                                ? null
                                : 'Use 0-3650.',
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: TextFormField(
                            controller: weekly,
                            enabled: !inherit,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: 'Weekly',
                            ),
                            validator: (value) =>
                                inherit || validCount(value) != null
                                ? null
                                : 'Use 0-3650.',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: monthly,
                      enabled: !inherit,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Monthly'),
                      validator: (value) => inherit || validCount(value) != null
                          ? null
                          : 'Use a value from 0 to 3650.',
                    ),
                    const SizedBox(height: 8),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Automatically enforce retention'),
                      subtitle: const Text(
                        'Only backups outside the configured buckets and with delete capability may be removed.',
                      ),
                      value: enforce,
                      onChanged: inherit
                          ? null
                          : (value) => setState(() => enforce = value),
                    ),
                    if (enforce && !inherit)
                      const Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          'Automatic cleanup is destructive. The newest completed backup is always retained.',
                        ),
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
              label: const Text('Save retention'),
            ),
          ],
        ),
      ),
    );
    if (saved != true || !context.mounted) return;
    final sent = network.setBackupRetention(
      serverId: serverId,
      daily: validCount(daily.text) ?? policy.daily,
      weekly: validCount(weekly.text) ?? policy.weekly,
      monthly: validCount(monthly.text) ?? policy.monthly,
      enforce: enforce,
      inherit: inherit,
    );
    if (!sent) {
      ToastUtils.showToastError('Retention configuration could not be sent.');
    }
  } finally {
    daily.dispose();
    weekly.dispose();
    monthly.dispose();
  }
}
