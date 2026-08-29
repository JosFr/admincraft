# Paper companion

Copy `AdmincraftWeather-1.2.0-community-rc3.jar` to each Paper server's `plugins/` directory and restart that server.

It exposes the structured `admincraftstatus` command used by the bridge for TPS, MSPT, worlds, players, whitelist/OP information, plugin names and versions, chunks/entities and diagnostics.

The matching Maven source is included in `source/` so the companion can be rebuilt or audited.

Keep RCON private: the plugin does not require a public port and AdminCraft should reach it through the WebSocket bridge.
