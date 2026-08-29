const { execFile, spawn } = require("child_process");

const MAX_COMMAND_LENGTH = 2048;

function validateMessage(message) {
  return (
    typeof message === "string" &&
    message.trim().length > 0 &&
    message.length <= MAX_COMMAND_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(message)
  );
}

function runFileOutput(execFileImpl, file, args) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, (error, stdout = "", stderr = "") => {
      if (error) {
        const detail = stderr.toString().trim() || error.message;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

async function runFile(execFileImpl, file, args) {
  const output = await runFileOutput(execFileImpl, file, args);
  return output.stdout;
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "unknown";
  const units = [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
    [1, "s"],
  ];
  let remaining = Math.floor(totalSeconds);
  const parts = [];
  for (const [seconds, label] of units) {
    const value = Math.floor(remaining / seconds);
    if (value > 0 || (label === "s" && parts.length === 0)) {
      parts.push(`${value}${label}`);
      remaining %= seconds;
    }
    if (parts.length === 2) break;
  }
  return parts.join(" ");
}

function parseObservedState(edition, daytimeOutput, playersOutput) {
  const daytimePattern =
    edition === "java"
      ? /(?:The time is|Timeline\s+(?:minecraft:\s*)?day\s+is\s+at)\s+(\d+)/iu
      : /Daytime is (\d+)/u;
  const playersPattern =
    edition === "java"
      ? /There are (\d+) of a max of (\d+) players online(?::\s*(.*))?/u
      : /There are (\d+)\/(\d+) players online(?::\s*(.*))?/u;
  const lastMatch = (pattern, output) => {
    const lines = output.split(/\r?\n/u);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const match = pattern.exec(lines[index]);
      if (match) return match;
    }
    return null;
  };
  const daytimeMatch = lastMatch(daytimePattern, daytimeOutput);
  const playersMatch = lastMatch(playersPattern, playersOutput);
  const result = {};
  if (daytimeMatch) result.daytime = Number.parseInt(daytimeMatch[1], 10);
  if (playersMatch) {
    result.playersOnline = Number.parseInt(playersMatch[1], 10);
    result.playerLimit = Number.parseInt(playersMatch[2], 10);
    result.onlinePlayers = (playersMatch[3] || "")
      .split(",")
      .map((player) => player.trim())
      .filter(Boolean);
  }
  return result;
}

function normalizeWeather(value) {
  if (typeof value !== "string") return null;
  const match = /Weather:\s*(clear|rain|thunder)\b/iu.exec(value);
  return match ? match[1].toLowerCase() : null;
}

function normalizeDifficulty(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const aliases = {
    "0": "peaceful",
    p: "peaceful",
    peaceful: "peaceful",
    "1": "easy",
    e: "easy",
    easy: "easy",
    "2": "normal",
    n: "normal",
    normal: "normal",
    "3": "hard",
    h: "hard",
    hard: "hard",
  };
  return aliases[normalized] || null;
}

function difficultyFromCommand(command) {
  const match = /^\/?difficulty\s+(\S+)\s*$/iu.exec(command);
  return match ? normalizeDifficulty(match[1]) : null;
}

function difficultyFromResponse(value) {
  if (typeof value !== "string") return null;
  const match =
    /(?:the\s+)?difficulty(?:\s+is|\s+has been set to|\s+set to)?\s*:?\s*(peaceful|easy|normal|hard)\b/iu.exec(
      value,
    );
  return match ? normalizeDifficulty(match[1]) : null;
}

function admincraftStatusFromResponse(value) {
  if (typeof value !== "string") return null;
  const marker = "AdmincraftStatus:";
  const index = value.indexOf(marker);
  if (index < 0) return null;
  const raw = value.slice(index + marker.length).trim();
  try {
    const seedMatch = /"worldSeed"\s*:\s*(-?\d+)/u.exec(raw);
    const parsed = JSON.parse(raw);
    if (seedMatch) parsed.worldSeed = seedMatch[1];
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function pluginNamesFromResponse(value) {
  if (typeof value !== "string") return [];
  const cleaned = value
    .replace(/§[0-9A-FK-OR]/giu, "")
    .replace(/\u001b\[[0-9;]*m/gu, "");
  const names = [];
  for (let line of cleaned.split(/\r?\n/u)) {
    line = line.trim();
    if (!line) continue;
    if (/^(?:server|paper|bukkit)?\s*plugins?\s*(?:\(\d+\))?\s*:?$/iu.test(line)) {
      continue;
    }
    line = line.replace(/^.*?plugins?\s*\(\d+\)\s*:\s*/iu, "");
    line = line.replace(/^[-*+]\s*/u, "");
    for (const part of line.split(/\s*,\s*/u)) {
      const name = part.trim().replace(/^[-*+]\s*/u, "");
      if (!name || /plugins?$/iu.test(name)) continue;
      names.push(name);
    }
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function dockerTools(containerName, enabled, dependencies) {
  const execFileImpl = dependencies.execFile || execFile;
  const spawnImpl = dependencies.spawn || spawn;

  return {
    async status() {
      if (!enabled) {
        return "unavailable (Docker management is disabled)";
      }
      const output = await runFile(execFileImpl, "docker", [
        "inspect",
        "--format",
        "{{.State.Status}}",
        containerName,
      ]);
      return output.trim() || "unknown";
    },

    async health() {
      if (!enabled) {
        return "unavailable (Docker management is disabled)";
      }
      const output = await runFile(execFileImpl, "docker", [
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        containerName,
      ]);
      return output.trim() || "unknown";
    },

    async uptime() {
      if (!enabled) {
        return "unavailable (Docker management is disabled)";
      }
      const output = await runFile(execFileImpl, "docker", [
        "inspect",
        "--format",
        "{{.State.StartedAt}}",
        containerName,
      ]);
      const startedAt = Date.parse(output.trim());
      return Number.isNaN(startedAt)
        ? "unknown"
        : formatDuration((Date.now() - startedAt) / 1000);
    },

    async start() {
      if (!enabled) {
        throw new Error("Docker management is disabled for this bridge.");
      }
      await runFile(execFileImpl, "docker", ["start", containerName]);
    },

    async stop() {
      if (!enabled) {
        throw new Error("Docker management is disabled for this bridge.");
      }
      await runFile(execFileImpl, "docker", ["stop", containerName]);
    },

    async restart() {
      if (!enabled) {
        throw new Error("Docker management is disabled for this bridge.");
      }
      await runFile(execFileImpl, "docker", ["restart", containerName]);
    },

    async readServerProperty(name) {
      if (!enabled) return null;
      try {
        const contents = await runFile(execFileImpl, "docker", [
          "exec",
          containerName,
          "cat",
          "/data/server.properties",
        ]);
        for (const rawLine of contents.split(/\r?\n/u)) {
          const line = rawLine.trim();
          if (line.startsWith("#")) continue;
          const separator = line.indexOf("=");
          if (separator < 0) continue;
          if (line.slice(0, separator).trim() === name) {
            return line.slice(separator + 1).trim();
          }
        }
      } catch {
        // A custom image may keep its configuration elsewhere. State polling
        // should still return time and players instead of failing wholesale.
      }
      return null;
    },

    followLogs(onData, onError, onClose, options = {}) {
      if (!enabled) return null;
      const tail = Number.isInteger(options.tail)
        ? Math.max(0, Math.min(options.tail, 1000))
        : 0;
      const args = [
        "logs",
        "--follow",
        "--tail",
        String(tail),
      ];
      // Protocol v2 uses Docker's stable per-line timestamp as an event id.
      // That lets a reconnect replay a useful tail while clients discard the
      // overlap they have already saved. Legacy clients retain --tail 0.
      if (options.timestamps) args.push("--timestamps");
      args.push(containerName);
      const process = spawnImpl("docker", args);
      process.stdout.on("data", (data) => onData(data.toString()));
      process.stderr.on("data", (data) => onError(data.toString()));
      process.on("close", onClose);
      return process;
    },

    async readLogs(options = {}) {
      if (!enabled) return { stdout: "", stderr: "" };
      const tail = Number.isInteger(options.tail)
        ? Math.max(0, Math.min(options.tail, 10000))
        : 250;
      const args = ["logs", "--tail", String(tail)];
      if (options.timestamps) args.push("--timestamps");
      args.push(containerName);
      return runFileOutput(execFileImpl, "docker", args);
    },
  };
}

function createBedrockBackend(config, dependencies = {}) {
  const containerName = config.containerName || "minecraft";
  const docker = dockerTools(containerName, true, dependencies);
  const execFileImpl = dependencies.execFile || execFile;
  const waitForCommandOutput =
    dependencies.waitForCommandOutput ||
    (() => new Promise((resolve) => setTimeout(resolve, 150)));

  let observedDifficulty = null;

  async function backendExecute(command) {
    const response = await runFile(execFileImpl, "docker", [
      "exec",
      containerName,
      "send-command",
      command,
    ]);
    observedDifficulty = difficultyFromCommand(command) || observedDifficulty;
    return response;
  }

  return {
    edition: "bedrock",
    capabilities: [
      "commands",
      "logs",
      "status",
      "version",
      "help",
      "health",
      "info",
      "uptime",
      "state",
      "start",
      "stop",
      "restart",
    ],
    execute: backendExecute,
    async observeState() {
      const status = await docker.status();
      if (status !== "running") return { state: status };
      await Promise.all([
        backendExecute("time query daytime"),
        backendExecute("list"),
      ]);
      // The Bedrock container's send-command helper writes to the server's
      // stdin and returns before the reply reaches stdout. Read the latest
      // bounded log tail after that reply lands instead of treating the empty
      // helper output as an unknown state.
      await waitForCommandOutput();
      const [recentLogs, configuredDifficulty] = await Promise.all([
        docker.readLogs({ tail: 80 }),
        docker.readServerProperty("difficulty"),
      ]);
      observedDifficulty =
        observedDifficulty || normalizeDifficulty(configuredDifficulty);
      const observedOutput = `${recentLogs.stdout}\n${recentLogs.stderr}`;
      return {
        state: status,
        ...parseObservedState("bedrock", observedOutput, observedOutput),
        ...(observedDifficulty ? { difficulty: observedDifficulty } : {}),
      };
    },
    start: docker.start,
    stop: docker.stop,
    restart: docker.restart,
    status: docker.status,
    health: docker.health,
    uptime: docker.uptime,
    containerName,
    readLogs: docker.readLogs,
    followLogs: docker.followLogs,
  };
}

function createJavaBackend(config, dependencies = {}) {
  const Rcon = dependencies.Rcon || require("rcon-client").Rcon;
  const containerName = config.containerName || "minecraft";
  const dockerEnabled = config.dockerEnabled !== false;
  const docker = dockerTools(containerName, dockerEnabled, dependencies);

  const multicraftEnabled = config.multicraftEnabled === true;
  const multicraft = multicraftEnabled
    ? require("./multicraft-client").createMulticraftClient({
        url: config.multicraftUrl,
        user: config.multicraftUser,
        apiKey: config.multicraftApiKey,
        serverId: config.multicraftServerId,
      })
    : null;

  const lifecycleEnabled = dockerEnabled || multicraftEnabled;

  if (!config.rconPassword) {
    throw new Error("RCON_PASSWORD is required when SERVER_TYPE is java.");
  }

  let observedDifficulty = null;
  let daytimeQueryMode = null;

  async function sendRcon(command) {
    const client = await Rcon.connect({
      host: config.rconHost || containerName,
      port: config.rconPort || 25575,
      password: config.rconPassword,
    });
    try {
      return (await client.send(command)) || "";
    } finally {
      client.end();
    }
  }

  function timelineDaytime(response) {
    const match =
      /Timeline\s+(?:minecraft:\s*)?day\s+is\s+at\s+(\d+)\s+tick\(s\)/iu.exec(
        response,
      );
    return match ? Number.parseInt(match[1], 10) : null;
  }

  async function backendExecute(command) {
    const normalized = command.trim().toLowerCase();

    if (normalized === "time query daytime") {
      if (daytimeQueryMode === "timeline") {
        const response = await sendRcon("time query day");
        const ticks = timelineDaytime(response);
        return ticks === null ? response : `The time is ${ticks}`;
      }

      const legacyResponse = await sendRcon(command);
      if (/The time is \\d+/u.test(legacyResponse)) {
        daytimeQueryMode = "legacy";
        return legacyResponse;
      }

      const timelineResponse = await sendRcon("time query day");
      const ticks = timelineDaytime(timelineResponse);

      if (ticks !== null) {
        daytimeQueryMode = "timeline";
        return `The time is ${ticks}`;
      }

      return legacyResponse;
    }

    const response = await sendRcon(command);
    observedDifficulty = difficultyFromCommand(command) || observedDifficulty;
    return response;
  }

  return {
    edition: "java",
    capabilities: [
      "commands",
      "status",
      "version",
      "help",
      "health",
      "info",
      "uptime",
      "state",
      ...(dockerEnabled ? ["logs"] : []),
      ...(lifecycleEnabled ? ["start", "stop", "restart"] : []),
    ],
    execute: backendExecute,
    async observeState() {
      const status = multicraftEnabled
        ? await multicraft.status()
        : dockerEnabled
          ? await docker.status()
          : "reachable";
      if (lifecycleEnabled && status !== "running") return { state: status };
      const [statusOutput, pluginOutput, resources] = await Promise.all([
        backendExecute("admincraftstatus").catch(() => ""),
        backendExecute("plugins").catch(() => ""),
        multicraftEnabled ? multicraft.resources().catch(() => ({})) : Promise.resolve({}),
      ]);
      const structured = admincraftStatusFromResponse(statusOutput);
      const pluginNames = pluginNamesFromResponse(pluginOutput);
      if (structured) {
        observedDifficulty = normalizeDifficulty(structured.difficulty) || observedDifficulty;
        return {
          state: status,
          ...structured,
          ...(pluginNames.length > 0 ? { pluginNames } : {}),
          ...resources,
          ...(observedDifficulty ? { difficulty: observedDifficulty } : {}),
        };
      }

      const [daytime, players, weatherOutput, difficultyOutput] =
        await Promise.all([
          backendExecute("minecraft:time query day"),
          backendExecute("minecraft:list"),
          backendExecute("admincraftweather"),
          backendExecute("difficulty"),
        ]);
      observedDifficulty =
        difficultyFromResponse(difficultyOutput) || observedDifficulty;
      const observedWeather = normalizeWeather(weatherOutput);
      return {
        state: status,
        ...parseObservedState("java", daytime, players),
        ...resources,
        ...(observedWeather ? { weather: observedWeather } : {}),
        ...(observedDifficulty ? { difficulty: observedDifficulty } : {}),
      };
    },
    start: multicraftEnabled ? multicraft.start : docker.start,
    stop: multicraftEnabled ? multicraft.stop : docker.stop,
    restart: multicraftEnabled ? multicraft.restart : docker.restart,
    status: multicraftEnabled ? multicraft.status : docker.status,
    health: dockerEnabled
      ? docker.health
      : async () => {
          await backendExecute("minecraft:list");
          return "reachable over RCON";
        },
    uptime: docker.uptime,
    containerName,
    readLogs: docker.readLogs,
    followLogs: docker.followLogs,
  };
}

function createBackend(config, dependencies = {}) {
  if (config.edition === "java") {
    return createJavaBackend(config, dependencies);
  }
  if (config.edition === "bedrock") {
    return createBedrockBackend(config, dependencies);
  }
  throw new Error(`Unsupported SERVER_TYPE: ${config.edition}`);
}

module.exports = {
  createBackend,
  createBedrockBackend,
  createJavaBackend,
  validateMessage,
  formatDuration,
  parseObservedState,
  normalizeDifficulty,
};
