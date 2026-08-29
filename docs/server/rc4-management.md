# RC4 management bridge

RC4 adds a network-wide management capability to the Admincraft WebSocket bridge. The source is versioned in `server/websocket` and is tested together with the Flutter client.

The management capability is advertised only for an authenticated admin session and only when Multicraft management is configured successfully. Existing RC3 access, network, push, console, and lifecycle behavior remains available independently.

## What RC4 manages

- Multicraft backup creation and backup status tracking.
- Local verification with SHA-256 when the backup file is accessible to the bridge.
- Persistent scheduled start, stop, restart, backup, and maintenance actions.
- Maintenance countdowns, optional safety backups, and wait-until-empty restarts.
- 1h/6h/24h/7d/30d Minecraft performance history from the existing Plan database; AdminCraft does not collect or persist a second performance history.
- Storage capacity reporting for the configured management storage path.
- Plugin update checks for configured Hangar, Modrinth, Spigot, and GitHub projects.
- Network-wide management activity history.

Restore, delete, download, and copy remain disabled unless a future backup engine can perform them safely. The client reads those capabilities per backup and does not expose unsupported operations as if they worked.
## Required environment

The bridge uses the existing Multicraft API credentials. Management is opt-in and is advertised only when MANAGEMENT_ENABLED=true:

```text
MULTICRAFT_ENABLED=true
MANAGEMENT_ENABLED=true
MULTICRAFT_URL=https://panel.example.net/api.php
MULTICRAFT_USER=admincraft
MULTICRAFT_API_KEY=...
MULTICRAFT_SERVER_ID=1
```

For multiple servers, add one JSON mapping. `id` must match the server ID used by the Admincraft client and `multicraftServerId` is the numeric Multicraft server ID.

```json
[
  {"id":"lobby","name":"Lobby","multicraftServerId":1},
  {"id":"smp","name":"SMP","multicraftServerId":2}
]
```

Pass that JSON as `MANAGEMENT_SERVERS_JSON`. With one server, `MANAGEMENT_SERVER_ID`, `MANAGEMENT_SERVER_NAME`, and `MULTICRAFT_SERVER_ID` are enough.

## Canonical performance source: Plan

RC4 deliberately does not run its own Minecraft performance collector or history database. Plan is the canonical source for TPS, players, CPU, RAM, entities, chunks, free disk space, MSPT average, MSPT p95, and MSPT jitter. Grafana may query the same Plan data for detailed dashboards; Prometheus remains the source for host and infrastructure metrics.

The AdminCraft bridge connects to the existing Plan MariaDB with a dedicated SELECT-only account. At runtime the adapter inspects `plan_tps` for the required Plan 5.8 columns and rejects database grants beyond `SELECT`/`USAGE`. Queries are read-only and downsample Plan history server-side for the existing 1h, 6h, 24h, 7d, and 30d client ranges.

```text
PLAN_DB_HOST=plan-db.example.net
PLAN_DB_PORT=3306
PLAN_DB_DATABASE=plan
PLAN_DB_USER=admincraft_ro
PLAN_DB_PASSWORD=...
PLAN_DB_SSL=false
PLAN_SERVER_MAP_JSON=[{"serverId":"smp","planServerName":"SMP"}]
```

Each mapping must use an AdminCraft management `serverId` plus either `planServerName` or `planServerUuid`. Only servers that Plan actually records need a mapping; requesting performance for an unmapped server fails closed instead of falling back to a second collector.

The recommended MariaDB account is dedicated to AdminCraft and has only `SELECT` on the `plan` database. Do not reuse Plan's own read/write database account.

## Persistent state and monitoring

Recommended settings:

```text
TZ=Europe/Amsterdam
MANAGEMENT_STATE_PATH=/data/management-state.json
MANAGEMENT_STORAGE_PATH=/backups
MANAGEMENT_TICK_MS=15000
```

Mount `/data` persistently. Mount `MANAGEMENT_STORAGE_PATH` read-only when it is only used for capacity and verification; no RC4 operation writes arbitrary files there.

Cron expressions are evaluated in the bridge process timezone. The client presets therefore follow `TZ` rather than the phone or browser timezone.

RC4 accepts a safe five-field cron subset: numeric values, *, */n, numeric ranges, and comma-separated lists. Invalid or out-of-range expressions are rejected before scheduling.

The bridge exposes `GET /healthz` with non-secret bridge status. Docker health checks use this endpoint.

## Plugin update projects

Update checking is explicit rather than guessing plugin identities. Configure `UPDATE_PROJECTS_JSON` with the current installed version and source project ID.
```json
[
  {
    "serverId":"lobby",
    "serverName":"Lobby",
    "plugin":"ViaVersion",
    "currentVersion":"5.11.0",
    "provider":"hangar",
    "projectId":"ViaVersion"
  },
  {
    "serverId":"smp",
    "serverName":"SMP",
    "plugin":"Example",
    "currentVersion":"1.4.0",
    "provider":"github",
    "projectId":"owner/repository"
  }
]
```

Supported checks are Hangar, Modrinth, Spigot via Spiget, GitHub Releases, PaperMC platform releases, and authenticated BuiltByBit version metadata. BuiltByBit is never scraped and never bypasses premium licensing or downloads. Its resource-ID version check uses the documented v1 API with a server-side Private or Shared token; keep BUILTBYBIT_API_TOKEN out of client configuration and source control.

For ambiguous plugin identities, omit provider/projectId and configure candidates. Admincraft returns the project as Unmanaged until an administrator confirms one candidate; that choice is remembered in persistent management state. Paper and Velocity platform rows can use kind paper or velocity and automatically map to the PaperMC source.

```json
{
  "serverId":"smp",
  "plugin":"Example",
  "currentVersion":"1.4.0",
  "candidates":[
    {"provider":"modrinth","projectId":"abc","label":"Example on Modrinth"},
    {"provider":"github","projectId":"owner/repository","label":"Example on GitHub"}
  ]
}
```

PaperMC requests use an identifying Admincraft User-Agent as required by the Downloads Service. BuiltByBit token type defaults to Private; set BUILTBYBIT_API_TOKEN_TYPE=Shared only when using a compatible Shared token.

## RC4 backup engines and storage

The management bridge now advertises backup engines and destinations as capabilities. The client only shows engines that the connected bridge actually exposes; an older RC4 bridge falls back to Multicraft only.

Configure destinations with `BACKUP_STORAGES_JSON`. Supported RC4 destination types are:

- `nextcloud` — first-class Nextcloud over WebDAV.
- `webdav` — generic WebDAV.
- `local` — a local or bind-mounted filesystem path.
- `smb` / `nfs` — paths mounted into the bridge container by the host.
- `sftp` / `s3` / `rclone` — rclone-backed remotes.

Credentials stay server-side. Storage snapshots sent to clients contain names, types and capacity information, never usernames, passwords or remote configuration secrets.
A minimal Nextcloud destination can be supplied as JSON like this (store the real password in the protected bridge environment, not in source control):

```json
[
  {
    "id": "nextcloud",
    "name": "Nextcloud",
    "type": "nextcloud",
    "url": "https://cloud.example.net/remote.php/dav/files/admincraft",
    "username": "admincraft-backup",
    "password": "...",
    "minimumFreeBytes": 161061273600
  }
]
```

For mounted storage, use `type: local`, `smb`, or `nfs` with a `path`. For SFTP/S3-compatible destinations configure an rclone remote and use its name in `remote`; the RC4 container includes rclone.
Configure non-Multicraft engines with `BACKUP_ENGINES_JSON`. `native` creates an archive from a mounted server path; `plugin` and `custom` dispatch an explicit console command. Plugin/custom completion is not guessed: their records remain non-authoritative unless a later adapter can observe completion.

```json
[
  {
    "id": "native-smp",
    "type": "native",
    "serverId": "smp",
    "label": "AdminCraft Native",
    "sourcePath": "/minecraft/smp",
    "destinationIds": ["nextcloud", "local"],
    "allowRestore": false
  },
  {
    "id": "plugin-smp",
    "type": "plugin",
    "serverId": "smp",
    "label": "Server backup plugin",
    "command": "backup start"
  }
]
```

## Retention and storage safeguards

Configure retention with `BACKUP_RETENTION_JSON`. Global defaults can be overridden per management server ID.

`enforce` defaults to `false`: the bridge calculates and exposes retention candidates, but does not delete them. Automatic cleanup only runs for backup records whose configured engine advertises delete support and only when the effective policy explicitly has `enforce: true`.

```json
{
  "global": {"daily": 7, "weekly": 4, "monthly": 6, "enforce": false},
  "servers": {
    "smp": {"daily": 14, "weekly": 8, "monthly": 12, "enforce": true}
  }
}
```

A storage destination can also define `minimumFreeBytes` (for example 150 GiB = `161061273600`). When the provider reports free capacity at or below that value, a new AdminCraft Native backup targeting that destination is blocked before the archive is created. `softLimitBytes` remains available for providers where a real quota is absent or unreliable.

Retention never makes unsupported Multicraft/plugin/custom backups deletable. AdminCraft does not silently remove backups outside the configured retention rules.

## Scheduled actions and job history

RC4 schedules are persisted in the management state and execute on the bridge, not in the mobile/desktop client. Supported actions are start, stop, restart, backup and maintenance.

Recurring schedules use the documented safe five-field cron subset in the bridge timezone. One-time schedules use an absolute future `runAt` timestamp and disable themselves after execution.

Every scheduled execution creates a bounded persistent `jobHistory` record with server, action, source, start/end timestamps and success/failure details. The client shows this history below the active schedule list, so failed jobs remain visible after the next refresh.

## Maintenance policies

`MAINTENANCE_CONFIG_JSON` controls RC4 maintenance countdowns and health checks. Global defaults can be overridden per management server ID. The bridge validates the configuration during preflight and rejects unknown server overrides.

```json
{
  "global": {
    "countdownOptionsSeconds": [60, 300, 600, 1800],
    "milestonesSeconds": [600, 300, 60, 30, 10],
    "countdownMessage": "Server maintenance starts in {time}.",
    "startingMessage": "Server maintenance is starting now.",
    "waitingEmptyMessage": "Maintenance is waiting for {players} player(s) to leave.",
    "availableMessage": "Server is available again.",
    "cancelledMessage": "Server maintenance was cancelled.",
    "healthcheckAttempts": 12,
    "healthcheckIntervalSeconds": 5
  },
  "servers": {}
}
```

A maintenance flow can restart or stop a server, optionally wait for players to leave, optionally require a safety backup, and then verify the expected Multicraft lifecycle state before reporting completion. Restart flows only announce availability again after the health-check phase succeeds.
