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

test("GitHub check source provides an inherited direct JAR download", async () => {
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
  assert.equal(result.downloadProvider, "github");
  assert.equal(result.downloadProjectId, "owner/repo");
  assert.equal(result.downloadSourceConfirmed, true);
  assert.match(result.downloadUrl, /Example\.jar$/u);
});

test("Modrinth check source exposes the primary JAR download", async () => {
  const checker = createUpdateChecker(
    {
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
      fetch: async () => ({
        ok: true,
        json: async () => [
          {
            version_number: "1.2.0",
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
  assert.equal(result.downloadProvider, "modrinth");
  assert.equal(result.downloadUrl, "https://cdn.test/Example.jar");
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
