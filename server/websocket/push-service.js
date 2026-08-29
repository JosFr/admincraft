const crypto = require("crypto");
const fs = require("fs");
const http2 = require("http2");
const path = require("path");

const RULES = new Set([
  "accessRequests",
  "serverStatus",
  "health",
  "playerActivity",
]);
const TOKEN_PATTERN = /^[0-9a-f]{64,200}$/iu;
const TOPIC_PATTERN = /^[A-Za-z0-9.-]{3,255}$/u;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function safeRules(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    [...RULES].map((rule) => [rule, source[rule] === true]),
  );
}

function normalizeRegistration(value) {
  const token = String(value?.token || "").trim().toLowerCase();
  const topic = String(value?.topic || "").trim();
  const environment = value?.environment === "development"
    ? "development"
    : "production";
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid APNs device token");
  if (!TOPIC_PATTERN.test(topic)) throw new Error("Invalid APNs topic");
  return { token, topic, environment, rules: safeRules(value?.rules) };
}

function loadRegistrations(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRegistration);
  } catch (_) {
    return [];
  }
}

function saveRegistrations(file, registrations) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(registrations, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function createProviderToken({ teamId, keyId, privateKey }) {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64url(JSON.stringify({
    iss: teamId,
    iat: Math.floor(Date.now() / 1000),
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${signature.toString("base64url")}`;
}

function apnsHost(environment) {
  return environment === "development"
    ? "https://api.sandbox.push.apple.com"
    : "https://api.push.apple.com";
}

async function sendApns(registration, notification, provider) {
  const client = http2.connect(apnsHost(registration.environment));
  try {
    const jwt = createProviderToken(provider);
    const body = JSON.stringify({
      aps: {
        alert: { title: notification.title, body: notification.message },
        sound: "default",
        "thread-id": "admincraft",
      },
      admincraft: { kind: notification.kind || "info" },
    });
    await new Promise((resolve, reject) => {
      const request = client.request({
        ":method": "POST",
        ":path": `/3/device/${registration.token}`,
        authorization: `bearer ${jwt}`,
        "apns-topic": registration.topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
      });
      let status = 0;
      let response = "";
      request.on("response", (headers) => { status = Number(headers[":status"] || 0); });
      request.setEncoding("utf8");
      request.on("data", (chunk) => { response += chunk; });
      request.on("end", () => {
        if (status >= 200 && status < 300) resolve();
        else reject(new Error(`APNs HTTP ${status}: ${response || "unknown error"}`));
      });
      request.on("error", reject);
      request.end(body);
    });
  } finally {
    client.close();
  }
}

function providerFromEnvironment() {
  const teamId = (process.env.APNS_TEAM_ID || "").trim();
  const keyId = (process.env.APNS_KEY_ID || "").trim();
  const keyPath = (process.env.APNS_KEY_PATH || "").trim();
  if (!teamId || !keyId || !keyPath || !fs.existsSync(keyPath)) return null;
  return {
    teamId,
    keyId,
    privateKey: fs.readFileSync(keyPath, "utf8"),
  };
}

function networkAttention(previous, server) {
  if (!previous || !server) return null;
  const previousState = String(previous.state || "UNKNOWN").toUpperCase();
  const nextState = String(server.state || "UNKNOWN").toUpperCase();
  if (previousState === nextState) return null;
  const label = server.label || server.name || "Minecraft server";
  if (nextState === "ERROR") {
    return {
      rule: "health",
      notification: {
        kind: "health",
        title: `${label} health alert`,
        message: `${previousState.toLowerCase()} → error`,
      },
    };
  }
  if (nextState === "OFFLINE" && previousState !== "STANDBY") {
    return {
      rule: "serverStatus",
      notification: {
        kind: "server",
        title: `${label} offline`,
        message: "The server became unavailable unexpectedly.",
      },
    };
  }
  return null;
}

function createPushService({ accessApi, networkApi, logger = console }) {
  const registryPath = process.env.PUSH_REGISTRY_PATH
    || "/data/admincraft-push-devices.json";
  let registrations = loadRegistrations(registryPath);
  const provider = providerFromEnvironment();
  let timer = null;
  let running = false;
  let previousPending = null;
  let previousNetwork = null;

  function register(value) {
    const registration = normalizeRegistration(value);
    registrations = registrations.filter((item) => item.token !== registration.token);
    registrations.push(registration);
    saveRegistrations(registryPath, registrations);
    return {
      success: true,
      providerConfigured: provider != null,
      message: provider
        ? "Native push device registered."
        : "Device registered; APNs provider credentials are not configured yet.",
    };
  }

  async function notify(rule, notification) {
    if (!provider) return;
    const targets = registrations.filter((item) => item.rules[rule] === true);
    await Promise.allSettled(
      targets.map(async (registration) => {
        try {
          await sendApns(registration, notification, provider);
        } catch (error) {
          logger.error(`APNs send failed: ${error.message}`);
        }
      }),
    );
  }

  async function pollAccess() {
    const data = await accessApi("/v1/access");
    const pending = new Map(
      (Array.isArray(data.entries) ? data.entries : [])
        .filter((entry) => String(entry.status || "").toUpperCase() === "PENDING")
        .map((entry) => [String(entry.uuid || ""), entry]),
    );
    if (previousPending != null) {
      for (const [uuid, entry] of pending) {
        if (previousPending.has(uuid)) continue;
        await notify("accessRequests", {
          kind: "access",
          title: "Nieuw toegangsverzoek",
          message: `${entry.name || "Speler"} vraagt toegang tot het netwerk.`,
        });
      }
    }
    previousPending = new Set(pending.keys());
  }

  async function pollNetwork() {
    const data = await networkApi();
    const servers = Array.isArray(data.servers) ? data.servers : [];
    const current = new Map(servers.map((server) => [String(server.name || ""), server]));
    if (previousNetwork != null) {
      for (const [name, server] of current) {
        const previous = previousNetwork.get(name);
        if (!previous) continue;
        const attention = networkAttention(previous, server);
        if (attention) await notify(attention.rule, attention.notification);
      }
    }
    previousNetwork = current;
  }

  async function poll() {
    if (running || registrations.length === 0) return;
    running = true;
    try {
      await Promise.allSettled([pollAccess(), pollNetwork()]);
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    void poll();
    timer = setInterval(poll, 5000);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    register,
    get providerConfigured() { return provider != null; },
    get registrationCount() { return registrations.length; },
  };
}

module.exports = { createPushService, networkAttention, normalizeRegistration };
