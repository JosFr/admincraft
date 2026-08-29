const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const ENGINE_TYPES = new Set(["native", "plugin", "custom"]);
const BACKUP_TYPES = new Set(["full-server", "world-only", "custom"]);

function parseArray(raw, label) {
  if (!String(raw || "").trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

function cleanId(value, label) {
  const id = String(value || "").trim();
  if (!id || !/^[a-zA-Z0-9._-]+$/u.test(id)) throw new Error(`Invalid ${label}: ${id || "<empty>"}.`);
  return id;
}

function capabilities(type, engine = {}) {
  if (type === "native") return {
    create: true, list: true, progress: true,
    restore: engine.allowRestore === true, download: false, delete: true,
    remoteDestination: true, verify: true, copy: true,
  };
  return {
    create: true, list: true, progress: false, restore: false,
    download: false, delete: false, remoteDestination: false,
    verify: false, copy: false,
  };
}function parseBackupEngines(config = {}, servers = [], storageIds = new Set()) {
  const raw = config.enginesJson || process.env.BACKUP_ENGINES_JSON || "";
  const parsed = parseArray(raw, "BACKUP_ENGINES_JSON");
  const serverIds = new Set(servers.map((server) => server.id));
  const ids = new Set(["multicraft"]);
  return parsed.map((entry, index) => {
    const id = cleanId(entry?.id, `backup engine ID at index ${index}`);
    const type = String(entry?.type || "").trim().toLowerCase();
    const serverId = cleanId(entry?.serverId, `backup engine serverId at index ${index}`);
    if (ids.has(id) || !ENGINE_TYPES.has(type) || !serverIds.has(serverId)) {
      throw new Error(`Invalid backup engine at index ${index}.`);
    }
    ids.add(id);
    const destinationIds = Array.isArray(entry?.destinationIds)
      ? entry.destinationIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    for (const destinationId of destinationIds) {
      if (!storageIds.has(destinationId)) throw new Error(`Unknown backup storage: ${destinationId}.`);
    }
    const engine = {
      id, type, serverId,
      label: String(entry?.label || id).trim(),
      sourcePath: String(entry?.sourcePath || "").trim(),
      stagingPath: String(entry?.stagingPath || "").trim(),
      command: String(entry?.command || "").trim(),
      backupType: String(entry?.backupType || (type === "native" ? "full-server" : "custom")).trim(),
      allowRestore: entry?.allowRestore === true,
      destinationIds,
    };
    if (!BACKUP_TYPES.has(engine.backupType)) {
      throw new Error(`Invalid backup type for engine ${id}.`);
    }
    if (type === "native" && !engine.sourcePath) {
      throw new Error(`Native backup engine ${id} requires sourcePath.`);
    }
    if (["plugin", "custom"].includes(type) && !engine.command) {
      throw new Error(`${type} backup engine ${id} requires command.`);
    }
    engine.capabilities = capabilities(type, engine);
    return engine;
  });
}function engineDescriptors(engines, servers, hasMulticraft, storageIds = []) {
  const result = [];
  if (hasMulticraft) {
    result.push({
      id: "multicraft",
      type: "multicraft",
      label: "Multicraft",
      serverIds: servers.map((server) => server.id),
      destinationIds: [],
      capabilities: {
        create: true, list: true, progress: true, restore: false,
        download: false, delete: false, remoteDestination: false,
        verify: false, copy: false,
      },
    });
  }
  for (const engine of engines) {
    result.push({
      id: engine.id,
      type: engine.type,
      label: engine.label,
      backupType: engine.backupType,
      serverIds: [engine.serverId],
      destinationIds: [...engine.destinationIds],
      availableDestinationIds: engine.type === "native" ? [...storageIds] : [...engine.destinationIds],
      capabilities: { ...engine.capabilities },
    });
  }
  return result;
}

function archiveName(serverId, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  return `${cleanId(serverId, "server ID")}-${stamp}.tar.gz`;
}

async function createNativeArchive(engine, server, defaultRoot, options = {}) {
  const source = path.resolve(engine.sourcePath);
  const root = path.resolve(engine.stagingPath || defaultRoot);
  const file = path.join(root, archiveName(server.id, options.now || new Date()));
  fs.mkdirSync(root, { recursive: true });
  const stat = fs.statSync(source);
  if (!stat.isDirectory()) throw new Error(`Native backup source is not a directory: ${source}`);
  await (options.execFile || execFileAsync)("tar", ["-czf", file, "-C", source, "."]);
  return file;
}async function waitStopped(multicraft, serverId, options = {}) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.timeoutMs || 60000);
  while (Date.now() < deadline) {
    if (await multicraft.status(serverId) === "stopped") return;
    await sleep(1000);
  }
  throw new Error("Server did not stop before the restore timeout.");
}

async function restoreNativeArchive(engine, server, archive, multicraft, options = {}) {
  if (engine.allowRestore !== true) throw new Error("Native restore is disabled for this engine.");
  if (!multicraft) throw new Error("Multicraft is required for coordinated native restore.");
  const source = path.resolve(engine.sourcePath);
  const parent = path.dirname(source);
  const basename = path.basename(source);
  const token = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const staged = path.join(parent, `.${basename}.admincraft-new-${token}`);
  const rollback = path.join(parent, `.${basename}.admincraft-old-${token}`);
  fs.mkdirSync(staged, { recursive: true });
  await multicraft.stop(server.multicraftServerId);
  await waitStopped(multicraft, server.multicraftServerId, options);
  try {
    await (options.execFile || execFileAsync)("tar", ["-xzf", archive, "-C", staged]);
    fs.renameSync(source, rollback);
    fs.renameSync(staged, source);
    await multicraft.start(server.multicraftServerId);
    fs.rmSync(rollback, { recursive: true, force: true });
  } catch (error) {
    try {
      if (!fs.existsSync(source) && fs.existsSync(rollback)) fs.renameSync(rollback, source);
      fs.rmSync(staged, { recursive: true, force: true });
      await multicraft.start(server.multicraftServerId);
    } catch (_) {
      // Preserve the original restore error; rollback remains on disk for manual recovery.
    }
    throw error;
  }
}module.exports = {
  parseBackupEngines,
  engineDescriptors,
  createNativeArchive,
  restoreNativeArchive,
  capabilities,
};
