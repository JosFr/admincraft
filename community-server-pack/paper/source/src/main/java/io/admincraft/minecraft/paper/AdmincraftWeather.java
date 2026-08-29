package io.admincraft.minecraft.paper;

import java.util.Locale;
import java.util.stream.Collectors;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

public final class AdmincraftWeather extends JavaPlugin {
    @Override
    public void onEnable() {
        getLogger().info("AdmincraftWeather 1.2.0-community-rc3 enabled.");
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (command.getName().equalsIgnoreCase("admincraftweather")) {
            sender.sendMessage("Weather: " + weather(primaryWorld()));
            return true;
        }
        if (command.getName().equalsIgnoreCase("admincraftstatus")) {
            sender.sendMessage("AdmincraftStatus: " + statusJson());
            return true;
        }
        return false;
    }

    private World primaryWorld() {
        return Bukkit.getWorlds().stream()
                .filter(w -> w.getEnvironment() == World.Environment.NORMAL)
                .findFirst()
                .orElse(Bukkit.getWorlds().isEmpty() ? null : Bukkit.getWorlds().get(0));
    }

    private String weather(World world) {
        if (world == null) return "unknown";
        if (world.isThundering()) return "thunder";
        if (world.hasStorm()) return "rain";
        return "clear";
    }

    private String names(java.util.Collection<? extends OfflinePlayer> players) {
        return players.stream()
                .map(OfflinePlayer::getName)
                .filter(name -> name != null && !name.isBlank())
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .map(this::quote)
                .collect(Collectors.joining(",", "[", "]"));
    }

    private String quote(String value) {
        if (value == null) return "null";
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\"";
    }

    private String number(double value) {
        return Double.isFinite(value) ? String.format(Locale.ROOT, "%.2f", value) : "null";
    }

    private String statusJson() {
        World world = primaryWorld();
        double[] tps = Bukkit.getTPS();
        double mspt = Bukkit.getAverageTickTime();
        String worldName = world == null ? null : world.getName();
        String difficulty = world == null ? null : world.getDifficulty().name().toLowerCase(Locale.ROOT);
        long daytime = world == null ? -1L : world.getTime();
        long seed = world == null ? 0L : world.getSeed();
        int chunks = world == null ? 0 : world.getLoadedChunks().length;
        int entities = world == null ? 0 : world.getEntities().size();
        String onlinePlayers = Bukkit.getOnlinePlayers().stream()
                .map(player -> player.getName())
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .map(this::quote)
                .collect(Collectors.joining(",", "[", "]"));
        String worlds = Bukkit.getWorlds().stream()
                .map(World::getName)
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .map(this::quote)
                .collect(Collectors.joining(",", "[", "]"));
        Plugin[] loadedPlugins = Bukkit.getPluginManager().getPlugins();
        String pluginNames = java.util.Arrays.stream(loadedPlugins)
                .map(plugin -> plugin.getName() + " " + plugin.getDescription().getVersion())
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .map(this::quote)
                .collect(Collectors.joining(",", "[", "]"));
        String disabledPlugins = java.util.Arrays.stream(loadedPlugins)
                .filter(plugin -> !plugin.isEnabled())
                .map(plugin -> plugin.getName())
                .sorted(String.CASE_INSENSITIVE_ORDER)
                .map(this::quote)
                .collect(Collectors.joining(",", "[", "]"));

        return "{" +
                "\"tps1m\":" + number(tps.length > 0 ? tps[0] : Double.NaN) + "," +
                "\"tps5m\":" + number(tps.length > 1 ? tps[1] : Double.NaN) + "," +
                "\"tps15m\":" + number(tps.length > 2 ? tps[2] : Double.NaN) + "," +
                "\"mspt\":" + number(mspt) + "," +
                "\"serverVersion\":" + quote(Bukkit.getVersion()) + "," +
                "\"bukkitVersion\":" + quote(Bukkit.getBukkitVersion()) + "," +
                "\"onlinePlayers\":" + onlinePlayers + "," +
                "\"playersOnline\":" + Bukkit.getOnlinePlayers().size() + "," +
                "\"playerLimit\":" + Bukkit.getMaxPlayers() + "," +
                "\"minecraftVersion\":" + quote(Bukkit.getMinecraftVersion()) + "," +
                "\"worldName\":" + quote(worldName) + "," +
                "\"worlds\":" + worlds + "," +
                "\"worldSeed\":" + (world == null ? "null" : quote(Long.toString(seed))) + "," +
                "\"loadedChunks\":" + (world == null ? "null" : Integer.toString(chunks)) + "," +
                "\"entityCount\":" + (world == null ? "null" : Integer.toString(entities)) + "," +
                "\"daytime\":" + (world == null ? "null" : Long.toString(daytime)) + "," +
                "\"weather\":" + quote(weather(world)) + "," +
                "\"difficulty\":" + quote(difficulty) + "," +
                "\"whitelistEnabled\":" + Bukkit.hasWhitelist() + "," +
                "\"whitelistedPlayers\":" + names(Bukkit.getWhitelistedPlayers()) + "," +
                "\"operators\":" + names(Bukkit.getOperators()) + "," +
                "\"pluginCount\":" + loadedPlugins.length + "," +
                "\"pluginNames\":" + pluginNames + "," +
                "\"disabledPlugins\":" + disabledPlugins +
                "}";
    }
}
