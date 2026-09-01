function normalizedName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

function candidateScore(plugin, label) {
  const query = normalizedName(plugin);
  const target = normalizedName(label);
  if (!query || !target) return 0;
  if (query === target) return 100;
  if (target.startsWith(query) || query.startsWith(target)) return 80;
  if (target.includes(query) || query.includes(target)) return 60;
  return 10;
}

async function json(fetchImpl, url, headers = {}) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Admincraft/1.4.0-rc4",
      ...headers,
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
async function searchModrinth(plugin, fetchImpl) {
  const facets = JSON.stringify([["all_project_types:plugin"]]);
  const url = new URL("https://api.modrinth.com/v2/search");
  url.searchParams.set("query", plugin);
  url.searchParams.set("limit", "5");
  url.searchParams.set("facets", facets);
  const data = await json(fetchImpl, url);
  return (Array.isArray(data?.hits) ? data.hits : []).map((item) => ({
    provider: "modrinth",
    projectId: String(item.project_id || item.slug || ""),
    label: `Modrinth · ${item.title || item.slug || item.project_id}`,
    url: `https://modrinth.com/plugin/${item.slug || item.project_id}`,
    score: candidateScore(plugin, item.title || item.slug),
  }));
}

async function searchHangar(plugin, fetchImpl) {
  const url = new URL("https://hangar.papermc.io/api/v1/projects");
  url.searchParams.set("q", plugin);
  url.searchParams.set("limit", "5");
  const data = await json(fetchImpl, url);
  return (Array.isArray(data?.result) ? data.result : []).map((item) => {
    const slug = item?.namespace?.slug || item?.slug || item?.name;
    const owner = item?.namespace?.owner || item?.owner || "";
    return {
      provider: "hangar",
      projectId: String(slug || ""),
      label: `Hangar · ${item?.name || slug}${owner ? ` · ${owner}` : ""}`,
      url: owner && slug ? `https://hangar.papermc.io/${owner}/${slug}` : null,
      score: candidateScore(plugin, item?.name || slug),
    };
  });
}
async function searchSpigot(plugin, fetchImpl) {
  const url = new URL(
    `https://api.spiget.org/v2/search/resources/${encodeURIComponent(plugin)}`,
  );
  url.searchParams.set("size", "5");
  url.searchParams.set("sort", "-downloads");
  const data = await json(fetchImpl, url);
  return (Array.isArray(data) ? data : []).map((item) => ({
    provider: "spigot",
    projectId: String(item.id || ""),
    label: `Spigot · ${item.name || item.id}`,
    url: item.id ? `https://www.spigotmc.org/resources/${item.id}/` : null,
    score: candidateScore(plugin, item.name),
  }));
}

async function searchGitHub(plugin, fetchImpl) {
  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `${plugin} minecraft plugin`);
  url.searchParams.set("per_page", "5");
  const data = await json(fetchImpl, url);
  return (Array.isArray(data?.items) ? data.items : []).map((item) => ({
    provider: "github",
    projectId: String(item.full_name || ""),
    label: `GitHub · ${item.full_name || item.name}`,
    url: item.html_url || null,
    score: candidateScore(plugin, item.name || item.full_name),
  }));
}
async function searchBuiltByBit(plugin, fetchImpl, config = {}) {
  const token = String(config.builtByBitApiToken || "").trim();
  if (!token) return [];
  const tokenType = String(config.builtByBitApiTokenType || "Private").trim();
  if (tokenType !== "Private") return [];
  const data = await json(
    fetchImpl,
    "https://api.builtbybit.com/v1/resources/owned",
    { Authorization: `${tokenType} ${token}` },
  );
  const items = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
      ? data
      : [];
  return items
    .map((item) => ({
      provider: "builtByBit",
      projectId: String(item.id || item.resource_id || ""),
      label: `BuiltByBit · ${item.title || item.name || item.id}`,
      url: item.id ? `https://builtbybit.com/resources/${item.id}/` : null,
      score: candidateScore(plugin, item.title || item.name),
    }))
    .filter((item) => item.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate.projectId) return false;
    const key = `${candidate.provider}\u0000${candidate.projectId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function discoverCandidates(plugin, providers, fetchImpl, config = {}) {
  const jobs = [];
  const enabled = (name) => providers?.[name] !== false;
  if (enabled("modrinth")) jobs.push(searchModrinth(plugin, fetchImpl));
  if (enabled("hangar")) jobs.push(searchHangar(plugin, fetchImpl));
  if (enabled("spigot")) jobs.push(searchSpigot(plugin, fetchImpl));
  if (enabled("github")) jobs.push(searchGitHub(plugin, fetchImpl));
  if (enabled("builtByBit")) {
    jobs.push(searchBuiltByBit(plugin, fetchImpl, config));
  }
  const settled = await Promise.allSettled(jobs);
  return uniqueCandidates(
    settled.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
  )
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ score, ...candidate }) => candidate);
}

module.exports = {
  candidateScore,
  discoverCandidates,
  normalizedName,
  searchBuiltByBit,
  searchGitHub,
  searchHangar,
  searchModrinth,
  searchSpigot,
};
