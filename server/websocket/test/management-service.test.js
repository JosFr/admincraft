const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createManagementService, nextCron, parseServers } = require("../management-service");

process.env.TZ = "Europe/Amsterdam";

function fixture(dependencyOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-management-"));
  let current = new Date("2026-08-29T03:59:00Z");
  const calls = [];
  let backupState = { status: "running" };
  let restartError = null;
  let backupStartError = null;
  let serverStatus = "running";
  const backupFile = path.join(dir, "backup.zip");
  fs.writeFileSync(backupFile, "backup-data", "utf8");
  const multicraft = {
    async start(id) { calls.push(["start", id]); },
    async stop(id) { calls.push(["stop", id]); },
    async restart(id) { calls.push(["restart", id]); if (restartError) throw restartError; },
    async startBackup(id) { calls.push(["backup", id]); if (backupStartError) throw backupStartError; },
    async backupStatus() { return { ...backupState }; },
    async statusDetails() { return { onlinePlayers: 0 }; },
    async status() { return serverStatus; },
    async resources() { return { cpuPercent: 12, memoryMb: 512 }; },
    async sendConsole(id, command) { calls.push(["console", id, command]); },
  };
  const service = createManagementService(
    {
      serversJson: JSON.stringify([
        { id: "lobby", name: "Lobby", multicraftServerId: 7 },
      ]),
      statePath: path.join(dir, "state.json"),
      performanceSampleMilliseconds: 300000,
    },
    {
      multicraft,
      planPerformance: {
        descriptor() { return { type: "plan", configured: true, canonical: true, serverIds: ["lobby"] }; },
        async history(serverId, range) {
          return {
            type: "admincraft.performance-history", source: { type: "plan", canonical: true, readOnly: true },
            serverId, range, samples: [{ serverId, at: current.toISOString(), tps: 19.8, mspt: 24.5,
              msptAverage: 24.5, msptP95: 31.2, msptJitterAverage: 1.5, msptJitterMax: 4.2,
              players: 2, cpuPercent: 12, memoryMb: 512, entities: 80, chunks: 120, freeDiskBytes: 1000000000 }],
          };
        },
      },
      now: () => new Date(current),
      ...dependencyOverrides,
    },
  );
  return {
    service,
    calls,
    backupFile,
    statePath: path.join(dir, "state.json"),
    setBackupState(value) { backupState = value; },
    setRestartError(value) { restartError = value; },
    setBackupStartError(value) { backupStartError = value; },
    setServerStatus(value) { serverStatus = value; },
    setNow(value) { current = new Date(value); },
    advance(milliseconds) { current = new Date(current.getTime() + milliseconds); },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

test("nextCron supports the RC4 schedule presets", () => {
  const from = new Date("2026-08-29T03:59:00Z");
  assert.equal(nextCron("0 4 * * *", from).toISOString(), "2026-08-30T02:00:00.000Z");
  assert.equal(nextCron("0 */6 * * *", from).toISOString(), "2026-08-29T04:00:00.000Z");
  assert.equal(nextCron("invalid", from), null);
  assert.equal(nextCron("61 * * * *", from), null);
  assert.equal(nextCron("*/0 * * * *", from), null);
  assert.equal(nextCron("0 4 * * MON", from), null);
  assert.equal(nextCron("0 4 12-3 * *", from), null);
});

test("Multicraft backup lifecycle becomes verifiable when local", async () => {
  const fx = fixture();
  try {
    const created = await fx.service.handle("backup-create", {
      serverId: "lobby",
      engine: "multicraft",
    });
    assert.equal(created.success, true);
    assert.deepEqual(fx.calls[0], ["backup", 7]);
    let backup = fx.service.snapshot().backups[0];
    assert.equal(backup.status, "running");
    assert.equal(backup.capabilities.verify, false);

    fx.setBackupState({ status: "completed", file: fx.backupFile });
    await fx.service.tick();
    backup = fx.service.snapshot().backups[0];
    assert.equal(backup.status, "completed");
    assert.equal(backup.capabilities.verify, true);

    const verified = await fx.service.handle("backup-verify", { backupId: backup.id });
    assert.equal(verified.success, true);
    backup = fx.service.snapshot().backups[0];
    assert.equal(backup.verified, true);
    assert.match(backup.checksum, /^sha256:[0-9a-f]{64}$/u);
  } finally {
    fx.cleanup();
  }
});

test("maintenance waits for the safety backup before restarting", async () => {
  const fx = fixture();
  try {
    await fx.service.handle("maintenance-start", {
      serverId: "lobby",
      countdownSeconds: 60,
      backup: true,
      restartWhenEmpty: false,
    });
    fx.advance(61000);
    await fx.service.tick();
    assert.equal(fx.calls.some(([name]) => name === "restart"), false);
    let maintenance = fx.service.snapshot().maintenance[0];
    assert.equal(maintenance.stage, "backup");
    assert.ok(maintenance.backupId);

    fx.setBackupState({ status: "completed", file: fx.backupFile });
    await fx.service.tick();
    assert.equal(fx.calls.some(([name, id]) => name === "restart" && id === 7), true);
    maintenance = fx.service.snapshot().maintenance[0];
    assert.equal(maintenance.active, true);
    assert.equal(maintenance.stage, "healthcheck");
    fx.setServerStatus("stopped");
    fx.advance(5001);
    await fx.service.tick();
    fx.setServerStatus("running");
    fx.advance(5001);
    await fx.service.tick();
    maintenance = fx.service.snapshot().maintenance[0];
    assert.equal(maintenance.active, false);
    assert.equal(maintenance.stage, "completed");
  } finally {
    fx.cleanup();
  }
});

test("scheduled actions persist a next run and execute when due", async () => {
  const fx = fixture();
  try {
    const created = await fx.service.handle("schedule-create", {
      serverId: "lobby",
      action: "restart",
      schedule: "0 4 * * *",
    });
    assert.equal(created.success, true);
    let schedule = fx.service.snapshot().schedules[0];
    assert.equal(schedule.nextRun, "2026-08-30T02:00:00.000Z");

    fx.setNow("2026-08-30T02:00:01Z");
    await fx.service.tick();
    assert.equal(fx.calls.some(([name, id]) => name === "restart" && id === 7), true);
    schedule = fx.service.snapshot().schedules[0];
    assert.match(schedule.lastResult, /^Success at /u);
    assert.equal(schedule.nextRun, "2026-08-31T02:00:00.000Z");
  } finally {
    fx.cleanup();
  }
});

test("performance history is delegated to canonical Plan data", async () => {
  const fx = fixture();
  try {
    await fx.service.tick();
    const frame = await fx.service.handle("performance-history", { serverId: "lobby", range: "7d" });
    assert.equal(frame.success, true);
    assert.equal(frame.events[0].source.type, "plan");
    assert.equal(frame.events[0].source.readOnly, true);
    assert.equal(frame.events[0].range, "7d");
    assert.equal(frame.events[0].samples.length, 1);
    assert.equal(frame.events[0].samples[0].tps, 19.8);
    assert.equal(frame.events[0].samples[0].msptP95, 31.2);
    assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(fx.statePath, "utf8")), "performance"), false);
    assert.equal(fx.service.snapshot().performanceSource.type, "plan");
  } finally { fx.cleanup(); }
});

test("duplicate backup requests are rejected while one is active", async () => {
  const fx = fixture();
  try {
    const first = await fx.service.handle("backup-create", { serverId: "lobby", engine: "multicraft" });
    const second = await fx.service.handle("backup-create", { serverId: "lobby", engine: "multicraft" });
    assert.equal(first.success, true);
    assert.equal(second.success, false);
    assert.match(second.message, /already in progress/u);
    assert.equal(fx.calls.filter(([name]) => name === "backup").length, 1);
  } finally { fx.cleanup(); }
});

test("maintenance waits for an existing backup before its safety backup", async () => {
  const fx = fixture();
  try {
    await fx.service.handle("backup-create", { serverId: "lobby", engine: "multicraft" });
    await fx.service.handle("maintenance-start", { serverId: "lobby", countdownSeconds: 60, backup: true });
    fx.advance(61000);
    await fx.service.tick();
    let maintenance = fx.service.snapshot().maintenance[0];
    assert.equal(maintenance.stage, "waiting-backup");
    assert.equal(fx.calls.filter(([name]) => name === "backup").length, 1);
    fx.setBackupState({ status: "completed", file: fx.backupFile });
    await fx.service.tick();
    maintenance = fx.service.snapshot().maintenance[0];
    assert.equal(maintenance.stage, "backup");
    assert.equal(fx.calls.filter(([name]) => name === "backup").length, 2);
  } finally { fx.cleanup(); }
});

test("maintenance failures are isolated and recorded", async () => {
  const fx = fixture();
  try {
    fx.setRestartError(new Error("restart denied"));
    await fx.service.handle("maintenance-start", { serverId: "lobby", countdownSeconds: 60, backup: false });
    fx.advance(61000);
    await fx.service.tick();
    const maintenance = fx.service.snapshot().maintenance[0];
    assert.equal(maintenance.active, false);
    assert.equal(maintenance.stage, "failed");
    assert.equal(maintenance.message, "restart denied");
    assert.equal(fx.service.snapshot().activity[0].error, true);
  } finally { fx.cleanup(); }
});

test("failed backup starts are recorded and do not stay active", async () => {
  const fx = fixture();
  try {
    fx.setBackupStartError(new Error("Multicraft refused backup"));
    const result = await fx.service.handle("backup-create", { serverId: "lobby", engine: "multicraft" });
    assert.equal(result.success, false);
    const backup = fx.service.snapshot().backups[0];
    assert.equal(backup.status, "failed");
    assert.equal(backup.message, "Multicraft refused backup");
    fx.setBackupStartError(null);
    const retry = await fx.service.handle("backup-create", { serverId: "lobby", engine: "multicraft" });
    assert.equal(retry.success, true);
  } finally { fx.cleanup(); }
});

test("disabled schedules clear nextRun until re-enabled", async () => {
  const fx = fixture();
  try {
    await fx.service.handle("schedule-create", { serverId: "lobby", action: "restart", schedule: "0 4 * * *" });
    let schedule = fx.service.snapshot().schedules[0];
    assert.ok(schedule.nextRun);
    await fx.service.handle("schedule-toggle", { id: schedule.id, enabled: false });
    schedule = fx.service.snapshot().schedules[0];
    assert.equal(schedule.enabled, false);
    assert.equal(schedule.nextRun, null);
    await fx.service.handle("schedule-toggle", { id: schedule.id, enabled: true });
    schedule = fx.service.snapshot().schedules[0];
    assert.equal(schedule.enabled, true);
    assert.ok(schedule.nextRun);
  } finally { fx.cleanup(); }
});

test("management server mappings fail closed when invalid or duplicated", () => {
  assert.throws(() => parseServers({ serversJson: JSON.stringify([{ id: "bad", multicraftServerId: 0 }]) }), /Invalid management server mapping/u);
  assert.throws(() => parseServers({ serversJson: JSON.stringify([{ id: "lobby", multicraftServerId: 1 }, { id: "lobby", multicraftServerId: 2 }]) }), /Duplicate management server ID/u);
  assert.throws(() => parseServers({ serversJson: JSON.stringify([{ id: "lobby", multicraftServerId: 1 }, { id: "smp", multicraftServerId: 1 }]) }), /Duplicate Multicraft server ID/u);
});

test("AdminCraft Native backup copies to configured local storage", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-native-"));
  try {
    const source = path.join(dir, "server");
    const staging = path.join(dir, "staging");
    const destination = path.join(dir, "destination");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, "server.properties"), "motd=test", "utf8");
    const service = createManagementService({
      serversJson: JSON.stringify([{
        id: "lobby",
        name: "Lobby",
        multicraftServerId: 7,
        defaultBackupEngineId: "native-lobby",
      }]),
      statePath: path.join(dir, "state.json"),
      nativeBackupPath: staging,
      storagesJson: JSON.stringify([{
        id: "local",
        name: "Local backup disk",
        type: "local",
        path: destination,
      }]),
      enginesJson: JSON.stringify([{
        id: "native-lobby",
        type: "native",
        serverId: "lobby",
        label: "AdminCraft Native",
        sourcePath: source,
        destinationIds: ["local"],
      }]),
    }, {
      multicraft: {},
      execFile: async (command, args) => {
        assert.equal(command, "tar");
        const output = args[1];
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, "native-archive", "utf8");
        return { stdout: "", stderr: "" };
      },
    });

    const result = await service.handle("backup-create", {
      serverId: "lobby",
      engineId: "native-lobby",
    });
    assert.equal(result.success, true);
    const backup = service.snapshot().backups[0];
    assert.equal(backup.engine, "native");
    assert.equal(backup.status, "completed");
    assert.deepEqual(backup.destinations, ["local"]);
    assert.equal(backup.capabilities.verify, true);
    assert.equal(backup.capabilities.delete, true);
    assert.equal(Object.hasOwn(backup, "localPath"), false);
    assert.equal(Object.hasOwn(backup, "destinationLocators"), false);
    const copied = fs.readdirSync(path.join(destination, "lobby"));
    assert.equal(copied.length, 1);
    assert.equal(
      fs.readFileSync(path.join(destination, "lobby", copied[0]), "utf8"),
      "native-archive",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("minimum-free-space safeguard blocks a native backup before archiving", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-safeguard-"));
  try {
    const source = path.join(dir, "server");
    const destination = path.join(dir, "destination");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(destination, { recursive: true });
    const service = createManagementService({
      serversJson: JSON.stringify([{
        id: "lobby", name: "Lobby", multicraftServerId: 7,
        defaultBackupEngineId: "native-lobby",
      }]),
      statePath: path.join(dir, "state.json"),
      storagesJson: JSON.stringify([{
        id: "local", type: "local", path: destination,
        minimumFreeBytes: Number.MAX_SAFE_INTEGER,
      }]),
      enginesJson: JSON.stringify([{
        id: "native-lobby", type: "native", serverId: "lobby",
        sourcePath: source, destinationIds: ["local"],
      }]),
    }, { multicraft: {} });
    const result = await service.handle("backup-create", {
      serverId: "lobby", engineId: "native-lobby",
    });
    assert.equal(result.success, false);
    assert.match(result.message, /Minimum free space/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("one-time schedules persist, execute once, and record job history", async () => {
  const fx = fixture();
  try {
    const created = await fx.service.handle("schedule-create", {
      serverId: "lobby",
      action: "restart",
      runAt: "2026-08-29T04:05:00Z",
    });
    assert.equal(created.success, true);
    let schedule = fx.service.snapshot().schedules.at(-1);
    assert.equal(schedule.recurring, false);
    assert.equal(schedule.nextRun, "2026-08-29T04:05:00.000Z");
    fx.setNow("2026-08-29T04:05:01Z");
    await fx.service.tick();
    schedule = fx.service.snapshot().schedules.at(-1);
    assert.equal(schedule.enabled, false);
    assert.equal(schedule.nextRun, null);
    const job = fx.service.snapshot().jobHistory[0];
    assert.equal(job.scheduleId, schedule.id);
    assert.equal(job.success, true);
    assert.equal(job.action, "restart");
  } finally { fx.cleanup(); }
});

test("scheduled failures are preserved in job history", async () => {
  const fx = fixture();
  try {
    fx.setRestartError(new Error("restart denied"));
    await fx.service.handle("schedule-create", {
      serverId: "lobby",
      action: "restart",
      runAt: "2026-08-29T04:05:00Z",
    });
    fx.setNow("2026-08-29T04:05:01Z");
    await fx.service.tick();
    const job = fx.service.snapshot().jobHistory[0];
    assert.equal(job.success, false);
    assert.equal(job.message, "restart denied");
    assert.equal(fx.service.snapshot().activity.some(
      (entry) => entry.title === "Scheduled action failed" && entry.error === true,
    ), true);
  } finally { fx.cleanup(); }
});

test("confirmed update sources are remembered in management state", async () => {
  const key = `lobby\u0000Example`;
  const checker = async ({ sourceOverrides = {} } = {}) => [{
    serverId: "lobby", serverName: "Lobby", plugin: "Example", kind: "plugin",
    currentVersion: "1.0.0", latestVersion: "1.1.0",
    provider: sourceOverrides[key]?.provider || null,
    projectId: sourceOverrides[key]?.projectId || null,
    sourceConfirmed: Boolean(sourceOverrides[key]), candidates: [],
    status: sourceOverrides[key] ? "updateAvailable" : "unmanaged", url: null,
  }];
  checker.confirmSource = ({ provider, projectId }) => ({
    key, source: { provider, projectId },
  });
  const fx = fixture({ updateChecker: checker });
  try {
    const result = await fx.service.handle("updates-source-set", {
      serverId: "lobby", plugin: "Example", provider: "github", projectId: "owner/repo",
    });
    assert.equal(result.success, true);
    assert.equal(fx.service.snapshot().updates[0].sourceConfirmed, true);
    const persisted = JSON.parse(fs.readFileSync(fx.statePath, "utf8"));
    assert.deepEqual(persisted.updateSourceOverrides[key], {
      provider: "github", projectId: "owner/repo",
    });
  } finally { fx.cleanup(); }
});


test("management activity records backup and schedule lifecycle actions", async () => {
  const fx = fixture();
  try {
    await fx.service.handle("backup-create", { serverId: "lobby", engine: "multicraft" });
    fx.setBackupState({ status: "completed", file: fx.backupFile });
    await fx.service.tick();
    const backup = fx.service.snapshot().backups[0];
    await fx.service.handle("backup-verify", { backupId: backup.id });
    await fx.service.handle("schedule-create", {
      serverId: "lobby", action: "restart", schedule: "0 4 * * *",
    });
    const schedule = fx.service.snapshot().schedules[0];
    await fx.service.handle("schedule-toggle", { id: schedule.id, enabled: false });
    await fx.service.handle("schedule-delete", { id: schedule.id });
    const titles = fx.service.snapshot().activity.map((entry) => entry.title);
    assert.ok(titles.includes("Backup verified"));
    assert.ok(titles.includes("Schedule created"));
    assert.ok(titles.includes("Schedule disabled"));
    assert.ok(titles.includes("Schedule deleted"));
  } finally { fx.cleanup(); }
});

test("management activity records update checks", async () => {
  const checker = async () => [{
    serverId: "lobby", serverName: "Lobby", plugin: "Example", kind: "plugin",
    currentVersion: "1.0.0", latestVersion: "1.0.0", status: "current",
  }];
  const fx = fixture({ updateChecker: checker });
  try {
    const result = await fx.service.handle("updates-check", { serverId: "lobby" });
    assert.equal(result.success, true);
    const entry = fx.service.snapshot().activity[0];
    assert.equal(entry.title, "Update check completed");
    assert.equal(entry.serverName, "Lobby");
    assert.match(entry.detail, /1 result/u);
  } finally { fx.cleanup(); }
});

test("scheduled backups report started instead of completed while still running", async () => {
  const fx = fixture();
  try {
    await fx.service.handle("schedule-create", {
      serverId: "lobby", action: "backup", runAt: "2026-08-29T04:05:00Z",
    });
    fx.setNow("2026-08-29T04:05:01Z");
    await fx.service.tick();
    const job = fx.service.snapshot().jobHistory[0];
    assert.equal(job.success, true);
    assert.equal(job.message, "Backup started.");
    assert.equal(fx.service.snapshot().backups[0].status, "running");
  } finally { fx.cleanup(); }
});

test("maintenance rejects an unobservable plugin safety backup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-maintenance-plugin-"));
  try {
    const service = createManagementService({
      serversJson: JSON.stringify([{
        id: "lobby", name: "Lobby", multicraftServerId: 7,
        defaultBackupEngineId: "plugin-backup",
      }]),
      statePath: path.join(dir, "state.json"),
      enginesJson: JSON.stringify([{
        id: "plugin-backup", type: "plugin", serverId: "lobby",
        label: "Plugin backup", command: "backup start",
      }]),
    }, { multicraft: { sendConsole: async () => {} } });
    const result = await service.handle("maintenance-start", {
      serverId: "lobby", countdownSeconds: 0, backup: true,
    });
    assert.equal(result.success, false);
    assert.match(result.message, /completion can be verified/u);
    assert.equal(service.snapshot().maintenance.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});