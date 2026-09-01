const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  discoverPluginProjects,
  pluginJarIdentity,
  yamlIdentity,
} = require("../plugin-inventory");

function storedZipEntry(name, body) {
  const nameBytes = Buffer.from(name);
  const data = Buffer.from(body);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  return { nameBytes, data, local };
}
function writeStoredZip(file, name, body) {
  const { nameBytes, data, local } = storedZipEntry(name, body);
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
test("plugin.yml identity parser reads name and version", () => {
  assert.deepEqual(
    yamlIdentity("name: ExamplePlugin\nversion: 1.2.3\nmain: example.Main\n"),
    { name: "ExamplePlugin", version: "1.2.3" },
  );
});

test("plugin JAR metadata drives automatic project inventory", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "admincraft-plugin-inventory-"),
  );
  try {
    const plugins = path.join(root, "server9", "plugins");
    fs.mkdirSync(plugins, { recursive: true });
    const jar = path.join(plugins, "renamed-file.jar");
    writeStoredZip(jar, "plugin.yml", "name: RealPlugin\nversion: 4.5.6\n");
    assert.deepEqual(pluginJarIdentity(jar), {
      name: "RealPlugin",
      version: "4.5.6",
      metadata: "plugin.yml",
    });
    const projects = discoverPluginProjects({
      servers: [
        { id: "new-server", name: "New server", multicraftServerId: 9 },
      ],
      sourceRoot: root,
    });
    assert.equal(projects.length, 1);
    assert.equal(projects[0].serverId, "new-server");
    assert.equal(projects[0].plugin, "RealPlugin");
    assert.equal(projects[0].currentVersion, "4.5.6");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
