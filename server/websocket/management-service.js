const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function id(prefix = "item") {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isoNow(now = () => new Date()) {
  return now().toISOString();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function parseServers(config = {}) {
  const raw = config.serversJson || process.env.MANAGEMENT_SERVERS_JSON || "";
  if (raw.trim()) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("MANAGEMENT_SERVERS_JSON must be an array.");
    return parsed.map((entry) => ({
      id: String(entry.id || entry.name || "").trim(),
      name: String(entry.name || entry.id || "Server").trim(),
      multicraftServerId: Number.parseInt(entry.multicraftServerId, 10),
    })).filter((entry) => entry.id && Number.isInteger(entry.multicraftServerId));
  }

  const multicraftServerId = Number.parseInt(
    config.multicraftServerId || process.env.MULTICRAFT_SERVER_ID,
    10,
  );
  if (!Number.isInteger(multicraftServerId) || multicraftServerId < 1) return [];
  return [{
    id: config.serverId || process.env.MANAGEMENT_SERVER_ID || "lobby",
    name: config.serverName || process.env.MANAGEMENT_SERVER_NAME || "Lobby",
    multicraftServerId,
  }];
}
function validField(expression, min, max) {
  return expression.split(",").every((part) => {
    if (part === "*") return true;
    const step = /^\*\/(\d+)$/u.exec(part);
    if (step) {
      const value = Number(step[1]);
      return Number.isInteger(value) && value > 0 && value <= max - min + 1;
    }
    const range = /^(\d+)-(\d+)$/u.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      return start >= min && end <= max && start <= end;
    }
    const number = Number(part);
    return Number.isInteger(number) && number >= min && number <= max;
  });
}

function fieldMatches(value, expression, min, max) {
  return expression.split(",").some((part) => {
    if (part === "*") return true;
    const step = /^\*\/(\d+)$/u.exec(part);
    if (step) return value % Number(step[1]) === 0;
    const range = /^(\d+)-(\d+)$/u.exec(part);
    if (range) return value >= Number(range[1]) && value <= Number(range[2]);
    const number = Number(part);
    return Number.isInteger(number) && number >= min && number <= max && value === number;
  });
}

function nextCron(schedule, from = new Date()) {
  const fields = String(schedule).trim().split(/\s+/u);
  if (fields.length !== 5) return null;
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  if (!fields.every((field, index) => validField(field, ...ranges[index]))) return null;
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = new Date(cursor.getTime() + 366 * 24 * 60 * 60 * 1000);
  while (cursor <= limit) {
    const matches = fieldMatches(cursor.getMinutes(), fields[0], 0, 59)
      && fieldMatches(cursor.getHours(), fields[1], 0, 23)
      && fieldMatches(cursor.getDate(), fields[2], 1, 31)
      && fieldMatches(cursor.getMonth() + 1, fields[3], 1, 12)
      && fieldMatches(cursor.getDay(), fields[4], 0, 6);
    if (matches) return cursor;
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}
function createManagementService(config = {}, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const setIntervalImpl = dependencies.setInterval || setInterval;
  const clearIntervalImpl = dependencies.clearInterval || clearInterval;
  const statePath = config.statePath
    || process.env.MANAGEMENT_STATE_PATH
    || path.join(process.cwd(), "data", "management-state.json");
  const servers = parseServers(config);
  const multicraft = dependencies.multicraft;
  const state = readJson(statePath, {
    backups: [],
    schedules: [],
    maintenance: [],
    performance: [],
    updates: [],
    activity: [],
  });
  let timer = null;
  let ticking = false;
  let lastPerformanceSampleAt = 0;

  const serverById = (serverId) => servers.find((server) => server.id === serverId);
  for (const key of ["backups", "schedules", "maintenance", "performance", "updates", "activity"]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }

  function persist() {
    writeJson(statePath, state);
  }

  function activity(server, title, detail, error = false) {
    state.activity.unshift({
      id: id("activity"),
      at: isoNow(now),
      serverName: server?.name || "Network",
      title,
      detail,
      error,
    });
    state.activity = state.activity.slice(0, 250);
  }

  function backupCapabilities() {
    return {
      restore: false,
      download: false,
      delete: false,
      verify: false,
      copy: false,
    };
  }
  function storageSnapshot() {
    const root = config.storagePath || process.env.MANAGEMENT_STORAGE_PATH || "";
    if (!root) return null;
    let totalBytes = null;
    let freeBytes = null;
    try {
      const stats = fs.statfsSync(root);
      totalBytes = Number(stats.blocks) * Number(stats.bsize);
      freeBytes = Number(stats.bavail) * Number(stats.bsize);
    } catch (_) {
      // Capacity remains unknown on runtimes without statfs support.
    }
    const backupBytes = state.backups.reduce(
      (sum, backup) => sum + (Number(backup.sizeBytes) || 0),
      0,
    );
    return {
      id: "management-local",
      name: "Management host",
      type: "local",
      totalBytes,
      freeBytes,
      backupBytes,
      softLimitBytes: null,
      warningFreePercent: 15,
      criticalFreePercent: 5,
    };
  }

  function snapshot() {
    return {
      type: "admincraft.management-state",
      observedAt: isoNow(now),
      storages: storageSnapshot() == null ? [] : [storageSnapshot()],
      backups: state.backups,
      schedules: state.schedules,
      maintenance: state.maintenance,
      updates: state.updates || [],
      activity: state.activity,
    };
  }

  async function recordPerformance(server) {
    if (!multicraft) return;
    const [resources, status] = await Promise.all([
      multicraft.resources(server.multicraftServerId).catch(() => ({})),
      multicraft.statusDetails(server.multicraftServerId).catch(() => ({})),
    ]);
    state.performance.push({
      serverId: server.id,
      at: isoNow(now),
      players: Number.parseInt(status.onlinePlayers, 10) || 0,
      cpuPercent: resources.cpuPercent ?? null,
      memoryMb: resources.memoryMb ?? null,
      tps: null,
      mspt: null,
    });
    const cutoff = now().getTime() - 30 * 24 * 60 * 60 * 1000;
    state.performance = state.performance.filter(
      (sample) => Date.parse(sample.at) >= cutoff,
    );
  }
  async function refreshBackups() {
    if (!multicraft) return;
    for (const backup of state.backups) {
      if (!['queued', 'running'].includes(backup.status)) continue;
      const server = serverById(backup.serverId);
      if (!server) continue;
      try {
        const status = await multicraft.backupStatus(server.multicraftServerId);
        const rawStatus = String(status.status || '').toLowerCase();
        backup.status = rawStatus === 'running' ? 'running'
          : rawStatus === 'error' || rawStatus === 'failed' ? 'failed'
          : 'completed';
        backup.message = status.message || null;
        if (status.file) {
          backup.destinations = [String(status.file)];
          try {
            backup.sizeBytes = fs.statSync(String(status.file)).size;
            backup.capabilities.verify = true;
          } catch (_) {
            // File may be on a remote daemon; the API path is still useful metadata.
          }
        }
        if (backup.status === 'completed') {
          activity(server, 'Backup completed', backup.message || 'Multicraft backup completed.');
        }
      } catch (error) {
        backup.status = 'failed';
        backup.message = error.message;
        activity(server, 'Backup failed', error.message, true);
      }
    }
  }
  async function createBackup(server, kind = "manual") {
    if (!multicraft) throw new Error("Multicraft management is not configured.");
    const backup = {
      id: id("backup"),
      serverId: server.id,
      serverName: server.name,
      createdAt: isoNow(now),
      sizeBytes: null,
      status: "queued",
      engine: "multicraft",
      kind,
      verified: false,
      destinations: [],
      capabilities: backupCapabilities(),
      message: null,
    };
    state.backups.unshift(backup);
    await multicraft.startBackup(server.multicraftServerId);
    backup.status = "running";
    activity(server, "Backup started", `${kind} Multicraft backup started.`);
    persist();
    return backup;
  }

  async function executeAction(server, action, source = "scheduled") {
    if (!multicraft) throw new Error("Multicraft management is not configured.");
    if (action === "backup") return createBackup(server, source);
    if (action === "start") await multicraft.start(server.multicraftServerId);
    else if (action === "stop") await multicraft.stop(server.multicraftServerId);
    else if (action === "restart") await multicraft.restart(server.multicraftServerId);
    else if (action === "maintenance") {
      return startMaintenance(server, { countdownSeconds: 600, backup: true });
    } else throw new Error(`Unsupported scheduled action: ${action}`);
    activity(server, `${action[0].toUpperCase()}${action.slice(1)} completed`, source);
    return null;
  }
  function startMaintenance(server, options = {}) {
    const countdownSeconds = Math.max(0, Number.parseInt(options.countdownSeconds, 10) || 600);
    const existing = state.maintenance.find((item) => item.serverId === server.id);
    const maintenance = existing || { serverId: server.id, serverName: server.name };
    Object.assign(maintenance, {
      active: true,
      endsAt: new Date(now().getTime() + countdownSeconds * 1000).toISOString(),
      stage: "countdown",
      message: `Restart scheduled after ${countdownSeconds} seconds.`,
      backup: options.backup !== false,
      restartWhenEmpty: options.restartWhenEmpty === true,
      backupStarted: false,
      backupId: null,
    });
    if (!existing) state.maintenance.push(maintenance);
    activity(server, "Maintenance started", maintenance.message);
    if (multicraft) {
      void multicraft.sendConsole(
        server.multicraftServerId,
        `say Server maintenance starts in ${Math.max(1, Math.ceil(countdownSeconds / 60))} minute(s).`,
      ).catch(() => {});
    }
    persist();
    return maintenance;
  }

  function cancelMaintenance(server) {
    const maintenance = state.maintenance.find((item) => item.serverId === server.id);
    if (!maintenance || maintenance.active !== true) return false;
    maintenance.active = false;
    maintenance.stage = "cancelled";
    maintenance.message = "Maintenance cancelled.";
    maintenance.endsAt = null;
    activity(server, "Maintenance cancelled", maintenance.message);
    persist();
    return true;
  }
  async function runMaintenance(maintenance) {
    const server = serverById(maintenance.serverId);
    if (!server || !multicraft || maintenance.active !== true) return;
    const endsAt = Date.parse(maintenance.endsAt || "");
    if (Number.isFinite(endsAt) && now().getTime() < endsAt) return;

    if (maintenance.restartWhenEmpty === true) {
      const status = await multicraft.statusDetails(server.multicraftServerId);
      const players = Number.parseInt(status.onlinePlayers, 10) || 0;
      if (players > 0) {
        maintenance.stage = "waiting-empty";
        maintenance.message = `Waiting for ${players} player(s) to leave.`;
        return;
      }
    }

    if (maintenance.backup === true) {
      if (!maintenance.backupId) {
        maintenance.stage = "backup";
        maintenance.message = "Starting safety backup.";
        const backup = await createBackup(server, "maintenance");
        maintenance.backupStarted = true;
        maintenance.backupId = backup.id;
        persist();
        return;
      }

      const backup = state.backups.find((item) => item.id === maintenance.backupId);
      if (!backup) {
        maintenance.active = false;
        maintenance.stage = "failed";
        maintenance.message = "Safety backup record is missing.";
        activity(server, "Maintenance failed", maintenance.message, true);
        return;
      }
      if (backup.status === "failed") {
        maintenance.active = false;
        maintenance.stage = "failed";
        maintenance.message = backup.message || "Safety backup failed.";
        activity(server, "Maintenance failed", maintenance.message, true);
        return;
      }
      if (backup.status !== "completed") {
        maintenance.stage = "backup";
        maintenance.message = "Waiting for safety backup to complete.";
        return;
      }
    }

    maintenance.stage = "restarting";
    maintenance.message = "Restarting server.";
    await multicraft.restart(server.multicraftServerId);
    maintenance.active = false;
    maintenance.stage = "completed";
    maintenance.message = "Maintenance completed.";
    maintenance.endsAt = null;
    activity(server, "Maintenance completed", "Server restart requested.");
  }

  async function runSchedules() {
    for (const schedule of state.schedules) {
      if (schedule.enabled !== true || !schedule.nextRun) continue;
      if (Date.parse(schedule.nextRun) > now().getTime()) continue;
      const server = serverById(schedule.serverId);
      if (!server) {
        schedule.lastResult = "Server mapping unavailable.";
      } else {
        try {
          await executeAction(server, schedule.action, "scheduled");
          schedule.lastResult = `Success at ${isoNow(now)}`;
        } catch (error) {
          schedule.lastResult = `Failed: ${error.message}`;
          activity(server, "Scheduled action failed", error.message, true);
        }
      }
      const next = nextCron(schedule.schedule, now());
      schedule.nextRun = next?.toISOString() || null;
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await refreshBackups();
      await runSchedules();
      for (const maintenance of state.maintenance) {
        await runMaintenance(maintenance);
      }
      const sampleInterval = Math.max(60000, Number.parseInt(
        config.performanceSampleMilliseconds || process.env.MANAGEMENT_PERFORMANCE_SAMPLE_MS,
        10,
      ) || 300000);
      if (now().getTime() - lastPerformanceSampleAt >= sampleInterval) {
        for (const server of servers) await recordPerformance(server);
        lastPerformanceSampleAt = now().getTime();
      }
      persist();
    } finally {
      ticking = false;
    }
  }
  function rangeMilliseconds(range) {
    return switchRange(range, {
      "1h": 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    }, 60 * 60 * 1000);
  }

  function switchRange(value, values, fallback) {
    return Object.prototype.hasOwnProperty.call(values, value)
      ? values[value]
      : fallback;
  }

  function performanceFrame(serverId, range) {
    const cutoff = now().getTime() - rangeMilliseconds(range);
    return {
      type: "admincraft.performance-history",
      serverId,
      range,
      samples: state.performance.filter(
        (sample) => sample.serverId === serverId && Date.parse(sample.at) >= cutoff,
      ),
    };
  }

  function requireServer(payload = {}) {
    const serverId = String(payload.serverId || "").trim();
    const server = serverById(serverId);
    if (!server) throw new Error(`Unknown management server: ${serverId || "<empty>"}.`);
    return server;
  }

  function findBackup(payload = {}) {
    const backupId = String(payload.backupId || "").trim();
    const backup = state.backups.find((item) => item.id === backupId);
    if (!backup) throw new Error("Backup record not found.");
    return backup;
  }

  function response(message, events = []) {
    return {
      success: true,
      message,
      refresh: false,
      events,
    };
  }

  function failure(message) {
    return {
      success: false,
      message,
      refresh: false,
      events: [],
    };
  }

  async function handle(action, payload = {}) {
    try {
      if (action === "snapshot") {
        return response("Management snapshot refreshed.", [snapshot()]);
      }

      if (action === "backup-create") {
        const server = requireServer(payload);
        if (payload.engine && payload.engine !== "multicraft") {
          throw new Error(`Backup engine ${payload.engine} is not available.`);
        }
        await createBackup(server, "manual");
        return response("Backup started.", [snapshot()]);
      }

      if (action === "backup-verify") {
        const backup = findBackup(payload);
        const destination = backup.destinations.find((item) => fs.existsSync(item));
        if (!destination) throw new Error("Backup file is not locally accessible for verification.");
        const digest = await hashFile(destination);
        backup.verified = true;
        backup.checksum = `sha256:${digest}`;
        persist();
        return response("Backup verified.", [snapshot()]);
      }

      if (["backup-delete", "backup-restore", "backup-download", "backup-copy"].includes(action)) {
        throw new Error("This backup operation is not supported by the configured engine.");
      }

      if (action === "schedule-create") {
        const server = requireServer(payload);
        const scheduledAction = String(payload.action || "").trim();
        const allowed = ["start", "stop", "restart", "backup", "maintenance"];
        if (!allowed.includes(scheduledAction)) throw new Error("Unsupported scheduled action.");
        const expression = String(payload.schedule || "").trim();
        const nextRun = nextCron(expression, now());
        if (!nextRun) throw new Error("Invalid or unsupported cron expression.");
        state.schedules.push({
          id: id("schedule"),
          serverId: server.id,
          serverName: server.name,
          action: scheduledAction,
          schedule: expression,
          nextRun: nextRun.toISOString(),
          enabled: true,
          lastResult: null,
        });
        persist();
        return response("Schedule created.", [snapshot()]);
      }

      if (action === "schedule-toggle") {
        const schedule = state.schedules.find((item) => item.id === String(payload.id || ""));
        if (!schedule) throw new Error("Schedule not found.");
        schedule.enabled = payload.enabled === true;
        if (schedule.enabled) {
          schedule.nextRun = nextCron(schedule.schedule, now())?.toISOString() || null;
        }
        persist();
        return response(schedule.enabled ? "Schedule enabled." : "Schedule disabled.", [snapshot()]);
      }

      if (action === "schedule-delete") {
        const before = state.schedules.length;
        state.schedules = state.schedules.filter((item) => item.id !== String(payload.id || ""));
        if (state.schedules.length === before) throw new Error("Schedule not found.");
        persist();
        return response("Schedule deleted.", [snapshot()]);
      }

      if (action === "maintenance-start") {
        const server = requireServer(payload);
        startMaintenance(server, payload);
        return response("Maintenance started.", [snapshot()]);
      }

      if (action === "maintenance-cancel") {
        const server = requireServer(payload);
        if (!cancelMaintenance(server)) throw new Error("No active maintenance flow found.");
        return response("Maintenance cancelled.", [snapshot()]);
      }

      if (action === "performance-history") {
        const server = requireServer(payload);
        const range = String(payload.range || "1h");
        return response(
          "Performance history refreshed.",
          [performanceFrame(server.id, range)],
        );
      }

      if (action === "updates-check") {
        if (typeof dependencies.updateChecker === "function") {
          state.updates = await dependencies.updateChecker({
            servers: servers.map((server) => ({ ...server })),
            providers: payload.providers || {},
            serverId: payload.serverId || null,
          });
          persist();
          return response("Update check completed.", [snapshot()]);
        }
        return response("Update checking is not configured on this bridge.", [snapshot()]);
      }

      throw new Error(`Unknown management action: ${action}.`);
    } catch (error) {
      return failure(error.message || "Management action failed.");
    }
  }

  function start() {
    if (timer || servers.length === 0 || !multicraft) return false;
    const interval = Math.max(
      5000,
      Number.parseInt(config.tickMilliseconds || process.env.MANAGEMENT_TICK_MS, 10) || 15000,
    );
    timer = setIntervalImpl(() => {
      void tick()
        .then(() => dependencies.onSnapshot?.(snapshot()))
        .catch((error) => console.error(`Management tick failed: ${error.message}`));
    }, interval);
    timer.unref?.();
    void tick()
      .then(() => dependencies.onSnapshot?.(snapshot()))
      .catch((error) => console.error(`Initial management tick failed: ${error.message}`));
    return true;
  }

  function stop() {
    if (!timer) return;
    clearIntervalImpl(timer);
    timer = null;
  }

  return {
    enabled: servers.length > 0 && Boolean(multicraft),
    servers: servers.map((server) => ({ ...server })),
    snapshot,
    handle,
    tick,
    start,
    stop,
  };
}

module.exports = { createManagementService, nextCron, parseServers };
