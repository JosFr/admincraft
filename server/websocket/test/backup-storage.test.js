const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseBackupStorages,
  publicStorage,
  copyToStorage,
  parseDavQuota,
} = require("../backup-storage");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("Nextcloud storage keeps credentials private", () => {
  const storage = parseBackupStorages({
    storagesJson: JSON.stringify([{
      id: "nextcloud",
      name: "Nextcloud",
      type: "nextcloud",
      url: "https://cloud.example.test/remote.php/dav/files/admincraft",
      username: "backup-user",
      password: "secret-password",
    }]),
  })[0];
  const visible = publicStorage(storage);
  assert.equal(visible.type, "nextcloud");
  assert.equal(Object.hasOwn(visible, "password"), false);
  assert.equal(Object.hasOwn(visible, "username"), false);
});
test("local storage copies into a server-specific directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-storage-"));
  try {
    const source = path.join(dir, "backup.tar.gz");
    const targetRoot = path.join(dir, "target");
    fs.writeFileSync(source, "backup-data", "utf8");
    const storage = parseBackupStorages({
      storagesJson: JSON.stringify([{
        id: "local",
        type: "local",
        path: targetRoot,
      }]),
    })[0];
    const result = await copyToStorage(storage, source, "smp");
    assert.equal(fs.readFileSync(result.locator, "utf8"), "backup-data");
    assert.match(result.locator, /smp[\\/]backup\.tar\.gz$/u);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("WebDAV quota parsing supports Nextcloud DAV properties", () => {
  const quota = parseDavQuota(
    "<d:quota-available-bytes>700</d:quota-available-bytes>" +
    "<d:quota-used-bytes>300</d:quota-used-bytes>",
  );
  assert.deepEqual(quota, { freeBytes: 700, totalBytes: 1000 });
});

test("storage exposes minimum-free-space safeguard without credentials", () => {
  const storage = parseBackupStorages({
    storagesJson: JSON.stringify([{
      id: "nextcloud",
      type: "nextcloud",
      url: "https://cloud.example.test/dav",
      username: "user",
      password: "secret",
      minimumFreeBytes: 150 * 1024 * 1024 * 1024,
    }]),
  })[0];
  const visible = publicStorage(storage);
  assert.equal(visible.minimumFreeBytes, 150 * 1024 * 1024 * 1024);
  assert.equal(Object.hasOwn(visible, "password"), false);
});
test("local storage reuses a native archive already at its destination", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "admincraft-storage-same-"));
  try {
    const targetRoot = path.join(dir, "target");
    const source = path.join(targetRoot, "smp", "smp-backup.tar.gz");
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "native-backup", "utf8");
    const storage = parseBackupStorages({
      storagesJson: JSON.stringify([{ id: "local", type: "local", path: targetRoot }]),
    })[0];
    const result = await copyToStorage(storage, source, "smp");
    assert.equal(path.resolve(result.locator), path.resolve(source));
    assert.equal(fs.readFileSync(source, "utf8"), "native-backup");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
