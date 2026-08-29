function integerOr(value, fallback, min = 0, max = 3650) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function boolOr(value, fallback = false) {
  return value == null ? fallback : value === true;
}

function normalizePolicy(raw = {}, fallback = {}) {
  return {
    daily: integerOr(raw.daily, fallback.daily ?? 7),
    weekly: integerOr(raw.weekly, fallback.weekly ?? 4),
    monthly: integerOr(raw.monthly, fallback.monthly ?? 6),
    enforce: boolOr(raw.enforce, fallback.enforce ?? false),
  };
}

function parseBackupRetention(raw, serverIds = []) {
  const text = String(raw || "").trim();
  const parsed = text ? JSON.parse(text) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("BACKUP_RETENTION_JSON must be a JSON object.");
  }
  const global = normalizePolicy(parsed.global || parsed);
  const overrides = {};
  const known = new Set(serverIds);
  const rawServers = parsed.servers || {};
  if (!rawServers || typeof rawServers !== "object" || Array.isArray(rawServers)) {
    throw new Error("BACKUP_RETENTION_JSON.servers must be an object.");
  }
  for (const [serverId, value] of Object.entries(rawServers)) {
    if (!known.has(serverId)) {
      throw new Error(`Unknown retention server: ${serverId}.`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Retention override for ${serverId} must be an object.`);
    }
    overrides[serverId] = normalizePolicy(value, global);
  }
  return { global, servers: overrides };
}

function effectiveRetention(config, serverId) {
  return config.servers[serverId] || config.global;
}

function isoWeekKey(date) {
  const value = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
function retentionBuckets(backups, policy) {
  const completed = backups
    .filter((backup) => backup.status === "completed")
    .filter((backup) => backup.capabilities?.delete === true)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const keep = new Set();
  const takeBuckets = (count, keyOf) => {
    if (count <= 0) return;
    const seen = new Set();
    for (const backup of completed) {
      const date = new Date(backup.createdAt);
      if (Number.isNaN(date.getTime())) continue;
      const key = keyOf(date);
      if (seen.has(key)) continue;
      seen.add(key);
      keep.add(backup.id);
      if (seen.size >= count) break;
    }
  };
  takeBuckets(policy.daily, (date) => date.toISOString().slice(0, 10));
  takeBuckets(policy.weekly, isoWeekKey);
  takeBuckets(policy.monthly, (date) => date.toISOString().slice(0, 7));
  if (completed[0]) keep.add(completed[0].id);
  return { completed, keep };
}

function retentionPlan(backups, config) {
  const byServer = new Map();
  for (const backup of backups) {
    const serverId = String(backup.serverId || "");
    if (!byServer.has(serverId)) byServer.set(serverId, []);
    byServer.get(serverId).push(backup);
  }
  const remove = [];
  const summaries = [];
  for (const [serverId, rows] of byServer.entries()) {
    const policy = effectiveRetention(config, serverId);
    const { completed, keep } = retentionBuckets(rows, policy);
    const candidates = completed.filter((backup) => !keep.has(backup.id));
    remove.push(...candidates.map((backup) => backup.id));
    summaries.push({
      serverId,
      daily: policy.daily,
      weekly: policy.weekly,
      monthly: policy.monthly,
      enforce: policy.enforce,
      kept: keep.size,
      prunable: candidates.length,
    });
  }
  return { remove, summaries };
}
module.exports = {
  parseBackupRetention,
  effectiveRetention,
  retentionPlan,
  retentionBuckets,
  isoWeekKey,
};
