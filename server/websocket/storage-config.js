const fs = require("fs");
const path = require("path");
const { parseBackupStorages } = require("./backup-storage");

function readEntries(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed?.storages) ? parsed.storages : [];
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(
      `Managed backup storage config could not be read: ${error.message}`,
    );
  }
}

function writePrivateJson(file, value) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
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
function storageEntry(storage) {
  return {
    id: storage.id,
    name: storage.name,
    type: storage.type,
    path: storage.path,
    remote: storage.remote,
    basePath: storage.basePath,
    url: storage.url,
    username: storage.username,
    password: storage.password,
    softLimitBytes: storage.softLimitBytes,
    minimumFreeBytes: storage.minimumFreeBytes,
    warningFreePercent: storage.warningFreePercent,
    criticalFreePercent: storage.criticalFreePercent,
  };
}

function nextcloudUrl(rawUrl, username) {
  const url = String(rawUrl || "").replace(/\/+$/u, "");
  if (!url) return url;
  const user = String(username || "").trim();
  if (!user) return url;
  const marker = "/remote.php/dav/files/";
  const markerIndex = url.indexOf(marker);
  const base = markerIndex >= 0 ? url.slice(0, markerIndex) : url;
  return `${base}${marker}${encodeURIComponent(user)}`;
}
function normalizeManagedStorage(payload = {}, previous = null) {
  const hasPassword = Object.prototype.hasOwnProperty.call(payload, "password");
  const password =
    payload.clearPassword === true
      ? ""
      : hasPassword && String(payload.password || "").length > 0
        ? String(payload.password)
        : previous?.password || "";
  const type = String(payload.type || previous?.type || "")
    .trim()
    .toLowerCase();
  const requestedUsername = String(payload.username ?? "").trim();
  const username = requestedUsername || previous?.username || "";
  const raw = {
    id: String(payload.id || previous?.id || "").trim(),
    name: String(payload.name || previous?.name || payload.id || "").trim(),
    type,
    path: String(payload.path ?? previous?.path ?? "").trim(),
    remote: String(payload.remote ?? previous?.remote ?? "").trim(),
    basePath: String(payload.basePath ?? previous?.basePath ?? "").trim(),
    url:
      type === "nextcloud"
        ? nextcloudUrl(payload.url ?? previous?.url ?? "", username)
        : String(payload.url ?? previous?.url ?? "").trim(),
    username,
    password,
    softLimitBytes: payload.softLimitBytes ?? previous?.softLimitBytes ?? null,
    minimumFreeBytes:
      payload.minimumFreeBytes ?? previous?.minimumFreeBytes ?? null,
    warningFreePercent:
      payload.warningFreePercent ?? previous?.warningFreePercent ?? 15,
    criticalFreePercent:
      payload.criticalFreePercent ?? previous?.criticalFreePercent ?? 5,
  };
  return parseBackupStorages({ storagesJson: JSON.stringify([raw]) })[0];
}
function loadManagedStorages(file) {
  const entries = readEntries(file);
  const storages = parseBackupStorages({
    storagesJson: JSON.stringify(entries),
  });
  return storages.map((storage) => ({ ...storage, managed: true }));
}

function saveManagedStorages(file, storages) {
  writePrivateJson(file, {
    version: 1,
    storages: storages.map(storageEntry),
  });
}

function combineStorages(external, managed) {
  const ids = new Set(external.map((storage) => storage.id));
  for (const storage of managed) {
    if (ids.has(storage.id)) {
      throw new Error(
        `Managed backup storage ID conflicts with external config: ${storage.id}.`,
      );
    }
    ids.add(storage.id);
  }
  return [
    ...external.map((storage) => ({ ...storage, managed: false })),
    ...managed.map((storage) => ({ ...storage, managed: true })),
  ];
}

module.exports = {
  combineStorages,
  loadManagedStorages,
  nextcloudUrl,
  normalizeManagedStorage,
  saveManagedStorages,
  storageEntry,
  writePrivateJson,
};
