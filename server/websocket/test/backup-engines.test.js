const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseBackupEngines,
  engineDescriptors,
} = require("../backup-engines");

test("configured engines expose only public descriptors", () => {
  const servers = [{ id: "smp", name: "SMP", multicraftServerId: 7 }];
  const engines = parseBackupEngines({
    enginesJson: JSON.stringify([{
      id: "native-smp",
      type: "native",
      serverId: "smp",
      label: "AdminCraft Native",
      sourcePath: "/srv/minecraft/smp",
      destinationIds: ["nextcloud"],
      allowRestore: true,
    }]),
  }, servers, new Set(["nextcloud", "local"]));
  const descriptor = engineDescriptors(
    engines,
    servers,
    true,
    ["nextcloud", "local"],
  ).find((item) => item.id === "native-smp");
  assert.deepEqual(descriptor.destinationIds, ["nextcloud"]);
  assert.deepEqual(descriptor.availableDestinationIds, ["nextcloud", "local"]);
  assert.equal(descriptor.capabilities.restore, true);
  assert.equal(Object.hasOwn(descriptor, "sourcePath"), false);
  assert.equal(Object.hasOwn(descriptor, "command"), false);
});

test("plugin and custom engines require explicit commands", () => {
  const servers = [{ id: "smp", name: "SMP", multicraftServerId: 7 }];
  assert.throws(
    () => parseBackupEngines({
      enginesJson: JSON.stringify([{
        id: "plugin-smp",
        type: "plugin",
        serverId: "smp",
      }]),
    }, servers, new Set()),
    /requires command/u,
  );
});
