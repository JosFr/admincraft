const DEFAULT_POLICY = Object.freeze({
  countdownOptionsSeconds: [60, 300, 600, 1800],
  milestonesSeconds: [600, 300, 60, 30, 10],
  countdownMessage: "Server maintenance starts in {time}.",
  startingMessage: "Server maintenance is starting now.",
  waitingEmptyMessage: "Maintenance is waiting for {players} player(s) to leave.",
  availableMessage: "Server is available again.",
  cancelledMessage: "Server maintenance was cancelled.",
  healthcheckAttempts: 12,
  healthcheckIntervalSeconds: 5,
});

function plainText(value, fallback) {
  if (value == null) return fallback;
  const text = String(value).trim();
  if (!text || /[\r\n\0]/u.test(text) || text.length > 300) {
    throw new Error("Maintenance messages must be 1-300 characters without control lines.");
  }
  return text;
}
function intList(value, fallback, label) {
  if (value == null) return [...fallback];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const result = [...new Set(value.map((item) => Number.parseInt(item, 10)))];
  if (result.some((item) => !Number.isInteger(item) || item < 1 || item > 86400)) {
    throw new Error(`${label} values must be between 1 and 86400 seconds.`);
  }
  return result.sort((a, b) => b - a);
}

function positiveInt(value, fallback, min, max, label) {
  if (value == null) return fallback;
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return number;
}
function normalizePolicy(raw = {}, base = DEFAULT_POLICY) {
  return {
    countdownOptionsSeconds: intList(
      raw.countdownOptionsSeconds, base.countdownOptionsSeconds, "countdownOptionsSeconds",
    ).sort((a, b) => a - b),
    milestonesSeconds: intList(
      raw.milestonesSeconds, base.milestonesSeconds, "milestonesSeconds",
    ),
    countdownMessage: plainText(raw.countdownMessage, base.countdownMessage),
    startingMessage: plainText(raw.startingMessage, base.startingMessage),
    waitingEmptyMessage: plainText(raw.waitingEmptyMessage, base.waitingEmptyMessage),
    availableMessage: plainText(raw.availableMessage, base.availableMessage),
    cancelledMessage: plainText(raw.cancelledMessage, base.cancelledMessage),
    healthcheckAttempts: positiveInt(
      raw.healthcheckAttempts, base.healthcheckAttempts, 1, 120, "healthcheckAttempts",
    ),
    healthcheckIntervalSeconds: positiveInt(
      raw.healthcheckIntervalSeconds, base.healthcheckIntervalSeconds,
      1, 300, "healthcheckIntervalSeconds",
    ),
  };
}
function parseMaintenancePolicies(raw, serverIds = []) {
  if (!String(raw || "").trim()) {
    return { global: normalizePolicy(), servers: {} };
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MAINTENANCE_CONFIG_JSON must be an object.");
  }
  const global = normalizePolicy(parsed.global || {});
  const allowed = new Set(serverIds);
  const servers = {};
  for (const [serverId, value] of Object.entries(parsed.servers || {})) {
    if (!allowed.has(serverId)) {
      throw new Error(`Unknown maintenance server override: ${serverId}.`);
    }
    servers[serverId] = normalizePolicy(value || {}, global);
  }
  return { global, servers };
}

function policyFor(policies, serverId) {
  return policies.servers[serverId] || policies.global;
}
function durationLabel(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600} hour(s)`;
  if (seconds % 60 === 0) return `${seconds / 60} minute(s)`;
  return `${seconds} second(s)`;
}

function renderMessage(template, values = {}) {
  return String(template)
    .replaceAll("{time}", durationLabel(Number(values.seconds) || 0))
    .replaceAll("{players}", String(values.players ?? 0));
}

function publicMaintenancePolicy(policy) {
  return {
    countdownOptionsSeconds: [...policy.countdownOptionsSeconds],
    milestonesSeconds: [...policy.milestonesSeconds],
    healthcheckAttempts: policy.healthcheckAttempts,
    healthcheckIntervalSeconds: policy.healthcheckIntervalSeconds,
  };
}

module.exports = {
  DEFAULT_POLICY, parseMaintenancePolicies, policyFor,
  renderMessage, publicMaintenancePolicy,
};
