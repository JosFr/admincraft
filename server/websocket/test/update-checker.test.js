const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canonicalProvider,
  compareVersions,
  createUpdateChecker,
  parseProjects,
} = require("../update-checker");

test("version comparison handles releases and prereleases", () => {
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(compareVersions("v2.0.0", "2.0.0"), 0);
  assert.equal(compareVersions("2.0.0-rc1", "2.0.0"), -1);
});

test("provider names match the Flutter contract", () => {
  assert.equal(canonicalProvider("BuiltByBit"), "builtByBit");
  assert.equal(canonicalProvider("GITHUB"), "github");
  assert.equal(canonicalProvider("unknown"), null);
});

test("project configuration ignores incomplete rows", () => {
  const projects = parseProjects(JSON.stringify([
    { serverId: "lobby", plugin: "Example", provider: "github", projectId: "a/b" },
    { serverId: "", plugin: "Missing", provider: "github", projectId: "x/y" },
  ]));
  assert.equal(projects.length, 1);
  assert.equal(projects[0].serverId, "lobby");
});
test("update checker reports a newer GitHub release", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "lobby",
          serverName: "Lobby",
          plugin: "Example",
          currentVersion: "1.0.0",
          provider: "github",
          projectId: "owner/repo",
        },
      ]),
    },
    {
      fetch: async () => ({
        ok: true,
        json: async () => ({ tag_name: "v1.1.0", html_url: "https://example.test/release" }),
      }),
    },
  );
  const updates = await checker({ providers: { github: true } });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "updateAvailable");
  assert.equal(updates[0].latestVersion, "v1.1.0");
});

test("disabled provider aliases are respected", async () => {
  const checker = createUpdateChecker({
    projectsJson: JSON.stringify([{
      serverId: "lobby", plugin: "Premium", currentVersion: "1.0.0",
      provider: "builtbybit", projectId: "12345"
    }]),
  }, { fetch: async () => { throw new Error("must not fetch"); } });
  const updates = await checker({ providers: { builtByBit: false } });
  assert.deepEqual(updates, []);
});
