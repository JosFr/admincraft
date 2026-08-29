const assert = require("node:assert/strict");
const test = require("node:test");
const { validateEnvironment } = require("../config-validator");

function validEnv() {
  return {
    SECRET_KEY: "secret",
    MULTICRAFT_ENABLED: "true",
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

