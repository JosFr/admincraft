const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const {
  combineStorages,
  loadManagedStorages,
  nextcloudUrl,
  normalizeManagedStorage,
  saveManagedStorages,
} = require("../storage-config");

test("Nextcloud base URL becomes DAV files endpoint", () => {
  assert.equal(
    nextcloudUrl("https://cloud.example.test/", "jos@example.test"),
    "https://cloud.example.test/remote.php/dav/files/jos%40example.test",
  );
});
test("managed storage preserves password unless explicitly cleared", () => {
  const first = normalizeManagedStorage({
    id: "nextcloud",
    name: "Nextcloud",
    type: "nextcloud",
    url: "https://cloud.example.test",
    username: "admincraft",
    password: "secret-one",
  });
  const updated = normalizeManagedStorage(
    {
      id: "nextcloud",
      name: "Cloud renamed",
      type: "nextcloud",
      url: "https://cloud.example.test",
      username: "admincraft",
    },
    first,
  );
  assert.equal(updated.password, "secret-one");
  assert.equal(updated.username, "admincraft");
  const usernamePreserved = normalizeManagedStorage(
    {
      id: "nextcloud",
      username: "",
    },
    updated,
  );
  assert.equal(usernamePreserved.username, "admincraft");
  const cleared = normalizeManagedStorage(
    {
      id: "nextcloud",
      clearPassword: true,
    },
    updated,
  );
  assert.equal(cleared.password, "");
});
test("managed storage file round-trips and stays private where supported", () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "admincraft-storage-config-"),
  );
  const file = path.join(dir, "backup-storages.json");
  try {
    const storage = normalizeManagedStorage({
      id: "nextcloud",
      name: "Nextcloud",
      type: "nextcloud",
      url: "https://cloud.example.test",
      username: "admincraft",
      password: "secret-two",
      minimumFreeBytes: 1024,
    });
    saveManagedStorages(file, [{ ...storage, managed: true }]);
    const loaded = loadManagedStorages(file);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].password, "secret-two");
    assert.equal(loaded[0].managed, true);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("managed IDs cannot shadow externally managed storage", () => {
  const external = [{ id: "local" }];
  const managed = [{ id: "local" }];
  assert.throws(
    () => combineStorages(external, managed),
    /conflicts with external/u,
  );
});
