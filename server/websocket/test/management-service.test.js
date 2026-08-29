const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createManagementService, nextCron } = require("../management-service");

process.env.TZ = "Europe/Amsterdam";

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-management-"));
  let current = new Date("2026-08-29T03:59:00Z");
  const calls = [];
  let backupState = { status: "running" };
  let restartError = null;
  const backupFile = path.join(dir, "backup.zip");
  fs.writeFileSync(backupFile, "backup-data", "utf8");
  const multicraft = {
    async start(id) { calls.push(["start", id]); },
    async stop(id) { calls.push(["stop", id]); },
    async restart(id) { calls.push(["restart", id]); if (restartError) throw restartError; },
    async startBackup(id) { calls.push(["backup", id]); },
    async backupStatus() { return { ...backupState }; },
    async statusDetails() { return { onlinePlayers: 0 }; },
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
      now: () => new Date(current),
    },
  );
  return {
    service,
    calls,
    backupFile,
    setBackupState(value) { backupState = value; },
    setRestartError(value) { restartError = value; },
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

test("performance sampling is bounded and range-filtered", async () => {
  const fx = fixture();
  try {
    await fx.service.tick();
    await fx.service.tick();
    let frame = await fx.service.handle("performance-history", {
      serverId: "lobby",
      range: "1h",
    });
    assert.equal(frame.success, true);
    assert.equal(frame.events[0].samples.length, 1);
    assert.equal(frame.events[0].samples[0].cpuPercent, 12);

    fx.advance(300001);
    await fx.service.tick();
    frame = await fx.service.handle("performance-history", {
      serverId: "lobby",
      range: "1h",
    });
    assert.equal(frame.events[0].samples.length, 2);
  } finally {
    fx.cleanup();
  }
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
