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

test("unconfirmed source candidates stay unmanaged until remembered", async () => {
  const checker = createUpdateChecker({
    projectsJson: JSON.stringify([{
      serverId: "smp", plugin: "Example", currentVersion: "1.0.0",
      candidates: [
        { provider: "modrinth", projectId: "abc", label: "Example on Modrinth" },
        { provider: "github", projectId: "owner/repo", label: "Example on GitHub" },
      ],
    }]),
  }, {
    fetch: async () => ({ ok: true, json: async () => ({ tag_name: "1.1.0" }) }),
  });
  let results = await checker();
  assert.equal(results[0].status, "unmanaged");
  assert.equal(results[0].candidates.length, 2);
  const confirmed = checker.confirmSource({
    serverId: "smp", plugin: "Example", provider: "github", projectId: "owner/repo",
  });
  results = await checker({ sourceOverrides: { [confirmed.key]: confirmed.source } });
  assert.equal(results[0].provider, "github");
  assert.equal(results[0].sourceConfirmed, true);
  assert.equal(results[0].status, "updateAvailable");
});

test("BuiltByBit checking uses the configured API token", async () => {
  let requestOptions;
  const checker = createUpdateChecker({
    builtByBitApiToken: "token-value",
    projectsJson: JSON.stringify([{
      serverId: "smp", plugin: "Premium", currentVersion: "2.0.0",
      provider: "builtbybit", projectId: "12345",
    }]),
  }, {
    fetch: async (_url, options) => {
      requestOptions = options;
      return { ok: true, json: async () => ({ data: { name: "2.1.0" } }) };
    },
  });
  const results = await checker();
  assert.equal(requestOptions.headers.Authorization, "Private token-value");
  assert.equal(results[0].latestVersion, "2.1.0");
});

test("Paper and Velocity platform projects use the PaperMC source", async () => {
  let requestOptions;
  const checker = createUpdateChecker({
    projectsJson: JSON.stringify([{
      serverId: "smp", plugin: "Paper", kind: "paper", currentVersion: "1.21.10",
    }]),
  }, {
    fetch: async (_url, options) => {
      requestOptions = options;
      return {
      ok: true,
      json: async () => ({ versions: { "1.21": ["1.21.10", "1.21.11"], "26": ["26.1"] } }),
      };
    },
  });
  const results = await checker();
  assert.match(requestOptions.headers["User-Agent"], /^Admincraft\/2\.0\.0 /u);
  assert.equal(results[0].provider, "paperMC");
  assert.equal(results[0].kind, "paper");
  assert.equal(results[0].latestVersion, "26.1");
  assert.equal(results[0].status, "updateAvailable");
});

test("BuiltByBit Shared token prefix is supported", async () => {
  let authorization;
  const checker = createUpdateChecker({
    builtByBitApiToken: "shared-value", builtByBitApiTokenType: "Shared",
    projectsJson: JSON.stringify([{
      serverId: "smp", plugin: "Premium", currentVersion: "1.0.0",
      provider: "builtbybit", projectId: "12345",
    }]),
  }, {
    fetch: async (_url, options) => {
      authorization = options.headers.Authorization;
      return { ok: true, json: async () => ({ data: { name: "1.0.0" } }) };
    },
  });
  await checker();
  assert.equal(authorization, "Shared shared-value");
});
