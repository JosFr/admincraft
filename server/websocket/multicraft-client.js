const crypto = require("crypto");
const http = require("http");
const https = require("https");

function createMulticraftClient(config = {}) {
  const url = config.url;
  const user = config.user;
  const apiKey = config.apiKey;
  const serverId = Number.parseInt(config.serverId, 10);

  if (!url) throw new Error("MULTICRAFT_URL is required.");
  if (!user) throw new Error("MULTICRAFT_USER is required.");
  if (!apiKey) throw new Error("MULTICRAFT_API_KEY is required.");
  if (!Number.isInteger(serverId) || serverId < 1) {
    throw new Error("MULTICRAFT_SERVER_ID must be a positive integer.");
  }

  async function call(method, extraParams = {}) {
    /*
     * Parameter order matters for the Multicraft HMAC.
     * Keep the body in exactly the same order as the signed parameters.
     */
    const params = {
      _MulticraftAPIMethod: method,
      _MulticraftAPIUser: user,
      ...extraParams,
    };

    let signString = "";
    for (const [key, value] of Object.entries(params)) {
      signString += key + String(value);
    }

    const signature = crypto
      .createHmac("sha256", apiKey)
      .update(signString)
      .digest("hex");

    const body = new URLSearchParams({
      ...params,
      _MulticraftAPIKey: signature,
    }).toString();

    const target = new URL(url);
    const transport = target.protocol === "https:" ? https : http;

    const raw = await new Promise((resolve, reject) => {
      const req = transport.request(
        target,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 10000,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error("Multicraft API request timed out."));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    let response;
    try {
      response = JSON.parse(raw);
    } catch (_) {
      throw new Error(`Invalid Multicraft API response: ${raw}`);
    }

    if (!response.success) {
      const errors =
        Array.isArray(response.errors) && response.errors.length
          ? response.errors.join("; ")
          : "Unknown Multicraft API error";
      throw new Error(errors);
    }

    return response.data || {};
  }

  function targetId(override) {
    const value = override == null ? serverId : Number.parseInt(override, 10);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error("Multicraft server ID must be a positive integer.");
    }
    return String(value);
  }

  return {
    async statusDetails(overrideId) {
      return call("getServerStatus", {
        id: targetId(overrideId),
        player_list: "0",
      });
    },

    async status(overrideId) {
      const data = await call("getServerStatus", {
        id: targetId(overrideId),
        player_list: "0",
      });

      // Keep Admincraft's existing Docker-style lifecycle states.
      return data.status === "online" ? "running" : "stopped";
    },

    async start(overrideId) {
      await call("startServer", { id: targetId(overrideId) });
    },

    async stop(overrideId) {
      await call("stopServer", { id: targetId(overrideId) });
    },

    async restart(overrideId) {
      await call("restartServer", { id: targetId(overrideId) });
    },

    async resources(overrideId) {
      const usage = await call("getServerResources", { id: targetId(overrideId) });
      let server = {};
      try {
        const serverData = await call("getServer", { id: targetId(overrideId) });
        server = serverData.Server || {};
      } catch (_) {
        // Resource usage is still useful even if server metadata is restricted.
      }
      const numberOrNull = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };
      return {
        cpuPercent: numberOrNull(usage.cpu),
        memoryMb: numberOrNull(usage.memory),
        memoryLimitMb: numberOrNull(server.memory),
      };
    },

    async sendConsole(overrideId, command) {
      return call("sendConsoleCommand", {
        server_id: targetId(overrideId),
        command: String(command),
      });
    },

    async log(overrideId) {
      const data = await call("getServerLog", { id: targetId(overrideId) });
      const entries = Array.isArray(data) ? data : Object.values(data || {});
      return entries
        .map((entry) => typeof entry === "string" ? entry : String(entry?.line || ""))
        .filter((line) => line.length > 0);
    },

    async startBackup(overrideId) {
      return call("startServerBackup", { id: targetId(overrideId) });
    },

    async backupStatus(overrideId) {
      return call("getServerBackupStatus", { id: targetId(overrideId) });
    },
  };
}

module.exports = { createMulticraftClient };
