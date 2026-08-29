# RC4 release readiness

RC4 is considered code-complete when the `rc4` branch passes the Quality workflow and the deployment target passes the bridge preflight check. This checklist deliberately stops before production changes.

## Automated release gates

The Quality workflow must pass all of these on the exact candidate commit:

- Flutter analyzer.
- Controller, model, service, utility, workspace, and view tests.
- RC4 WebSocket backend tests.
- Production dependency audit with no high-severity vulnerability.
- RC4 WebSocket Docker image build.
- Strict documentation build.

For local regression, run the complete Flutter test suite and a release build for the platform being distributed.

## Bridge preflight

From `server/websocket`, validate the intended environment before starting or replacing a bridge:

```bash
npm ci
npm run preflight
```

The preflight validates required Multicraft credentials, management server mappings, optional update-project JSON, and reports whether management can be enabled. It does not contact Multicraft or modify state.

## Deployment prerequisites

Before a production rollout, capture the current RC3 image or source revision, current environment/configuration, and any persistent bridge state. Keep that rollback material unchanged until RC4 has been verified in service.

RC4 management needs persistent storage for `MANAGEMENT_STATE_PATH`. If backup verification or capacity reporting is used, mount the configured backup path read-only unless a future engine explicitly requires writes.

Do not enable unsupported backup operations. Restore, delete, download, and copy remain capability-gated for the Multicraft engine.

## Post-start checks

After an eventual rollout, verify before considering it complete:

- `GET /healthz` reports a healthy bridge.
- An admin client receives the `management` capability.
- A management snapshot loads without errors.
- Lobby and SMP mappings point to the intended Multicraft server IDs.
- A performance sample can be requested.
- Update checks do not interfere with management when no update projects are configured.
- No routine player-count or normal lifecycle transition creates push noise.

If any of these fail, restore the previous RC3 bridge/configuration rather than debugging against the live service.
