const RANGE_CONFIG = Object.freeze({
  "1h": { milliseconds: 60 * 60 * 1000, bucketMilliseconds: 60 * 1000 },
  "6h": { milliseconds: 6 * 60 * 60 * 1000, bucketMilliseconds: 5 * 60 * 1000 },
  "24h": { milliseconds: 24 * 60 * 60 * 1000, bucketMilliseconds: 15 * 60 * 1000 },
  "7d": { milliseconds: 7 * 24 * 60 * 60 * 1000, bucketMilliseconds: 60 * 60 * 1000 },
  "30d": { milliseconds: 30 * 24 * 60 * 60 * 1000, bucketMilliseconds: 4 * 60 * 60 * 1000 },
});

const PLAN_TPS_COLUMNS = Object.freeze([
  "server_id", "date", "tps", "players_online", "cpu_usage", "ram_usage",
  "entities", "chunks_loaded", "free_disk_space", "mspt_average",
  "mspt_95th_percentile", "mspt_jitter_average", "mspt_jitter_max",
]);

function parseServerMap(raw = "", managementServerIds = []) {
  if (!String(raw).trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("PLAN_SERVER_MAP_JSON must be an array.");
  const known = new Set(managementServerIds);
  const seen = new Set();
  return parsed.map((entry, index) => {
    const serverId = String(entry?.serverId || "").trim();
    const planServerUuid = String(entry?.planServerUuid || "").trim();
    const planServerName = String(entry?.planServerName || "").trim();
    if (!serverId || (!planServerUuid && !planServerName)) {
      throw new Error(`Invalid Plan server mapping at index ${index}.`);
    }
    if (known.size > 0 && !known.has(serverId)) {
      throw new Error(`Plan mapping references unknown management server: ${serverId}.`);
    }
    if (seen.has(serverId)) throw new Error(`Duplicate Plan server mapping: ${serverId}.`);
    seen.add(serverId);
    return { serverId, planServerUuid, planServerName };
  });
}

function planDatabaseConfig(config = {}, environment = process.env) {
  return {
    host: String(config.host || environment.PLAN_DB_HOST || "").trim(),
    port: Number.parseInt(config.port || environment.PLAN_DB_PORT || "3306", 10),
    database: String(config.database || environment.PLAN_DB_DATABASE || "plan").trim(),
    user: String(config.user || environment.PLAN_DB_USER || "").trim(),
    password: String(config.password || environment.PLAN_DB_PASSWORD || ""),
    ssl: String(config.ssl ?? environment.PLAN_DB_SSL ?? "false") === "true",
  };
}
function assertDatabaseConfig(database) {
  if (!database.host) throw new Error("PLAN_DB_HOST is required for Plan performance.");
  if (!database.user) throw new Error("PLAN_DB_USER is required for Plan performance.");
  if (!database.database) throw new Error("PLAN_DB_DATABASE is required for Plan performance.");
  if (!Number.isInteger(database.port) || database.port < 1 || database.port > 65535) {
    throw new Error("PLAN_DB_PORT must be a valid TCP port.");
  }
}

function grantLooksWritable(grant) {
  const lines = String(grant || "")
    .split(/\r?\n/u)
    .map((line) => line.trim().toUpperCase())
    .filter(Boolean);
  return lines.some((line) => {
    const match = /^GRANT\s+(.+?)\s+ON\s+/u.exec(line);
    if (!match) return true;
    const privileges = match[1].split(",").map((value) => value.trim());
    return privileges.some((privilege) => !["SELECT", "USAGE"].includes(privilege));
  });
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundOrNull(value) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
}

function createPlanPerformanceAdapter(config = {}, dependencies = {}) {
  const database = planDatabaseConfig(config, dependencies.environment || process.env);
  const now = dependencies.now || (() => Date.now());
  assertDatabaseConfig(database);
  const mappings = parseServerMap(
    config.serverMapJson || (dependencies.environment || process.env).PLAN_SERVER_MAP_JSON || "",
    config.managementServerIds || [],
  );
  if (mappings.length === 0) throw new Error("PLAN_SERVER_MAP_JSON must contain at least one mapping.");
  const mappingByServer = new Map(mappings.map((mapping) => [mapping.serverId, mapping]));
  const createPool = dependencies.createPool || ((options) => require("mysql2/promise").createPool(options));
  const pool = dependencies.pool || createPool({
    host: database.host,
    port: database.port,
    database: database.database,
    user: database.user,
    password: database.password,
    ssl: database.ssl ? { rejectUnauthorized: true } : undefined,
    waitForConnections: true,
    connectionLimit: 3,
    queueLimit: 20,
    multipleStatements: false,
  });
  let inspected = null;
  const resolvedServers = new Map();

  async function query(sql, values = []) {
    const [rows] = await pool.execute(sql, values);
    return rows;
  }

  async function inspect() {
    if (inspected) return inspected;
    const columns = await query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='plan_tps'",
      [database.database],
    );
    const present = new Set(
      columns.map((row) => String(row.COLUMN_NAME || row.column_name || "")),
    );
    const missing = PLAN_TPS_COLUMNS.filter((column) => !present.has(column));
    if (missing.length > 0) {
      throw new Error(`Plan plan_tps schema is missing RC4 columns: ${missing.join(", ")}.`);
    }
    const grants = await query("SHOW GRANTS FOR CURRENT_USER");
    const grantText = grants.flatMap((row) => Object.values(row)).join("\n");
    if (grantLooksWritable(grantText)) {
      throw new Error("Plan database account is not read-only; use a SELECT-only AdminCraft account.");
    }
    inspected = { readOnly: true, columns: PLAN_TPS_COLUMNS.slice() };
    return inspected;
  }

  async function resolveServer(serverId) {
    if (resolvedServers.has(serverId)) return resolvedServers.get(serverId);
    const mapping = mappingByServer.get(serverId);
    if (!mapping) throw new Error(`Plan performance is not mapped for server ${serverId}.`);
    let rows;
    if (mapping.planServerUuid) {
      rows = await query(
        "SELECT id, uuid, name, is_proxy, plan_version FROM plan_servers WHERE uuid=? LIMIT 2",
        [mapping.planServerUuid],
      );
    } else {
      rows = await query(
        "SELECT id, uuid, name, is_proxy, plan_version FROM plan_servers WHERE name=? LIMIT 2",
        [mapping.planServerName],
      );
    }
    if (rows.length !== 1) {
      const label = mapping.planServerUuid || mapping.planServerName;
      throw new Error(rows.length === 0
        ? `Plan server not found: ${label}.`
        : `Plan server mapping is ambiguous: ${label}.`);
    }
    const resolved = {
      id: Number(rows[0].id),
      uuid: String(rows[0].uuid || ""),
      name: String(rows[0].name || mapping.planServerName || serverId),
      isProxy: Boolean(rows[0].is_proxy),
      version: rows[0].plan_version ? String(rows[0].plan_version) : null,
    };
    resolvedServers.set(serverId, resolved);
    return resolved;
  }

  function descriptor() {
    return {
      type: "plan",
      configured: true,
      canonical: true,
      readOnlyRequired: true,
      serverIds: mappings.map((mapping) => mapping.serverId),
      ranges: Object.keys(RANGE_CONFIG),
    };
  }

  async function history(serverId, range = "1h") {
    const rangeConfig = RANGE_CONFIG[range];
    if (!rangeConfig) throw new Error(`Unsupported performance range: ${range}.`);
    await inspect();
    const planServer = await resolveServer(serverId);
    const before = Number(now());
    const after = before - rangeConfig.milliseconds;
    const bucket = rangeConfig.bucketMilliseconds;
    const rows = await query(
      `SELECT MAX(t.date) AS date,
        AVG(CASE WHEN t.tps >= 0 THEN t.tps END) AS tps,
        MAX(CASE WHEN t.players_online >= 0 THEN t.players_online END) AS players_online,
        AVG(CASE WHEN t.cpu_usage >= 0 THEN t.cpu_usage END) AS cpu_usage,
        AVG(CASE WHEN t.ram_usage >= 0 THEN t.ram_usage END) AS ram_usage,
        AVG(CASE WHEN t.entities >= 0 THEN t.entities END) AS entities,
        AVG(CASE WHEN t.chunks_loaded >= 0 THEN t.chunks_loaded END) AS chunks_loaded,
        MIN(CASE WHEN t.free_disk_space >= 0 THEN t.free_disk_space END) AS free_disk_space,
        AVG(CASE WHEN t.mspt_average >= 0 THEN t.mspt_average END) AS mspt_average,
        MAX(CASE WHEN t.mspt_95th_percentile >= 0 THEN t.mspt_95th_percentile END) AS mspt_95th_percentile,
        AVG(CASE WHEN t.mspt_jitter_average >= 0 THEN t.mspt_jitter_average END) AS mspt_jitter_average,
        MAX(CASE WHEN t.mspt_jitter_max >= 0 THEN t.mspt_jitter_max END) AS mspt_jitter_max
       FROM plan_tps t
       WHERE t.server_id=? AND t.date>=? AND t.date<=?
       GROUP BY FLOOR(t.date / ${bucket}) ORDER BY date ASC`,
      [planServer.id, after, before],
    );
    const samples = rows.map((row) => {
      // Plan SystemUsage persists RAM and free disk in decimal megabytes.
      const memoryMb = numberOrNull(row.ram_usage);
      const freeDiskMb = numberOrNull(row.free_disk_space);
      return {
        serverId,
        at: new Date(Number(row.date)).toISOString(),
        tps: numberOrNull(row.tps),
        mspt: numberOrNull(row.mspt_average),
        msptAverage: numberOrNull(row.mspt_average),
        msptP95: numberOrNull(row.mspt_95th_percentile),
        msptJitterAverage: numberOrNull(row.mspt_jitter_average),
        msptJitterMax: numberOrNull(row.mspt_jitter_max),
        players: roundOrNull(row.players_online),
        cpuPercent: numberOrNull(row.cpu_usage),
        memoryMb,
        entities: roundOrNull(row.entities),
        chunks: roundOrNull(row.chunks_loaded),
        freeDiskBytes: freeDiskMb === null ? null : freeDiskMb * 1000000,
      };
    });
    return {
      type: "admincraft.performance-history",
      source: {
        type: "plan",
        canonical: true,
        readOnly: true,
        serverUuid: planServer.uuid,
        serverName: planServer.name,
        planVersion: planServer.version,
      },
      serverId,
      range,
      samples,
    };
  }

  async function probe() {
    const schema = await inspect();
    const servers = [];
    for (const mapping of mappings) {
      const resolved = await resolveServer(mapping.serverId);
      servers.push({ serverId: mapping.serverId, ...resolved });
    }
    return { ...descriptor(), readOnly: schema.readOnly, servers };
  }

  async function close() {
    if (!dependencies.pool && typeof pool.end === "function") await pool.end();
  }

  return { descriptor, history, probe, close };
}
module.exports = {
  PLAN_TPS_COLUMNS,
  RANGE_CONFIG,
  createPlanPerformanceAdapter,
  grantLooksWritable,
  parseServerMap,
  planDatabaseConfig,
};
