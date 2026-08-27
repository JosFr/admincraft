import 'package:admincraft/controllers/connection_controller.dart';
import 'package:admincraft/models/model.dart';
import 'package:admincraft/services/persistence_service.dart';
import 'package:admincraft/views/players_view.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  testWidgets('Players tab keeps online, whitelist and operator actions', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final model = Model(PersistenceService(prefs));
    model.updateServerRuntimeState(
      'running',
      playersOnline: 1,
      playerLimit: 15,
      onlinePlayers: const ['Steve'],
      whitelistEnabled: true,
      whitelistedPlayers: const ['Alex'],
      operators: const ['Alex'],
    );

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: model),
          ChangeNotifierProvider(create: (_) => ConnectionController()),
        ],
        child: const MaterialApp(
          home: Scaffold(body: PlayersView(isEnabled: true)),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('1 of 15 online'), findsOneWidget);
    expect(find.text('Steve'), findsOneWidget);
    expect(find.text('Add to whitelist'), findsOneWidget);
    expect(find.text('Whitelist & operators'), findsOneWidget);

    await tester.tap(find.widgetWithText(ActionChip, 'Steve'));
    await tester.pumpAndSettle();

    expect(find.text('Kick'), findsOneWidget);
    expect(find.text('Make operator'), findsOneWidget);
    expect(find.text('Add to whitelist'), findsWidgets);
    expect(find.text('survival'), findsOneWidget);
    expect(find.text('creative'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
