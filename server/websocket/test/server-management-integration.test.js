const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const WebSocket = require("ws");

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForLine(child, pattern) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(output || "Bridge startup timed out.")), 10000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (!pattern.test(output)) return;      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolve(output);
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Bridge exited early with code ${code}: ${output}`));
    });
  });
}

function nextFrame(ws, expectedType) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedType}.`)), 5000);
    const onMessage = (raw) => {
      let frame;
      try { frame = JSON.parse(raw.toString()); } catch (_) { return; }
      if (frame.type !== expectedType) return;
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolve(frame);
    };
    ws.on("message", onMessage);
  });
}

test("bridge advertises management and serves a snapshot", async () => {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-bridge-smoke-"));  const secret = "rc4-smoke-secret";
  const child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      SECRET_KEY: secret,
      SERVER_TYPE: "java",
      DOCKER_ENABLED: "false",
      RCON_PASSWORD: "unused-smoke-password",
      MULTICRAFT_ENABLED: "true",
      MULTICRAFT_URL: "http://127.0.0.1:1/api.php",
      MULTICRAFT_USER: "smoke",
      MULTICRAFT_API_KEY: "smoke",
      MULTICRAFT_SERVER_ID: "1",
      MANAGEMENT_SERVER_ID: "lobby",
      MANAGEMENT_SERVER_NAME: "Lobby",
      MANAGEMENT_STATE_PATH: path.join(dir, "management.json"),
      MANAGEMENT_TICK_MS: "60000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let ws;
  try {
    await waitForLine(child, /bridge listening on port/u);
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });    const helloPromise = nextFrame(ws, "admincraft.hello");
    const token = jwt.sign({
      userId: "smoke",
      protocol: 2,
      edition: "java",
      logTail: 0,
    }, secret);
    ws.send(JSON.stringify({ type: "admincraft.auth", token }));
    const hello = await helloPromise;
    assert.equal(hello.edition, "java");
    assert.equal(hello.scope, "admin");
    assert.ok(hello.capabilities.includes("management"));

    const statePromise = nextFrame(ws, "admincraft.management-state");
    const resultPromise = nextFrame(ws, "admincraft.management-result");
    ws.send("admincraft manage snapshot e30");
    const [state, result] = await Promise.all([statePromise, resultPromise]);
    assert.equal(result.success, true);
    assert.ok(Array.isArray(state.backups));
    assert.ok(Array.isArray(state.schedules));
    assert.ok(Array.isArray(state.maintenance));
    assert.ok(Array.isArray(state.updates));
    assert.ok(Array.isArray(state.activity));
  } finally {
    ws?.close();
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});