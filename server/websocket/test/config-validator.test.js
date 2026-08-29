const assert = require("node:assert/strict");
const test = require("node:test");
const { validateEnvironment } = require("../config-validator");

function validEnv() {
  return {
    SECRET_KEY: "secret",
    MULTICRAFT_ENABLED: "true",
    MANAGEMENT_ENABLED: "true",
    MULTICRAFT_URL: "https://panel.example.net/api.php",
    MULTICRAFT_USER: "admincraft",
    MULTICRAFT_API_KEY: "key",
    MULTICRAFT_SERVER_ID: "1",
    MANAGEMENT_SERVER_ID: "lobby",
    MANAGEMENT_SERVER_NAME: "Lobby",
  };
}

test("preflight accepts a valid single-server management config", () => {
  const result = validateEnvironment(validEnv());
  assert.equal(result.ok, true);
  assert.equal(result.serverCount, 1);
  assert.deepEqual(result.errors, []);
});

test("preflight rejects missing Multicraft credentials", () => {
  const env = validEnv();
  delete env.MULTICRAFT_API_KEY;
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("MULTICRAFT_API_KEY")));
});

test("preflight rejects malformed management server mappings", () => {
  const env = validEnv();
  env.MANAGEMENT_SERVERS_JSON = JSON.stringify([
    { id: "lobby", name: "Lobby", multicraftServerId: 1 },
    { id: "lobby", name: "Duplicate", multicraftServerId: 2 },
  ]);
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("Duplicate")));
});

test("preflight keeps update configuration optional", () => {
  const env = validEnv();
  env.UPDATE_PROJECTS_JSON = "";
  const result = validateEnvironment(env);
  assert.equal(result.ok, true);
  assert.equal(result.updateProjectCount, 0);
});


test("preflight leaves management off unless explicitly enabled", () => {
  const env = validEnv();
  delete env.MANAGEMENT_ENABLED;
  delete env.MANAGEMENT_SERVER_ID;
  delete env.MANAGEMENT_SERVER_NAME;
  const result = validateEnvironment(env);
  assert.equal(result.ok, true);
  assert.equal(result.serverCount, 0);
  assert.ok(result.warnings.some((message) => message.includes("disabled")));
});

test("preflight rejects management without Multicraft", () => {
  const env = validEnv();
  env.MULTICRAFT_ENABLED = "false";
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("requires MULTICRAFT")));
});
test("preflight validates backup storage and engine mappings", () => {
  const env = validEnv();
  env.MANAGEMENT_SERVERS_JSON = JSON.stringify([{
    id: "smp",
    name: "SMP",
    multicraftServerId: 1,
    defaultBackupEngineId: "native-smp",
  }]);
  env.BACKUP_STORAGES_JSON = JSON.stringify([{
    id: "nextcloud",
    type: "nextcloud",
    url: "https://cloud.example.test/remote.php/dav/files/admincraft",
    username: "backup-user",
    password: "secret",
  }]);
  env.BACKUP_ENGINES_JSON = JSON.stringify([{
    id: "native-smp",
    type: "native",
    serverId: "smp",
    sourcePath: "/srv/minecraft/smp",
    destinationIds: ["nextcloud"],
  }]);
  const result = validateEnvironment(env);
  assert.equal(result.ok, true);
  assert.equal(result.backupStorageCount, 1);
  assert.equal(result.backupEngineCount, 1);
});

test("preflight rejects unknown default backup engines", () => {
  const env = validEnv();
  env.MANAGEMENT_SERVERS_JSON = JSON.stringify([{
    id: "smp",
    name: "SMP",
    multicraftServerId: 1,
    defaultBackupEngineId: "missing-engine",
  }]);
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((message) => message.includes("Unknown default backup engine")),
  );
});

test("preflight rejects backup engines pointing at unknown storage", () => {
  const env = validEnv();
  env.BACKUP_ENGINES_JSON = JSON.stringify([{
    id: "native-lobby",
    type: "native",
    serverId: "lobby",
    sourcePath: "/srv/minecraft/lobby",
    destinationIds: ["missing-storage"],
  }]);
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("Unknown backup storage")));
});

test("preflight validates retention server overrides", () => {
  const env = validEnv();
  env.BACKUP_RETENTION_JSON = JSON.stringify({
    global: { daily: 7, weekly: 4, monthly: 6 },
    servers: { lobby: { daily: 14, enforce: false } },
  });
  const result = validateEnvironment(env);
  assert.equal(result.ok, true);
});

test("preflight rejects retention overrides for unknown servers", () => {
  const env = validEnv();
  env.BACKUP_RETENTION_JSON = JSON.stringify({
    servers: { unknown: { daily: 1 } },
  });
  const result = validateEnvironment(env);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes("Unknown retention server")));
});
