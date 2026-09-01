const fs = require("fs");
const path = require("path");
const { centralEntries, readZipEntry } = require("./plugin-inventory");

function manifestAttributes(text) {
  const unfolded = [];
  for (const line of String(text || "").split(/\r?\n/u)) {
    if (line.startsWith(" ") && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  const values = {};
  for (const line of unfolded) {
    const index = line.indexOf(":");
    if (index < 1) continue;
    values[line.slice(0, index).trim().toLowerCase()] = line
      .slice(index + 1)
      .trim();
  }
  return values;
}

function versionParts(text) {
  const value = String(text || "");
  const match = /(\d+(?:\.\d+){1,2})(?:[-+._](?:build[-+._]?)?(\d+))?/iu.exec(
    value,
  );
  return match
    ? { platformVersion: match[1], build: match[2] ? Number(match[2]) : null }
    : null;
}
function platformJarIdentity(file) {
  try {
    const buffer = fs.readFileSync(file);
    if (buffer.length < 22) return null;
    const entries = centralEntries(buffer);
    const manifest = entries.find(
      (entry) =>
        entry.name.replace(/^\.\//u, "").toLowerCase() ===
        "meta-inf/manifest.mf",
    );
    const attrs = manifest
      ? manifestAttributes(readZipEntry(buffer, manifest).toString("utf8"))
      : {};
    const evidence = [
      path.basename(file),
      attrs["main-class"],
      attrs["implementation-title"],
      attrs["implementation-vendor"],
      attrs["implementation-version"],
      ...entries.slice(0, 250).map((entry) => entry.name),
    ]
      .filter(Boolean)
      .join(" ");
    const kind = /velocitypowered|com\/velocitypowered|\bvelocity\b/iu.test(
      evidence,
    )
      ? "velocity"
      : /papermc|paperclip|io\/papermc|\bpaper\b/iu.test(evidence)
        ? "paper"
        : null;
    if (!kind) return null;
    const versionSources = [
      attrs["implementation-version"],
      attrs["specification-version"],
      attrs["bundle-version"],
      path.basename(file),
      evidence,
    ];
    const parsed = versionSources.map(versionParts).find(Boolean) || {};
    const currentVersion = parsed.platformVersion
      ? parsed.build != null
        ? `${parsed.platformVersion}+build.${parsed.build}`
        : parsed.platformVersion
      : "";
    return {
      kind,
      currentVersion,
      platformVersion: parsed.platformVersion || "",
      build: parsed.build ?? null,
    };
  } catch (_) {
    return null;
  }
}
function platformInDirectory(directory, expectedKind = null) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jar")) continue;
    const identity = platformJarIdentity(path.join(directory, entry.name));
    if (!identity || (expectedKind && identity.kind !== expectedKind)) continue;
    return { ...identity, jar: entry.name, directory };
  }
  return null;
}
function projectFromIdentity({ id, name, identity }) {
  const label = identity.kind === "velocity" ? "Velocity" : "Paper";
  return {
    serverId: id,
    serverName: name,
    plugin: label,
    kind: identity.kind,
    currentVersion: identity.currentVersion,
    provider: "paperMC",
    projectId: identity.kind,
    sourceConfirmed: true,
    candidates: [],
    url: null,
    platformVersion: identity.platformVersion,
    currentBuild: identity.build,
    inventory: { jar: identity.jar, directory: identity.directory },
  };
}
function parsePlatformRoots(
  raw = process.env.UPDATE_PLATFORM_ROOTS_JSON || "",
) {
  const roots = [];
  if (String(raw).trim()) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed))
      throw new Error("UPDATE_PLATFORM_ROOTS_JSON must be an array.");
    for (const [index, entry] of parsed.entries()) {
      const id = String(entry?.id || "").trim();
      const name = String(entry?.name || id || "Platform").trim();
      const kind = String(entry?.kind || "")
        .trim()
        .toLowerCase();
      const directory = String(entry?.path || "").trim();
      if (!id || !["paper", "velocity"].includes(kind) || !directory) {
        throw new Error(`Invalid platform root at index ${index}.`);
      }
      roots.push({ id, name, kind, directory });
    }
  }
  const velocityRoot = String(
    process.env.MANAGEMENT_VELOCITY_ROOT || "",
  ).trim();
  if (velocityRoot && !roots.some((root) => root.id === "velocity")) {
    roots.push({
      id: "velocity",
      name: "Velocity",
      kind: "velocity",
      directory: velocityRoot,
    });
  }
  return roots;
}
function discoverPlatformProjects({
  servers = [],
  sourceRoot = "/minecraft",
  platformRoots,
} = {}) {
  const projects = [];
  for (const server of servers) {
    const directory = path.join(
      sourceRoot,
      `server${server.multicraftServerId}`,
    );
    const identity = platformInDirectory(directory, "paper");
    if (identity)
      projects.push(
        projectFromIdentity({ id: server.id, name: server.name, identity }),
      );
  }
  const roots = platformRoots || parsePlatformRoots();
  for (const root of roots) {
    const identity = platformInDirectory(root.directory, root.kind);
    if (!identity) continue;
    const key = `${root.id}\u0000${root.kind}`;
    if (
      projects.some(
        (project) => `${project.serverId}\u0000${project.kind}` === key,
      )
    )
      continue;
    projects.push(
      projectFromIdentity({ id: root.id, name: root.name, identity }),
    );
  }
  return projects;
}

module.exports = {
  discoverPlatformProjects,
  manifestAttributes,
  parsePlatformRoots,
  platformInDirectory,
  platformJarIdentity,
  versionParts,
};
