function canonicalProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return {
    hangar: "hangar",
    modrinth: "modrinth",
    spigot: "spigot",
    builtbybit: "builtByBit",
    github: "github",
    papermc: "paperMC",
    paper: "paperMC",
  }[normalized] || null;
}

function canonicalKind(value) {
  const normalized = String(value || "plugin").trim().toLowerCase();
  if (["paper", "velocity", "platform"].includes(normalized)) return normalized;
  return "plugin";
}

function projectKey(serverId, plugin) {
  return `${String(serverId)}\u0000${String(plugin)}`;
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
  if (!Array.isArray(parsed)) throw new Error("UPDATE_PROJECTS_JSON must be an array.");
  return parsed.map((entry, index) => {
    const serverId = String(entry?.serverId || "").trim();
    const plugin = String(entry?.plugin || "").trim();
    if (!serverId || !plugin) return null;
    const kind = canonicalKind(entry.kind);
    let provider = canonicalProvider(entry.provider);
    let projectId = String(entry.projectId || "").trim();
    if (!provider && !projectId && (kind === "paper" || kind === "velocity")) {
      provider = "paperMC";
      projectId = kind;
    }
    if ((provider && !projectId) || (!provider && projectId)) {
      throw new Error(`Incomplete update source at index ${index}.`);
    }
    const rawCandidates = Array.isArray(entry.candidates) ? entry.candidates : [];
    const candidates = rawCandidates.map(normalizeCandidate);
    return {
      serverId,
      serverName: String(entry.serverName || entry.serverId || "Server").trim(),
      plugin,
      kind,
      currentVersion: String(entry.currentVersion || "").trim(),
      provider,
      projectId,
      sourceConfirmed: Boolean(provider && projectId),
      candidates,
      url: entry.url ? String(entry.url) : null,
    };
  }).filter(Boolean);
}

function versionParts(value) {
  const cleaned = String(value || "").trim().replace(/^v/iu, "");
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
    return String(left).localeCompare(String(right), undefined, { numeric: true });
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

function newestVersion(values) {
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort(compareVersions)
    .at(-1) || null;
}

async function latestFor(project, fetchImpl, config = {}) {
  if (project.provider === "github") {
    const data = await fetchJson(
      fetchImpl,
      `https://api.github.com/repos/${project.projectId}/releases/latest`,
    );
    return { version: data.tag_name || data.name, url: data.html_url || project.url };
  }
  if (project.provider === "modrinth") {
    const data = await fetchJson(
      fetchImpl,
      `https://api.modrinth.com/v2/project/${encodeURIComponent(project.projectId)}/version?include_changelog=false`,
    );
    if (!Array.isArray(data) || data.length === 0) throw new Error("No versions returned.");
    const sorted = [...data].sort(
      (a, b) => Date.parse(b.date_published || 0) - Date.parse(a.date_published || 0),
    );
    return { version: sorted[0].version_number || sorted[0].name, url: project.url };
  }
  if (project.provider === "spigot") {
    const data = await fetchJson(
      fetchImpl,
      `https://api.spiget.org/v2/resources/${encodeURIComponent(project.projectId)}/versions/latest`,
    );
    return {
      version: data.name,
      url: project.url || `https://www.spigotmc.org/resources/${project.projectId}/`,
    };
  }
  if (project.provider === "hangar") {
    const data = await fetchJson(
      fetchImpl,
      `https://hangar.papermc.io/api/v1/projects/${encodeURIComponent(project.projectId)}/versions`,
    );
    const versions = Array.isArray(data?.result) ? data.result : [];
    const release = versions.find((item) =>
      String(item?.channel?.name || "").toLowerCase() === "release") || versions[0];
    if (!release) throw new Error("No versions returned.");
    return { version: release.name, url: project.url };
  }
  if (project.provider === "builtByBit") {
    const token = String(
      config.builtByBitApiToken || process.env.BUILTBYBIT_API_TOKEN || "",
    ).trim();
    if (!token) throw new Error("BuiltByBit API token is not configured.");
    const tokenType = String(
      config.builtByBitApiTokenType || process.env.BUILTBYBIT_API_TOKEN_TYPE || "Private",
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
      url: project.url || `https://builtbybit.com/resources/${project.projectId}/`,
    };
  }
  if (project.provider === "paperMC") {
    const data = await fetchJson(
      fetchImpl,
      `https://fill.papermc.io/v3/projects/${encodeURIComponent(project.projectId)}`,
    );
    const groups = data?.versions && typeof data.versions === "object"
      ? Object.values(data.versions) : [];
    const versions = groups.flatMap((group) => Array.isArray(group) ? group : []);
    const latest = newestVersion(versions);
    if (!latest) throw new Error("No platform versions returned.");
    return {
      version: latest,
      url: project.url || `https://papermc.io/software/${project.projectId}`,
    };
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

function sourceFor(project, overrides = {}) {
  const override = overrides[projectKey(project.serverId, project.plugin)];
  if (override) {
    const provider = canonicalProvider(override.provider);
    const projectId = String(override.projectId || "").trim();
    if (provider && projectId) {
      const candidate = project.candidates.find(
        (item) => item.provider === provider && item.projectId === projectId,
      );
      return {
        ...project,
        provider,
        projectId,
        url: candidate?.url || project.url,
        sourceConfirmed: true,
      };
    }
  }
  if (project.provider && project.projectId) return project;
  return null;
}

function baseResult(project, source = null) {
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
  };
}

function createUpdateChecker(config = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetch || fetch;
  const projects = parseProjects(config.projectsJson || process.env.UPDATE_PROJECTS_JSON || "");
  const checkerConfig = {
    builtByBitApiToken:
      config.builtByBitApiToken || process.env.BUILTBYBIT_API_TOKEN || "",
    builtByBitApiTokenType:
      config.builtByBitApiTokenType || process.env.BUILTBYBIT_API_TOKEN_TYPE || "Private",
  };

  async function check({ providers = {}, serverId = null, sourceOverrides = {} } = {}) {
    const selected = projects.filter((project) => !serverId || project.serverId === serverId);
    const results = [];
    for (const project of selected) {
      const source = sourceFor(project, sourceOverrides);
      if (!source) {
        results.push(baseResult(project));
        continue;
      }
      if (!providerEnabled(providers, source.provider)) continue;
      try {
        const latest = await latestFor(source, fetchImpl, checkerConfig);
        const latestVersion = String(latest.version || "").trim();
        const status = !source.currentVersion || !latestVersion
          ? "unmanaged"
          : compareVersions(source.currentVersion, latestVersion) < 0
            ? "updateAvailable"
            : "current";
        results.push({
          ...baseResult(project, source),
          latestVersion: latestVersion || null,
          status,
          url: latest.url || source.url,
        });
      } catch (_) {
        results.push({
          ...baseResult(project, source),
          status: "sourceUnavailable",
        });
      }
    }
    return results;
  }

  check.confirmSource = ({ serverId, plugin, provider, projectId }) => {
    const project = projects.find(
      (item) => item.serverId === String(serverId) && item.plugin === String(plugin),
    );
    if (!project) throw new Error("Update project not found.");
    const canonical = canonicalProvider(provider);
    const targetId = String(projectId || "").trim();
    if (!canonical || !targetId) throw new Error("Invalid update source.");
    const candidate = project.candidates.find(
      (item) => item.provider === canonical && item.projectId === targetId,
    );
    if (!candidate && project.candidates.length > 0) {
      throw new Error("Update source is not one of the configured candidates.");
    }
    return {
      key: projectKey(project.serverId, project.plugin),
      source: { provider: canonical, projectId: targetId },
    };
  };
  check.projects = projects.map((project) => ({
    serverId: project.serverId,
    plugin: project.plugin,
    kind: project.kind,
    candidates: publicCandidates(project),
  }));
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
