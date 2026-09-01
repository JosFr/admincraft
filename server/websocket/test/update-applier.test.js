const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createUpdateApplier, updateEligibility } = require("../update-applier");
const { pluginJarIdentity } = require("../plugin-inventory");

function storedZip(name, body) {
  const nameBytes = Buffer.from(name);
  const data = Buffer.from(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + nameBytes.length + data.length;
  const centralSize = central.length + nameBytes.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, nameBytes, data, central, nameBytes, eocd]);
}
function response(buffer) {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(buffer.length) },
    arrayBuffer: async () => arrayBuffer,
  };
}
test("automatic update eligibility is fail-closed", () => {
  assert.equal(
    updateEligibility({
      kind: "plugin",
      status: "updateAvailable",
      downloadSourceConfirmed: true,
      downloadUrl: "http://example.test/plugin.jar",
    }).eligible,
    false,
  );
  assert.equal(
    updateEligibility({
      kind: "plugin",
      status: "updateAvailable",
      downloadSourceConfirmed: true,
      downloadUrl: "https://example.test/plugin.jar",
    }).eligible,
    true,
  );
});

test("plugin update apply validates and replaces a JAR with rollback copy", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-update-"));
  try {
    const plugins = path.join(root, "server1", "plugins");
    fs.mkdirSync(plugins, { recursive: true });
    const target = path.join(plugins, "Example.jar");
    fs.writeFileSync(
      target,
      storedZip("plugin.yml", "name: Example\nversion: 1.0.0\n"),
    );
    const replacement = storedZip(
      "plugin.yml",
      "name: Example\nversion: 1.1.0\n",
    );
    const applier = createUpdateApplier(
      {
        sourceRoot: root,
        writeRoot: root,
        rollbackRoot: path.join(root, "rollbacks"),
      },
      { fetch: async () => response(replacement) },
    );
    const result = await applier.applyServer(
      { id: "smp", name: "SMP", multicraftServerId: 1 },
      [
        {
          serverId: "smp",
          plugin: "Example",
          kind: "plugin",
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          status: "updateAvailable",
          downloadSourceConfirmed: true,
          downloadUrl: "https://example.test/Example.jar",
        },
      ],
    );
    assert.equal(result.applied.length, 1);
    assert.equal(pluginJarIdentity(target).version, "1.1.0");
    assert.equal(fs.existsSync(result.rollbackDirectory), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("a later update failure rolls back earlier plugin replacements", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "admincraft-update-rollback-"),
  );
  try {
    const plugins = path.join(root, "server1", "plugins");
    fs.mkdirSync(plugins, { recursive: true });
    const first = path.join(plugins, "First.jar");
    const second = path.join(plugins, "Second.jar");
    fs.writeFileSync(
      first,
      storedZip("plugin.yml", "name: First\nversion: 1.0.0\n"),
    );
    fs.writeFileSync(
      second,
      storedZip("plugin.yml", "name: Second\nversion: 1.0.0\n"),
    );
    const good = storedZip("plugin.yml", "name: First\nversion: 2.0.0\n");
    const bad = Buffer.from("not-a-jar");
    const applier = createUpdateApplier(
      {
        sourceRoot: root,
        writeRoot: root,
        rollbackRoot: path.join(root, "rollbacks"),
      },
      {
        fetch: async (url) =>
          response(String(url).includes("First") ? good : bad),
      },
    );
    const updates = ["First", "Second"].map((plugin) => ({
      serverId: "smp",
      plugin,
      kind: "plugin",
      currentVersion: "1.0.0",
      latestVersion: "2.0.0",
      status: "updateAvailable",
      downloadSourceConfirmed: true,
      downloadUrl: `https://example.test/${plugin}.jar`,
    }));
    await assert.rejects(
      applier.applyServer(
        { id: "smp", name: "SMP", multicraftServerId: 1 },
        updates,
      ),
      /rolled back/u,
    );
    assert.equal(pluginJarIdentity(first).version, "1.0.0");
    assert.equal(pluginJarIdentity(second).version, "1.0.0");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
