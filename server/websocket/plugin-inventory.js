const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const METADATA_NAMES = new Set([
  "plugin.yml",
  "paper-plugin.yml",
  "velocity-plugin.json",
]);

function findEocd(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD) return offset;
  }
  throw new Error("JAR end-of-central-directory record not found.");
}
function centralEntries(buffer) {
  const eocd = findEocd(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL) {
      throw new Error("Invalid JAR central directory entry.");
    }
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    entries.push({
      name,
      compression,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
function readZipEntry(buffer, entry) {
  if (entry.uncompressedSize > 1024 * 1024) {
    throw new Error("Plugin metadata entry is unexpectedly large.");
  }
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== LOCAL) {
    throw new Error("Invalid JAR local file header.");
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.compression === 0) return Buffer.from(compressed);
  if (entry.compression === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported JAR compression method: ${entry.compression}.`);
}

function unquote(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}
function yamlIdentity(text) {
  let name = "";
  let version = "";
  for (const line of String(text || "").split(/\r?\n/u)) {
    const nameMatch = /^\s*name\s*:\s*(.+?)\s*$/iu.exec(line);
    if (nameMatch && !name) name = unquote(nameMatch[1]);
    const versionMatch = /^\s*version\s*:\s*(.+?)\s*$/iu.exec(line);
    if (versionMatch && !version) version = unquote(versionMatch[1]);
    if (name && version) break;
  }
  return { name, version };
}

function velocityIdentity(text) {
  try {
    const data = JSON.parse(String(text || ""));
    return {
      name: String(data.name || data.id || "").trim(),
      version: String(data.version || "").trim(),
    };
  } catch (_) {
    return { name: "", version: "" };
  }
}

function filenameIdentity(file) {
  const stem = path.basename(file, path.extname(file));
  const match = /^(.*?)[-_]v?(\d+(?:\.\d+)+(?:[-+._][A-Za-z0-9.-]+)?)$/u.exec(
    stem,
  );
  return match
    ? { name: match[1], version: match[2] }
    : { name: stem, version: "" };
}
function pluginJarIdentity(file) {
  const fallback = filenameIdentity(file);
  let buffer;
  try {
    buffer = fs.readFileSync(file);
    if (buffer.length < 22) return { ...fallback, metadata: "filename" };
    const entries = centralEntries(buffer);
    const metadata = entries.find((entry) => {
      const normalized = entry.name.replace(/^\.\//u, "").toLowerCase();
      return METADATA_NAMES.has(normalized);
    });
    if (!metadata) return { ...fallback, metadata: "filename" };
    const body = readZipEntry(buffer, metadata).toString("utf8");
    const normalized = metadata.name.toLowerCase();
    const parsed = normalized.endsWith(".json")
      ? velocityIdentity(body)
      : yamlIdentity(body);
    return {
      name: parsed.name || fallback.name,
      version: parsed.version || fallback.version,
      metadata: normalized,
    };
  } catch (_) {
    return { ...fallback, metadata: "filename" };
  }
}

function pluginDirectoryInventory(directory) {
  if (!fs.existsSync(directory)) return [];
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jar")) continue;
    const file = path.join(directory, entry.name);
    const identity = pluginJarIdentity(file);
    plugins.push({
      name: identity.name,
      version: identity.version,
      jar: entry.name,
      metadata: identity.metadata,
    });
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

function minecraftVersionFromText(text) {
  const patterns = [
    /Starting minecraft server version\s+([0-9]+(?:\.[0-9]+){1,3})/giu,
    /Loading Paper\s+([0-9]+(?:\.[0-9]+){1,3})(?:[-+\s]|$)/giu,
    /Minecraft Version:\s*([0-9]+(?:\.[0-9]+){1,3})/giu,
    /Implementing API version\s+([0-9]+(?:\.[0-9]+){1,3})-R/giu,
  ];
  let latest = null;
  for (const pattern of patterns) {
    for (const match of String(text || "").matchAll(pattern)) {
      if (!latest || match.index > latest.index) {
        latest = { index: match.index, version: match[1] };
      }
    }
  }
  return latest?.version || null;
}

function minecraftVersionFromLog(file, { fromEnd = false } = {}) {
  if (!fs.existsSync(file)) return null;
  try {
    if (file.toLowerCase().endsWith(".gz")) {
      const compressed = fs.readFileSync(file);
      if (compressed.length > 8 * 1024 * 1024) return null;
      return minecraftVersionFromText(zlib.gunzipSync(compressed).toString("utf8"));
    }
    const stat = fs.statSync(file);
    const length = Math.min(stat.size, 2 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, "r");
    try {
      fs.readSync(
        fd,
        buffer,
        0,
        length,
        fromEnd ? Math.max(0, stat.size - length) : 0,
      );
    } finally {
      fs.closeSync(fd);
    }
    return minecraftVersionFromText(buffer.toString("utf8"));
  } catch (_) {
    return null;
  }
}

function minecraftVersionFromServerLogs(serverRoot) {
  const logs = path.join(serverRoot, "logs");
  const direct =
    minecraftVersionFromLog(path.join(logs, "latest.log")) ||
    minecraftVersionFromLog(path.join(serverRoot, "server.log"), { fromEnd: true });
  if (direct) return direct;
  let archived = [];
  try {
    archived = fs
      .readdirSync(logs, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log.gz"))
      .map((entry) => {
        const file = path.join(logs, entry.name);
        return { file, mtime: fs.statSync(file).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 3);
  } catch (_) {
    return null;
  }
  for (const entry of archived) {
    const version = minecraftVersionFromLog(entry.file);
    if (version) return version;
  }
  return null;
}


async function resolveMinecraftVersionFromMulticraft(
  multicraft,
  server,
  { sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), attempts = 8, intervalMs = 250 } = {},
) {
  if (!multicraft || !server?.multicraftServerId) return null;
  const id = server.multicraftServerId;
  const readVersion = async () => {
    const lines = await multicraft.log(id).catch(() => []);
    return minecraftVersionFromText(Array.isArray(lines) ? lines.join("\n") : "");
  };
  const existing = await readVersion();
  if (existing) return existing;
  const status = await multicraft.status(id).catch(() => "stopped");
  if (status !== "running") return null;
  await multicraft.sendConsole(id, "version").catch(() => null);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(intervalMs);
    const version = await readVersion();
    if (version) return version;
  }
  return null;
}

function discoverPluginProjects({
  servers = [],
  sourceRoot = "/minecraft",
} = {}) {
  const projects = [];
  for (const server of servers) {
    const serverRoot = path.join(
      sourceRoot,
      `server${server.multicraftServerId}`,
    );
    const directory = path.join(serverRoot, "plugins");
    const gameVersion = minecraftVersionFromServerLogs(serverRoot);
    for (const plugin of pluginDirectoryInventory(directory)) {
      projects.push({
        serverId: server.id,
        serverName: server.name,
        plugin: plugin.name,
        kind: "plugin",
        currentVersion: plugin.version,
        gameVersion,
        provider: null,
        projectId: "",
        sourceConfirmed: false,
        candidates: [],
        url: null,
        inventory: { jar: plugin.jar, metadata: plugin.metadata },
      });
    }
  }
  return projects;
}
module.exports = {
  centralEntries,
  discoverPluginProjects,
  filenameIdentity,
  minecraftVersionFromLog,
  minecraftVersionFromServerLogs,
  minecraftVersionFromText,
  resolveMinecraftVersionFromMulticraft,
  pluginDirectoryInventory,
  pluginJarIdentity,
  readZipEntry,
  velocityIdentity,
  yamlIdentity,
};
