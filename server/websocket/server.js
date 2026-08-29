const fs = require("fs");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const WebSocket = require("ws");
const path = require("path");
const {
  authenticate,
  capabilitiesFor,
  credentialsFromEnvironment,
  hasScope,
} = require("./bridge-auth");
const { executeBridgeCommand } = require("./bridge-commands");
const { createBackend, validateMessage } = require("./minecraft-backend");
const { createMulticraftClient } = require("./multicraft-client");
const { createManagementService } = require("./management-service");
const { createUpdateChecker } = require("./update-checker");
const { createPushService } = require("./push-service");
const {
  isInternalStateReply,
  splitLogLine,
  trimVisibleLogHistory,
} = require("./log-history");
const BRIDGE_VERSION = process.env.BRIDGE_VERSION || require("./package.json").version;

const USE_SSL = process.env.USE_SSL === "true";
const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const CERT_PATH = "./certs/server.crt";
const KEY_PATH = "./certs/server.key";
const MAX_MESSAGES_PER_SECOND = 5;
const MC_NAME = process.env.MC_NAME || "minecraft";
const SERVER_TYPE = (process.env.SERVER_TYPE || "bedrock").toLowerCase();
const ACCESS_API_URL = (process.env.ACCESS_API_URL || "").trim();
const ACCESS_API_TOKEN = (process.env.ACCESS_API_TOKEN || "").trim();
const ACCESS_API_ENABLED = Boolean(ACCESS_API_URL && ACCESS_API_TOKEN);
const NETWORK_API_URL = (process.env.NETWORK_API_URL || "").trim();
const NETWORK_API_TOKEN = (process.env.NETWORK_API_TOKEN || "").trim();
const NETWORK_API_ENABLED = Boolean(NETWORK_API_URL && NETWORK_API_TOKEN);

async function accessApi(pathname, { method = "GET" } = {}) {
  if (!ACCESS_API_ENABLED) throw new Error("Access API is not configured");
  const response = await fetch(new URL(pathname, ACCESS_API_URL), {
    method,
    headers: {
      Authorization: `Bearer ${ACCESS_API_TOKEN}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
  if (!response.ok) {
    throw new Error(data.message || `Access API returned HTTP ${response.status}`);
  }
  return data;
}

async function networkApi() {
  if (!NETWORK_API_ENABLED) throw new Error("Network API is not configured");
  const response = await fetch(new URL("/v1/network", NETWORK_API_URL), {
    headers: { Authorization: `Bearer ${NETWORK_API_TOKEN}`, Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.message || `Network API returned HTTP ${response.status}`);
  }
  return data;
}

const pushService = createPushService({ accessApi, networkApi });
pushService.start();

const credentials = credentialsFromEnvironment();
if (credentials.length === 0) {
  throw new Error(
    "Configure SECRET_KEY, ADMIN_SECRET_KEY, COMMAND_SECRET_KEY, or READ_ONLY_SECRET_KEY.",
  );
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}

const backend = createBackend({
  edition: SERVER_TYPE,
  containerName: MC_NAME,
  dockerEnabled: process.env.DOCKER_ENABLED !== "false",
  rconHost: process.env.RCON_HOST || MC_NAME,
  rconPort: Number.parseInt(process.env.RCON_PORT || "25575", 10),
  rconPassword: process.env.RCON_PASSWORD,
  multicraftEnabled: process.env.MULTICRAFT_ENABLED === "true",
  multicraftUrl: process.env.MULTICRAFT_URL,
  multicraftUser: process.env.MULTICRAFT_USER,
  multicraftApiKey: process.env.MULTICRAFT_API_KEY,
  multicraftServerId: process.env.MULTICRAFT_SERVER_ID,
});

function handleRequest(req, res) {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ ok: true, version: BRIDGE_VERSION, edition: backend.edition, management: managementService?.enabled === true }));
    return;
  }
  if (req.method === "GET" && req.url === "/getcert" && fs.existsSync(CERT_PATH)) {
    const certFilePath = path.join(__dirname, CERT_PATH);
    res.writeHead(200, {
      "Content-Type": "application/x-x509-ca-cert",
      "Content-Disposition": 'attachment; filename="server.crt"',
    });
    fs.createReadStream(certFilePath).pipe(res);
    return;
  }
  res.writeHead(404);
  res.end("Not Found");
}

let useSSL = USE_SSL;
if (useSSL && (!fs.existsSync(CERT_PATH) || !fs.existsSync(KEY_PATH))) {
  console.warn("SSL certificates not found. Starting without SSL.");
  useSSL = false;
}

const server = useSSL
  ? https.createServer(
      { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) },
      handleRequest,
    )
  : http.createServer(handleRequest);
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN && message) {
    ws.send(message.toString());
  }
}

function sendEvent(ws, type, fields = {}) {
  send(ws, JSON.stringify({ type, ...fields }));
}

const managementClients = new Set();
let managementService = null;

try {
  if (process.env.MULTICRAFT_ENABLED === "true" && process.env.MANAGEMENT_ENABLED === "true") {
    const managementMulticraft = createMulticraftClient({
      url: process.env.MULTICRAFT_URL,
      user: process.env.MULTICRAFT_USER,
      apiKey: process.env.MULTICRAFT_API_KEY,
      serverId: process.env.MULTICRAFT_SERVER_ID,
    });
    let updateChecker = null;
    try {
      updateChecker = createUpdateChecker();
    } catch (error) {
      console.warn(`RC4 update checking disabled: ${error.message}`);
    }
    managementService = createManagementService(
      {
        serversJson: process.env.MANAGEMENT_SERVERS_JSON,
        serverId: process.env.MANAGEMENT_SERVER_ID,
        serverName: process.env.MANAGEMENT_SERVER_NAME,
        multicraftServerId: process.env.MULTICRAFT_SERVER_ID,
        statePath: process.env.MANAGEMENT_STATE_PATH,
        storagePath: process.env.MANAGEMENT_STORAGE_PATH,
        storagesJson: process.env.BACKUP_STORAGES_JSON,
        enginesJson: process.env.BACKUP_ENGINES_JSON,
        retentionJson: process.env.BACKUP_RETENTION_JSON,
        nativeBackupPath: process.env.MANAGEMENT_NATIVE_BACKUP_PATH,
        storageProbeMilliseconds: process.env.MANAGEMENT_STORAGE_PROBE_MS,
      },
      {
        multicraft: managementMulticraft,
        updateChecker,
        onSnapshot(frame) {
          for (const client of managementClients) send(client, JSON.stringify(frame));
        },
      },
    );
    managementService.start();
  }
} catch (error) {
  managementService = null;
  console.error(`RC4 management disabled: ${error.message}`);
}


function eventId(stream, at, message) {
  return crypto
    .createHash("sha256")
    .update(`${stream}\0${at}\0${message}`)
    .digest("hex")
    .slice(0, 24);
}

/// Converts Docker's `--timestamps` stream into complete, deduplicatable log
/// frames. Docker may split a line across arbitrary data chunks, so the final
/// fragment is retained until its newline arrives.
function createLogForwarder(ws, stream) {
  let remainder = "";

  function emit(line) {
    const { at, message } = splitLogLine(line);
    if (!message || isInternalStateReply(message)) return;
    sendEvent(ws, "admincraft.log", {
      id: eventId(stream, at, message),
      at,
      stream,
      message,
    });
  }

  return {
    push(data) {
      const lines = `${remainder}${data}`.split(/\r?\n/u);
      remainder = lines.pop() || "";
      for (const line of lines) emit(line);
    },
    flush() {
      if (remainder) emit(remainder);
      remainder = "";
    },
  };
}

function startSession(ws, request, authenticated) {
  const user = authenticated.claims;
  const scope = authenticated.scope;
  const baseCapabilities = capabilitiesFor(backend.capabilities, scope);
  const capabilities = [...baseCapabilities];
  if (ACCESS_API_ENABLED && scope === "admin" && !capabilities.includes("access")) {
    capabilities.push("access");
  }
  if (NETWORK_API_ENABLED && !capabilities.includes("network")) {
    capabilities.push("network");
  }
  if (scope === "admin" && !capabilities.includes("push")) {
    capabilities.push("push");
  }
  if (scope === "admin" && managementService?.enabled && !capabilities.includes("management")) {
    capabilities.push("management");
  }

  // Older clients did not include an edition. They remain compatible with the
  // default Bedrock bridge, but cannot accidentally operate a Java bridge.
  const requestedEdition = user.edition || "bedrock";
  if (requestedEdition !== backend.edition) {
    send(
      ws,
      `Configuration error: profile is ${requestedEdition}, but this bridge is ${backend.edition}.`,
    );
    ws.close(
      4002,
      `Profile is ${requestedEdition}, but this bridge is ${backend.edition}`,
    );
    return;
  }

  const protocol = Number(user.protocol) >= 2 ? 2 : 1;
  const requestedTail = Number.parseInt(user.logTail, 10);
  const logTail = Number.isInteger(requestedTail)
    ? Math.max(0, Math.min(requestedTail, 1000))
    : 250;

  console.log(`New ${backend.edition} client connected`);
  if (capabilities.includes("management")) managementClients.add(ws);
  if (protocol >= 2) {
    sendEvent(ws, "admincraft.hello", {
      protocol,
      edition: backend.edition,
      capabilities,
      scope,
      version: BRIDGE_VERSION,
      connectedAt: new Date().toISOString(),
    });
  } else {
    send(
      ws,
      `${user.userId} connected to ${backend.edition} bridge (${capabilities.join(", ")})`,
    );
  }

  const stdout = protocol >= 2 ? createLogForwarder(ws, "stdout") : null;
  const stderr = protocol >= 2 ? createLogForwarder(ws, "stderr") : null;
  let closed = false;
  let logProcess = null;
  let logRetry = null;
  let stateTimer = null;
  let accessTimer = null;
  let networkTimer = null;
  let accessCheckInFlight = false;
  let networkCheckInFlight = false;
  let lastAccessState = null;
  let observeAccessState = null;
  let observeNetworkState = null;
  let stateCheckInFlight = false;
  let lastNetworkState = null;
  let lastServerState = null;
  let replayingHistory = protocol >= 2;
  const pendingLiveLogs = [];

  function forwardLiveLog(stream, data) {
    if (replayingHistory) {
      pendingLiveLogs.push({ stream, data });
      return;
    }
    (stream === "stdout" ? stdout : stderr)?.push(data);
  }

  async function replayLogs(tail, { signalComplete = true } = {}) {
    const rawTail = Math.min(10000, Math.max(tail, tail * 10));
    const history = await backend.readLogs({ tail: rawTail, timestamps: true });
    if (closed) return;
    const historyStdout = createLogForwarder(ws, "stdout");
    const historyStderr = createLogForwarder(ws, "stderr");
    historyStdout.push(trimVisibleLogHistory(history.stdout || "", tail));
    historyStderr.push(trimVisibleLogHistory(history.stderr || "", tail));
    historyStdout.flush();
    historyStderr.flush();
    if (signalComplete) {
      sendEvent(ws, "admincraft.history-complete", {
        requested: tail,
        manual: true,
      });
    }
  }

  function attachLogs() {
    if (closed || ws.readyState !== WebSocket.OPEN) return;
    logProcess = backend.followLogs(
      (data) => (stdout ? forwardLiveLog("stdout", data) : send(ws, data)),
      (data) =>
        stderr
          ? forwardLiveLog("stderr", data)
          : send(ws, `Log error: ${data}`),
      (code) => {
        stdout?.flush();
        stderr?.flush();
        logProcess = null;
        console.log(`Log process exited with code ${code}`);
        // Stopping Minecraft also ends `docker logs --follow`, but the bridge
        // remains reachable so the same client can start it again. Reattach
        // until the container returns instead of requiring a reconnect.
        if (!closed) {
          logRetry = setTimeout(attachLogs, 2000);
          logRetry.unref?.();
        }
      },
      // Protocol v2 replays an explicit snapshot below. Starting the follower
      // first and buffering it prevents lines written during that snapshot
      // from falling into a gap between two Docker commands.
      { tail: 0, timestamps: protocol >= 2 },
    );
  }

  attachLogs();

  if (protocol >= 2) {
    Promise.resolve(replayLogs(logTail, { signalComplete: false }))
      .catch((error) => {
        console.error(`Could not read initial log history: ${error.message}`);
        sendEvent(ws, "admincraft.history-error", {
          message: "Recent server logs could not be loaded.",
        });
      })
      .finally(() => {
        if (closed) return;
        replayingHistory = false;
        for (const { stream, data } of pendingLiveLogs.splice(0)) {
          (stream === "stdout" ? stdout : stderr)?.push(data);
        }
        sendEvent(ws, "admincraft.history-complete", { requested: logTail });
      });

    if (capabilities.includes("access")) {
      observeAccessState = async () => {
        if (closed || accessCheckInFlight) return;
        accessCheckInFlight = true;
        try {
          const data = await accessApi("/v1/access");
          const entries = Array.isArray(data.entries) ? data.entries : [];
          const fingerprint = JSON.stringify(entries);
          if (fingerprint !== lastAccessState) {
            lastAccessState = fingerprint;
            sendEvent(ws, "admincraft.access-state", {
              entries,
              observedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error(`Could not observe Access state: ${error.message}`);
        } finally {
          accessCheckInFlight = false;
        }
      };
      void observeAccessState();
      accessTimer = setInterval(observeAccessState, 5000);
      accessTimer.unref?.();
    }

    if (capabilities.includes("network")) {
      observeNetworkState = async () => {
        if (closed || networkCheckInFlight) return;
        networkCheckInFlight = true;
        try {
          const data = await networkApi();
          const snapshot = {
            playersOnline: data.playersOnline,
            playerLimit: data.playerLimit,
            clientMin: data.clientMin,
            clientMax: data.clientMax,
            servers: Array.isArray(data.servers) ? data.servers : [],
          };
          const fingerprint = JSON.stringify(snapshot);
          if (fingerprint !== lastNetworkState) {
            lastNetworkState = fingerprint;
            sendEvent(ws, "admincraft.network-state", {
              ...snapshot,
              observedAt: data.observedAt || new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error(`Could not observe Network state: ${error.message}`);
        } finally {
          networkCheckInFlight = false;
        }
      };
      void observeNetworkState();
      networkTimer = setInterval(observeNetworkState, 5000);
      networkTimer.unref?.();
    }

    const observeServerState = async () => {
      if (closed || stateCheckInFlight) return;
      stateCheckInFlight = true;
      try {
        const observation = await backend.observeState();
        const fingerprint = JSON.stringify(observation);
        if (fingerprint !== lastServerState) {
          lastServerState = fingerprint;
          sendEvent(ws, "admincraft.server-state", {
            ...observation,
            observedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        if (lastServerState !== "unknown") {
          lastServerState = "unknown";
          sendEvent(ws, "admincraft.server-state", {
            state: "unknown",
            observedAt: new Date().toISOString(),
          });
        }
        console.error(`Could not observe server state: ${error.message}`);
      } finally {
        stateCheckInFlight = false;
      }
    };
    void observeServerState();
    stateTimer = setInterval(observeServerState, 30000);
    stateTimer.unref?.();
  }

  let messageCount = 0;
  let startTime = Date.now();

  ws.on("message", async (message) => {
    const command = message.toString();
    const currentTime = Date.now();
    if (currentTime - startTime > 1000) {
      messageCount = 0;
      startTime = currentTime;
    }
    if (messageCount >= MAX_MESSAGES_PER_SECOND) {
      send(ws, "Rate limit exceeded. Please slow down.");
      return;
    }
    messageCount += 1;

    if (!validateMessage(command)) {
      send(ws, "Invalid input.");
      return;
    }

    try {
      const loggedCommand = command.startsWith("admincraft push-register ")
        ? "admincraft push-register <redacted>"
        : command;
      console.log(`Command from ${user.userId} [${scope}]: ${loggedCommand}`);
      if (command === "admincraft ping") {
        protocol >= 2
          ? sendEvent(ws, "admincraft.pong")
          : send(ws, "Admincraft pong");
      } else {
        const manageMatch = /^admincraft manage ([a-z0-9-]+)(?: ([A-Za-z0-9_-]+))?$/u.exec(command);
        if (manageMatch) {
          if (!capabilities.includes("management") || !managementService) {
            sendEvent(ws, "admincraft.management-result", {
              success: false,
              refresh: false,
              message: "RC4 management is not available for this credential.",
            });
            return;
          }
          let payload = {};
          try {
            if (manageMatch[2]) {
              const padded = manageMatch[2] + "=".repeat((4 - manageMatch[2].length % 4) % 4);
              payload = JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
            }
          } catch (_) {
            sendEvent(ws, "admincraft.management-result", {
              success: false,
              refresh: false,
              message: "Invalid management payload.",
            });
            return;
          }
          const result = await managementService.handle(manageMatch[1], payload);
          for (const event of result.events || []) send(ws, JSON.stringify(event));
          sendEvent(ws, "admincraft.management-result", {
            success: result.success === true,
            refresh: result.refresh === true,
            message: result.message || "Management action completed.",
          });
          return;
        }
        const pushMatch = /^admincraft push-register ([A-Za-z0-9_-]+)$/u.exec(command);
        if (pushMatch) {
          if (!capabilities.includes("push")) {
            sendEvent(ws, "admincraft.push-result", { success: false, providerConfigured: pushService.providerConfigured, message: "Native push registration requires an admin credential." });
            return;
          }
          try {
            const padded = pushMatch[1] + "=".repeat((4 - pushMatch[1].length % 4) % 4);
            const payload = JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
            const result = pushService.register(payload);
            sendEvent(ws, "admincraft.push-result", result);
          } catch (error) {
            sendEvent(ws, "admincraft.push-result", { success: false, providerConfigured: pushService.providerConfigured, message: error.message || "Native push registration failed." });
          }
          return;
        }
                const accessMatch = /^admincraft access (allow|approve|deny|blacklist|revoke|reset) ([0-9a-f-]{36})$/iu.exec(command);
        if (accessMatch) {
          if (!capabilities.includes("access")) {
            sendEvent(ws, "admincraft.access-result", {
              success: false,
              message: "Network Access is not available for this credential.",
            });
            return;
          }
          const actionMap = { allow: "approve", approve: "approve", deny: "deny", blacklist: "deny", revoke: "reset", reset: "reset" };
          const action = actionMap[accessMatch[1].toLowerCase()];
          const uuid = accessMatch[2].toLowerCase();
          try {
            const result = await accessApi(
              `/v1/access/${encodeURIComponent(uuid)}/${action}`,
              { method: "POST" },
            );
            sendEvent(ws, "admincraft.access-result", {
              success: result.success === true,
              message: result.message || "Access action completed.",
            });
            lastAccessState = null;
            if (observeAccessState) await observeAccessState();
          } catch (error) {
            sendEvent(ws, "admincraft.access-result", {
              success: false,
              message: error.message || "Access action failed.",
            });
          }
          return;
        }
        const bridgeResponse = await executeBridgeCommand(command, backend, {
          capabilities,
          protocol,
          replayLogs,
          scope,
        });
        const response =
          bridgeResponse === null
            ? hasScope(scope, "command")
              ? await backend.execute(command)
              : "Permission denied: command access required."
            : bridgeResponse;
        send(ws, response);
      }
    } catch (error) {
      console.error(`Command failed: ${error.message}`);
      send(ws, `Command failed: ${error.message}`);
    }
  });

  ws.on("close", () => {
    closed = true;
    console.log("Client disconnected");
    stdout?.flush();
    stderr?.flush();
    if (logRetry) clearTimeout(logRetry);
    if (stateTimer) clearInterval(stateTimer);
    if (accessTimer) clearInterval(accessTimer);
    if (networkTimer) clearInterval(networkTimer);
    managementClients.delete(ws);
    if (logProcess) logProcess.kill();
  });
  ws.on("error", (error) => console.error("WebSocket error:", error.message));
}

function rejectAuthentication(ws, reason = "Authentication failed") {
  console.error(reason);
  if (ws.readyState === WebSocket.OPEN) ws.close(4001, reason);
}

wss.on("connection", (ws, request) => {
  const url = new URL(
    request.url,
    `${useSSL ? "wss" : "ws"}://${request.headers.host}`,
  );
  const legacyToken = url.searchParams.get("token");
  if (legacyToken) {
    const authenticated = authenticate(legacyToken, credentials);
    if (!authenticated) {
      rejectAuthentication(ws);
      return;
    }
    startSession(ws, request, authenticated);
    return;
  }

  let settled = false;
  const authTimer = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectAuthentication(ws, "Authentication required");
  }, 5000);
  authTimer.unref?.();

  const onAuthMessage = (message) => {
    if (settled) return;
    let frame;
    try {
      frame = JSON.parse(message.toString());
    } catch (_) {
      settled = true;
      clearTimeout(authTimer);
      ws.off("message", onAuthMessage);
      rejectAuthentication(ws);
      return;
    }

    if (frame?.type !== "admincraft.auth" || typeof frame.token !== "string") {
      settled = true;
      clearTimeout(authTimer);
      ws.off("message", onAuthMessage);
      rejectAuthentication(ws);
      return;
    }

    const authenticated = authenticate(frame.token, credentials);
    if (!authenticated) {
      settled = true;
      clearTimeout(authTimer);
      ws.off("message", onAuthMessage);
      rejectAuthentication(ws);
      return;
    }

    settled = true;
    clearTimeout(authTimer);
    ws.off("message", onAuthMessage);
    startSession(ws, request, authenticated);
  };

  ws.on("message", onAuthMessage);
  ws.once("close", () => clearTimeout(authTimer));
  ws.once("error", () => clearTimeout(authTimer));
});

server.listen(PORT, () => {
  console.log(
    `Admincraft ${backend.edition} bridge listening on port ${PORT}${useSSL ? " with SSL" : ""}`,
  );
});
