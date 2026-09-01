const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  discoverPlatformProjects,
  platformJarIdentity,
} = require("../platform-inventory");

function writeStoredZip(file, name, body) {
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
  fs.writeFileSync(
    file,
    Buffer.concat([local, nameBytes, data, central, nameBytes, eocd]),
  );
}

test("Paper server JAR metadata becomes an automatic platform project", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "admincraft-paper-inventory-"),
  );
  try {
    const server = path.join(root, "server9");
    fs.mkdirSync(server, { recursive: true });
    const jar = path.join(server, "paper.jar");
    writeStoredZip(
      jar,
      "META-INF/MANIFEST.MF",
      "Main-Class: io.papermc.paperclip.Main\nImplementation-Version: 1.21.10-48\n",
    );
    assert.deepEqual(platformJarIdentity(jar), {
      kind: "paper",
      currentVersion: "1.21.10+build.48",
      platformVersion: "1.21.10",
      build: 48,
    });
    const projects = discoverPlatformProjects({
      servers: [
        { id: "new-server", name: "New server", multicraftServerId: 9 },
      ],
      sourceRoot: root,
      platformRoots: [],
    });
    assert.equal(projects.length, 1);
    assert.equal(projects[0].serverId, "new-server");
    assert.equal(projects[0].plugin, "Paper");
    assert.equal(projects[0].provider, "paperMC");
    assert.equal(projects[0].currentVersion, "1.21.10+build.48");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Velocity can be discovered from a generic platform root", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "admincraft-velocity-inventory-"),
  );
  try {
    const jar = path.join(root, "velocity.jar");
    writeStoredZip(
      jar,
      "META-INF/MANIFEST.MF",
      "Main-Class: com.velocitypowered.proxy.Velocity\nImplementation-Version: 4.0.0-123\n",
    );
    const projects = discoverPlatformProjects({
      servers: [],
      sourceRoot: root,
      platformRoots: [
        { id: "proxy", name: "Velocity", kind: "velocity", directory: root },
      ],
    });
    assert.equal(projects.length, 1);
    assert.equal(projects[0].kind, "velocity");
    assert.equal(projects[0].currentVersion, "4.0.0+build.123");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
