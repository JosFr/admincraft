function canonicalProvider(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return {
    hangar: "hangar",
    modrinth: "modrinth",
    spigot: "spigot",
    builtbybit: "builtByBit",
    github: "github",
  }[normalized] || null;
}

function parseProjects(raw = process.env.UPDATE_PROJECTS_JSON || "") {
  if (!String(raw).trim()) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("UPDATE_PROJECTS_JSON must be an array.");
  return parsed.map((entry) => ({
    serverId: String(entry.serverId || "").trim(),
    serverName: String(entry.serverName || entry.serverId || "Server").trim(),
    plugin: String(entry.plugin || "").trim(),
    currentVersion: String(entry.currentVersion || "").trim(),
    provider: canonicalProvider(entry.provider),
    projectId: String(entry.projectId || "").trim(),
    url: entry.url ? String(entry.url) : null,
  })).filter((entry) => entry.serverId && entry.plugin && entry.provider && entry.projectId);
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
  if (!a || !b) return String(left).localeCompare(String(right), undefined, { numeric: true });
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
    headers: { Accept: "application/json", "User-Agent": "Admincraft-RC4", ...headers },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function latestFor(project, fetchImpl) {
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
    const sorted = [...data].sort((a, b) =>
      Date.parse(b.date_published || 0) - Date.parse(a.date_published || 0));
    return {
      version: sorted[0].version_number || sorted[0].name,
      url: project.url,
    };
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
    return {
      version: release.name,
      url: project.url,
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

function createUpdateChecker(config = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetch || fetch;
  const projects = parseProjects(config.projectsJson || process.env.UPDATE_PROJECTS_JSON || "");
  return async ({ providers = {}, serverId = null } = {}) => {
    const selected = projects.filter((project) => !serverId || project.serverId === serverId);
    const results = [];
    for (const project of selected) {
      if (!providerEnabled(providers, project.provider)) continue;
      try {
        const latest = await latestFor(project, fetchImpl);
        const current = project.currentVersion;
        const latestVersion = String(latest.version || "").trim();
        const status = !current || !latestVersion
          ? "unmanaged"
          : compareVersions(current, latestVersion) < 0
            ? "updateAvailable"
            : "current";
        results.push({
          serverId: project.serverId,
          serverName: project.serverName,
          plugin: project.plugin,
          currentVersion: current,
          latestVersion: latestVersion || null,
          provider: project.provider,
          projectId: project.projectId,
          status,
          url: latest.url || project.url,
        });
      } catch (_) {
        results.push({
          serverId: project.serverId,
          serverName: project.serverName,
          plugin: project.plugin,
          currentVersion: project.currentVersion,
          latestVersion: null,
          provider: project.provider,
          projectId: project.projectId,
          status: "sourceUnavailable",
          url: project.url,
        });
      }
    }
    return results;
  };
}

module.exports = {
  canonicalProvider,
  compareVersions,
  createUpdateChecker,
  latestFor,
  parseProjects,
};
