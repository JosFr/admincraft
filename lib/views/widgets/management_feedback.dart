import 'package:admincraft/controllers/network_controller.dart';
import 'package:flutter/material.dart';

class ManagementFeedback extends StatelessWidget {
  final NetworkController network;
  const ManagementFeedback({super.key, required this.network});

  @override
  Widget build(BuildContext context) {
    if (network.managementMessage?.isNotEmpty != true) {
      return const SizedBox.shrink();
    }
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.35,
      ),
      child: SingleChildScrollView(
        child: Card(
          key: const ValueKey('backup-management-feedback'),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        network.managementPending
                            ? 'Waiting for confirmation'
                            : network.managementSuccess == true
                            ? 'Request confirmed'
                            : network.managementSuccess == false
                            ? 'Action failed'
                            : 'Status not confirmed',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    if (!network.managementPending)
                      IconButton(
                        tooltip: 'Dismiss result',
                        onPressed: network.clearManagementFeedback,
                        icon: const Icon(Icons.close),
                      ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(network.managementMessage!),
                if (network.managementPending) ...[
                  const SizedBox(height: 8),
                  const LinearProgressIndicator(),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
