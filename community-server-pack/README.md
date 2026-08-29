# AdminCraft Community Server Pack — RC3

This branch turns the RC3 client into a reusable setup for other Minecraft administrators.

## Two deployment levels

**Basic** uses one AdminCraft bridge per Paper server. It provides dashboard metrics, console,
players, whitelist/OP controls, plugin information, diagnostics, and lifecycle controls.

**Network** adds Velocity. One selected profile is marked **Network hub / Lobby bridge** and
provides Network Overview, central Access requests, server-state notifications, and APNs device registration.

## Components

- `bridge/` — WebSocket bridge with frame authentication, network feed and optional APNs provider.
- `velocity/access/` — central TRUSTED / PENDING / DENIED access control.
- `velocity/network-status/` — Velocity network status API.
- Paper servers need the AdmincraftWeather companion plugin for rich Paper statistics.

The Community NetworkStatus build does not contain the private automatic Multicraft standby mapping.
All Velocity backends therefore work generically as ONLINE/OFFLINE. Lifecycle automation can be added separately.
