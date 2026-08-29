# RC4 management bridge

RC4 adds a network-wide management capability to the Admincraft WebSocket bridge. The source is versioned in `server/websocket` and is tested together with the Flutter client.

The management capability is advertised only for an authenticated admin session and only when Multicraft management is configured successfully. Existing RC3 access, network, push, console, and lifecycle behavior remains available independently.

## What RC4 manages

- Multicraft backup creation and backup status tracking.
- Local verification with SHA-256 when the backup file is accessible to the bridge.
- Persistent scheduled start, stop, restart, backup, and maintenance actions.
- Maintenance countdowns, optional safety backups, and wait-until-empty restarts.
- 30-day performance history from Multicraft CPU, memory, and player counters.
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
## Persistent state and monitoring

Recommended settings:

```text
TZ=Europe/Amsterdam
MANAGEMENT_STATE_PATH=/data/management-state.json
MANAGEMENT_STORAGE_PATH=/backups
MANAGEMENT_TICK_MS=15000
MANAGEMENT_PERFORMANCE_SAMPLE_MS=300000
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

Supported automatic checks are Hangar, Modrinth, Spigot via Spiget, and GitHub Releases. BuiltByBit is deliberately not scraped or used to bypass premium access; configure a project URL for navigation and Admincraft reports the source as unavailable until an authenticated integration exists.

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
    "password": "..."
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
