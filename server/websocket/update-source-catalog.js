function normalizedPlugin(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "");
}

const READY = {
  afkdummy: ["modrinth", "PHiV6JLQ", "Modrinth · AfkDummy", "https://modrinth.com/plugin/afkdummy"],
  auctionhouse: ["modrinth", "scEbl04C", "Modrinth · Auction House Plugin", "https://modrinth.com/plugin/auction-house-plugin"],
  bluemap: ["modrinth", "swbUV1cr", "Modrinth · BlueMap", "https://modrinth.com/plugin/bluemap"],
  chunky: ["modrinth", "fALzjamp", "Modrinth · Chunky", "https://modrinth.com/plugin/chunky"],
  cmilib: ["spigot", "87610", "Spigot · CMILib", "https://www.spigotmc.org/resources/87610/"],
  commandapi: ["modrinth", "ExxvCi0y", "Modrinth · CommandAPI", "https://modrinth.com/plugin/commandapi"],
  coreprotect: ["modrinth", "Lu3KuzdV", "Modrinth · CoreProtect", "https://modrinth.com/plugin/coreprotect"],
  customworldheight: ["modrinth", "UF11NNft", "Modrinth · CustomWorldHeight", "https://modrinth.com/plugin/customworldheight"],
  discordsrv: ["github", "DiscordSRV/DiscordSRV", "GitHub · DiscordSRV/DiscordSRV", "https://github.com/DiscordSRV/DiscordSRV"],
  dynmap: ["modrinth", "fRQREgAc", "Modrinth · Dynmap", "https://modrinth.com/plugin/dynmap"],
  economyshopgui: ["spigot", "69927", "Spigot · EconomyShopGUI", "https://www.spigotmc.org/resources/69927/"],
};

const READY_MORE = {
  excellentshop: ["spigot", "50696", "Spigot · ExcellentShop", "https://www.spigotmc.org/resources/50696/"],
  fastchunkpregenerator: ["spigot", "74429", "Spigot · FastChunkPregenerator", "https://www.spigotmc.org/resources/74429/"],
  ipdynamic: ["modrinth", "fRqinjfY", "Modrinth · IPDynamic", "https://modrinth.com/plugin/ipdynamic"],
  nightcore: ["modrinth", "Y4NRwMW5", "Modrinth · nightcore", "https://modrinth.com/plugin/nightcore"],
  packetevents: ["modrinth", "HYKaKraK", "Modrinth · PacketEvents", "https://modrinth.com/plugin/packetevents"],
  placeholderapi: ["modrinth", "lKEzGugV", "Modrinth · PlaceholderAPI", "https://modrinth.com/plugin/placeholderapi"],
  tabtps: ["modrinth", "cUhi3iB2", "Modrinth · TabTPS", "https://modrinth.com/plugin/tabtps"],
  veinminer: ["modrinth", "OhduvhIc", "Modrinth · VeinMiner", "https://modrinth.com/plugin/veinminer"],
  veinminerenchantment: ["modrinth", "4sP0LXxp", "Modrinth · VeinMiner Enchantment", "https://modrinth.com/plugin/veinminer-enchantment"],
  webdavbackup: ["spigot", "119533", "Spigot · WebDavBackup", "https://www.spigotmc.org/resources/119533/"],
  worldedit: ["modrinth", "1u6JkXh5", "Modrinth · WorldEdit", "https://modrinth.com/plugin/worldedit"],
  worldguard: ["modrinth", "DKY9btbd", "Modrinth · WorldGuard", "https://modrinth.com/plugin/worldguard"],
};
const SPECIAL = {
  boostedtrees: ["BuiltByBit 76405", "Premium/authenticated distribution."],
  citizens: ["Citizens Jenkins", "Installed development build needs a Jenkins build channel."],
  cmi: ["Spigot 3742", "Premium plugin; authenticated download is separate."],
  floodgate: ["GeyserMC downloads API", "Installed snapshot needs the Geyser build channel."],
  geyserspigot: ["GeyserMC downloads API", "Installed snapshot needs the Geyser build channel."],
  guiadmintoolspremium: ["Spigot 109931", "Premium/authenticated download."],
  lpx: ["BuiltByBit 15709", "Premium/DRM distribution."],
  oraxen: ["Spigot 72448", "Premium plugin; download must remain licensed/authenticated."],
  protocollib: ["ProtocolLib development builds", "Installed snapshot should not be compared only with stable releases."],
  realtreefall: ["MipCraft/JernejTDO", "Premium source family known; exact provider ID still needs confirmation."],
  upgradeablehoppers: ["Angeschossen / voxel.shop", "Premium vendor is outside current providers."],
  vault: ["Zrips CMI Vault", "Installed 1.7.3-CMI is not the generic Vault project."],
};

const UNKNOWN = {
  admincraftweather: "Custom/private-looking plugin; no public source candidate.",
  customoregenerator: "Only unrelated low-confidence search results were found.",
  lobby: "Generic plugin name; an exact-name search result is not sufficient proof.",
  profanityfilter: "Several similarly named projects exist and the installed identity is ambiguous.",
};

const VERIFIED = { ...READY, ...READY_MORE };

function verifiedCandidate(plugin) {
  const entry = VERIFIED[normalizedPlugin(plugin)];
  if (!entry) return null;
  const [provider, projectId, label, url] = entry;
  return { provider, projectId, label, url, score: 120, verified: true };
}

function sourceReview(plugin) {
  const key = normalizedPlugin(plugin);
  const candidate = verifiedCandidate(plugin);
  if (candidate) {
    return { status: "ready", label: candidate.label, reason: "Verified project identity." };
  }
  if (SPECIAL[key]) {
    return { status: "special", label: SPECIAL[key][0], reason: SPECIAL[key][1] };
  }
  if (UNKNOWN[key]) {
    return { status: "unknown", label: null, reason: UNKNOWN[key] };
  }
  return null;
}

module.exports = { normalizedPlugin, sourceReview, verifiedCandidate };
