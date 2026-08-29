package io.admincraft.minecraft.status;

import com.google.inject.Inject;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import org.slf4j.Logger;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

@Plugin(
    id = "admincraft-network-status",
    name = "AdminCraft Network Status",
    version = "1.0.0-rc3",
    description = "Generic Velocity network status feed for AdminCraft",
    authors = {"AdminCraft Community"}
)
public final class NetworkStatus {
    private static final int MAX_PLAYERS = Integer.getInteger("admincraft.maxPlayers", 0);
    private record BackendState(boolean online, String version) {}

    private final ProxyServer proxy;
    private final Logger logger;
    private final Path dataDirectory;
    private final Map<String, BackendState> backends = new ConcurrentHashMap<>();
    private AdmincraftNetworkApi admincraftApi;

    @Inject
    public NetworkStatus(
        ProxyServer proxy,
        Logger logger,
        @DataDirectory Path dataDirectory
    ) {
        this.proxy = proxy;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
    }

    @Subscribe
    public void onInitialize(ProxyInitializeEvent event) {
        admincraftApi = new AdmincraftNetworkApi(this, logger, dataDirectory);
        admincraftApi.start();
        refreshBackends();
        proxy.getScheduler()
            .buildTask(this, this::refreshBackends)
            .delay(Duration.ofSeconds(10))
            .repeat(Duration.ofSeconds(10))
            .schedule();
        logger.info("AdminCraft Network Status community RC3 started.");
    }

    @Subscribe
    public void onShutdown(ProxyShutdownEvent event) {
        if (admincraftApi != null) admincraftApi.stop();
    }

    private void refreshBackends() {
        for (RegisteredServer server : proxy.getAllServers()) {
            checkBackend(server);
        }
    }

    private void checkBackend(RegisteredServer server) {
        String name = server.getServerInfo().getName();
        server.ping()
            .orTimeout(3, TimeUnit.SECONDS)
            .whenComplete((ping, error) -> {
                if (error != null || ping == null) {
                    updateBackend(name, new BackendState(false, ""));
                    return;
                }
                updateBackend(
                    name,
                    new BackendState(true, ping.getVersion().getName())
                );
            });
    }
    private void updateBackend(String name, BackendState next) {
        BackendState previous = backends.put(name, next);
        if (previous == null || previous.online() != next.online()
                || !previous.version().equals(next.version())) {
            if (next.online()) {
                logger.info("Backend {} ONLINE ({})", name, next.version());
            } else {
                logger.info("Backend {} OFFLINE", name);
            }
        }
    }

    private BackendState state(String name) {
        return backends.getOrDefault(name, new BackendState(false, ""));
    }

    private int players(String name) {
        return proxy.getServer(name)
            .map(server -> server.getPlayersConnected().size())
            .orElse(0);
    }

    private String prettyName(String name) {
        String clean = name.replace('-', ' ').replace('_', ' ').trim();
        if (clean.isEmpty()) return clean;
        StringBuilder out = new StringBuilder();
        for (String part : clean.split("\\s+")) {
            if (part.isEmpty()) continue;
            if (!out.isEmpty()) out.append(' ');
            out.append(Character.toUpperCase(part.charAt(0)));
            if (part.length() > 1) out.append(part.substring(1));
        }
        return out.toString();
    }

    String admincraftNetworkJson() {
        List<RegisteredServer> servers = new ArrayList<>(proxy.getAllServers());
        servers.sort(Comparator.comparing(
            server -> server.getServerInfo().getName().toLowerCase()
        ));

        StringBuilder out = new StringBuilder();
        out.append("{\"success\":true,\"observedAt\":")
            .append(jsonQuote(Instant.now().toString()))
            .append(",\"playersOnline\":").append(proxy.getPlayerCount())
            .append(",\"playerLimit\":").append(MAX_PLAYERS)
            .append(",\"clientMin\":\"\"")
            .append(",\"clientMax\":\"\"")
            .append(",\"servers\":[");

        boolean first = true;
        for (RegisteredServer server : servers) {
            String name = server.getServerInfo().getName();
            BackendState backend = state(name);
            if (!first) out.append(',');
            first = false;
            out.append("{\"name\":").append(jsonQuote(name))
                .append(",\"label\":").append(jsonQuote(prettyName(name)))
                .append(",\"state\":").append(jsonQuote(backend.online() ? "ONLINE" : "OFFLINE"))
                .append(",\"players\":").append(players(name))
                .append(",\"version\":").append(jsonQuote(backend.version()))
                .append('}');
        }
        out.append("]}");
        return out.toString();
    }

    private String jsonQuote(String value) {
        if (value == null) return "null";
        return "\"" + value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\r", "\\r")
            .replace("\n", "\\n") + "\"";
    }
}
