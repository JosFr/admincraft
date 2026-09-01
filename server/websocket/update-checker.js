const { discoverPluginProjects } = require("./plugin-inventory");
const { discoverPlatformProjects } = require("./platform-inventory");
const { discoverCandidates } = require("./update-discovery");

function canonicalProvider(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    {
      hangar: "hangar",
      modrinth: "modrinth",
      spigot: "spigot",
      builtbybit: "builtByBit",
      github: "github",
      papermc: "paperMC",
      paper: "paperMC",
    }[normalized] || null
  );
}

function canonicalKind(value) {
  const normalized = String(value || "plugin")
    .trim()
    .toLowerCase();
  if (["paper", "velocity", "platform"].includes(normalized)) return normalized;
  return "plugin";
}

function projectKey(serverId, plugin) {
  return `${String(serverId)}\u0000${String(plugin)}`;
}

function mergeProjects(configured, discovered) {
  const merged = new Map();
  for (const project of discovered)
    merged.set(projectKey(project.serverId, project.plugin), project);
  for (const project of configured) {
    const key = projectKey(project.serverId, project.plugin);
    const live = merged.get(key);
    merged.set(key, {
      ...live,
      ...project,
      currentVersion: live?.currentVersion || project.currentVersion,
      candidates: project.candidates || [],
    });
  }
  return [...merged.values()];
}

async function mapLimit(values, limit, task) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, worker),
  );
  return results;
}

function normalizeCandidate(value, index) {
  const provider = canonicalProvider(value?.provider);
  const projectId = String(value?.projectId || "").trim();
  if (!provider || !projectId) {
    throw new Error(`Invalid update source candidate at index ${index}.`);
  }
  return {
    provider,
    projectId,
    label: String(value?.label || `${provider}: ${projectId}`).trim(),
    url: value?.url ? String(value.url) : null,
  };
}

function parseProjects(raw = process.env.UPDATE_PROJECTS_JSON || "") {
  if (!String(raw).trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed))
    throw new Error("UPDATE_PROJECTS_JSON must be an array.");
  return parsed
    .map((entry, index) => {
      const serverId = String(entry?.serverId || "").trim();
      const plugin = String(entry?.plugin || "").trim();
      if (!serverId || !plugin) return null;
      const kind = canonicalKind(entry.kind);
      let provider = canonicalProvider(entry.provider);
      let projectId = String(entry.projectId || "").trim();
      if (
        !provider &&
        !projectId &&
        (kind === "paper" || kind === "velocity")
      ) {
        provider = "paperMC";
        projectId = kind;
      }
      if ((provider && !projectId) || (!provider && projectId)) {
        throw new Error(`Incomplete update source at index ${index}.`);
      }
      const rawCandidates = Array.isArray(entry.candidates)
        ? entry.candidates
        : [];
      const candidates = rawCandidates.map(normalizeCandidate);
      return {
        serverId,
        serverName: String(
          entry.serverName || entry.serverId || "Server",
        ).trim(),
        plugin,
        kind,
        currentVersion: String(entry.currentVersion || "").trim(),
        provider,
        projectId,
        sourceConfirmed: Boolean(provider && projectId),
        candidates,
        url: entry.url ? String(entry.url) : null,
        downloadProvider: canonicalProvider(entry.downloadProvider),
        downloadProjectId: String(entry.downloadProjectId || "").trim(),
        downloadUrl: entry.downloadUrl ? String(entry.downloadUrl) : null,
      };
    })
    .filter(Boolean);
}

function versionParts(value) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^v/iu, "");
  const match = /^(\d+(?:\.\d+)*)(?:[-+](.*))?$/u.exec(cleaned);
  if (!match) return null;
  return {
    numbers: match[1].split(".").map((part) => Number.parseInt(part, 10)),
    prerelease: match[2] || null,
  };
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) {
    return String(left).localeCompare(String(right), undefined, {
      numeric: true,
    });
  }
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const av = a.numbers[index] || 0;
    const bv = b.numbers[index] || 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease == null) return 1;
  if (b.prerelease == null) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

async function fetchJson(fetchImpl, url, headers = {}) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Admincraft/2.0.0 (https://github.com/JosFr/admincraft)",
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function latestPaperMcStable(project, fetchImpl) {
  const current = platformVersionInfo(project.currentVersion);
  let versions;
  if (
    project.kind === "paper" &&
    (project.platformVersion || current?.version)
  ) {
    versions = [String(project.platformVersion || current.version)];
  } else {
    const projectData = await fetchJson(
      fetchImpl,
      `https://fill.papermc.io/v3/projects/${encodeURIComponent(project.projectId)}`,
    );
    const groups =
      projectData?.versions && typeof projectData.versions === "object"
        ? Object.values(projectData.versions)
        : [];
    versions = [
      ...new Set(
        groups.flatMap((group) => (Array.isArray(group) ? group : [])),
      ),
    ]
      .map(String)
      .sort(compareVersions)
      .reverse();
  }
  for (const platformVersion of versions.slice(0, 8)) {
    const builds = await fetchJson(
      fetchImpl,
      `https://fill.papermc.io/v3/projects/${encodeURIComponent(project.projectId)}/versions/${encodeURIComponent(platformVersion)}/builds`,
    );
    if (!Array.isArray(builds)) continue;
    const stable = builds
      .filter(
        (build) => String(build?.channel || "").toUpperCase() === "STABLE",
      )
      .sort(
        (a, b) =>
          Number(b?.id ?? b?.number ?? 0) - Number(a?.id ?? a?.number ?? 0),
      )[0];
    if (!stable) continue;
    const build = Number(stable.id ?? stable.number);
    const download = stable.downloads?.["server:default"] || null;
    return {
      version: Number.isFinite(build)
        ? `${platformVersion}+build.${build}`
        : platformVersion,
      platformVersion,
      build: Number.isFinite(build) ? build : null,
      url: `https://papermc.io/software/${project.projectId}`,
      downloadUrl: download?.url || null,
    };
  }
  throw new Error("No stable PaperMC build returned.");
}

async function latestFor(project, fetchImpl, config = {}) {
  if (project.provider === "github") {
    const data = await fetchJson(
      fetchImpl,
      `https://api.github.com/repos/${project.projectId}/releases/latest`,
    );
    const jarAssets = Array.isArray(data.assets)
      ? data.assets.filter((asset) =>
          String(asset?.name || "")
            .toLowerCase()
            .endsWith(".jar"),
        )
      : [];
    const normalizedPlugin = String(project.plugin || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "");
    const preferred = jarAssets.find((asset) =>
      String(asset?.name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "")
        .includes(normalizedPlugin),
    );
    const artifact =
      preferred || (jarAssets.length === 1 ? jarAssets[0] : null);
    return {
      version: data.tag_name || data.name,
      url: data.html_url || project.url,
      downloadUrl: artifact?.browser_download_url || null,
    };
  }
  if (project.provider === "modrinth") {
    const data = await fetchJson(
      fetchImpl,
      `https://api.modrinth.com/v2/project/${encodeURIComponent(project.projectId)}/version?include_changelog=false`,
    );
    if (!Array.isArray(data) || data.length === 0)
      throw new Error("No versions returned.");
    const sorted = [...data].sort(
      (a, b) =>
        Date.parse(b.date_published || 0) - Date.parse(a.date_published || 0),
    );
    const latest = sorted[0];
    const files = Array.isArray(latest.files) ? latest.files : [];
    const artifact =
      files.find((file) => file?.primary === true) ||
      files.find((file) =>
        String(file?.filename || "")
          .toLowerCase()
          .endsWith(".jar"),
      ) ||
      null;
    return {
      version: latest.version_number || latest.name,
      url: project.url,
      downloadUrl: artifact?.url || null,
    };
  }
  if (project.provider === "spigot") {
    const data = await fetchJson(
      fetchImpl,
      `https://api.spiget.org/v2/resources/${encodeURIComponent(project.projectId)}/versions/latest`,
    );
    return {
      version: data.name,
      url:
        project.url ||
        `https://www.spigotmc.org/resources/${project.projectId}/`,
      downloadUrl: `https://api.spiget.org/v2/resources/${encodeURIComponent(project.projectId)}/download`,
    };
  }
  if (project.provider === "hangar") {
    const data = await fetchJson(
      fetchImpl,
      `https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(project.projectId)}/versions`,
    );
    const versions = Array.isArray(data?.result) ? data.result : [];
    const release =
      versions.find(
        (item) => String(item?.channel?.name || "").toLowerCase() === "release",
      ) || versions[0];
    if (!release) throw new Error("No versions returned.");
    return { version: release.name, url: project.url };
  }
  if (project.provider === "builtByBit") {
    const token = String(
      config.builtByBitApiToken || process.env.BUILTBYBIT_API_TOKEN || "",
    ).trim();
    if (!token) throw new Error("BuiltByBit API token is not configured.");
    const tokenType = String(
      config.builtByBitApiTokenType ||
        process.env.BUILTBYBIT_API_TOKEN_TYPE ||
        "Private",
    ).trim();
    if (!["Private", "Shared"].includes(tokenType)) {
      throw new Error("BuiltByBit API token type must be Private or Shared.");
    }
    const data = await fetchJson(
      fetchImpl,
      `https://api.builtbybit.com/v1/resources/${encodeURIComponent(project.projectId)}/versions/latest`,
      { Authorization: `${tokenType} ${token}` },
    );
    const version = data?.data || data;
    return {
      version: version?.name || version?.version || version?.title,
      url:
        project.url || `https://builtbybit.com/resources/${project.projectId}/`,
    };
  }
  if (project.provider === "paperMC") {
    return latestPaperMcStable(project, fetchImpl);
  }
  throw new Error("Provider requires manual or authenticated checking.");
}
function providerEnabled(providers, provider) {
  for (const [key, value] of Object.entries(providers || {})) {
    if (canonicalProvider(key) === provider) return value !== false;
  }
  return true;
}

function publicCandidates(project) {
  return project.candidates.map((candidate) => ({ ...candidate }));
}

function overrideSource(rawOverride, role = "check") {
  if (!rawOverride || typeof rawOverride !== "object") return null;
  if (role === "check")
    return rawOverride.check || (rawOverride.provider ? rawOverride : null);
  return rawOverride.download || null;
}

function sourceFor(project, overrides = {}, role = "check") {
  const raw = overrides[projectKey(project.serverId, project.plugin)];
  const override = overrideSource(raw, role);
  if (override) {
    const provider = canonicalProvider(override.provider);
    const projectId = String(override.projectId || "").trim();
    if (provider && projectId) {
      const candidate = project.candidates.find(
        (item) => item.provider === provider && item.projectId === projectId,
      );
      return {
        provider,
        projectId,
        url: override.url || candidate?.url || project.url || null,
        sourceConfirmed: true,
      };
    }
  }
  if (role === "download") {
    const provider = canonicalProvider(project.downloadProvider);
    const projectId = String(project.downloadProjectId || "").trim();
    return provider && projectId
      ? { provider, projectId, url: project.downloadUrl, sourceConfirmed: true }
      : null;
  }
  return project.provider && project.projectId ? project : null;
}

function platformVersionInfo(value) {
  const match = /^(\d+(?:\.\d+)*)(?:\+build\.(\d+))?/u.exec(
    String(value || "").trim(),
  );
  return match
    ? { version: match[1], build: match[2] ? Number(match[2]) : null }
    : null;
}

function updateStatus(project, latest) {
  const latestVersion = String(latest?.version || "").trim();
  if (!project.currentVersion || !latestVersion) return "unmanaged";
  if (["paper", "velocity"].includes(project.kind)) {
    const current = platformVersionInfo(project.currentVersion);
    const newest = platformVersionInfo(latestVersion);
    if (!current || !newest) return "unmanaged";
    const versionCompare = compareVersions(current.version, newest.version);
    if (versionCompare < 0) return "updateAvailable";
    if (versionCompare > 0) return "current";
    if (current.build == null || newest.build == null) return "unmanaged";
    return current.build < newest.build ? "updateAvailable" : "current";
  }
  return compareVersions(project.currentVersion, latestVersion) < 0
    ? "updateAvailable"
    : "current";
}

function baseResult(project, source = null, downloadSource = null) {
  return {
    serverId: project.serverId,
    serverName: project.serverName,
    plugin: project.plugin,
    kind: project.kind,
    currentVersion: project.currentVersion,
    latestVersion: null,
    provider: source?.provider || null,
    projectId: source?.projectId || null,
    sourceConfirmed: source?.sourceConfirmed === true,
    candidates: publicCandidates(project),
    status: "unmanaged",
    url: source?.url || project.url,
    downloadProvider: downloadSource?.provider || null,
    downloadProjectId: downloadSource?.projectId || null,
    downloadSourceConfirmed: downloadSource?.sourceConfirmed === true,
    downloadUrl: downloadSource?.url || null,
  };
}

function createUpdateChecker(config = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetch || fetch;
  const inventoryDiscovery =
    dependencies.discoverUpdateProjects ||
    dependencies.discoverPluginProjects ||
    ((options) => [
      ...discoverPluginProjects(options),
      ...discoverPlatformProjects({
        ...options,
        platformRoots: config.platformRoots,
      }),
    ]);
  const candidateDiscovery =
    dependencies.discoverCandidates || discoverCandidates;
  const configuredProjects = parseProjects(
    config.projectsJson || process.env.UPDATE_PROJECTS_JSON || "",
  );
  const servers = Array.isArray(config.servers) ? config.servers : [];
  const sourceRoot = String(
    config.sourceRoot ||
      process.env.MANAGEMENT_NATIVE_SOURCE_ROOT ||
      "/minecraft",
  ).trim();
  const checkerConfig = {
    builtByBitApiToken:
      config.builtByBitApiToken || process.env.BUILTBYBIT_API_TOKEN || "",
    builtByBitApiTokenType:
      config.builtByBitApiTokenType ||
      process.env.BUILTBYBIT_API_TOKEN_TYPE ||
      "Private",
  };
  const candidateCache = new Map();
  let lastProjects = configuredProjects;

  function providerFingerprint(providers) {
    return Object.entries(providers || {})
      .map(([key, value]) => [canonicalProvider(key) || key, value !== false])
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, enabled]) => `${key}:${enabled}`)
      .join("|");
  }

  async function projectsFor(providers) {
    const discovered = inventoryDiscovery({ servers, sourceRoot });
    let projects = mergeProjects(configuredProjects, discovered);
    const providerKey = providerFingerprint(providers);
    projects = await mapLimit(projects, 3, async (project) => {
      if (
        project.kind !== "plugin" ||
        project.candidates.length > 0 ||
        (project.provider && project.projectId)
      )
        return project;
      const cacheKey = `${project.plugin.toLowerCase()}\u0000${providerKey}`;
      const cached = candidateCache.get(cacheKey);
      const current = Date.now();
      let candidates;
      if (cached && current - cached.at < 6 * 60 * 60 * 1000) {
        candidates = cached.candidates;
      } else {
        candidates = await candidateDiscovery(
          project.plugin,
          providers,
          fetchImpl,
          checkerConfig,
        );
        candidateCache.set(cacheKey, { at: current, candidates });
      }
      return { ...project, candidates };
    });
    lastProjects = projects;
    return projects;
  }

  async function check({
    providers = {},
    serverId = null,
    sourceOverrides = {},
  } = {}) {
    const projects = await projectsFor(providers);
    const selected = projects.filter(
      (project) => !serverId || project.serverId === serverId,
    );
    const results = [];
    for (const project of selected) {
      const source = sourceFor(project, sourceOverrides, "check");
      const explicitDownloadSource = sourceFor(
        project,
        sourceOverrides,
        "download",
      );
      const downloadSource = explicitDownloadSource || source;
      if (!source) {
        results.push(baseResult(project, null, explicitDownloadSource));
        continue;
      }
      if (!providerEnabled(providers, source.provider)) continue;
      try {
        const latest = await latestFor(
          { ...project, ...source },
          fetchImpl,
          checkerConfig,
        );
        const latestVersion = String(latest.version || "").trim();
        let resolvedDownloadSource = downloadSource;
        if (downloadSource) {
          let directUrl = explicitDownloadSource?.url || null;
          const sameSource =
            downloadSource.provider === source.provider &&
            downloadSource.projectId === source.projectId;
          if (!directUrl && sameSource) directUrl = latest.downloadUrl || null;
          if (!directUrl && !sameSource) {
            try {
              const downloadLatest = await latestFor(
                { ...project, ...downloadSource },
                fetchImpl,
                checkerConfig,
              );
              directUrl = downloadLatest.downloadUrl || null;
            } catch (_) {}
          }
          resolvedDownloadSource = { ...downloadSource, url: directUrl };
        }
        const status = updateStatus(project, latest);
        results.push({
          ...baseResult(project, source, resolvedDownloadSource),
          latestVersion: latestVersion || null,
          status,
          url: latest.url || source.url || project.url,
        });
      } catch (_) {
        results.push({
          ...baseResult(project, source, downloadSource),
          status: "sourceUnavailable",
        });
      }
    }
    return results;
  }

  check.confirmSource = ({
    serverId,
    plugin,
    provider,
    projectId,
    role = "check",
    url = null,
  }) => {
    const project = lastProjects.find(
      (item) =>
        item.serverId === String(serverId) && item.plugin === String(plugin),
    );
    if (!project)
      throw new Error("Update project not found. Run an update check first.");
    const canonical = canonicalProvider(provider);
    const targetId = String(projectId || "").trim();
    const normalizedRole = role === "download" ? "download" : "check";
    if (!canonical || !targetId) throw new Error("Invalid update source.");
    const candidate = project.candidates.find(
      (item) => item.provider === canonical && item.projectId === targetId,
    );
    if (
      normalizedRole === "check" &&
      !candidate &&
      project.candidates.length > 0
    ) {
      throw new Error("Update source is not one of the discovered candidates.");
    }
    return {
      key: projectKey(project.serverId, project.plugin),
      role: normalizedRole,
      source: {
        provider: canonical,
        projectId: targetId,
        ...(url || candidate?.url
          ? { url: String(url || candidate?.url) }
          : {}),
      },
    };
  };

  check.projects = () =>
    lastProjects.map((project) => ({
      serverId: project.serverId,
      plugin: project.plugin,
      kind: project.kind,
      currentVersion: project.currentVersion,
      candidates: publicCandidates(project),
    }));
  check.discover = projectsFor;
  return check;
}

module.exports = {
  canonicalProvider,
  compareVersions,
  createUpdateChecker,
  latestFor,
  parseProjects,
  projectKey,
};
