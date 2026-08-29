# AdminCraft Community RC3

This is a separate, reusable variant of the private RC3 branch.

The important community change is that the central Velocity/Lobby connection is no longer inferred only from a server name or `/lobby` path. A server profile can explicitly be marked **Network hub / Lobby bridge** in the editor. Older Lobby profiles remain compatible.

The included `community-server-pack/` contains the bridge and Velocity companion sources plus example configuration. Secrets and APNs keys are deliberately not included.

## Minimum server-side requirements

For a normal Paper server:

1. AdminCraft WebSocket bridge.
2. RCON reachable only from the bridge/server host.
3. AdmincraftWeather Paper companion for rich metrics and plugin information.
4. A unique long bridge secret.
5. WSS/reverse proxy for access from outside the LAN.

For Network mode, add Velocity Access + NetworkStatus and mark one app profile as the Network hub.

## Generic profile matching

Network quick actions match a Velocity backend to a saved server profile by either the profile alias or the final bridge-path segment. Keep one of those equal to the Velocity backend name. The profile marked **Network hub / Lobby bridge** is used for the central network and Access feed.

Private endpoint migrations and private standby mappings are intentionally absent from this branch.
