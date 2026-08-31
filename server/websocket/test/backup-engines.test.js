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
  assert.equal(descriptor.consistency, "offline");
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

test("plugin completion regex makes progress observable without leaking private matching config", () => {
  const servers = [{ id: "smp", name: "SMP", multicraftServerId: 7 }];
  const engines = parseBackupEngines({
    enginesJson: JSON.stringify([{
      id: "plugin-smp", type: "plugin", serverId: "smp", label: "Backup plugin",
      command: "backup start", completionRegex: "Backup complete", failureRegex: "Backup failed",
      completionTimeoutSeconds: 120,
    }]),
  }, servers, new Set());
  const descriptor = engineDescriptors(engines, servers, true).find((item) => item.id === "plugin-smp");
  assert.equal(descriptor.capabilities.progress, true);
  assert.equal(Object.hasOwn(descriptor, "command"), false);
  assert.equal(Object.hasOwn(descriptor, "completionRegex"), false);
  assert.equal(Object.hasOwn(descriptor, "failureRegex"), false);
  assert.equal(Object.hasOwn(descriptor, "completionTimeoutSeconds"), false);
});

test("plugin completion matching fails closed on invalid configuration", () => {
  const servers = [{ id: "smp", name: "SMP", multicraftServerId: 7 }];
  assert.throws(() => parseBackupEngines({
    enginesJson: JSON.stringify([{
      id: "plugin-smp", type: "plugin", serverId: "smp", command: "backup start",
      completionRegex: "[unterminated",
    }]),
  }, servers, new Set()), /Invalid completionRegex/u);
  assert.throws(() => parseBackupEngines({
    enginesJson: JSON.stringify([{
      id: "plugin-smp", type: "plugin", serverId: "smp", command: "backup start",
      failureRegex: "failed",
    }]),
  }, servers, new Set()), /requires completionRegex/u);
});
test("native consistency defaults offline and rejects unsupported modes", () => {
  const servers = [{ id: "smp", name: "SMP", multicraftServerId: 7 }];
  const engine = parseBackupEngines({
    enginesJson: JSON.stringify([{
      id: "native-smp", type: "native", serverId: "smp", sourcePath: "/srv/smp",
    }]),
  }, servers, new Set())[0];
  assert.equal(engine.consistency, "offline");
  assert.throws(() => parseBackupEngines({
    enginesJson: JSON.stringify([{
      id: "native-smp", type: "native", serverId: "smp", sourcePath: "/srv/smp",
      consistency: "snapshot-magic",
    }]),
  }, servers, new Set()), /invalid consistency mode/u);
});