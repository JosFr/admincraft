const fs = require("fs");
const path = require("path");
const { parseBackupEngines } = require("./backup-engines");

function readEntries(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.engines) ? parsed.engines : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(
      `Managed backup engine config could not be read: ${error.message}`,
    );
  }
}

function writePrivateJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(temp, 0o600);
  } catch (_) {}
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch (_) {}
}
function engineEntry(engine) {
  return {
    id: engine.id,
    type: engine.type,
    serverId: engine.serverId,
    label: engine.label,
    command: engine.command,
    backupType: engine.backupType,
    destinationIds: [...engine.destinationIds],
    completionRegex: engine.completionRegex,
    failureRegex: engine.failureRegex,
    completionTimeoutSeconds: engine.completionTimeoutSeconds,
  };
}

function parseOne(raw, servers, storageIds) {
  const parsed = parseBackupEngines(
    { enginesJson: JSON.stringify([raw]) },
    servers,
    storageIds,
  )[0];
  if (!["plugin", "custom"].includes(parsed.type)) {
    throw new Error(
      "AdminCraft-managed backup engines may only be plugin or custom engines.",
    );
  }
  return { ...parsed, managed: true, configurable: true };
}
function loadManagedBackupEngines(file, servers, storageIds) {
  return readEntries(file).map((entry) => parseOne(entry, servers, storageIds));
}

function normalizeManagedBackupEngine(
  payload = {},
  previous = null,
  servers = [],
  storageIds = new Set(),
) {
  const type = String(payload.type || previous?.type || "")
    .trim()
    .toLowerCase();
  const hasCommand = Object.prototype.hasOwnProperty.call(payload, "command");
  const hasCompletion = Object.prototype.hasOwnProperty.call(
    payload,
    "completionRegex",
  );
  const hasFailure = Object.prototype.hasOwnProperty.call(
    payload,
    "failureRegex",
  );
  const raw = {
    id: String(payload.id || previous?.id || "").trim(),
    type,
    serverId: String(payload.serverId || previous?.serverId || "").trim(),
    label: String(payload.label || previous?.label || payload.id || "").trim(),
    command:
      hasCommand && String(payload.command || "").trim()
        ? String(payload.command).trim()
        : previous?.command || "",
    backupType: String(
      payload.backupType || previous?.backupType || "custom",
    ).trim(),
    destinationIds: Array.isArray(payload.destinationIds)
      ? payload.destinationIds
      : previous?.destinationIds || [],
    completionRegex: hasCompletion
      ? String(payload.completionRegex || "").trim()
      : previous?.completionRegex || "",
    failureRegex: hasFailure
      ? String(payload.failureRegex || "").trim()
      : previous?.failureRegex || "",
    completionTimeoutSeconds:
      payload.completionTimeoutSeconds ??
      previous?.completionTimeoutSeconds ??
      600,
  };
  return parseOne(raw, servers, storageIds);
}

function saveManagedBackupEngines(file, engines) {
  writePrivateJson(file, {
    version: 1,
    engines: engines.map(engineEntry),
  });
}

function combineBackupEngines(external, managed) {
  const ids = new Set(external.map((engine) => engine.id));
  for (const engine of managed) {
    if (ids.has(engine.id)) {
      throw new Error(
        `Managed backup engine ID conflicts with external config: ${engine.id}.`,
      );
    }
    ids.add(engine.id);
  }
  return [
    ...external.map((engine) => ({
      ...engine,
      managed: false,
      configurable: false,
    })),
    ...managed.map((engine) => ({
      ...engine,
      managed: true,
      configurable: true,
    })),
  ];
}

module.exports = {
  combineBackupEngines,
  engineEntry,
  loadManagedBackupEngines,
  normalizeManagedBackupEngine,
  saveManagedBackupEngines,
  writePrivateJson,
};
