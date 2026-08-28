import 'dart:convert';
import 'dart:typed_data';

import 'package:admincraft/models/server_profile.dart';
import 'package:flutter/material.dart';

class ServerIconPreset {
  final String label;
  final String asset;
  final String category;

  const ServerIconPreset(this.label, this.asset, this.category);
}

const serverIconPresets = <ServerIconPreset>[
  ServerIconPreset('Grass block', 'docs/logo/variants/grass.png', 'World'),
  ServerIconPreset('Dirt block', 'docs/logo/variants/dirt.png', 'World'),
  ServerIconPreset('Stone block', 'docs/logo/variants/stone.png', 'World'),
  ServerIconPreset('Obsidian', 'docs/logo/variants/obsidian_glow.png', 'World'),
  ServerIconPreset('Diamond', 'docs/logo/variants/diamond.png', 'World'),
  ServerIconPreset('Gold', 'docs/logo/variants/gold.png', 'World'),
  ServerIconPreset('Beacon', 'assets/mcicons/beacon.png', 'Hub'),
  ServerIconPreset('Compass', 'assets/mcicons/compass.png', 'Hub'),
  ServerIconPreset('Map', 'assets/mcicons/map.png', 'Hub'),
  ServerIconPreset('Chest', 'assets/mcicons/chest.png', 'Utility'),
  ServerIconPreset('Crafting table', 'assets/mcicons/crafting_table.png', 'Utility'),
  ServerIconPreset('Furnace', 'assets/mcicons/furnace.png', 'Utility'),
  ServerIconPreset('Anvil', 'assets/mcicons/anvil.png', 'Utility'),
  ServerIconPreset('Clock', 'assets/mcicons/clock.png', 'Archive'),
  ServerIconPreset('Legacy world', 'assets/mcicons/legacy_world.png', 'Archive'),
  ServerIconPreset('Recovery compass', 'assets/mcicons/recovery_compass.png', 'Archive'),
  ServerIconPreset('Book', 'assets/mcicons/book.png', 'Archive'),
  ServerIconPreset('Lantern', 'assets/mcicons/lantern.png', 'Private'),
  ServerIconPreset('Campfire', 'assets/mcicons/campfire.png', 'Private'),
  ServerIconPreset('Chicken', 'assets/mcicons/live_chicken.png', 'Farm'),
  ServerIconPreset('Egg', 'assets/mcicons/egg.png', 'Farm'),
  ServerIconPreset('Wheat', 'assets/mcicons/wheat.png', 'Farm'),
  ServerIconPreset('Carrot', 'assets/mcicons/carrot.png', 'Farm'),
  ServerIconPreset('Diamond pickaxe', 'assets/mcicons/diamond_pickaxe.png', 'Mining'),
  ServerIconPreset('Netherite pickaxe', 'assets/mcicons/netherite_pickaxe.png', 'Mining'),
  ServerIconPreset('Diamond sword', 'assets/mcicons/diamond_sword.png', 'PvP'),
  ServerIconPreset('Shield', 'assets/mcicons/shield.png', 'PvP'),
  ServerIconPreset('Bow', 'assets/mcicons/bow.png', 'PvP'),
  ServerIconPreset('Crossbow', 'assets/mcicons/crossbow.png', 'PvP'),
  ServerIconPreset('Netherrack', 'assets/mcicons/netherrack.png', 'Nether'),
  ServerIconPreset('Nether star', 'assets/mcicons/nether_star.png', 'Nether'),
  ServerIconPreset('Ender eye', 'assets/mcicons/ender_eye.png', 'End'),
  ServerIconPreset('End stone', 'assets/mcicons/end_stone.png', 'End'),
  ServerIconPreset('Ender chest', 'assets/mcicons/ender_chest.png', 'End'),
  ServerIconPreset('Redstone', 'assets/mcicons/redstone.png', 'Technical'),
  ServerIconPreset('Comparator', 'assets/mcicons/comparator.png', 'Technical'),
  ServerIconPreset('Bedrock', 'assets/mcicons/bedrock.png', 'Technical'),
  ServerIconPreset('Creeper', 'docs/logo/variants/creeper.png', 'Mob'),
  ServerIconPreset('Pig', 'docs/logo/variants/pig.png', 'Mob'),
  ServerIconPreset('Cow', 'docs/logo/variants/cow.png', 'Mob'),
  ServerIconPreset('Villager', 'docs/logo/variants/villager.png', 'Mob'),
  ServerIconPreset('Enderman', 'docs/logo/variants/enderman.png', 'Mob'),
];

final serverIconAssets = List<String>.unmodifiable(
  serverIconPresets.map((preset) => preset.asset),
);

class ServerIcon extends StatelessWidget {
  final ServerProfile server;
  final double size;

  const ServerIcon({super.key, required this.server, this.size = 32});

  @override
  Widget build(BuildContext context) {
    final custom = _customBytes(server.customIconBase64);
    if (custom != null) {
      return Image.memory(
        custom,
        width: size,
        height: size,
        fit: BoxFit.fill,
        filterQuality: FilterQuality.none,
        gaplessPlayback: true,
      );
    }
    return Image.asset(
      server.iconAsset.isEmpty ? serverIconPresets.first.asset : server.iconAsset,
      width: size,
      height: size,
      fit: BoxFit.fill,
      filterQuality: FilterQuality.none,
      isAntiAlias: false,
      errorBuilder: (_, __, ___) => Icon(Icons.dns_outlined, size: size),
    );
  }

  static Uint8List? _customBytes(String encoded) {
    if (encoded.isEmpty) return null;
    try {
      return base64Decode(encoded);
    } catch (_) {
      return null;
    }
  }
}
