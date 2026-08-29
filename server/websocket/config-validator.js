const { parseServers } = require("./management-service");
const { parseProjects } = require("./update-checker");

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

  let projects = [];
  try {
    projects = parseProjects(env.UPDATE_PROJECTS_JSON || "");
  } catch (error) {
    errors.push(error.message);
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
    updateProjectCount: projects.length,
  };
}

module.exports = { validateEnvironment };
