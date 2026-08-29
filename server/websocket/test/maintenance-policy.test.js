const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseMaintenancePolicies,
  policyFor,
  renderMessage,
  publicMaintenancePolicy,
} = require("../maintenance-policy");

test("maintenance policy supports global defaults and server overrides", () => {
  const policies = parseMaintenancePolicies(JSON.stringify({
    global: { milestonesSeconds: [300, 60], healthcheckAttempts: 8 },
    servers: { smp: { healthcheckIntervalSeconds: 10 } },
  }), ["lobby", "smp"]);
  assert.deepEqual(policies.global.milestonesSeconds, [300, 60]);
  assert.equal(policyFor(policies, "smp").healthcheckAttempts, 8);
  assert.equal(policyFor(policies, "smp").healthcheckIntervalSeconds, 10);
});
test("maintenance messages render without exposing private config", () => {
  const policies = parseMaintenancePolicies("", ["smp"]);
  const policy = policyFor(policies, "smp");
  assert.equal(
    renderMessage(policy.countdownMessage, { seconds: 300 }),
    "Server maintenance starts in 5 minute(s).",
  );
  assert.equal(
    renderMessage(policy.waitingEmptyMessage, { players: 3 }),
    "Maintenance is waiting for 3 player(s) to leave.",
  );
  const visible = publicMaintenancePolicy(policy);
  assert.deepEqual(visible.countdownOptionsSeconds, [60, 300, 600, 1800]);
  assert.equal(Object.hasOwn(visible, "availableMessage"), false);
});

test("maintenance config rejects unknown server overrides and control lines", () => {
  assert.throws(
    () => parseMaintenancePolicies(JSON.stringify({ servers: { bad: {} } }), ["smp"]),
    /Unknown maintenance server override/u,
  );
  assert.throws(
    () => parseMaintenancePolicies(JSON.stringify({
      global: { availableMessage: "bad\ncommand" },
    }), ["smp"]),
    /without control lines/u,
  );
});
