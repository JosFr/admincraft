const { parseServers } = require("./management-service");
const { parseProjects } = require("./update-checker");
const { parseBackupStorages } = require("./backup-storage");
const { parseBackupEngines } = require("./backup-engines");
const { parseBackupRetention } = require("./backup-policy");
const { parseMaintenancePolicies } = require("./maintenance-policy");
const { parseServerMap, planDatabaseConfig } = require("./plan-performance");

function requireValue(env, key, errors) {
  if (!String(env[key] || "").trim()) errors.push(`${key} is required.`);
}

function validateEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];
  const multicraftEnabled = env.MULTICRAFT_ENABLED === "true";
  const managementEnabled = env.MANAGEMENT_ENABLED === "true";

  if (multicraftEnabled) {
    requireValue(env, "MULTICRAFT_URL", errors);
    requireValue(env, "MULTICRAFT_USER", errors);
    requireValue(env, "MULTICRAFT_API_KEY", errors);
  }

  let servers = [];
  if (managementEnabled) {
    if (!multicraftEnabled) {
      errors.push("MANAGEMENT_ENABLED=true requires MULTICRAFT_ENABLED=true.");
    }
    try {
      servers = parseServers({
        serversJson: env.MANAGEMENT_SERVERS_JSON,
        serverId: env.MANAGEMENT_SERVER_ID,
        serverName: env.MANAGEMENT_SERVER_NAME,
        multicraftServerId: env.MULTICRAFT_SERVER_ID,
      });
    } catch (error) {
      errors.push(error.message);
    }
    if (servers.length === 0) {
      errors.push("At least one management server mapping is required.");
    }
  }

  let planMappings = [];
  if (managementEnabled && servers.length > 0) {
    requireValue(env, "PLAN_DB_HOST", errors);
    requireValue(env, "PLAN_DB_USER", errors);
    requireValue(env, "PLAN_DB_PASSWORD", errors);
    try {
      const database = planDatabaseConfig({}, env);
      if (!Number.isInteger(database.port) || database.port < 1 || database.port > 65535) {
        errors.push("PLAN_DB_PORT must be a valid TCP port.");
      }
      if (env.PLAN_DB_SSL && !["true", "false"].includes(env.PLAN_DB_SSL)) {
        errors.push("PLAN_DB_SSL must be true or false.");
      }
      planMappings = parseServerMap(env.PLAN_SERVER_MAP_JSON || "", servers.map((server) => server.id));
      if (planMappings.length === 0) errors.push("PLAN_SERVER_MAP_JSON must contain at least one mapping.");
    } catch (error) {
      errors.push(error.message);
    }
  }

  let storages = [];
  let engines = [];
  if (managementEnabled && servers.length > 0) {
    try {
      storages = parseBackupStorages({ storagesJson: env.BACKUP_STORAGES_JSON });
      const storageIds = new Set(storages.map((storage) => storage.id));
      if (String(env.MANAGEMENT_STORAGE_PATH || '').trim()) storageIds.add('management-local');
      engines = parseBackupEngines({ enginesJson: env.BACKUP_ENGINES_JSON }, servers, storageIds);
      parseBackupRetention(env.BACKUP_RETENTION_JSON || "", servers.map((server) => server.id));
      parseMaintenancePolicies(env.MAINTENANCE_CONFIG_JSON || "", servers.map((server) => server.id));
      for (const server of servers) {
        if (server.defaultBackupEngineId === 'multicraft') continue;
        if (!engines.some((engine) => engine.id === server.defaultBackupEngineId && engine.serverId === server.id)) {
          errors.push('Unknown default backup engine for management server ' + server.id + '.');
        }
      }
    } catch (error) {
      errors.push(error.message);
    }
  }

  let projects = [];
  try {
    projects = parseProjects(env.UPDATE_PROJECTS_JSON || "");
  } catch (error) {
    errors.push(error.message);
  }
  const builtByBitTokenType = String(env.BUILTBYBIT_API_TOKEN_TYPE || "").trim();
  if (builtByBitTokenType && !["Private", "Shared"].includes(builtByBitTokenType)) {
    errors.push("BUILTBYBIT_API_TOKEN_TYPE must be Private or Shared.");
  }

  if (!env.SECRET_KEY && !env.AUTH_USERS_JSON) {
    warnings.push("No bridge authentication credential is configured.");
  }
  if (!managementEnabled) {
    warnings.push("RC4 management is disabled on this bridge.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    serverCount: servers.length,
    backupStorageCount: storages.length,
    backupEngineCount: engines.length,
    updateProjectCount: projects.length,
    planServerCount: planMappings.length,
  };
}

module.exports = { validateEnvironment };
