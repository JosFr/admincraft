const fs = require("fs");
const path = require("path");
const { RANGE_CONFIG } = require("./plan-performance");

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function safeId(value) {
  const cleaned = String(value || "")
    .replace(/[^a-zA-Z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error("Unsafe performance server ID.");
  }
  return cleaned;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) return numberOrNull(value[0]);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value) {
  const parsed = numberOrNull(value);
  return parsed === null ? null : Math.round(parsed);
}
function parseAdmincraftStatus(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value || "");
  const marker = "AdmincraftStatus:";
  const index = text.lastIndexOf(marker);
  if (index < 0) return null;
  const tail = text.slice(index + marker.length).trim();
  const firstLine = tail.split(/\r?\n/u)[0].trim();
  try {
    const parsed = JSON.parse(firstLine);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function appendedLogLines(previous = [], current = []) {
  const before = Array.isArray(previous) ? previous : [];
  const after = Array.isArray(current) ? current : [];
  const max = Math.min(before.length, after.length);
  for (let overlap = max; overlap >= 0; overlap--) {
    let match = true;
    for (let index = 0; index < overlap; index++) {
      if (before[before.length - overlap + index] !== after[index]) {
        match = false;
        break;
      }
    }
    if (match) return after.slice(overlap);
  }
  return [...after];
}
function sampleFromStatus(
  serverId,
  at,
  structured = {},
  resources = {},
  details = {},
) {
  const msptObject =
    structured.mspt && typeof structured.mspt === "object"
      ? structured.mspt
      : null;
  return {
    serverId,
    at: new Date(at).toISOString(),
    tps: numberOrNull(
      structured.tps ?? structured.tps1m ?? structured.tpsAverage,
    ),
    mspt: numberOrNull(
      structured.msptAverage ?? msptObject?.average ?? structured.mspt,
    ),
    msptAverage: numberOrNull(
      structured.msptAverage ?? msptObject?.average ?? structured.mspt,
    ),
    msptP95: numberOrNull(structured.msptP95 ?? msptObject?.p95),
    msptJitterAverage: numberOrNull(
      structured.msptJitterAverage ?? msptObject?.jitterAverage,
    ),
    msptJitterMax: numberOrNull(
      structured.msptJitterMax ?? msptObject?.jitterMax,
    ),
    players: integerOrNull(
      structured.playersOnline ??
        structured.onlinePlayers ??
        details.onlinePlayers,
    ),
    cpuPercent: numberOrNull(resources.cpuPercent),
    memoryMb: numberOrNull(resources.memoryMb),
    entities: integerOrNull(structured.entities ?? structured.entityCount),
    chunks: integerOrNull(structured.chunks ?? structured.chunksLoaded),
    freeDiskBytes: numberOrNull(structured.freeDiskBytes),
  };
}
function average(values) {
  const present = values.filter((value) => Number.isFinite(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

function maximum(values) {
  const present = values.filter((value) => Number.isFinite(value));
  return present.length === 0 ? null : Math.max(...present);
}

function minimum(values) {
  const present = values.filter((value) => Number.isFinite(value));
  return present.length === 0 ? null : Math.min(...present);
}

function bucketSamples(samples, bucketMilliseconds) {
  const buckets = new Map();
  for (const sample of samples) {
    const time = Date.parse(sample.at);
    if (!Number.isFinite(time)) continue;
    const key = Math.floor(time / bucketMilliseconds);
    const list = buckets.get(key) || [];
    list.push(sample);
    buckets.set(key, list);
  }
  return [...buckets.values()].map((list) => ({
    serverId: list[0].serverId,
    at: list[list.length - 1].at,
    tps: average(list.map((item) => item.tps)),
    mspt: average(list.map((item) => item.mspt)),
    msptAverage: average(list.map((item) => item.msptAverage)),
    msptP95: maximum(list.map((item) => item.msptP95)),
    msptJitterAverage: average(list.map((item) => item.msptJitterAverage)),
    msptJitterMax: maximum(list.map((item) => item.msptJitterMax)),
    players: maximum(list.map((item) => item.players)),
    cpuPercent: average(list.map((item) => item.cpuPercent)),
    memoryMb: average(list.map((item) => item.memoryMb)),
    entities: average(list.map((item) => item.entities)),
    chunks: average(list.map((item) => item.chunks)),
    freeDiskBytes: minimum(list.map((item) => item.freeDiskBytes)),
  }));
}

function readSamples(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed && typeof parsed === "object" ? [parsed] : [];
      } catch (_) {
        return [];
      }
    });
}

function appendSample(file, sample) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(sample)}\n`, "utf8");
}
function compactFile(file, cutoff) {
  const kept = readSamples(file).filter((sample) => {
    const time = Date.parse(sample.at);
    return Number.isFinite(time) && time >= cutoff;
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text =
    kept.length === 0
      ? ""
      : `${kept.map((sample) => JSON.stringify(sample)).join("\n")}\n`;
  fs.writeFileSync(file, text, "utf8");
}

async function structuredStatus(multicraft, serverId, options = {}) {
  if (
    !multicraft ||
    typeof multicraft.log !== "function" ||
    typeof multicraft.sendConsole !== "function"
  ) {
    return null;
  }
  const sleep =
    options.sleep ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseline = await multicraft.log(serverId);
  await multicraft.sendConsole(serverId, "admincraftstatus");
  let last = baseline;
  for (let attempt = 0; attempt < (options.pollAttempts || 8); attempt++) {
    await sleep(options.pollDelayMs || 250);
    const current = await multicraft.log(serverId);
    const added = appendedLogLines(last, current);
    const parsed = parseAdmincraftStatus(added);
    if (parsed) return parsed;
    last = current;
  }
  return null;
}
function createGenericPerformanceAdapter(config = {}, dependencies = {}) {
  const servers = Array.isArray(config.servers) ? config.servers : [];
  const multicraft = dependencies.multicraft;
  const plan = dependencies.planPerformance || null;
  const now = dependencies.now || (() => Date.now());
  const root = String(
    config.root ||
      process.env.MANAGEMENT_PERFORMANCE_PATH ||
      path.join(
        path.dirname(
          config.statePath ||
            path.join(process.cwd(), "data", "management-state.json"),
        ),
        "performance",
      ),
  ).trim();
  const intervalMs = Math.max(
    30000,
    Number.parseInt(
      config.sampleMilliseconds || process.env.MANAGEMENT_PERFORMANCE_SAMPLE_MS,
      10,
    ) || 60000,
  );
  const planIds = new Set(plan?.descriptor?.().serverIds || []);
  const serverById = new Map(servers.map((server) => [server.id, server]));
  let lastSampleAt = 0;
  let lastCompactAt = 0;

  const fileFor = (serverId) => path.join(root, `${safeId(serverId)}.jsonl`);

  function descriptor() {
    return {
      type: plan ? "hybrid" : "admincraft",
      configured: true,
      canonical: false,
      readOnlyRequired: false,
      serverIds: servers.map((server) => server.id),
      planServerIds: [...planIds],
      ranges: Object.keys(RANGE_CONFIG),
    };
  }
  async function sampleServer(server) {
    if (planIds.has(server.id)) return null;
    if (!multicraft) return null;
    const status = await multicraft
      .status(server.multicraftServerId)
      .catch(() => "stopped");
    if (status !== "running") return null;
    const [structured, resources, details] = await Promise.all([
      structuredStatus(
        multicraft,
        server.multicraftServerId,
        dependencies,
      ).catch(() => null),
      multicraft.resources(server.multicraftServerId).catch(() => ({})),
      multicraft.statusDetails(server.multicraftServerId).catch(() => ({})),
    ]);
    const sample = sampleFromStatus(
      server.id,
      Number(now()),
      structured || {},
      resources || {},
      details || {},
    );
    appendSample(fileFor(server.id), sample);
    return sample;
  }

  async function tick() {
    const current = Number(now());
    if (current - lastSampleAt < intervalMs) return;
    lastSampleAt = current;
    for (const server of servers) {
      try {
        await sampleServer(server);
      } catch (_) {
        // A single server must never block history collection for the rest.
      }
    }
    if (current - lastCompactAt >= 60 * 60 * 1000) {
      const cutoff = current - THIRTY_DAYS_MS;
      for (const server of servers) {
        if (planIds.has(server.id)) continue;
        try {
          compactFile(fileFor(server.id), cutoff);
        } catch (_) {
          // Retention compaction is best effort; sampling remains available.
        }
      }
      lastCompactAt = current;
    }
  }

  async function history(serverId, range = "1h") {
    const server = serverById.get(serverId);
    if (!server) throw new Error(`Unknown performance server: ${serverId}.`);
    const rangeConfig = RANGE_CONFIG[range];
    if (!rangeConfig)
      throw new Error(`Unsupported performance range: ${range}.`);
    if (planIds.has(serverId) && plan) return plan.history(serverId, range);
    const before = Number(now());
    const after = before - rangeConfig.milliseconds;
    const raw = readSamples(fileFor(serverId)).filter((sample) => {
      const at = Date.parse(sample.at);
      return Number.isFinite(at) && at >= after && at <= before;
    });
    const samples = bucketSamples(raw, rangeConfig.bucketMilliseconds);
    return {
      type: "admincraft.performance-history",
      source: {
        type: "admincraft",
        canonical: false,
        readOnly: false,
        serverName: server.name,
      },
      serverId,
      range,
      samples,
    };
  }
  async function probe() {
    return {
      ...descriptor(),
      root,
      sampleMilliseconds: intervalMs,
      planServerIds: [...planIds],
      fallbackServerIds: servers
        .map((server) => server.id)
        .filter((serverId) => !planIds.has(serverId)),
    };
  }

  return {
    descriptor,
    history,
    probe,
    tick,
    sampleServer,
  };
}

module.exports = {
  appendedLogLines,
  bucketSamples,
  createGenericPerformanceAdapter,
  parseAdmincraftStatus,
  sampleFromStatus,
  structuredStatus,
};
