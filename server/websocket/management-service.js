const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  parseBackupStorages,
  copyToStorage,
  deleteFromStorage,
  probeStorage,
  storageSnapshot,
  testStorageConnection,
} = require("./backup-storage");
const {
  parseBackupEngines,
  engineDescriptors,
  createNativeArchive,
  restoreNativeArchive,
  waitStopped,
  capabilities,
} = require("./backup-engines");
const { enrichBackupEngineCatalog } = require("./backup-engine-catalog");
const {
  combineBackupEngines,
  loadManagedBackupEngines,
  normalizeManagedBackupEngine,
  saveManagedBackupEngines,
} = require("./backup-engine-config");
const {
  combineStorages,
  loadManagedStorages,
  normalizeManagedStorage,
  saveManagedStorages,
} = require("./storage-config");
const {
  parseBackupRetention,
  effectiveRetention,
  retentionPlan,
} = require("./backup-policy");
const {
  parseMaintenancePolicies,
  policyFor,
  renderMessage,
  publicMaintenancePolicy,
} = require("./maintenance-policy");

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
function appendedLogLines(previous = [], current = []) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(current) ? current : [];
  const max = Math.min(before.length, after.length);
  for (let overlap = max; overlap >= 0; overlap--) {
    let matches = true;
    for (let index = 0; index < overlap; index++) {
      if (before[before.length - overlap + index] !== after[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return after.slice(overlap);
  }
  return [...after];
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
    if (!Array.isArray(parsed))
      throw new Error("MANAGEMENT_SERVERS_JSON must be an array.");
    const servers = parsed.map((entry, index) => {
      const id = String(entry?.id || entry?.name || "").trim();
      const name = String(entry?.name || entry?.id || "Server").trim();
      const multicraftServerId = Number.parseInt(entry?.multicraftServerId, 10);
      if (
        !id ||
        !Number.isInteger(multicraftServerId) ||
        multicraftServerId < 1
      ) {
        throw new Error(`Invalid management server mapping at index ${index}.`);
      }
      return {
        id,
        name,
        multicraftServerId,
        defaultBackupEngineId:
          String(entry?.defaultBackupEngineId || "multicraft").trim() ||
          "multicraft",
      };
    });
    const ids = new Set();
    const multicraftIds = new Set();
    for (const server of servers) {
      if (ids.has(server.id))
        throw new Error(`Duplicate management server ID: ${server.id}.`);
      if (multicraftIds.has(server.multicraftServerId)) {
        throw new Error(
          `Duplicate Multicraft server ID: ${server.multicraftServerId}.`,
        );
      }
      ids.add(server.id);
      multicraftIds.add(server.multicraftServerId);
    }
    return servers;
  }

  const multicraftServerId = Number.parseInt(
    config.multicraftServerId || process.env.MULTICRAFT_SERVER_ID,
    10,
  );
  if (!Number.isInteger(multicraftServerId) || multicraftServerId < 1)
    return [];
  return [
    {
      id: config.serverId || process.env.MANAGEMENT_SERVER_ID || "lobby",
      name: config.serverName || process.env.MANAGEMENT_SERVER_NAME || "Lobby",
      multicraftServerId,
      defaultBackupEngineId: "multicraft",
    },
  ];
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
    return (
      Number.isInteger(number) &&
      number >= min &&
      number <= max &&
      value === number
    );
  });
}

function nextCron(schedule, from = new Date()) {
  const fields = String(schedule).trim().split(/\s+/u);
  if (fields.length !== 5) return null;
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];
  if (!fields.every((field, index) => validField(field, ...ranges[index])))
    return null;
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = new Date(cursor.getTime() + 366 * 24 * 60 * 60 * 1000);
  while (cursor <= limit) {
    const matches =
      fieldMatches(cursor.getMinutes(), fields[0], 0, 59) &&
      fieldMatches(cursor.getHours(), fields[1], 0, 23) &&
      fieldMatches(cursor.getDate(), fields[2], 1, 31) &&
      fieldMatches(cursor.getMonth() + 1, fields[3], 1, 12) &&
      fieldMatches(cursor.getDay(), fields[4], 0, 6);
    if (matches) return cursor;
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return null;
}
function createManagementService(config = {}, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const setIntervalImpl = dependencies.setInterval || setInterval;
  const clearIntervalImpl = dependencies.clearInterval || clearInterval;
  const statePath =
    config.statePath ||
    process.env.MANAGEMENT_STATE_PATH ||
    path.join(process.cwd(), "data", "management-state.json");
  const servers = parseServers(config);
  const multicraft = dependencies.multicraft;
  const performance =
    dependencies.performance || dependencies.planPerformance || null;
  const externalStorages = parseBackupStorages({
    storagesJson: config.storagesJson,
  });
  const legacyStoragePath =
    config.storagePath || process.env.MANAGEMENT_STORAGE_PATH || "";
  if (externalStorages.length === 0 && legacyStoragePath) {
    externalStorages.push({
      id: "management-local",
      name: "Management host",
      type: "local",
      path: legacyStoragePath,
      remote: "",
      basePath: "",
      url: "",
      username: "",
      password: "",
      softLimitBytes: null,
      minimumFreeBytes: null,
      warningFreePercent: 15,
      criticalFreePercent: 5,
    });
  }
  const managedStorageConfigPath =
    config.storageConfigPath ||
    process.env.MANAGEMENT_STORAGE_CONFIG_PATH ||
    path.join(path.dirname(statePath), "backup-storages.json");
  let managedStorages = loadManagedStorages(managedStorageConfigPath);
  let storages = combineStorages(externalStorages, managedStorages);
  const storageById = (storageId) =>
    storages.find((storage) => storage.id === storageId);
  const externalEngines = parseBackupEngines(
    { enginesJson: config.enginesJson },
    servers,
    new Set(storages.map((storage) => storage.id)),
  );
  const managedEngineConfigPath =
    config.engineConfigPath ||
    process.env.MANAGEMENT_BACKUP_ENGINE_CONFIG_PATH ||
    path.join(path.dirname(statePath), "backup-engines.json");
  let managedEngines = loadManagedBackupEngines(
    managedEngineConfigPath,
    servers,
    new Set(storages.map((storage) => storage.id)),
  );
  let engines = [];
  const engineById = (engineId) =>
    engines.find((engine) => engine.id === engineId);
  function rebuildEngines(nextManaged = managedEngines) {
    managedEngines = nextManaged;
    engines = enrichBackupEngineCatalog({
      engines: combineBackupEngines(externalEngines, managedEngines),
      servers,
      capabilities,
      sourceRoot:
        config.nativeSourceRoot ||
        process.env.MANAGEMENT_NATIVE_SOURCE_ROOT ||
        "/minecraft",
      stagingRoot:
        config.nativeBackupPath ||
        process.env.MANAGEMENT_NATIVE_BACKUP_PATH ||
        "/backups",
    });
  }
  rebuildEngines();
  for (const server of servers) {
    if (server.defaultBackupEngineId === "multicraft") continue;
    const engine = engineById(server.defaultBackupEngineId);
    if (!engine || engine.serverId !== server.id) {
      throw new Error(
        `Unknown default backup engine for management server ${server.id}.`,
      );
    }
  }
  const initialRetention = parseBackupRetention(
    config.retentionJson || process.env.BACKUP_RETENTION_JSON || "",
    servers.map((server) => server.id),
  );
  const maintenancePolicies = parseMaintenancePolicies(
    config.maintenanceConfigJson || process.env.MAINTENANCE_CONFIG_JSON || "",
    servers.map((server) => server.id),
  );
  const nativeBackupRoot =
    config.nativeBackupPath ||
    process.env.MANAGEMENT_NATIVE_BACKUP_PATH ||
    path.join(path.dirname(statePath), "backups");
  const commandBackupObservers = new Map();
  const state = readJson(statePath, {
    backups: [],
    schedules: [],
    jobHistory: [],
    maintenance: [],
    updates: [],
    updateSourceOverrides: {},
    activity: [],
    storageMetrics: {},
    backupDestinationDefaults: { global: [], servers: {} },
    retentionConfig: null,
  });
  let timer = null;
  let ticking = false;
  let lastStorageProbeAt = 0;
  if (
    !state.storageMetrics ||
    typeof state.storageMetrics !== "object" ||
    Array.isArray(state.storageMetrics)
  ) {
    state.storageMetrics = {};
  }
  if (
    !state.updateSourceOverrides ||
    typeof state.updateSourceOverrides !== "object" ||
    Array.isArray(state.updateSourceOverrides)
  ) {
    state.updateSourceOverrides = {};
  }
  if (
    !state.backupDestinationDefaults ||
    typeof state.backupDestinationDefaults !== "object" ||
    Array.isArray(state.backupDestinationDefaults)
  ) {
    state.backupDestinationDefaults = { global: [], servers: {} };
  }
  state.backupDestinationDefaults.global = Array.isArray(
    state.backupDestinationDefaults.global,
  )
    ? state.backupDestinationDefaults.global
    : [];
  if (
    !state.backupDestinationDefaults.servers ||
    typeof state.backupDestinationDefaults.servers !== "object" ||
    Array.isArray(state.backupDestinationDefaults.servers)
  ) {
    state.backupDestinationDefaults.servers = {};
  }

  let retention = initialRetention;
  if (
    state.retentionConfig &&
    typeof state.retentionConfig === "object" &&
    !Array.isArray(state.retentionConfig)
  ) {
    retention = parseBackupRetention(
      JSON.stringify(state.retentionConfig),
      servers.map((server) => server.id),
    );
  } else {
    state.retentionConfig = {
      global: { ...initialRetention.global },
      servers: Object.fromEntries(
        Object.entries(initialRetention.servers).map(([serverId, policy]) => [
          serverId,
          { ...policy },
        ]),
      ),
    };
  }
  const serverById = (serverId) =>
    servers.find((server) => server.id === serverId);
  if (Object.prototype.hasOwnProperty.call(state, "performance"))
    delete state.performance;
  for (const key of [
    "backups",
    "schedules",
    "jobHistory",
    "maintenance",
    "updates",
    "activity",
  ]) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  for (const backup of state.backups) {
    if (
      ["plugin", "custom"].includes(backup.engine) &&
      backup.status === "running"
    ) {
      backup.status = "unknown";
      backup.message =
        "Backup observation was interrupted by a management bridge restart.";
    }
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
      create: true,
      list: true,
      progress: true,
      restore: false,
      download: false,
      delete: false,
      verify: false,
      copy: false,
      remoteDestination: false,
    };
  }
  function backupPublic(backup) {
    const { localPath, destinationLocators, ...publicBackup } = backup;
    return publicBackup;
  }

  function storageSnapshots() {
    return storages.map((storage) =>
      storageSnapshot(
        storage,
        state.backups,
        state.storageMetrics[storage.id] || {},
      ),
    );
  }

  async function refreshStorageMetrics() {
    for (const storage of storages) {
      state.storageMetrics[storage.id] = await probeStorage(
        storage,
        dependencies,
      );
    }
  }

  function snapshot() {
    return {
      type: "admincraft.management-state",
      observedAt: isoNow(now),
      storages: storageSnapshots(),
      backupDestinationDefaults: {
        global: [...state.backupDestinationDefaults.global],
        servers: Object.fromEntries(
          Object.entries(state.backupDestinationDefaults.servers).map(
            ([serverId, ids]) => [serverId, Array.isArray(ids) ? [...ids] : []],
          ),
        ),
      },
      backupEngines: engineDescriptors(
        engines,
        servers,
        Boolean(multicraft),
        storages.map((storage) => storage.id),
      ),
      backups: state.backups.map(backupPublic),
      schedules: state.schedules,
      jobHistory: state.jobHistory,
      maintenance: state.maintenance,
      maintenancePolicies: {
        global: publicMaintenancePolicy(maintenancePolicies.global),
        servers: Object.fromEntries(
          Object.entries(maintenancePolicies.servers).map(
            ([serverId, policy]) => [serverId, publicMaintenancePolicy(policy)],
          ),
        ),
      },
      updates: state.updates || [],
      updateApply: dependencies.updateApplier?.descriptor?.() || {
        configured: false,
        pluginUpdates: false,
        rollback: false,
      },
      activity: state.activity,
      performanceSource: performance?.descriptor?.() || {
        type: "admincraft",
        configured: false,
        canonical: false,
      },
      retention: {
        global: { ...retention.global },
        servers: { ...retention.servers },
        summaries: retentionPlan(state.backups, retention).summaries,
      },
    };
  }

  async function refreshBackups() {
    if (!multicraft) return;
    for (const backup of state.backups) {
      if (
        backup.engine !== "multicraft" ||
        !["queued", "running"].includes(backup.status)
      )
        continue;
      const server = serverById(backup.serverId);
      if (!server) continue;
      try {
        const status = await multicraft.backupStatus(server.multicraftServerId);
        const rawStatus = String(status.status || "").toLowerCase();
        backup.status =
          rawStatus === "running"
            ? "running"
            : rawStatus === "error" || rawStatus === "failed"
              ? "failed"
              : "completed";
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
        if (backup.status === "completed") {
          activity(
            server,
            "Backup completed",
            backup.message || "Multicraft backup completed.",
          );
        }
        settleBackupJob(backup);
      } catch (error) {
        backup.status = "failed";
        backup.message = error.message;
        activity(server, "Backup failed", error.message, true);
        settleBackupJob(backup);
      }
    }
  }
  function activeBackupFor(serverId) {
    return (
      state.backups.find(
        (backup) =>
          backup.serverId === serverId &&
          ["queued", "running"].includes(backup.status),
      ) || null
    );
  }

  async function createMulticraftBackup(server, kind = "manual") {
    if (!multicraft)
      throw new Error("Multicraft management is not configured.");
    if (activeBackupFor(server.id)) {
      throw new Error("A backup is already in progress for this server.");
    }
    const backup = {
      id: id("backup"),
      serverId: server.id,
      serverName: server.name,
      createdAt: isoNow(now),
      sizeBytes: null,
      status: "queued",
      engine: "multicraft",
      engineId: "multicraft",
      engineLabel: "Multicraft",
      backupType: "server-backup",
      kind,
      verified: false,
      destinations: [],
      capabilities: backupCapabilities(),
      message: null,
    };
    state.backups.unshift(backup);
    try {
      await multicraft.startBackup(server.multicraftServerId);
      backup.status = "running";
      activity(server, "Backup started", `${kind} Multicraft backup started.`);
      persist();
      return backup;
    } catch (error) {
      backup.status = "failed";
      backup.message =
        error.message || "Multicraft backup could not be started.";
      activity(server, "Backup failed", backup.message, true);
      persist();
      throw error;
    }
  }

  function defaultStorageIds(serverId) {
    const serverOverride = state.backupDestinationDefaults.servers?.[serverId];
    if (Array.isArray(serverOverride) && serverOverride.length > 0)
      return serverOverride;
    if (
      Array.isArray(state.backupDestinationDefaults.global) &&
      state.backupDestinationDefaults.global.length > 0
    ) {
      return state.backupDestinationDefaults.global;
    }
    return [];
  }

  function requestedStorageIds(
    engine,
    payload = {},
    serverId = engine.serverId,
  ) {
    const requested = Array.isArray(payload.destinationIds)
      ? payload.destinationIds
      : Array.isArray(payload.destinations)
        ? payload.destinations
        : [];
    const inherited = defaultStorageIds(serverId);
    let values =
      requested.length > 0
        ? requested
        : inherited.length > 0
          ? inherited
          : engine.destinationIds;
    if (values.length === 0 && storages.length === 1) values = [storages[0].id];
    return [
      ...new Set(values.map((value) => String(value).trim()).filter(Boolean)),
    ];
  }

  async function assertStorageSafeguards(storageIds) {
    for (const storageId of storageIds) {
      const storage = storageById(storageId);
      if (!storage) throw new Error(`Unknown backup storage: ${storageId}.`);
      const metrics = await probeStorage(storage, dependencies);
      state.storageMetrics[storage.id] = metrics;
      const current = storageSnapshot(storage, state.backups, metrics);
      if (current.safeguardBlocked)
        throw new Error(`Minimum free space reached on ${storage.name}.`);
      if (
        current.softLimitBytes != null &&
        current.backupBytes >= current.softLimitBytes
      )
        throw new Error(`Backup soft limit reached on ${storage.name}.`);
    }
  }

  async function copyBackupToDestinations(backup, storageIds) {
    if (!backup.localPath)
      throw new Error("Backup has no local source for copying.");
    backup.destinationLocators ||= {};
    for (const storageId of storageIds) {
      const storage = storageById(storageId);
      if (!storage) throw new Error(`Unknown backup storage: ${storageId}.`);
      const result = await copyToStorage(
        storage,
        backup.localPath,
        backup.serverId,
        dependencies,
      );
      backup.destinationLocators[storageId] = result.locator;
      if (!backup.destinations.includes(storageId))
        backup.destinations.push(storageId);
    }
  }

  async function refreshCommandBackups() {
    if (!multicraft || typeof multicraft.log !== "function") return;
    for (const [backupId, observer] of commandBackupObservers) {
      const backup = state.backups.find((item) => item.id === backupId);
      if (!backup || backup.status !== "running") {
        commandBackupObservers.delete(backupId);
        continue;
      }
      const server = serverById(backup.serverId);
      if (!server) {
        backup.status = "failed";
        backup.message =
          "Server mapping disappeared while observing backup completion.";
        settleBackupJob(backup);
        commandBackupObservers.delete(backupId);
        continue;
      }
      if (now().getTime() >= observer.deadline) {
        backup.status = "failed";
        backup.message = `Backup completion was not observed within ${observer.timeoutSeconds} seconds.`;
        activity(server, "Backup failed", backup.message, true);
        settleBackupJob(backup);
        commandBackupObservers.delete(backupId);
        continue;
      }
      let current;
      try {
        current = await multicraft.log(server.multicraftServerId);
      } catch (_) {
        continue;
      }
      const lines = appendedLogLines(observer.lastLines, current);
      observer.lastLines = current;
      const failed =
        observer.failure && lines.some((line) => observer.failure.test(line));
      if (failed) {
        backup.status = "failed";
        backup.message = "Backup plugin reported a failure.";
        activity(server, "Backup failed", backup.message, true);
        commandBackupObservers.delete(backupId);
        continue;
      }
      if (lines.some((line) => observer.completion.test(line))) {
        backup.status = "completed";
        backup.message = `${backup.engineLabel} reported completion.`;
        activity(server, "Backup completed", backup.message);
        settleBackupJob(backup);
        commandBackupObservers.delete(backupId);
      }
    }
  }

  async function createConsistentNativeArchive(server, engine, kind) {
    if (engine.consistency === "live") {
      return createNativeArchive(engine, server, nativeBackupRoot, {
        ...dependencies,
        now: now(),
      });
    }
    if (!multicraft)
      throw new Error(
        "Multicraft is required for an offline-consistent native backup.",
      );
    const wasRunning =
      (await multicraft.status(server.multicraftServerId)) === "running";
    const keepStopped = kind === "maintenance" || kind === "pre-restore";
    let archive = null;
    let operationError = null;
    try {
      if (wasRunning) {
        activity(
          server,
          "Native backup quiescing",
          "Stopping server for an offline-consistent snapshot.",
        );
        await multicraft.stop(server.multicraftServerId);
        await waitStopped(multicraft, server.multicraftServerId, dependencies);
      }
      archive = await createNativeArchive(engine, server, nativeBackupRoot, {
        ...dependencies,
        now: now(),
      });
    } catch (error) {
      operationError = error;
    }
    if (wasRunning && !keepStopped) {
      try {
        await multicraft.start(server.multicraftServerId);
      } catch (error) {
        if (!operationError) {
          operationError = new Error(
            `Native backup archive was created but the server could not be restarted: ${error.message}`,
          );
        }
      }
    }
    if (operationError) throw operationError;
    return archive;
  }

  async function createConfiguredBackup(server, engine, kind, payload = {}) {
    if (activeBackupFor(server.id))
      throw new Error("A backup is already in progress for this server.");
    const backup = {
      id: id("backup"),
      serverId: server.id,
      serverName: server.name,
      createdAt: isoNow(now),
      sizeBytes: 0,
      status: "running",
      engine: engine.type,
      engineId: engine.id,
      engineLabel: engine.label,
      backupType: engine.backupType,
      kind,
      verified: false,
      destinations: [],
      capabilities: { ...engine.capabilities },
      message: null,
      localPath: null,
      destinationLocators: {},
    };
    state.backups.unshift(backup);
    persist();
    try {
      if (engine.type === "native") {
        const destinationIds = requestedStorageIds(engine, payload);
        await assertStorageSafeguards(destinationIds);
        backup.localPath = await createConsistentNativeArchive(
          server,
          engine,
          kind,
        );
        backup.sizeBytes = fs.statSync(backup.localPath).size;
        await copyBackupToDestinations(backup, destinationIds);
        backup.status = "completed";
        backup.message = "AdminCraft Native backup completed.";
        activity(server, "Backup completed", backup.message);
      } else {
        if (!multicraft)
          throw new Error(
            "Multicraft is required to dispatch backup commands.",
          );
        let baseline = null;
        if (engine.completionRegex) {
          if (typeof multicraft.log !== "function") {
            throw new Error(
              "This backup engine requires Multicraft log access for completion observation.",
            );
          }
          baseline = await multicraft.log(server.multicraftServerId);
        }
        await multicraft.sendConsole(server.multicraftServerId, engine.command);
        if (engine.completionRegex) {
          backup.status = "running";
          backup.message = `Waiting for ${engine.label} completion.`;
          commandBackupObservers.set(backup.id, {
            lastLines: baseline,
            completion: new RegExp(engine.completionRegex, "u"),
            failure: engine.failureRegex
              ? new RegExp(engine.failureRegex, "u")
              : null,
            timeoutSeconds: engine.completionTimeoutSeconds,
            deadline: now().getTime() + engine.completionTimeoutSeconds * 1000,
          });
        } else {
          backup.status = "unknown";
          backup.message =
            "Backup command dispatched; completion is not observable by the central bridge.";
        }
        activity(
          server,
          "Backup command sent",
          `${engine.label}: ${engine.command}`,
        );
      }
      persist();
      return backup;
    } catch (error) {
      backup.status = "failed";
      backup.message = error.message || "Backup failed.";
      activity(server, "Backup failed", backup.message, true);
      persist();
      throw error;
    }
  }

  function backupEngineIdFor(server, requested) {
    const engineId = String(
      requested || server.defaultBackupEngineId || "multicraft",
    ).trim();
    if (engineId === "multicraft") return engineId;
    const engine = engineById(engineId);
    if (!engine || engine.serverId !== server.id) {
      throw new Error(
        `Backup engine ${engineId || "<empty>"} is not available for ${server.id}.`,
      );
    }
    return engineId;
  }

  async function createBackupForServer(server, payload = {}, kind = "manual") {
    const engineId = backupEngineIdFor(
      server,
      payload.engineId || payload.engine,
    );
    if (engineId === "multicraft") return createMulticraftBackup(server, kind);
    return createConfiguredBackup(server, engineById(engineId), kind, payload);
  }

  function backupCompletionObservable(server, requestedEngineId) {
    const engineId = backupEngineIdFor(server, requestedEngineId);
    if (engineId === "multicraft") return true;
    const engine = engineById(engineId);
    if (engine?.type === "native") return true;
    return Boolean(
      engine?.completionRegex && typeof multicraft?.log === "function",
    );
  }

  function finishJob(jobId, success, message) {
    if (!jobId) return null;
    const job = state.jobHistory.find((item) => item.id === jobId);
    if (!job || job.finishedAt) return job || null;
    job.success = success;
    job.message = message;
    job.finishedAt = isoNow(now);
    if (job.scheduleId) {
      const schedule = state.schedules.find(
        (item) => item.id === job.scheduleId,
      );
      if (schedule) {
        schedule.lastResult =
          success === true
            ? `Success at ${job.finishedAt}: ${message}`
            : success === false
              ? `Failed: ${message}`
              : message;
      }
    }
    return job;
  }

  function settleBackupJob(backup) {
    if (!backup?.jobId) return;
    if (backup.status === "completed")
      finishJob(backup.jobId, true, backup.message || "Backup completed.");
    else if (backup.status === "failed")
      finishJob(backup.jobId, false, backup.message || "Backup failed.");
  }

  async function executeAction(
    server,
    action,
    source = "scheduled",
    options = {},
  ) {
    if (!multicraft)
      throw new Error("Multicraft management is not configured.");
    if (action === "backup") {
      return createBackupForServer(
        server,
        {
          engineId: options.backupEngineId,
          destinationIds: options.destinationIds,
        },
        source,
      );
    }
    if (action === "start") await multicraft.start(server.multicraftServerId);
    else if (action === "stop")
      await multicraft.stop(server.multicraftServerId);
    else if (action === "restart")
      await multicraft.restart(server.multicraftServerId);
    else if (action === "maintenance") {
      return startMaintenance(server, {
        countdownSeconds: options.countdownSeconds ?? 600,
        backup: options.backup ?? true,
        backupEngineId: options.backupEngineId,
        restartWhenEmpty: options.restartWhenEmpty,
        action: options.action,
      });
    } else throw new Error(`Unsupported scheduled action: ${action}`);
    activity(
      server,
      `${action[0].toUpperCase()}${action.slice(1)} completed`,
      source,
    );
    return null;
  }
  async function executeJob(
    server,
    action,
    source,
    scheduleId = null,
    options = {},
  ) {
    const job = {
      id: id("job"),
      scheduleId,
      serverId: server.id,
      serverName: server.name,
      action,
      source,
      startedAt: isoNow(now),
      finishedAt: null,
      success: null,
      message: "Running",
    };
    state.jobHistory.unshift(job);
    state.jobHistory = state.jobHistory.slice(0, 250);
    try {
      const result = await executeAction(server, action, source, options);
      if (action === "backup" && result) {
        result.jobId = job.id;
        if (result.status === "completed")
          finishJob(job.id, true, result.message || "Backup completed.");
        else if (result.status === "failed")
          finishJob(job.id, false, result.message || "Backup failed.");
        else if (result.status === "unknown")
          finishJob(
            job.id,
            null,
            result.message ||
              "Backup dispatched; completion is not observable.",
          );
        else job.message = "Backup running.";
      } else if (action === "maintenance" && result) {
        result.jobId = job.id;
        job.message = "Maintenance running.";
      } else {
        finishJob(job.id, true, `${action} completed.`);
      }
      persist();
      return job;
    } catch (error) {
      finishJob(job.id, false, error.message || "Job failed.");
      persist();
      throw error;
    }
  }

  function sayMaintenance(server, message) {
    if (!multicraft || !message) return;
    void multicraft
      .sendConsole(server.multicraftServerId, `say ${message}`)
      .catch(() => {});
  }

  function startMaintenance(server, options = {}) {
    const backupEngineId = backupEngineIdFor(server, options.backupEngineId);
    if (
      options.backup !== false &&
      !backupCompletionObservable(server, backupEngineId)
    ) {
      throw new Error(
        "Safety backup requires an engine whose completion can be verified.",
      );
    }
    const requestedCountdown = Number.parseInt(options.countdownSeconds, 10);
    const countdownSeconds = Number.isInteger(requestedCountdown)
      ? Math.max(0, Math.min(86400, requestedCountdown))
      : 600;
    const requestedAction = String(options.action || "");
    const action = ["restart", "stop", "update"].includes(requestedAction)
      ? requestedAction
      : "restart";
    let updatePlan = null;
    if (action === "update") {
      if (
        typeof dependencies.updateApplier?.plan !== "function" ||
        dependencies.updateApplier?.descriptor?.().configured !== true
      ) {
        throw new Error(
          "Automatic plugin update apply is not configured on this bridge.",
        );
      }
      updatePlan = dependencies.updateApplier.plan(server, state.updates || []);
      if (
        !Array.isArray(updatePlan.selected) ||
        updatePlan.selected.length === 0
      ) {
        const detail = (updatePlan.skipped || [])
          .map((item) => item.reason)
          .filter(Boolean)
          .join("; ");
        throw new Error(
          detail ||
            "No applicable plugin updates are available for this server.",
        );
      }
    }
    const policy = policyFor(maintenancePolicies, server.id);
    const existing = state.maintenance.find(
      (item) => item.serverId === server.id,
    );
    const maintenance = existing || {
      serverId: server.id,
      serverName: server.name,
    };
    Object.assign(maintenance, {
      active: true,
      action,
      endsAt: new Date(now().getTime() + countdownSeconds * 1000).toISOString(),
      stage: "countdown",
      message: `Maintenance ${action} scheduled after ${countdownSeconds} seconds.`,
      backup: options.backup !== false,
      backupEngineId,
      restartWhenEmpty: options.restartWhenEmpty === true,
      backupStarted: false,
      backupId: null,
      announcedMilestones: policy.milestonesSeconds.includes(countdownSeconds)
        ? [countdownSeconds]
        : [],
      lastWaitingPlayers: null,
      actionStarted: false,
      updatePlugins:
        updatePlan?.selected?.map((item) => item.update.plugin) || [],
      updateApplied: [],
      healthcheckAttempts: 0,
      healthcheckSeenOffline: false,
      nextHealthcheckAt: null,
    });
    if (!existing) state.maintenance.push(maintenance);
    activity(server, "Maintenance started", maintenance.message);
    if (countdownSeconds <= 0) {
      sayMaintenance(server, policy.startingMessage);
    } else {
      sayMaintenance(
        server,
        renderMessage(policy.countdownMessage, { seconds: countdownSeconds }),
      );
    }
    persist();
    return maintenance;
  }

  function cancelMaintenance(server) {
    const maintenance = state.maintenance.find(
      (item) => item.serverId === server.id,
    );
    if (!maintenance || maintenance.active !== true) return false;
    const policy = policyFor(maintenancePolicies, server.id);
    maintenance.active = false;
    maintenance.stage = "cancelled";
    maintenance.message = "Maintenance cancelled.";
    maintenance.endsAt = null;
    sayMaintenance(server, policy.cancelledMessage);
    activity(server, "Maintenance cancelled", maintenance.message);
    finishJob(maintenance.jobId, null, maintenance.message);
    persist();
    return true;
  }

  function announceCountdown(server, maintenance, policy) {
    const endsAt = Date.parse(maintenance.endsAt || "");
    if (!Number.isFinite(endsAt)) return;
    const remaining = Math.max(0, Math.ceil((endsAt - now().getTime()) / 1000));
    maintenance.announcedMilestones ||= [];
    for (const milestone of policy.milestonesSeconds) {
      if (
        remaining <= milestone &&
        !maintenance.announcedMilestones.includes(milestone)
      ) {
        maintenance.announcedMilestones.push(milestone);
        sayMaintenance(
          server,
          renderMessage(policy.countdownMessage, { seconds: milestone }),
        );
      }
    }
  }
  async function runMaintenance(maintenance) {
    const server = serverById(maintenance.serverId);
    if (!server || !multicraft || maintenance.active !== true) return;
    const policy = policyFor(maintenancePolicies, server.id);
    const endsAt = Date.parse(maintenance.endsAt || "");

    if (
      maintenance.stage === "countdown" &&
      Number.isFinite(endsAt) &&
      now().getTime() < endsAt
    ) {
      announceCountdown(server, maintenance, policy);
      return;
    }

    if (maintenance.stage === "healthcheck") {
      const nextAt = Date.parse(maintenance.nextHealthcheckAt || "");
      if (Number.isFinite(nextAt) && now().getTime() < nextAt) return;
      const status = await multicraft.status(server.multicraftServerId);
      maintenance.healthcheckAttempts =
        (maintenance.healthcheckAttempts || 0) + 1;
      const restartLike = ["restart", "update"].includes(maintenance.action);
      if (restartLike && status !== "running") {
        maintenance.healthcheckSeenOffline = true;
      }
      const healthy =
        maintenance.action === "stop"
          ? status === "stopped"
          : status === "running" &&
            (maintenance.healthcheckSeenOffline === true ||
              maintenance.healthcheckAttempts >= 2);
      if (healthy) {
        maintenance.active = false;
        maintenance.stage = "completed";
        maintenance.message =
          maintenance.action === "stop"
            ? "Server stopped for maintenance."
            : maintenance.action === "update"
              ? "Plugin update maintenance completed; " +
                (maintenance.updateApplied?.length || 0) +
                " update(s) applied and server is healthy."
              : "Maintenance completed; server is healthy.";
        maintenance.endsAt = null;
        maintenance.nextHealthcheckAt = null;
        if (["restart", "update"].includes(maintenance.action)) {
          sayMaintenance(server, policy.availableMessage);
        }
        activity(server, "Maintenance completed", maintenance.message);
        finishJob(maintenance.jobId, true, maintenance.message);
        return;
      }
      if (maintenance.healthcheckAttempts >= policy.healthcheckAttempts) {
        maintenance.active = false;
        maintenance.stage = "failed";
        maintenance.message = `Health check failed after ${maintenance.healthcheckAttempts} attempts.`;
        maintenance.nextHealthcheckAt = null;
        activity(server, "Maintenance failed", maintenance.message, true);
        finishJob(maintenance.jobId, false, maintenance.message);
        return;
      }
      maintenance.message = `Waiting for server health (${status}).`;
      maintenance.nextHealthcheckAt = new Date(
        now().getTime() + policy.healthcheckIntervalSeconds * 1000,
      ).toISOString();
      return;
    }

    if (maintenance.restartWhenEmpty === true) {
      const status = await multicraft.statusDetails(server.multicraftServerId);
      const players = Number.parseInt(status.onlinePlayers, 10) || 0;
      if (players > 0) {
        maintenance.stage = "waiting-empty";
        maintenance.message = `Waiting for ${players} player(s) to leave.`;
        if (maintenance.lastWaitingPlayers !== players) {
          sayMaintenance(
            server,
            renderMessage(policy.waitingEmptyMessage, { players }),
          );
          maintenance.lastWaitingPlayers = players;
        }
        return;
      }
    }
    if (maintenance.backup === true) {
      if (!maintenance.backupId) {
        if (activeBackupFor(server.id)) {
          maintenance.stage = "waiting-backup";
          maintenance.message =
            "Waiting for the current backup to finish before the safety backup.";
          return;
        }
        maintenance.stage = "backup";
        maintenance.message = "Starting safety backup.";
        const backup = await createBackupForServer(
          server,
          { engineId: maintenance.backupEngineId },
          "maintenance",
        );
        maintenance.backupStarted = true;
        maintenance.backupId = backup.id;
        persist();
        return;
      }
      const backup = state.backups.find(
        (item) => item.id === maintenance.backupId,
      );
      if (!backup) {
        maintenance.active = false;
        maintenance.stage = "failed";
        maintenance.message = "Safety backup record is missing.";
        activity(server, "Maintenance failed", maintenance.message, true);
        finishJob(maintenance.jobId, false, maintenance.message);
        return;
      }
      if (backup.status === "failed") {
        maintenance.active = false;
        maintenance.stage = "failed";
        maintenance.message = backup.message || "Safety backup failed.";
        activity(server, "Maintenance failed", maintenance.message, true);
        finishJob(maintenance.jobId, false, maintenance.message);
        return;
      }
      if (backup.status !== "completed") {
        maintenance.stage = "backup";
        maintenance.message = "Waiting for safety backup to complete.";
        return;
      }
    }
    if (maintenance.actionStarted !== true) {
      if (maintenance.startingAnnounced !== true) {
        sayMaintenance(server, policy.startingMessage);
        maintenance.startingAnnounced = true;
      }
      if (maintenance.action === "update") {
        maintenance.stage = "stopping-for-update";
        maintenance.message = "Stopping server before applying plugin updates.";
        await multicraft.stop(server.multicraftServerId);
        await waitStopped(multicraft, server.multicraftServerId, dependencies);
        maintenance.healthcheckSeenOffline = true;
        maintenance.stage = "updating";
        maintenance.message = "Applying validated plugin updates.";
        try {
          const result = await dependencies.updateApplier.applyServer(
            server,
            state.updates || [],
          );
          maintenance.updateApplied = result.applied || [];
        } catch (error) {
          try {
            await multicraft.start(server.multicraftServerId);
          } catch (_) {}
          throw error;
        }
        await multicraft.start(server.multicraftServerId);
      } else {
        maintenance.stage =
          maintenance.action === "stop" ? "stopping" : "restarting";
        maintenance.message =
          maintenance.action === "stop"
            ? "Stopping server."
            : "Restarting server.";
        await executeJob(
          server,
          maintenance.action || "restart",
          "maintenance",
        );
      }
      maintenance.actionStarted = true;
      maintenance.stage = "healthcheck";
      maintenance.healthcheckAttempts = 0;
      if (maintenance.action !== "update")
        maintenance.healthcheckSeenOffline = false;
      maintenance.nextHealthcheckAt = new Date(
        now().getTime() + policy.healthcheckIntervalSeconds * 1000,
      ).toISOString();
      maintenance.message =
        maintenance.action === "stop"
          ? "Waiting for server to stop."
          : "Waiting for server health.";
      persist();
      return;
    }
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
          const job = await executeJob(
            server,
            schedule.action,
            "scheduled",
            schedule.id,
            {
              backupEngineId: schedule.backupEngineId,
            },
          );
          if (!job.finishedAt)
            schedule.lastResult = `Running since ${job.startedAt}`;
        } catch (error) {
          schedule.lastResult = `Failed: ${error.message}`;
          activity(server, "Scheduled action failed", error.message, true);
        }
      }
      if (schedule.recurring === false) {
        schedule.enabled = false;
        schedule.nextRun = null;
      } else {
        const next = nextCron(schedule.schedule, now());
        schedule.nextRun = next?.toISOString() || null;
      }
    }
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await refreshBackups();
      await refreshCommandBackups();
      await runSchedules();
      await performance?.tick?.();
      for (const maintenance of state.maintenance) {
        try {
          await runMaintenance(maintenance);
        } catch (error) {
          if (maintenance.active !== true) continue;
          maintenance.active = false;
          maintenance.stage = "failed";
          maintenance.message = error.message || "Maintenance failed.";
          const server = serverById(maintenance.serverId);
          activity(server, "Maintenance failed", maintenance.message, true);
          finishJob(maintenance.jobId, false, maintenance.message);
        }
      }
      const storageProbeInterval = Math.max(
        60000,
        Number.parseInt(
          config.storageProbeMilliseconds ||
            process.env.MANAGEMENT_STORAGE_PROBE_MS,
          10,
        ) || 300000,
      );
      if (now().getTime() - lastStorageProbeAt >= storageProbeInterval) {
        await refreshStorageMetrics();
        lastStorageProbeAt = now().getTime();
      }
      await runRetention();
      persist();
    } finally {
      ticking = false;
    }
  }
  function requireServer(payload = {}) {
    const serverId = String(payload.serverId || "").trim();
    const server = serverById(serverId);
    if (!server)
      throw new Error(`Unknown management server: ${serverId || "<empty>"}.`);
    return server;
  }

  function findBackup(payload = {}) {
    const backupId = String(payload.backupId || "").trim();
    const backup = state.backups.find((item) => item.id === backupId);
    if (!backup) throw new Error("Backup record not found.");
    return backup;
  }

  function engineForBackup(backup) {
    if (backup.engine === "multicraft") return null;
    return engineById(backup.engineId || "");
  }

  function localBackupFile(backup) {
    if (backup.localPath && fs.existsSync(backup.localPath))
      return backup.localPath;
    for (const destination of backup.destinations || []) {
      if (typeof destination === "string" && fs.existsSync(destination))
        return destination;
    }
    for (const locator of Object.values(backup.destinationLocators || {})) {
      if (typeof locator === "string" && fs.existsSync(locator)) return locator;
    }
    return null;
  }

  async function deleteManagedBackup(backup, detail = "Deleted by AdminCraft") {
    const engine = engineForBackup(backup);
    if (!engine || backup.engine !== "native") {
      throw new Error("Delete is not supported by this backup engine.");
    }
    for (const [storageId, locator] of Object.entries(
      backup.destinationLocators || {},
    )) {
      const storage = storageById(storageId);
      if (storage && locator)
        await deleteFromStorage(storage, locator, dependencies);
    }
    if (backup.localPath)
      await fs.promises.rm(backup.localPath, { force: true });
    state.backups = state.backups.filter((item) => item.id !== backup.id);
    activity(serverById(backup.serverId), "Backup deleted", detail);
  }

  async function runRetention() {
    const plan = retentionPlan(state.backups, retention);
    for (const backupId of plan.remove) {
      const backup = state.backups.find((item) => item.id === backupId);
      if (!backup) continue;
      const policy = effectiveRetention(retention, backup.serverId);
      if (policy.enforce !== true) continue;
      try {
        await deleteManagedBackup(backup, "Removed by retention policy.");
      } catch (error) {
        activity(
          serverById(backup.serverId),
          "Retention cleanup failed",
          error.message,
          true,
        );
      }
    }
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

  function validateStorageIds(values) {
    const ids = [
      ...new Set(
        (Array.isArray(values) ? values : [])
          .map((value) => String(value).trim())
          .filter(Boolean),
      ),
    ];
    for (const storageId of ids) {
      if (!storageById(storageId))
        throw new Error(`Unknown backup storage: ${storageId}.`);
    }
    return ids;
  }

  function reloadManagedStorages(nextManaged = managedStorages) {
    managedStorages = nextManaged;
    storages = combineStorages(externalStorages, managedStorages);
  }

  function retentionPolicyPayload(payload = {}, fallback = {}) {
    const policy = {};
    for (const key of ["daily", "weekly", "monthly"]) {
      const value =
        payload[key] == null
          ? fallback[key]
          : Number.parseInt(payload[key], 10);
      if (!Number.isInteger(value) || value < 0 || value > 3650) {
        throw new Error(`Retention ${key} must be between 0 and 3650.`);
      }
      policy[key] = value;
    }
    policy.enforce =
      payload.enforce == null
        ? fallback.enforce === true
        : payload.enforce === true;
    return policy;
  }
  async function handle(action, payload = {}) {
    try {
      if (action === "snapshot") {
        return response("Management snapshot refreshed.", [snapshot()]);
      }

      if (action === "storage-upsert") {
        const storageId = String(payload.id || "").trim();
        const previous =
          managedStorages.find((storage) => storage.id === storageId) || null;
        if (
          !previous &&
          externalStorages.some((storage) => storage.id === storageId)
        ) {
          throw new Error(
            "This storage is externally managed and cannot be changed in AdminCraft.",
          );
        }
        const storage = normalizeManagedStorage(payload, previous);
        const next = managedStorages.filter((item) => item.id !== storage.id);
        next.push({ ...storage, managed: true });
        saveManagedStorages(managedStorageConfigPath, next);
        reloadManagedStorages(next);
        state.storageMetrics[storage.id] = await probeStorage(
          storage,
          dependencies,
        );
        activity(
          null,
          previous ? "Backup storage updated" : "Backup storage added",
          storage.name,
        );
        persist();
        return response(
          previous ? "Backup storage updated." : "Backup storage added.",
          [snapshot()],
        );
      }

      if (action === "storage-test") {
        const storageId = String(payload.storageId || payload.id || "").trim();
        const storage = storageById(storageId);
        if (!storage) throw new Error("Backup storage not found.");
        const result = await testStorageConnection(storage, dependencies);
        state.storageMetrics[storage.id] = await probeStorage(
          storage,
          dependencies,
        );
        activity(
          null,
          "Backup storage tested",
          storage.name + ": " + result.detail,
        );
        persist();
        return response(result.detail, [snapshot()]);
      }

      if (action === "storage-delete") {
        const storageId = String(payload.storageId || payload.id || "").trim();
        const storage = managedStorages.find((item) => item.id === storageId);
        if (!storage) {
          if (externalStorages.some((item) => item.id === storageId)) {
            throw new Error(
              "This storage is externally managed and cannot be deleted in AdminCraft.",
            );
          }
          throw new Error("Managed backup storage not found.");
        }
        const referenced = state.backups.some(
          (backup) =>
            (backup.destinations || []).includes(storageId) ||
            Object.prototype.hasOwnProperty.call(
              backup.destinationLocators || {},
              storageId,
            ),
        );
        if (referenced)
          throw new Error(
            "Storage is referenced by existing backup records and cannot be deleted.",
          );
        const inDefaults =
          state.backupDestinationDefaults.global.includes(storageId) ||
          Object.values(state.backupDestinationDefaults.servers).some(
            (ids) => Array.isArray(ids) && ids.includes(storageId),
          );
        if (inDefaults)
          throw new Error(
            "Remove this storage from backup destination defaults before deleting it.",
          );
        const engineReference = managedEngines.some((engine) =>
          (engine.destinationIds || []).includes(storageId),
        );
        if (engineReference) {
          throw new Error(
            "Storage is referenced by a managed backup engine and cannot be deleted.",
          );
        }
        const next = managedStorages.filter((item) => item.id !== storageId);
        saveManagedStorages(managedStorageConfigPath, next);
        reloadManagedStorages(next);
        delete state.storageMetrics[storageId];
        activity(null, "Backup storage deleted", storage.name);
        persist();
        return response("Backup storage deleted.", [snapshot()]);
      }

      if (action === "storage-defaults-set") {
        const ids = validateStorageIds(
          payload.storageIds || payload.destinationIds || [],
        );
        const serverId = String(payload.serverId || "").trim();
        if (serverId) {
          if (!serverById(serverId))
            throw new Error("Unknown management server: " + serverId + ".");
          if (payload.inherit === true)
            delete state.backupDestinationDefaults.servers[serverId];
          else state.backupDestinationDefaults.servers[serverId] = ids;
        } else {
          state.backupDestinationDefaults.global = ids;
        }
        activity(
          serverId ? serverById(serverId) : null,
          "Backup destination defaults updated",
          ids.join(", ") || "No destinations",
        );
        persist();
        return response("Backup destination defaults updated.", [snapshot()]);
      }

      if (action === "retention-set") {
        const serverId = String(payload.serverId || "").trim();
        if (serverId && !serverById(serverId)) {
          throw new Error("Unknown management server: " + serverId + ".");
        }
        const current = serverId
          ? effectiveRetention(retention, serverId)
          : retention.global;
        const next = {
          global: { ...retention.global },
          servers: Object.fromEntries(
            Object.entries(retention.servers).map(([id, policy]) => [
              id,
              { ...policy },
            ]),
          ),
        };
        if (serverId && payload.inherit === true) delete next.servers[serverId];
        else {
          const policy = retentionPolicyPayload(payload, current);
          if (serverId) next.servers[serverId] = policy;
          else next.global = policy;
        }
        retention = parseBackupRetention(
          JSON.stringify(next),
          servers.map((server) => server.id),
        );
        state.retentionConfig = {
          global: { ...retention.global },
          servers: Object.fromEntries(
            Object.entries(retention.servers).map(([id, policy]) => [
              id,
              { ...policy },
            ]),
          ),
        };
        activity(
          serverId ? serverById(serverId) : null,
          "Backup retention updated",
          serverId || "Global defaults",
        );
        persist();
        return response("Backup retention updated.", [snapshot()]);
      }

      if (action === "engine-upsert") {
        const engineId = String(payload.id || "").trim();
        const previous =
          managedEngines.find((engine) => engine.id === engineId) || null;
        const catalog = engineById(engineId);
        if (
          !previous &&
          externalEngines.some((engine) => engine.id === engineId)
        ) {
          throw new Error(
            "This backup engine is externally managed and cannot be changed in AdminCraft.",
          );
        }
        if (!previous && (!catalog || catalog.configurable !== true)) {
          throw new Error(
            "This backup engine is not configurable in AdminCraft.",
          );
        }
        const candidate = normalizeManagedBackupEngine(
          {
            ...payload,
            id: engineId,
            type: payload.type || previous?.type || catalog?.type,
            serverId:
              payload.serverId || previous?.serverId || catalog?.serverId,
            label: payload.label || previous?.label || catalog?.label,
          },
          previous,
          servers,
          new Set(storages.map((storage) => storage.id)),
        );
        const next = managedEngines.filter(
          (engine) => engine.id !== candidate.id,
        );
        next.push(candidate);
        saveManagedBackupEngines(managedEngineConfigPath, next);
        rebuildEngines(next);
        activity(
          serverById(candidate.serverId),
          previous ? "Backup engine updated" : "Backup engine configured",
          candidate.label,
        );
        persist();
        return response(
          previous ? "Backup engine updated." : "Backup engine configured.",
          [snapshot()],
        );
      }

      if (action === "engine-delete") {
        const engineId = String(payload.engineId || payload.id || "").trim();
        const engine = managedEngines.find((item) => item.id === engineId);
        if (!engine) throw new Error("Managed backup engine not found.");
        if (
          servers.some((server) => server.defaultBackupEngineId === engineId)
        ) {
          throw new Error(
            "This backup engine is configured as a server default and cannot be removed.",
          );
        }
        const next = managedEngines.filter((item) => item.id !== engineId);
        saveManagedBackupEngines(managedEngineConfigPath, next);
        rebuildEngines(next);
        activity(
          serverById(engine.serverId),
          "Backup engine reset",
          engine.label,
        );
        persist();
        return response("Backup engine reset to automatic discovery.", [
          snapshot(),
        ]);
      }

      if (action === "backup-create") {
        const server = requireServer(payload);
        await executeJob(server, "backup", "manual", null, {
          backupEngineId: payload.engineId || payload.engine,
          destinationIds: payload.destinationIds,
        });
        return response("Backup job started.", [snapshot()]);
      }

      if (action === "backup-verify") {
        const backup = findBackup(payload);
        const destination = localBackupFile(backup);
        if (!destination)
          throw new Error(
            "Backup file is not locally accessible for verification.",
          );
        const digest = await hashFile(destination);
        backup.verified = true;
        backup.checksum = `sha256:${digest}`;
        activity(serverById(backup.serverId), "Backup verified", backup.id);
        persist();
        return response("Backup verified.", [snapshot()]);
      }

      if (action === "backup-copy") {
        const backup = findBackup(payload);
        if (backup.engine !== "native")
          throw new Error(
            "Copy is only available for AdminCraft Native backups.",
          );
        const destinationIds = Array.isArray(payload.destinationIds)
          ? payload.destinationIds
          : [];
        if (destinationIds.length === 0)
          throw new Error("Choose at least one backup destination.");
        await copyBackupToDestinations(backup, destinationIds);
        activity(
          serverById(backup.serverId),
          "Backup copied",
          `${backup.id} to ${destinationIds.join(", ")}`,
        );
        persist();
        return response("Backup copied.", [snapshot()]);
      }

      if (action === "backup-delete") {
        const backup = findBackup(payload);
        await deleteManagedBackup(backup, backup.id);
        persist();
        return response("Backup deleted.", [snapshot()]);
      }

      if (action === "backup-restore") {
        const backup = findBackup(payload);
        const engine = engineForBackup(backup);
        const server = serverById(backup.serverId);
        if (
          !engine ||
          !server ||
          backup.engine !== "native" ||
          engine.allowRestore !== true
        ) {
          throw new Error("Restore is not supported by this backup engine.");
        }
        const archive = localBackupFile(backup);
        if (!archive)
          throw new Error(
            "Backup archive is not locally accessible for restore.",
          );
        await createConfiguredBackup(server, engine, "pre-restore", {});
        await restoreNativeArchive(
          engine,
          server,
          archive,
          multicraft,
          dependencies,
        );
        activity(server, "Backup restored", backup.id);
        persist();
        return response("Backup restored.", [snapshot()]);
      }

      if (action === "backup-download") {
        throw new Error(
          "Direct backup download is not available on this bridge yet.",
        );
      }

      if (action === "schedule-create") {
        const server = requireServer(payload);
        const scheduledAction = String(payload.action || "").trim();
        const allowed = ["start", "stop", "restart", "backup", "maintenance"];
        if (!allowed.includes(scheduledAction))
          throw new Error("Unsupported scheduled action.");
        const backupEngineId = ["backup", "maintenance"].includes(
          scheduledAction,
        )
          ? backupEngineIdFor(server, payload.backupEngineId)
          : null;
        const runAtRaw = String(payload.runAt || "").trim();
        const recurring = runAtRaw.length === 0;
        const expression = recurring
          ? String(payload.schedule || "").trim()
          : "";
        let runAt = null;
        let nextRun = null;
        if (recurring) {
          nextRun = nextCron(expression, now());
          if (!nextRun)
            throw new Error("Invalid or unsupported cron expression.");
        } else {
          const parsed = new Date(runAtRaw);
          if (
            Number.isNaN(parsed.getTime()) ||
            parsed.getTime() <= now().getTime()
          ) {
            throw new Error(
              "One-time schedule must be a valid future date/time.",
            );
          }
          runAt = parsed.toISOString();
          nextRun = parsed;
        }
        state.schedules.push({
          id: id("schedule"),
          serverId: server.id,
          serverName: server.name,
          action: scheduledAction,
          backupEngineId,
          schedule: expression,
          recurring,
          runAt,
          nextRun: nextRun.toISOString(),
          enabled: true,
          lastResult: null,
        });
        activity(
          server,
          "Schedule created",
          recurring
            ? `${scheduledAction} · ${expression}`
            : `${scheduledAction} · ${runAt}`,
        );
        persist();
        return response("Schedule created.", [snapshot()]);
      }

      if (action === "schedule-toggle") {
        const schedule = state.schedules.find(
          (item) => item.id === String(payload.id || ""),
        );
        if (!schedule) throw new Error("Schedule not found.");
        schedule.enabled = payload.enabled === true;
        if (!schedule.enabled) {
          schedule.nextRun = null;
        } else if (schedule.recurring === false) {
          const runAt = new Date(schedule.runAt || "");
          if (
            Number.isNaN(runAt.getTime()) ||
            runAt.getTime() <= now().getTime()
          ) {
            throw new Error("The one-time schedule time has already passed.");
          }
          schedule.nextRun = runAt.toISOString();
        } else {
          schedule.nextRun =
            nextCron(schedule.schedule, now())?.toISOString() || null;
        }
        activity(
          serverById(schedule.serverId),
          schedule.enabled ? "Schedule enabled" : "Schedule disabled",
          `${schedule.action} · ${schedule.id}`,
        );
        persist();
        return response(
          schedule.enabled ? "Schedule enabled." : "Schedule disabled.",
          [snapshot()],
        );
      }

      if (action === "schedule-delete") {
        const schedule = state.schedules.find(
          (item) => item.id === String(payload.id || ""),
        );
        if (!schedule) throw new Error("Schedule not found.");
        state.schedules = state.schedules.filter(
          (item) => item.id !== schedule.id,
        );
        activity(
          serverById(schedule.serverId),
          "Schedule deleted",
          schedule.action + " · " + schedule.id,
        );
        persist();
        return response("Schedule deleted.", [snapshot()]);
      }

      if (action === "maintenance-start") {
        const server = requireServer(payload);
        await executeJob(server, "maintenance", "manual", null, payload);
        return response("Maintenance started.", [snapshot()]);
      }

      if (action === "maintenance-cancel") {
        const server = requireServer(payload);
        if (!cancelMaintenance(server))
          throw new Error("No active maintenance flow found.");
        return response("Maintenance cancelled.", [snapshot()]);
      }

      if (action === "performance-history") {
        const server = requireServer(payload);
        const range = String(payload.range || "1h");
        if (!performance)
          throw new Error(
            "Performance history is not configured on this bridge.",
          );
        const frame = await performance.history(server.id, range);
        return response("Performance history refreshed.", [frame]);
      }

      if (action === "updates-source-set") {
        if (typeof dependencies.updateChecker?.confirmSource !== "function") {
          throw new Error(
            "Update source matching is not configured on this bridge.",
          );
        }
        const confirmed = dependencies.updateChecker.confirmSource(payload);
        const previous = state.updateSourceOverrides[confirmed.key];
        const normalized = previous?.provider
          ? { check: previous }
          : { ...(previous || {}) };
        normalized[confirmed.role || "check"] = confirmed.source;
        state.updateSourceOverrides[confirmed.key] = normalized;
        state.updates = await dependencies.updateChecker({
          providers: payload.providers || {},
          serverId: payload.serverId || null,
          sourceOverrides: state.updateSourceOverrides,
        });
        activity(
          serverById(payload.serverId),
          "Update source confirmed",
          String(payload.plugin || "Plugin"),
        );
        persist();
        return response("Update source remembered.", [snapshot()]);
      }

      if (action === "updates-check") {
        if (typeof dependencies.updateChecker === "function") {
          state.updates = await dependencies.updateChecker({
            servers: servers.map((server) => ({ ...server })),
            providers: payload.providers || {},
            serverId: payload.serverId || null,
            sourceOverrides: state.updateSourceOverrides,
          });
          activity(
            payload.serverId ? serverById(payload.serverId) : null,
            "Update check completed",
            `${state.updates.length} result(s)`,
          );
          persist();
          return response("Update check completed.", [snapshot()]);
        }
        return response("Update checking is not configured on this bridge.", [
          snapshot(),
        ]);
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
      Number.parseInt(
        config.tickMilliseconds || process.env.MANAGEMENT_TICK_MS,
        10,
      ) || 15000,
    );
    timer = setIntervalImpl(() => {
      void tick()
        .then(() => dependencies.onSnapshot?.(snapshot()))
        .catch((error) =>
          console.error(`Management tick failed: ${error.message}`),
        );
    }, interval);
    timer.unref?.();
    void tick()
      .then(() => dependencies.onSnapshot?.(snapshot()))
      .catch((error) =>
        console.error(`Initial management tick failed: ${error.message}`),
      );
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

module.exports = {
  createManagementService,
  nextCron,
  parseServers,
  appendedLogLines,
};
