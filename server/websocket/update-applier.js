const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  pluginDirectoryInventory,
  pluginJarIdentity,
} = require("./plugin-inventory");

const MAX_PLUGIN_BYTES = 128 * 1024 * 1024;

function safeSegment(value, label) {
  const text = String(value || "").trim();
  if (!text || text !== path.basename(text) || /[\\/\0]/u.test(text)) {
    throw new Error(`Unsafe ${label}.`);
  }
  return text;
}

function normalizedPluginName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}
function updateEligibility(update) {
  if (String(update?.kind || "plugin") !== "plugin") {
    return {
      eligible: false,
      reason: "Only plugin updates can be applied automatically.",
    };
  }
  if (String(update?.status || "") !== "updateAvailable") {
    return { eligible: false, reason: "No newer plugin version is available." };
  }
  if (update?.downloadSourceConfirmed !== true) {
    return { eligible: false, reason: "Confirm a download source first." };
  }
  const downloadUrl = String(update?.downloadUrl || "").trim();
  if (!downloadUrl) {
    return {
      eligible: false,
      reason: "The download source has no direct artifact URL.",
    };
  }
  let parsed;
  try {
    parsed = new URL(downloadUrl);
  } catch (_) {
    return { eligible: false, reason: "The download URL is invalid." };
  }
  if (parsed.protocol !== "https:") {
    return {
      eligible: false,
      reason: "Automatic updates require HTTPS downloads.",
    };
  }
  return { eligible: true, reason: "Ready" };
}
async function downloadPlugin(update, targetFile, fetchImpl = fetch) {
  const response = await fetchImpl(String(update.downloadUrl), {
    headers: {
      Accept: "application/java-archive, application/octet-stream, */*",
      "User-Agent": "Admincraft/2.0.0 (https://github.com/JosFr/admincraft)",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`Plugin download failed with HTTP ${response.status}.`);
  }
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PLUGIN_BYTES) {
    throw new Error("Plugin artifact exceeds the 128 MiB safety limit.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (
    buffer.length < 4 ||
    buffer.length > MAX_PLUGIN_BYTES ||
    buffer.readUInt32LE(0) !== 0x04034b50
  ) {
    throw new Error("Download source did not return a valid JAR/ZIP artifact.");
  }
  fs.writeFileSync(targetFile, buffer, { mode: 0o600 });
}
function findInstalledPlugin(server, plugin, sourceRoot) {
  const pluginsDir = path.join(
    sourceRoot,
    `server${server.multicraftServerId}`,
    "plugins",
  );
  const wanted = normalizedPluginName(plugin);
  const matches = pluginDirectoryInventory(pluginsDir).filter(
    (item) => normalizedPluginName(item.name) === wanted,
  );
  if (matches.length === 0) {
    throw new Error(`Installed plugin could not be located: ${plugin}.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple installed JARs match plugin ${plugin}; refusing automatic replacement.`,
    );
  }
  return { ...matches[0], pluginsDir };
}

function planServerUpdates(server, updates, sourceRoot) {
  const selected = [];
  const skipped = [];
  for (const update of updates.filter((item) => item.serverId === server.id)) {
    const eligibility = updateEligibility(update);
    if (!eligibility.eligible) {
      skipped.push({ plugin: update.plugin, reason: eligibility.reason });
      continue;
    }
    try {
      const installed = findInstalledPlugin(server, update.plugin, sourceRoot);
      selected.push({ update, installed });
    } catch (error) {
      skipped.push({ plugin: update.plugin, reason: error.message });
    }
  }
  return { selected, skipped };
}
function createUpdateApplier(config = {}, dependencies = {}) {
  const sourceRoot = String(
    config.sourceRoot ||
      process.env.MANAGEMENT_NATIVE_SOURCE_ROOT ||
      "/minecraft",
  ).trim();
  const writeRoot = String(
    config.writeRoot || process.env.MANAGEMENT_UPDATE_SOURCE_ROOT || "",
  ).trim();
  const rollbackRoot = String(
    config.rollbackRoot ||
      process.env.MANAGEMENT_UPDATE_ROLLBACK_PATH ||
      "/data/update-rollbacks",
  ).trim();
  const fetchImpl = dependencies.fetch || fetch;

  function descriptor() {
    return {
      configured: Boolean(writeRoot),
      pluginUpdates: Boolean(writeRoot),
      rollback: Boolean(writeRoot),
    };
  }

  function plan(server, updates = []) {
    if (!writeRoot)
      return {
        selected: [],
        skipped: [
          {
            plugin: "*",
            reason: "Writable update source root is not configured.",
          },
        ],
      };
    return planServerUpdates(server, updates, sourceRoot);
  }
  async function applyServer(server, updates = []) {
    if (!writeRoot) {
      throw new Error(
        "Automatic update apply is not configured on this bridge.",
      );
    }
    const planned = planServerUpdates(server, updates, sourceRoot);
    if (planned.selected.length === 0) {
      const detail = planned.skipped
        .map((item) => `${item.plugin}: ${item.reason}`)
        .join("; ");
      throw new Error(detail || "No applicable plugin updates are available.");
    }
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    const rollbackDir = path.join(
      rollbackRoot,
      safeSegment(server.id, "server update ID"),
      stamp,
    );
    fs.mkdirSync(rollbackDir, { recursive: true, mode: 0o700 });
    const applied = [];
    let tempFile = null;
    try {
      for (const item of planned.selected) {
        const jarName = safeSegment(item.installed.jar, "plugin JAR name");
        const target = path.join(
          writeRoot,
          `server${server.multicraftServerId}`,
          "plugins",
          jarName,
        );
        if (!fs.existsSync(target)) {
          throw new Error(`Writable plugin JAR is missing: ${jarName}.`);
        }
        const originalStat = fs.statSync(target);
        tempFile = `${target}.admincraft-${crypto.randomUUID()}.tmp`;
        await downloadPlugin(item.update, tempFile, fetchImpl);
        const identity = pluginJarIdentity(tempFile);
        if (
          normalizedPluginName(identity.name) !==
          normalizedPluginName(item.update.plugin)
        ) {
          throw new Error(
            `Downloaded JAR identifies as ${identity.name || "unknown"}, expected ${item.update.plugin}.`,
          );
        }
        const backupPath = path.join(rollbackDir, jarName);
        fs.copyFileSync(target, backupPath, fs.constants.COPYFILE_EXCL);
        fs.renameSync(tempFile, target);
        tempFile = null;
        try {
          fs.chmodSync(target, originalStat.mode);
        } catch (_) {}
        try {
          fs.chownSync(target, originalStat.uid, originalStat.gid);
        } catch (_) {}
        applied.push({
          plugin: item.update.plugin,
          fromVersion:
            item.update.currentVersion || item.installed.version || "",
          toVersion: item.update.latestVersion || identity.version || "",
          jar: jarName,
          target,
          backupPath,
          originalStat,
        });
      }
    } catch (error) {
      if (tempFile) {
        try {
          fs.rmSync(tempFile, { force: true });
        } catch (_) {}
      }
      for (const item of [...applied].reverse()) {
        try {
          fs.copyFileSync(item.backupPath, item.target);
          try {
            fs.chmodSync(item.target, item.originalStat.mode);
          } catch (_) {}
          try {
            fs.chownSync(
              item.target,
              item.originalStat.uid,
              item.originalStat.gid,
            );
          } catch (_) {}
        } catch (_) {}
      }
      const rolledBack =
        applied.length > 0
          ? ` ${applied.length} already-applied plugin update(s) were rolled back.`
          : "";
      throw new Error(`${error.message}${rolledBack}`);
    }
    return {
      applied: applied.map(
        ({ target, backupPath, originalStat, ...item }) => item,
      ),
      skipped: planned.skipped,
      rollbackDirectory: rollbackDir,
    };
  }

  return {
    applyServer,
    descriptor,
    plan,
  };
}

module.exports = {
  MAX_PLUGIN_BYTES,
  createUpdateApplier,
  downloadPlugin,
  normalizedPluginName,
  planServerUpdates,
  updateEligibility,
};
