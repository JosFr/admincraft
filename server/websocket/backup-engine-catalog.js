const fs = require("fs");
const path = require("path");

const BUILTIN_PLUGIN_ADAPTERS = [
  {
    key: "webdavbackup",
    label: "WebDavBackup",
    filePattern: /^WebDavBackup(?:[-_.].*)?\.jar$/iu,
    command: "backup",
    backupType: "custom",
  },
];

function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory();
  } catch (_) {
    return false;
  }
}

function pluginJars(directory) {
  if (!isDirectory(directory)) return [];
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"),
      )
      .map((entry) => entry.name);
  } catch (_) {
    return [];
  }
}
function availabilityCapabilities(type, engine, capabilities) {
  const base = capabilities(type, engine);
  return engine.available === false ? { ...base, create: false } : base;
}

function addNativeEngine({
  engines,
  ids,
  server,
  sourceRoot,
  stagingRoot,
  capabilities,
}) {
  const explicit = engines.some(
    (engine) => engine.serverId === server.id && engine.type === "native",
  );
  if (explicit) return;
  const engineId = `native-${server.id}`;
  if (ids.has(engineId)) return;
  const sourcePath = path.join(
    sourceRoot,
    `server${server.multicraftServerId}`,
  );
  const available = isDirectory(sourcePath);
  const engine = {
    id: engineId,
    type: "native",
    serverId: server.id,
    label: "AdminCraft Native",
    sourcePath,
    stagingPath: path.join(stagingRoot, server.id),
    command: "",
    backupType: "full-server",
    allowRestore: false,
    destinationIds: [],
    completionRegex: "",
    failureRegex: "",
    completionTimeoutSeconds: 600,
    consistency: "offline",
    available,
    managed: false,
    configurable: false,
    availability: available ? "ready" : "unavailable",
    availabilityMessage: available
      ? "Full-server source is available."
      : `Server source is not mounted at ${sourcePath}.`,
  };
  engine.capabilities = availabilityCapabilities(
    "native",
    engine,
    capabilities,
  );
  ids.add(engineId);
  engines.push(engine);
}

function addBuiltInPluginEngines({ engines, ids, server, jars, capabilities }) {
  for (const adapter of BUILTIN_PLUGIN_ADAPTERS) {
    const explicit = engines.some(
      (engine) =>
        engine.serverId === server.id &&
        engine.type === "plugin" &&
        engine.label.toLowerCase() === adapter.label.toLowerCase(),
    );
    if (explicit) continue;
    const engineId = `plugin-${adapter.key}-${server.id}`;
    if (ids.has(engineId)) continue;
    const installed = jars.some((name) => adapter.filePattern.test(name));
    const engine = {
      id: engineId,
      type: "plugin",
      serverId: server.id,
      label: adapter.label,
      sourcePath: "",
      stagingPath: "",
      command: adapter.command,
      backupType: adapter.backupType,
      allowRestore: false,
      destinationIds: [],
      completionRegex: "",
      failureRegex: "",
      completionTimeoutSeconds: 600,
      consistency: "",
      available: installed,
      managed: false,
      configurable: false,
      availability: installed ? "ready" : "notInstalled",
      availabilityMessage: installed
        ? `${adapter.label} was detected in the server plugins directory.`
        : `${adapter.label} is not installed on this server.`,
    };
    engine.capabilities = availabilityCapabilities(
      "plugin",
      engine,
      capabilities,
    );
    ids.add(engineId);
    engines.push(engine);
  }
}

function addCustomEngine({ engines, ids, server, capabilities }) {
  const explicit = engines.some(
    (engine) => engine.serverId === server.id && engine.type === "custom",
  );
  if (explicit) return;
  const engineId = `custom-${server.id}`;
  if (ids.has(engineId)) return;
  const engine = {
    id: engineId,
    type: "custom",
    serverId: server.id,
    label: "Custom command",
    sourcePath: "",
    stagingPath: "",
    command: "",
    backupType: "custom",
    allowRestore: false,
    destinationIds: [],
    completionRegex: "",
    failureRegex: "",
    completionTimeoutSeconds: 600,
    consistency: "",
    available: false,
    managed: false,
    configurable: true,
    availability: "configurationRequired",
    availabilityMessage:
      "Configure a command and optional completion regex before use.",
  };
  engine.capabilities = availabilityCapabilities(
    "custom",
    engine,
    capabilities,
  );
  ids.add(engineId);
  engines.push(engine);
}
function addDetectedPluginEngines({
  engines,
  ids,
  server,
  jars,
  capabilities,
}) {
  const known = new Set(
    BUILTIN_PLUGIN_ADAPTERS.filter((adapter) =>
      jars.some((name) => adapter.filePattern.test(name)),
    ).flatMap((adapter) =>
      jars.filter((name) => adapter.filePattern.test(name)),
    ),
  );
  for (const jar of jars) {
    if (known.has(jar) || !/backup|snapshot|drive|webdav|cloud/iu.test(jar)) {
      continue;
    }
    const base = jar.replace(/\.jar$/iu, "").replace(/[^a-zA-Z0-9._-]+/gu, "-");
    const engineId = `plugin-detected-${server.id}-${base}`;
    if (ids.has(engineId)) continue;
    const engine = {
      id: engineId,
      type: "plugin",
      serverId: server.id,
      label: base,
      sourcePath: "",
      stagingPath: "",
      command: "",
      backupType: "custom",
      allowRestore: false,
      destinationIds: [],
      completionRegex: "",
      failureRegex: "",
      completionTimeoutSeconds: 600,
      consistency: "",
      available: false,
      managed: false,
      configurable: true,
      availability: "configurationRequired",
      availabilityMessage:
        "Backup-related plugin detected, but no safe built-in command adapter is configured.",
    };
    engine.capabilities = availabilityCapabilities(
      "plugin",
      engine,
      capabilities,
    );
    ids.add(engineId);
    engines.push(engine);
  }
}

function enrichBackupEngineCatalog({
  engines,
  servers,
  capabilities,
  sourceRoot = process.env.MANAGEMENT_NATIVE_SOURCE_ROOT || "/minecraft",
  stagingRoot = process.env.MANAGEMENT_NATIVE_BACKUP_PATH || "/backups",
}) {
  const result = [...engines];
  const ids = new Set(["multicraft", ...result.map((engine) => engine.id)]);
  for (const server of servers) {
    const sourcePath = path.join(
      sourceRoot,
      `server${server.multicraftServerId}`,
    );
    const jars = pluginJars(path.join(sourcePath, "plugins"));
    addNativeEngine({
      engines: result,
      ids,
      server,
      sourceRoot,
      stagingRoot,
      capabilities,
    });
    addBuiltInPluginEngines({
      engines: result,
      ids,
      server,
      jars,
      capabilities,
    });
    addDetectedPluginEngines({
      engines: result,
      ids,
      server,
      jars,
      capabilities,
    });
    addCustomEngine({ engines: result, ids, server, capabilities });
  }
  return result;
}

module.exports = {
  BUILTIN_PLUGIN_ADAPTERS,
  enrichBackupEngineCatalog,
  pluginJars,
  isDirectory,
};
