const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  createGenericPerformanceAdapter,
  parseAdmincraftStatus,
  sampleFromStatus,
} = require("../generic-performance");

function server(id, multicraftServerId) {
  return { id, name: id.toUpperCase(), multicraftServerId };
}
test("AdminCraft status parser reads the structured console frame", () => {
  const parsed = parseAdmincraftStatus([
    "unrelated",
    'AdmincraftStatus:{"tps":19.9,"msptAverage":12.5,"playersOnline":3}',
  ]);
  assert.deepEqual(parsed, {
    tps: 19.9,
    msptAverage: 12.5,
    playersOnline: 3,
  });
});

test("generic samples preserve the Plan-compatible contract", () => {
  const sample = sampleFromStatus(
    "skeerekippen",
    1000,
    {
      tps: 19.8,
      msptAverage: 14.2,
      msptP95: 25,
      playersOnline: 4,
      entities: 120,
      chunksLoaded: 80,
    },
    { cpuPercent: 22, memoryMb: 1536 },
    {},
  );
  assert.deepEqual(sample, {
    serverId: "skeerekippen",
    at: "1970-01-01T00:00:01.000Z",
    tps: 19.8,
    mspt: 14.2,
    msptAverage: 14.2,
    msptP95: 25,
    msptJitterAverage: null,
    msptJitterMax: null,
    players: 4,
    cpuPercent: 22,
    memoryMb: 1536,
    entities: 120,
    chunks: 80,
    freeDiskBytes: null,
  });
});

function fakeMulticraft() {
  const logs = new Map();
  return {
    async status() {
      return "running";
    },
    async resources() {
      return { cpuPercent: 12, memoryMb: 768 };
    },
    async statusDetails() {
      return { onlinePlayers: 2 };
    },
    async log(id) {
      return [...(logs.get(id) || [])];
    },
    async sendConsole(id, command) {
      assert.equal(command, "admincraftstatus");
      const list = logs.get(id) || [];
      logs.set(id, [
        ...list,
        `AdmincraftStatus:{"tps":19.7,"msptAverage":16.5,"playersOnline":2}`,
      ]);
    },
  };
}

test("fallback history is automatic for every non-Plan management server", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-perf-"));
  const now = Date.parse("2026-08-31T20:00:00Z");
  const plan = {
    descriptor() {
      return { type: "plan", serverIds: ["smp"], ranges: ["1h"] };
    },
    async history(serverId, range) {
      return {
        type: "admincraft.performance-history",
        source: { type: "plan", canonical: true, readOnly: true },
        serverId,
        range,
        samples: [{ serverId, at: new Date(now).toISOString(), tps: 20 }],
      };
    },
  };
  try {
    const source = createGenericPerformanceAdapter(
      {
        servers: [
          server("smp", 7),
          server("skeerekippen", 6),
          server("new-server", 9),
        ],
        root: dir,
        sampleMilliseconds: 30000,
      },
      {
        multicraft: fakeMulticraft(),
        planPerformance: plan,
        now: () => now,
        sleep: async () => {},
        pollAttempts: 1,
        pollDelayMs: 0,
      },
    );

    assert.deepEqual(source.descriptor().serverIds, [
      "smp",
      "skeerekippen",
      "new-server",
    ]);
    assert.deepEqual(source.descriptor().planServerIds, ["smp"]);
    await source.tick();

    const fallback = await source.history("skeerekippen", "1h");
    assert.equal(fallback.source.type, "admincraft");
    assert.equal(fallback.samples.length, 1);
    assert.equal(fallback.samples[0].tps, 19.7);
    assert.equal(fallback.samples[0].msptAverage, 16.5);
    assert.equal(fallback.samples[0].cpuPercent, 12);

    const addedLater = await source.history("new-server", "1h");
    assert.equal(addedLater.samples.length, 1);
    const canonical = await source.history("smp", "1h");
    assert.equal(canonical.source.type, "plan");
    assert.equal(canonical.samples[0].tps, 20);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("generic performance uses a management-local default path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-state-"));
  try {
    const source = createGenericPerformanceAdapter(
      {
        servers: [server("lobby", 8)],
        statePath: path.join(dir, "management-state.json"),
      },
      { multicraft: fakeMulticraft() },
    );
    assert.equal(source.probe instanceof Function, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
