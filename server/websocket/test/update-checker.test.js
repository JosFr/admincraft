const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  canonicalProvider,
  compareVersions,
  createUpdateChecker,
  parseProjects,
} = require("../update-checker");
const { discoverCandidates } = require("../update-discovery");

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
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBytes.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  fs.writeFileSync(
    file,
    Buffer.concat([local, nameBytes, data, central, nameBytes, eocd]),
  );
}


test("candidate discovery ranks an exact Plan repository above PLand", async () => {
  const candidates = await discoverCandidates(
    "Plan",
    { modrinth: false, hangar: false, spigot: false, builtByBit: false, github: true },
    async (url) => {
      assert.match(String(url), /api\.github\.com\/search\/repositories/u);
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              name: "PLand",
              full_name: "IceBlockMC/PLand",
              html_url: "https://github.com/IceBlockMC/PLand",
            },
            {
              name: "Plan",
              full_name: "plan-player-analytics/Plan",
              html_url: "https://github.com/plan-player-analytics/Plan",
            },
          ],
        }),
      };
    },
  );

  assert.equal(candidates[0].projectId, "plan-player-analytics/Plan");
  assert.equal(candidates[0].score, 100);
  assert.equal(candidates[1].projectId, "IceBlockMC/PLand");
  assert.equal(candidates[1].score, 80);
});


test("verified source catalog injects the reviewed AuctionHouse project", async () => {
  const candidates = await discoverCandidates(
    "AuctionHouse",
    { modrinth: true, hangar: false, spigot: false, github: false, builtByBit: false },
    async () => {
      throw new Error("provider search unavailable");
    },
  );
  assert.equal(candidates[0].provider, "modrinth");
  assert.equal(candidates[0].projectId, "scEbl04C");
  assert.equal(candidates[0].verified, true);
  assert.equal(candidates[0].score, 120);
});

test("version comparison handles releases, prereleases and build metadata", () => {
  assert.equal(compareVersions("1.2.3", "1.2.4"), -1);
  assert.equal(compareVersions("v2.0.0", "2.0.0"), 0);
  assert.equal(compareVersions("2.0.0-rc1", "2.0.0"), -1);
  assert.equal(compareVersions("7.0.9+5934e49", "7.0.9"), 0);
  assert.equal(compareVersions("7.4.5+7590-b8dc4c1", "7.4.5"), 0);
  assert.equal(compareVersions("2.14.0+spigot", "2.14.0+fabric"), 0);
});

test("version comparison treats Plan build notation as the release tag", () => {
  assert.equal(compareVersions("5.8 build 3638", "5.8.3638"), 0);
  assert.equal(compareVersions("5.8 build #3638", "5.8.3638"), 0);
  assert.equal(compareVersions("5.8 build 3637", "5.8.3638"), -1);
});

test("provider names match the Flutter contract", () => {
  assert.equal(canonicalProvider("BuiltByBit"), "builtByBit");
  assert.equal(canonicalProvider("GITHUB"), "github");
  assert.equal(canonicalProvider("unknown"), null);
});

test("project configuration ignores incomplete rows", () => {
  const projects = parseProjects(
    JSON.stringify([
      {
        serverId: "lobby",
        plugin: "Example",
        provider: "github",
        projectId: "a/b",
      },
      { serverId: "", plugin: "Missing", provider: "github", projectId: "x/y" },
    ]),
  );
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
        json: async () => ({
          tag_name: "v1.1.0",
          html_url: "https://example.test/release",
        }),
      }),
    },
  );
  const updates = await checker({ providers: { github: true } });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "updateAvailable");
  assert.equal(updates[0].latestVersion, "v1.1.0");
});

test("disabled provider aliases are respected", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "lobby",
          plugin: "Premium",
          currentVersion: "1.0.0",
          provider: "builtbybit",
          projectId: "12345",
        },
      ]),
    },
    {
      fetch: async () => {
        throw new Error("must not fetch");
      },
    },
  );
  const updates = await checker({ providers: { builtByBit: false } });
  assert.deepEqual(updates, []);
});

test("unconfirmed source candidates stay unmanaged until remembered", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
          plugin: "Example",
          currentVersion: "1.0.0",
          candidates: [
            {
              provider: "modrinth",
              projectId: "abc",
              label: "Example on Modrinth",
            },
            {
              provider: "github",
              projectId: "owner/repo",
              label: "Example on GitHub",
            },
          ],
        },
      ]),
    },
    {
      fetch: async () => ({
        ok: true,
        json: async () => ({ tag_name: "1.1.0" }),
      }),
    },
  );
  let results = await checker();
  assert.equal(results[0].status, "unmanaged");
  assert.equal(results[0].candidates.length, 2);
  const confirmed = checker.confirmSource({
    serverId: "smp",
    plugin: "Example",
    provider: "github",
    projectId: "owner/repo",
  });
  results = await checker({
    sourceOverrides: { [confirmed.key]: confirmed.source },
  });
  assert.equal(results[0].provider, "github");
  assert.equal(results[0].sourceConfirmed, true);
  assert.equal(results[0].status, "updateAvailable");
});

test("BuiltByBit checking uses the configured API token", async () => {
  let requestOptions;
  const checker = createUpdateChecker(
    {
      builtByBitApiToken: "token-value",
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
          plugin: "Premium",
          currentVersion: "2.0.0",
          provider: "builtbybit",
          projectId: "12345",
        },
      ]),
    },
    {
      fetch: async (_url, options) => {
        requestOptions = options;
        return { ok: true, json: async () => ({ data: { name: "2.1.0" } }) };
      },
    },
  );
  const results = await checker();
  assert.equal(requestOptions.headers.Authorization, "Private token-value");
  assert.equal(results[0].latestVersion, "2.1.0");
});

test("Paper and Velocity use stable PaperMC builds", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
          plugin: "Paper",
          kind: "paper",
          currentVersion: "1.21.10+build.48",
        },
        {
          serverId: "proxy",
          plugin: "Velocity",
          kind: "velocity",
          currentVersion: "4.0.0+build.100",
        },
      ]),
    },
    {
      fetch: async (url, options) => {
        assert.match(options.headers["User-Agent"], /^Admincraft\/2\.0\.0 /u);
        if (url.endsWith("/projects/paper")) {
          return {
            ok: true,
            json: async () => ({ versions: { stable: ["1.21.11"] } }),
          };
        }
        if (url.endsWith("/projects/velocity")) {
          return {
            ok: true,
            json: async () => ({ versions: { stable: ["4.1.0"] } }),
          };
        }
        const paper = url.includes("/projects/paper/");
        return {
          ok: true,
          json: async () => [
            {
              id: 999,
              channel: "EXPERIMENTAL",
              downloads: {
                "server:default": {
                  url: "https://downloads.example/unstable.jar",
                },
              },
            },
            {
              id: paper ? 55 : 120,
              channel: "STABLE",
              downloads: {
                "server:default": {
                  url: paper
                    ? "https://downloads.example/paper.jar"
                    : "https://downloads.example/velocity.jar",
                },
              },
            },
          ],
        };
      },
    },
  );
  const results = await checker();
  assert.equal(results.length, 2);
  assert.equal(results[0].latestVersion, "1.21.10+build.55");
  assert.equal(results[0].status, "updateAvailable");
  assert.equal(results[0].downloadUrl, "https://downloads.example/paper.jar");
  assert.equal(results[1].latestVersion, "4.1.0+build.120");
  assert.equal(results[1].status, "updateAvailable");
});

test("BuiltByBit Shared token prefix is supported", async () => {
  let authorization;
  const checker = createUpdateChecker(
    {
      builtByBitApiToken: "shared-value",
      builtByBitApiTokenType: "Shared",
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
          plugin: "Premium",
          currentVersion: "1.0.0",
          provider: "builtbybit",
          projectId: "12345",
        },
      ]),
    },
    {
      fetch: async (_url, options) => {
        authorization = options.headers.Authorization;
        return { ok: true, json: async () => ({ data: { name: "1.0.0" } }) };
      },
    },
  );
  await checker();
  assert.equal(authorization, "Shared shared-value");
});

test("live plugin inventory discovers candidates without UPDATE_PROJECTS_JSON", async () => {
  const project = {
    serverId: "new-server",
    serverName: "New server",
    plugin: "RealPlugin",
    kind: "plugin",
    currentVersion: "1.0.0",
    provider: null,
    projectId: "",
    sourceConfirmed: false,
    candidates: [],
    url: null,
  };
  const checker = createUpdateChecker(
    {
      servers: [
        { id: "new-server", name: "New server", multicraftServerId: 9 },
      ],
    },
    {
      discoverPluginProjects: () => [project],
      discoverCandidates: async () => [
        {
          provider: "github",
          projectId: "owner/real-plugin",
          label: "GitHub · owner/real-plugin",
          url: "https://example.test/project",
        },
      ],
      fetch: async () => ({
        ok: true,
        json: async () => ({
          tag_name: "1.1.0",
          html_url: "https://example.test/release",
        }),
      }),
    },
  );
  const first = await checker({ providers: { github: true } });
  assert.equal(first.length, 1);
  assert.equal(first[0].plugin, "RealPlugin");
  assert.equal(first[0].status, "unmanaged");
  assert.equal(first[0].candidates.length, 1);
  const confirmed = checker.confirmSource({
    serverId: "new-server",
    plugin: "RealPlugin",
    provider: "github",
    projectId: "owner/real-plugin",
  });
  assert.equal(confirmed.role, "check");
  const second = await checker({
    providers: { github: true },
    sourceOverrides: { [confirmed.key]: { check: confirmed.source } },
  });
  assert.equal(second[0].provider, "github");
  assert.equal(second[0].sourceConfirmed, true);
  assert.equal(second[0].latestVersion, "1.1.0");
  assert.equal(second[0].status, "updateAvailable");
});

test("duplicate plugin inventory shares one candidate discovery request", async () => {
  let discoveries = 0;
  const projects = ["lobby", "smp", "archive"].map((serverId) => ({
    serverId,
    serverName: serverId,
    plugin: "Plan",
    kind: "plugin",
    currentVersion: "5.8 build 3638",
    provider: null,
    projectId: "",
    sourceConfirmed: false,
    candidates: [],
    url: null,
  }));
  const checker = createUpdateChecker(
    {
      servers: projects.map((project, index) => ({
        id: project.serverId,
        name: project.serverName,
        multicraftServerId: index + 1,
      })),
    },
    {
      discoverPluginProjects: () => projects,
      discoverCandidates: async () => {
        discoveries += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [
          {
            provider: "github",
            projectId: "plan-player-analytics/Plan",
            label: "GitHub · plan-player-analytics/Plan",
            url: "https://github.com/plan-player-analytics/Plan",
            score: 100,
          },
        ];
      },
    },
  );

  const results = await checker({ providers: { github: true } });
  assert.equal(discoveries, 1);
  assert.equal(results.length, 3);
  assert.ok(results.every((item) => item.candidates.length === 1));
  for (const project of projects) {
    const confirmed = checker.confirmSource({
      serverId: project.serverId,
      plugin: "Plan",
      provider: "github",
      projectId: "plan-player-analytics/Plan",
    });
    assert.equal(confirmed.source.projectId, "plan-player-analytics/Plan");
  }
});

test("check and download sources remain independent", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
          plugin: "Premium",
          currentVersion: "1.0.0",
          candidates: [
            { provider: "github", projectId: "owner/check", label: "Check" },
          ],
        },
      ]),
    },
    {
      fetch: async () => ({
        ok: true,
        json: async () => ({ tag_name: "1.0.0" }),
      }),
    },
  );
  await checker();
  const check = checker.confirmSource({
    serverId: "smp",
    plugin: "Premium",
    provider: "github",
    projectId: "owner/check",
  });
  const download = checker.confirmSource({
    serverId: "smp",
    plugin: "Premium",
    provider: "builtByBit",
    projectId: "12345",
    role: "download",
    url: "https://builtbybit.com/resources/12345/",
  });
  const overrides = {
    [check.key]: { check: check.source, download: download.source },
  };
  const results = await checker({ sourceOverrides: overrides });
  assert.equal(results[0].provider, "github");
  assert.equal(results[0].downloadProvider, "builtByBit");
  assert.equal(results[0].downloadProjectId, "12345");
  assert.equal(results[0].downloadSourceConfirmed, true);
  assert.equal(results[0].status, "current");
});

test("GitHub check source does not implicitly confirm a download source", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
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
        json: async () => ({
          tag_name: "1.1.0",
          html_url: "https://github.com/owner/repo/releases/tag/1.1.0",
          assets: [
            {
              name: "Example-1.1.0.jar",
              browser_download_url:
                "https://github.com/owner/repo/releases/download/1.1.0/Example.jar",
            },
          ],
        }),
      }),
    },
  );
  const result = (await checker())[0];
  assert.equal(result.downloadProvider, null);
  assert.equal(result.downloadProjectId, null);
  assert.equal(result.downloadSourceConfirmed, false);
  assert.equal(result.downloadUrl, null);
  assert.equal(result.downloadReview.status, "ready");
});

test("Modrinth check source does not implicitly confirm the primary JAR", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
          plugin: "Example",
          currentVersion: "1.0.0",
          gameVersion: "1.21.4",
          provider: "modrinth",
          projectId: "abc",
        },
      ]),
    },
    {
      fetch: async () => ({
        ok: true,
        json: async () => [
          {
            version_number: "1.2.0",
            version_type: "release",
            loaders: ["paper"],
            game_versions: ["1.21.4"],
            date_published: "2026-08-31T12:00:00Z",
            files: [
              { filename: "sources.jar", url: "https://cdn.test/sources.jar" },
              {
                filename: "Example.jar",
                url: "https://cdn.test/Example.jar",
                primary: true,
              },
            ],
          },
        ],
      }),
    },
  );
  const result = (await checker())[0];
  assert.equal(result.latestVersion, "1.2.0");
  assert.equal(result.downloadProvider, null);
  assert.equal(result.downloadSourceConfirmed, false);
  assert.equal(result.downloadUrl, null);
  assert.equal(result.downloadReview.status, "ready");
});

test("Modrinth chooses a stable compatible Bukkit release", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
          plugin: "Example",
          currentVersion: "1.0.0",
          gameVersion: "1.21.4",
          provider: "modrinth",
          projectId: "abc",
        },
      ]),
    },
    {
      fetch: async () => ({
        ok: true,
        json: async () => [
          {
            version_number: "2.2.0+fabric",
            version_type: "release",
            loaders: ["fabric"],
            game_versions: ["1.21.4"],
            date_published: "2026-09-04T12:00:00Z",
            files: [],
          },
          {
            version_number: "2.1.0-beta",
            version_type: "beta",
            loaders: ["paper", "spigot"],
            game_versions: ["1.21.4"],
            date_published: "2026-09-03T12:00:00Z",
            files: [],
          },
          {
            version_number: "2.0.0",
            version_type: "release",
            loaders: ["paper", "spigot"],
            game_versions: ["1.21.5"],
            date_published: "2026-09-02T12:00:00Z",
            files: [],
          },
          {
            version_number: "1.8.0",
            version_type: "release",
            loaders: ["bukkit", "paper"],
            game_versions: ["1.21.4"],
            date_published: "2026-09-01T12:00:00Z",
            files: [],
          },
        ],
      }),
    },
  );
  const result = (await checker())[0];
  assert.equal(result.gameVersion, "1.21.4");
  assert.equal(result.latestVersion, "1.8.0");
  assert.equal(result.status, "updateAvailable");
});

test("Paper inventory supplies the Minecraft version for Modrinth plugin filtering", async () => {
  const checker = createUpdateChecker(
    {
      servers: [
        { id: "smp", name: "SMP", multicraftServerId: 7 },
      ],
    },
    {
      discoverUpdateProjects: () => [
        {
          serverId: "smp",
          serverName: "SMP",
          plugin: "Example",
          kind: "plugin",
          currentVersion: "1.0.0",
          gameVersion: null,
          provider: "modrinth",
          projectId: "abc",
          sourceConfirmed: true,
          candidates: [],
          url: "https://modrinth.com/plugin/example",
        },
        {
          serverId: "smp",
          serverName: "SMP",
          plugin: "Paper",
          kind: "paper",
          currentVersion: "1.21.4+build.123",
          platformVersion: "1.21.4",
          provider: "paperMC",
          projectId: "paper",
          sourceConfirmed: true,
          candidates: [],
          url: null,
        },
      ],
      fetch: async () => ({
        ok: true,
        json: async () => [
          {
            version_number: "1.8.0",
            version_type: "release",
            loaders: ["paper"],
            game_versions: ["1.21.4"],
            date_published: "2026-09-01T12:00:00Z",
            files: [],
          },
        ],
      }),
    },
  );
  const result = await checker({
    providers: { modrinth: true, paperMC: false },
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].plugin, "Example");
  assert.equal(result[0].gameVersion, "1.21.4");
  assert.equal(result[0].latestVersion, "1.8.0");
  assert.equal(result[0].status, "updateAvailable");
});


test("missing plugin game version can be resolved once per server", async () => {
  let resolutions = 0;
  const checker = createUpdateChecker(
    {
      servers: [{ id: "smp", name: "SMP", multicraftServerId: 7 }],
      projectsJson: JSON.stringify([
        {
          serverId: "smp",
          plugin: "Example",
          currentVersion: "1.0.0",
          provider: "modrinth",
          projectId: "abc",
        },
      ]),
    },
    {
      discoverPluginProjects: () => [
        {
          serverId: "smp",
          serverName: "SMP",
          plugin: "Example",
          kind: "plugin",
          currentVersion: "1.0.0",
          gameVersion: null,
          provider: null,
          projectId: "",
          candidates: [],
        },
      ],
      resolveGameVersion: async () => { resolutions += 1; return "1.21.4"; },
      fetch: async () => ({
        ok: true,
        json: async () => [
          {
            version_number: "1.1.0",
            version_type: "release",
            loaders: ["paper"],
            game_versions: ["1.21.4"],
            date_published: "2026-10-01T00:00:00Z",
            files: [],
          },
        ],
      }),
    },
  );
  const result = (await checker())[0];
  assert.equal(resolutions, 1);
  assert.equal(result.gameVersion, "1.21.4");
  assert.equal(result.status, "updateAvailable");
});

test("Modrinth follows beta updates only when the installed plugin is already beta", async () => {
  async function run(currentVersion) {
    const checker = createUpdateChecker(
      {
        projectsJson: JSON.stringify([
          {
            serverId: "smp",
            plugin: "Dynmap",
            currentVersion,
            gameVersion: "1.20.4",
            provider: "modrinth",
            projectId: "dynmap",
          },
        ]),
      },
      {
        fetch: async () => ({
          ok: true,
          json: async () => [
            {
              version_number: "3.7-beta-8",
              version_type: "beta",
              loaders: ["paper", "spigot"],
              game_versions: ["1.20.4"],
              date_published: "2026-10-01T00:00:00Z",
              files: [],
            },
            {
              version_number: "3.6.1",
              version_type: "release",
              loaders: ["paper", "spigot"],
              game_versions: ["1.20.4"],
              date_published: "2025-01-01T00:00:00Z",
              files: [],
            },
          ],
        }),
      },
    );
    return (await checker())[0];
  }
  const beta = await run("3.7-beta-4-935");
  assert.equal(beta.latestVersion, "3.7-beta-8");
  const stable = await run("3.6.0");
  assert.equal(stable.latestVersion, "3.6.1");
});

test("Spigot download review keeps free JARs manual and premium JARs authenticated", async () => {
  async function run(premium) {
    const checker = createUpdateChecker(
      {
        projectsJson: JSON.stringify([
          {
            serverId: "smp",
            plugin: premium ? "PremiumShop" : "FreePlugin",
            currentVersion: "1.0.0",
            provider: "spigot",
            projectId: premium ? "999" : "123",
          },
        ]),
      },
      {
        fetch: async (url) => ({
          ok: true,
          json: async () =>
            url.endsWith("/versions/latest")
              ? { name: "1.1.0" }
              : {
                  premium,
                  external: false,
                  file: { type: ".jar" },
                },
        }),
      },
    );
    return (await checker())[0];
  }

  const free = await run(false);
  assert.equal(free.status, "updateAvailable");
  assert.equal(free.downloadReview.status, "manual");
  assert.equal(free.downloadSourceConfirmed, false);
  assert.equal(free.downloadUrl, null);

  const premium = await run(true);
  assert.equal(premium.status, "updateAvailable");
  assert.equal(premium.downloadReview.status, "authenticated");
  assert.equal(premium.downloadUrl, null);
});

test("confirmed Spigot download source resolves Spiget artifact and stays manual-only", async () => {
  const checker = createUpdateChecker(
    {
      projectsJson: JSON.stringify([
        {
          serverId: "skeerekippen",
          plugin: "CMILib",
          currentVersion: "1.5.9.7",
          provider: "spigot",
          projectId: "87610",
          candidates: [
            {
              provider: "spigot",
              projectId: "87610",
              label: "Spigot · CMILib",
              url: "https://www.spigotmc.org/resources/87610/",
            },
          ],
        },
      ]),
    },
    {
      fetch: async (url) => ({
        ok: true,
        json: async () =>
          url.endsWith("/versions/latest")
            ? { name: "1.6.0.1" }
            : {
                premium: false,
                external: false,
                file: { type: ".jar" },
              },
      }),
    },
  );
  await checker();
  const confirmed = checker.confirmSource({
    serverId: "skeerekippen",
    plugin: "CMILib",
    provider: "spigot",
    projectId: "87610",
    role: "download",
  });
  assert.deepEqual(confirmed.source, {
    provider: "spigot",
    projectId: "87610",
  });
  const result = (
    await checker({
      sourceOverrides: {
        [confirmed.key]: { download: confirmed.source },
      },
    })
  )[0];
  assert.equal(
    result.downloadUrl,
    "https://api.spiget.org/v2/resources/87610/download",
  );
  assert.equal(result.downloadReview.status, "manual");
});

test("download confirmation does not remember a project page as an artifact URL", async () => {
  const checker = createUpdateChecker(
    {},
    {
      discoverPluginProjects: () => [
        {
          serverId: "smp",
          serverName: "SMP",
          plugin: "Example",
          kind: "plugin",
          currentVersion: "1.0.0",
          provider: null,
          projectId: "",
          sourceConfirmed: false,
          candidates: [
            {
              provider: "modrinth",
              projectId: "abc",
              label: "Modrinth · Example",
              url: "https://modrinth.com/plugin/example",
            },
          ],
          url: null,
          gameVersion: "1.21.11",
        },
      ],
      fetch: async () => ({ ok: true, json: async () => [] }),
    },
  );
  await checker();
  const confirmed = checker.confirmSource({
    serverId: "smp",
    plugin: "Example",
    provider: "modrinth",
    projectId: "abc",
    role: "download",
  });
  assert.deepEqual(confirmed.source, {
    provider: "modrinth",
    projectId: "abc",
  });
});

test("confirmed Modrinth download source resolves the direct artifact instead of the project page", async () => {
  const checker = createUpdateChecker(
    {},
    {
      discoverPluginProjects: () => [
        {
          serverId: "smp",
          serverName: "SMP",
          plugin: "Example",
          kind: "plugin",
          currentVersion: "1.0.0",
          provider: "modrinth",
          projectId: "abc",
          sourceConfirmed: true,
          candidates: [
            {
              provider: "modrinth",
              projectId: "abc",
              label: "Modrinth · Example",
              url: "https://modrinth.com/plugin/example",
            },
          ],
          url: "https://modrinth.com/plugin/example",
          gameVersion: "1.21.11",
        },
      ],
      fetch: async () => ({
        ok: true,
        json: async () => [
          {
            version_number: "1.1.0",
            version_type: "release",
            loaders: ["paper"],
            game_versions: ["1.21.11"],
            files: [
              {
                filename: "Example.jar",
                url: "https://cdn.modrinth.test/Example.jar",
                primary: true,
              },
            ],
          },
        ],
      }),
    },
  );
  await checker();
  const confirmed = checker.confirmSource({
    serverId: "smp",
    plugin: "Example",
    provider: "modrinth",
    projectId: "abc",
    role: "download",
  });
  assert.deepEqual(confirmed.source, {
    provider: "modrinth",
    projectId: "abc",
  });
  const result = (
    await checker({
      sourceOverrides: {
        [confirmed.key]: { download: confirmed.source },
      },
    })
  )[0];
  assert.equal(result.downloadUrl, "https://cdn.modrinth.test/Example.jar");
  assert.equal(result.downloadReview.status, "ready");
});

test("manual download URL never becomes automatic-ready", async () => {
  const checker = createUpdateChecker(
    {},
    {
      discoverPluginProjects: () => [
        {
          serverId: "smp",
          serverName: "SMP",
          plugin: "Example",
          kind: "plugin",
          currentVersion: "1.0.0",
          provider: "modrinth",
          projectId: "abc",
          sourceConfirmed: true,
          candidates: [],
          url: "https://modrinth.com/plugin/example",
          gameVersion: "1.21.11",
        },
      ],
      fetch: async () => ({
        ok: true,
        json: async () => [
          {
            version_number: "1.1.0",
            version_type: "release",
            loaders: ["paper"],
            game_versions: ["1.21.11"],
            files: [
              {
                filename: "Example.jar",
                url: "https://cdn.modrinth.test/Example.jar",
                primary: true,
              },
            ],
          },
        ],
      }),
    },
  );
  const result = (
    await checker({
      sourceOverrides: {
        ["smp\u0000Example"]: {
          download: {
            provider: "modrinth",
            projectId: "abc",
            url: "https://example.test/manually-entered.jar",
          },
        },
      },
    })
  )[0];
  assert.equal(result.downloadUrl, "https://example.test/manually-entered.jar");
  assert.equal(result.downloadReview.status, "manual");
});

test("automatic Paper inventory reaches Update Center without configured projects", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "admincraft-platform-checker-"),
  );
  try {
    const server = path.join(root, "server9");
    fs.mkdirSync(server, { recursive: true });
    writeStoredZip(
      path.join(server, "paper.jar"),
      "META-INF/MANIFEST.MF",
      "Main-Class: io.papermc.paperclip.Main\nImplementation-Version: 1.21.10-48\n",
    );
    const checker = createUpdateChecker(
      {
        servers: [
          { id: "new-server", name: "New server", multicraftServerId: 9 },
        ],
        sourceRoot: root,
        platformRoots: [],
      },
      {
        fetch: async (url) => {
          if (url.endsWith("/projects/paper")) {
            return {
              ok: true,
              json: async () => ({ versions: { current: ["1.21.11"] } }),
            };
          }
          assert.match(url, /\/projects\/paper\/versions\/1\.21\.10\/builds$/u);
          return {
            ok: true,
            json: async () => [
              {
                id: 49,
                channel: "STABLE",
                downloads: {
                  "server:default": { url: "https://fill-data.test/paper.jar" },
                },
              },
            ],
          };
        },
      },
    );
    const result = (await checker())[0];
    assert.equal(result.serverId, "new-server");
    assert.equal(result.kind, "paper");
    assert.equal(result.currentVersion, "1.21.10+build.48");
    assert.equal(result.latestVersion, "1.21.10+build.49");
    assert.equal(result.status, "updateAvailable");
    assert.equal(result.downloadUrl, "https://fill-data.test/paper.jar");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
