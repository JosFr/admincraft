const { parseServers } = require("./management-service");
const { parseProjects } = require("./update-checker");

function requireValue(env, key, errors) {
  if (!String(env[key] || "").trim()) errors.push(`${key} is required.`);
}

function validateEnvironment(env = process.env) {
  const errors = [];
  const warnings = [];
  const multicraftEnabled = env.MULTICRAFT_ENABLED === "true";

  if (multicraftEnabled) {
    requireValue(env, "MULTICRAFT_URL", errors);
    requireValue(env, "MULTICRAFT_USER", errors);
    requireValue(env, "MULTICRAFT_API_KEY", errors);
  }

  let servers = [];
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
  if (multicraftEnabled && servers.length === 0) {
    errors.push("At least one management server mapping is required.");
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
  if (!multicraftEnabled) {
    warnings.push("Multicraft management is disabled; RC4 management will not be advertised.");
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
