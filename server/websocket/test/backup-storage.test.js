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
