const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseBackupRetention,
  effectiveRetention,
  retentionPlan,
} = require("../backup-policy");

function backup(id, at, serverId = "smp") {
  return {
    id,
    serverId,
    createdAt: at,
    status: "completed",
    capabilities: { delete: true },
  };
}

test("retention supports global defaults and server overrides", () => {
  const config = parseBackupRetention(JSON.stringify({
    global: { daily: 7, weekly: 4, monthly: 6, enforce: false },
    servers: { smp: { daily: 14, enforce: true } },
  }), ["lobby", "smp"]);
  assert.equal(config.global.daily, 7);
  assert.equal(effectiveRetention(config, "smp").daily, 14);
  assert.equal(effectiveRetention(config, "smp").weekly, 4);
  assert.equal(effectiveRetention(config, "smp").enforce, true);
});
test("retention keeps daily weekly and monthly buckets", () => {
  const config = parseBackupRetention(JSON.stringify({
    global: { daily: 2, weekly: 1, monthly: 1, enforce: false },
  }), ["smp"]);
  const rows = [
    backup("b1", "2026-08-29T12:00:00Z"),
    backup("b2", "2026-08-29T08:00:00Z"),
    backup("b3", "2026-08-28T12:00:00Z"),
    backup("b4", "2026-08-27T12:00:00Z"),
    backup("b5", "2026-07-20T12:00:00Z"),
  ];
  const plan = retentionPlan(rows, config);
  assert.equal(plan.summaries.length, 1);
  assert.equal(plan.summaries[0].prunable > 0, true);
  assert.equal(plan.remove.includes("b1"), false);
  assert.equal(plan.remove.includes("b2"), true);
});

test("retention never prunes backups the engine cannot delete", () => {
  const config = parseBackupRetention(JSON.stringify({
    global: { daily: 0, weekly: 0, monthly: 0, enforce: true },
  }), ["smp"]);
  const row = backup("multicraft", "2026-01-01T00:00:00Z");
  row.capabilities.delete = false;
  assert.deepEqual(retentionPlan([row], config).remove, []);
});

test("retention rejects unknown server overrides", () => {
  assert.throws(
    () => parseBackupRetention('{"servers":{"unknown":{"daily":1}}}', ["smp"]),
    /Unknown retention server/u,
  );
});
