const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const STORAGE_TYPES = new Set([
  "local",
  "nextcloud",
  "webdav",
  "smb",
  "nfs",
  "sftp",
  "s3",
  "rclone",
]);
const MOUNT_TYPES = new Set(["local", "smb", "nfs"]);
const WEBDAV_TYPES = new Set(["nextcloud", "webdav"]);

function parseJsonArray(raw, label) {
  if (!String(raw || "").trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed;
}

function parseBackupStorages(config = {}) {
  const raw = config.storagesJson || process.env.BACKUP_STORAGES_JSON || "";
  const entries = parseJsonArray(raw, "BACKUP_STORAGES_JSON");
  const ids = new Set();
  return entries.map((entry, index) => {
    const id = String(entry?.id || "").trim();
    const type = String(entry?.type || "")
      .trim()
      .toLowerCase();
    if (!id || ids.has(id) || !STORAGE_TYPES.has(type)) {
      throw new Error(`Invalid backup storage at index ${index}.`);
    }
    ids.add(id);
    const storage = {
      id,
      name: String(entry?.name || id).trim(),
      type,
      path: String(entry?.path || "").trim(),
      remote: String(entry?.remote || "").trim(),
      basePath: String(entry?.basePath || "").replace(/^\/+|\/+$/gu, ""),
      url: String(entry?.url || "").replace(/\/+$/u, ""),
      username: String(entry?.username || ""),
      password: String(entry?.password || ""),
      softLimitBytes: numberOrNull(entry?.softLimitBytes),
      minimumFreeBytes: numberOrNull(entry?.minimumFreeBytes),
      warningFreePercent: numberOr(entry?.warningFreePercent, 15),
      criticalFreePercent: numberOr(entry?.criticalFreePercent, 5),
    };
    if (MOUNT_TYPES.has(type) && !storage.path) {
      throw new Error(`Backup storage ${id} requires path.`);
    }
    if (WEBDAV_TYPES.has(type) && !storage.url) {
      throw new Error(`Backup storage ${id} requires url.`);
    }
    if (["sftp", "s3", "rclone"].includes(type) && !storage.remote) {
      throw new Error(`Backup storage ${id} requires an rclone remote.`);
    }
    return storage;
  });
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function safePart(value) {
  const cleaned = String(value)
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!cleaned || cleaned === "." || cleaned === "..")
    throw new Error("Unsafe backup path component.");
  return cleaned;
}

function destinationRelative(serverId, fileName, basePath = "") {
  return [basePath, safePart(serverId), safePart(fileName)]
    .filter(Boolean)
    .join("/");
}

function webDavHeaders(storage, extra = {}) {
  const headers = { ...extra };
  if (storage.username || storage.password) {
    headers.Authorization = `Basic ${Buffer.from(`${storage.username}:${storage.password}`).toString("base64")}`;
  }
  return headers;
}

function webDavUrl(storage, relative = "") {
  const suffix = [storage.basePath, relative]
    .filter(Boolean)
    .map((part) =>
      part.split("/").filter(Boolean).map(encodeURIComponent).join("/"),
    )
    .filter(Boolean)
    .join("/");
  return `${storage.url}${suffix ? `/${suffix}` : ""}`;
}

async function ensureWebDavPath(storage, relativeDirectory, fetchImpl = fetch) {
  const parts = [storage.basePath, relativeDirectory]
    .filter(Boolean)
    .join("/")
    .split("/")
    .filter(Boolean);
  let current = storage.url;
  for (const part of parts) {
    current += `/${encodeURIComponent(part)}`;
    const response = await fetchImpl(current, {
      method: "MKCOL",
      headers: webDavHeaders(storage),
    });
    if (![201, 405].includes(response.status) && !response.ok) {
      throw new Error(`WebDAV MKCOL failed with HTTP ${response.status}.`);
    }
  }
}
async function copyToStorage(storage, sourceFile, serverId, options = {}) {
  const fileName = path.basename(sourceFile);
  const relative = destinationRelative(serverId, fileName);
  if (MOUNT_TYPES.has(storage.type)) {
    const target = path.join(
      storage.path,
      storage.basePath,
      safePart(serverId),
      safePart(fileName),
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (path.resolve(sourceFile) !== path.resolve(target)) {
      await fs.promises.copyFile(sourceFile, target);
    }
    return { storageId: storage.id, locator: target };
  }
  if (WEBDAV_TYPES.has(storage.type)) {
    const fetchImpl = options.fetch || fetch;
    await ensureWebDavPath(storage, safePart(serverId), fetchImpl);
    const body = fs.createReadStream(sourceFile);
    const response = await fetchImpl(webDavUrl(storage, relative), {
      method: "PUT",
      headers: webDavHeaders(storage, {
        "Content-Type": "application/octet-stream",
      }),
      body,
      duplex: "half",
    });
    if (!response.ok)
      throw new Error(`WebDAV upload failed with HTTP ${response.status}.`);
    return { storageId: storage.id, locator: webDavUrl(storage, relative) };
  }
  const run = options.execFile || execFileAsync;
  const remote = `${storage.remote.replace(/\/+$/u, "")}/${relative}`;
  await run("rclone", ["copyto", sourceFile, remote]);
  return { storageId: storage.id, locator: remote };
}

async function deleteFromStorage(storage, locator, options = {}) {
  if (MOUNT_TYPES.has(storage.type)) {
    await fs.promises.rm(locator, { force: true });
    return;
  }
  if (WEBDAV_TYPES.has(storage.type)) {
    const response = await (options.fetch || fetch)(locator, {
      method: "DELETE",
      headers: webDavHeaders(storage),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`WebDAV delete failed with HTTP ${response.status}.`);
    }
    return;
  }
  await (options.execFile || execFileAsync)("rclone", ["deletefile", locator]);
}
function parseDavQuota(text) {
  const value = (name) => {
    const match = new RegExp(`<[^>]*${name}[^>]*>(\\d+)</[^>]+>`, "iu").exec(
      text,
    );
    return match ? Number(match[1]) : null;
  };
  const free = value("quota-available-bytes");
  const used = value("quota-used-bytes");
  return {
    freeBytes: free,
    totalBytes: free == null || used == null ? null : free + used,
  };
}

async function probeStorage(storage, options = {}) {
  if (MOUNT_TYPES.has(storage.type)) {
    try {
      const stats = fs.statfsSync(storage.path);
      return {
        totalBytes: Number(stats.blocks) * Number(stats.bsize),
        freeBytes: Number(stats.bavail) * Number(stats.bsize),
      };
    } catch (_) {
      return { totalBytes: null, freeBytes: null };
    }
  }
  if (WEBDAV_TYPES.has(storage.type)) {
    try {
      const response = await (options.fetch || fetch)(webDavUrl(storage), {
        method: "PROPFIND",
        headers: webDavHeaders(storage, {
          Depth: "0",
          "Content-Type": "application/xml",
        }),
        body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><quota-available-bytes/><quota-used-bytes/></prop></propfind>',
      });
      if (!response.ok && response.status !== 207)
        return { totalBytes: null, freeBytes: null };
      return parseDavQuota(await response.text());
    } catch (_) {
      return { totalBytes: null, freeBytes: null };
    }
  }
  try {
    const { stdout } = await (options.execFile || execFileAsync)("rclone", [
      "about",
      storage.remote,
      "--json",
    ]);
    const data = JSON.parse(stdout);
    return {
      totalBytes: numberOrNull(data.total),
      freeBytes: numberOrNull(data.free),
    };
  } catch (_) {
    return { totalBytes: null, freeBytes: null };
  }
}
async function testStorageConnection(storage, options = {}) {
  if (MOUNT_TYPES.has(storage.type)) {
    fs.accessSync(storage.path, fs.constants.R_OK | fs.constants.W_OK);
    return {
      ok: true,
      detail: `Path is readable and writable: ${storage.path}`,
    };
  }
  if (WEBDAV_TYPES.has(storage.type)) {
    const response = await (options.fetch || fetch)(webDavUrl(storage), {
      method: "PROPFIND",
      headers: webDavHeaders(storage, {
        Depth: "0",
        "Content-Type": "application/xml",
      }),
      body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
    });
    if (!response.ok && response.status !== 207) {
      throw new Error(
        `WebDAV connection test failed with HTTP ${response.status}.`,
      );
    }
    return {
      ok: true,
      detail: `${storage.type === "nextcloud" ? "Nextcloud" : "WebDAV"} endpoint is reachable.`,
    };
  }
  await (options.execFile || execFileAsync)("rclone", [
    "lsf",
    storage.remote,
    "--max-depth",
    "1",
  ]);
  return { ok: true, detail: `rclone remote is reachable: ${storage.remote}` };
}

function publicStorageUrl(storage) {
  if (storage.type !== "nextcloud") return storage.url || "";
  const marker = "/remote.php/dav/files/";
  const markerIndex = String(storage.url || "").indexOf(marker);
  return markerIndex >= 0
    ? storage.url.slice(0, markerIndex)
    : storage.url || "";
}

function storageSnapshot(storage, backups, metrics = {}) {
  const backupBytes = backups.reduce((sum, backup) => {
    const destinations = Array.isArray(backup.destinations)
      ? backup.destinations
      : [];
    const direct = destinations.includes(storage.id);
    const mounted =
      MOUNT_TYPES.has(storage.type) &&
      destinations.some((value) => {
        if (typeof value !== "string" || !path.isAbsolute(value)) return false;
        const root = path.resolve(storage.path);
        const candidate = path.resolve(value);
        return candidate === root || candidate.startsWith(root + path.sep);
      });
    return direct || mounted ? sum + (Number(backup.sizeBytes) || 0) : sum;
  }, 0);
  return {
    id: storage.id,
    name: storage.name,
    type: storage.type,
    totalBytes: metrics.totalBytes ?? null,
    freeBytes: metrics.freeBytes ?? null,
    backupBytes,
    softLimitBytes: storage.softLimitBytes,
    minimumFreeBytes: storage.minimumFreeBytes,
    safeguardBlocked:
      storage.minimumFreeBytes != null && metrics.freeBytes != null
        ? metrics.freeBytes <= storage.minimumFreeBytes
        : false,
    warningFreePercent: storage.warningFreePercent,
    criticalFreePercent: storage.criticalFreePercent,
    path: storage.path || "",
    remote: storage.remote || "",
    basePath: storage.basePath || "",
    url: publicStorageUrl(storage),
    credentialConfigured: Boolean(storage.password),
    managed: storage.managed === true,
  };
}

function publicStorage(storage) {
  return {
    id: storage.id,
    name: storage.name,
    type: storage.type,
    softLimitBytes: storage.softLimitBytes,
    minimumFreeBytes: storage.minimumFreeBytes,
    warningFreePercent: storage.warningFreePercent,
    criticalFreePercent: storage.criticalFreePercent,
    path: storage.path || "",
    remote: storage.remote || "",
    basePath: storage.basePath || "",
    url: publicStorageUrl(storage),
    credentialConfigured: Boolean(storage.password),
    managed: storage.managed === true,
  };
}

module.exports = {
  parseBackupStorages,
  copyToStorage,
  deleteFromStorage,
  probeStorage,
  testStorageConnection,
  storageSnapshot,
  publicStorage,
  parseDavQuota,
};
