const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PLAN_TPS_COLUMNS,
  createPlanPerformanceAdapter,
  grantLooksWritable,
  parseServerMap,
} = require("../plan-performance");

function fakePool({ writable = false } = {}) {
  const calls = [];
  const now = Date.parse("2026-08-29T20:00:00Z");
  return {
    calls,
    now,
    async execute(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("information_schema.COLUMNS")) {
        return [PLAN_TPS_COLUMNS.map((COLUMN_NAME) => ({ COLUMN_NAME })), []];
      }
      if (sql.startsWith("SHOW GRANTS")) {
        const grant = writable
          ? "GRANT SELECT, UPDATE ON `plan`.* TO `admincraft`@`%`"
          : "GRANT SELECT ON `plan`.* TO `admincraft`@`%`";
        return [[{ grant }], []];
      }
      if (sql.includes("FROM plan_servers")) {
        return [[{
          id: 42,
          uuid: "11111111-2222-3333-4444-555555555555",
          name: "SMP",
          is_proxy: 0,
          plan_version: "5.8 build 3605",
        }], []];
      }
      if (sql.includes("FROM plan_tps")) {
        return [[{
          date: now - 60000,
          tps: 19.75,
          players_online: 3,
          cpu_usage: 24.5,
          ram_usage: 2048,
          entities: 150,
          chunks_loaded: 245,
          free_disk_space: 50000,
          mspt_average: 18.25,
          mspt_95th_percentile: 27.75,
          mspt_jitter_average: 1.25,
          mspt_jitter_max: 4.5,
        }], []];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}
function adapter(pool) {
  return createPlanPerformanceAdapter({
    host: "plan-db",
    database: "plan",
    user: "admincraft_ro",
    password: "secret",
    managementServerIds: ["smp"],
    serverMapJson: JSON.stringify([
      { serverId: "smp", planServerName: "SMP" },
    ]),
  }, {
    pool,
    now: () => pool.now,
  });
}

test("Plan mappings are explicit and management-scoped", () => {
  const mappings = parseServerMap(
    JSON.stringify([{ serverId: "smp", planServerUuid: "abc" }]),
    ["smp"],
  );
  assert.deepEqual(mappings, [{ serverId: "smp", planServerUuid: "abc", planServerName: "" }]);
  assert.throws(
    () => parseServerMap(JSON.stringify([{ serverId: "other", planServerName: "Other" }]), ["smp"]),
    /unknown management server/u,
  );
});

test("Plan database grants must be read-only", () => {
  assert.equal(grantLooksWritable("GRANT SELECT ON `plan`.* TO `ro`@`%`"), false);
  assert.equal(grantLooksWritable("GRANT SELECT, UPDATE ON `plan`.* TO `rw`@`%`"), true);
  assert.equal(grantLooksWritable("GRANT ALL PRIVILEGES ON `plan`.* TO `rw`@`%`"), true);
  assert.equal(grantLooksWritable("GRANT SHOW VIEW ON `plan`.* TO `wide`@`%`"), true);
});
test("Plan history returns the canonical Minecraft performance contract", async () => {
  const pool = fakePool();
  const source = adapter(pool);
  const frame = await source.history("smp", "1h");
  assert.equal(frame.type, "admincraft.performance-history");
  assert.equal(frame.source.type, "plan");
  assert.equal(frame.source.canonical, true);
  assert.equal(frame.source.readOnly, true);
  assert.equal(frame.source.planVersion, "5.8 build 3605");
  assert.equal(frame.samples.length, 1);
  assert.deepEqual(frame.samples[0], {
    serverId: "smp",
    at: "2026-08-29T19:59:00.000Z",
    tps: 19.75,
    mspt: 18.25,
    msptAverage: 18.25,
    msptP95: 27.75,
    msptJitterAverage: 1.25,
    msptJitterMax: 4.5,
    players: 3,
    cpuPercent: 24.5,
    memoryMb: 2048,
    entities: 150,
    chunks: 245,
    freeDiskBytes: 50000000000,
  });
});
test("Plan history uses SELECT-only queries and range downsampling", async () => {
  const pool = fakePool();
  const source = adapter(pool);
  await source.history("smp", "30d");
  assert.ok(pool.calls.every(({ sql }) => /^SELECT\b|^SHOW GRANTS\b/u.test(sql.trim())));
  const historyQuery = pool.calls.find(({ sql }) => sql.includes("FROM plan_tps"));
  assert.ok(historyQuery);
  assert.match(historyQuery.sql, /CASE WHEN t\.cpu_usage >= 0/u);
  assert.match(historyQuery.sql, /GROUP BY FLOOR\(t\.date \/ 14400000\)/u);
  assert.deepEqual(historyQuery.values, [42, pool.now - 30 * 24 * 60 * 60 * 1000, pool.now]);
});

test("Plan history rejects a database account with write grants", async () => {
  const source = adapter(fakePool({ writable: true }));
  await assert.rejects(
    source.history("smp", "1h"),
    /not read-only/u,
  );
});

test("Plan history rejects unsupported ranges", async () => {
  const source = adapter(fakePool());
  await assert.rejects(
    source.history("smp", "90d"),
    /Unsupported performance range/u,
  );
});
