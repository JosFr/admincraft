package io.admincraft.minecraft.access;

import com.google.inject.Inject;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import com.velocitypowered.api.command.CommandSource;
import com.velocitypowered.api.command.SimpleCommand;
import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.event.connection.PostLoginEvent;
import com.velocitypowered.api.event.player.ServerPostConnectEvent;
import com.velocitypowered.api.event.player.ServerPreConnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.format.NamedTextColor;

import org.slf4j.Logger;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;

import java.net.InetSocketAddress;

import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import java.security.MessageDigest;

import java.time.Instant;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Plugin(
    id = "access",
    name = "Access",
    version = "1.1.0-community-rc3",
    description = "Central TRUSTED / PENDING / DENIED access control for Velocity",
    authors = {"AdminCraft Community"}
)
public final class Access {

    private enum Status {
        UNKNOWN,
        PENDING,
        TRUSTED,
        DENIED
    }

    private final ProxyServer proxy;
    private final Logger logger;
    private final Path dataDirectory;

    private final Object storageLock = new Object();

    private final Properties config = new Properties();
    private final Properties state = new Properties();

    private final ConcurrentHashMap<UUID, String> lastAttemptTarget =
        new ConcurrentHashMap<>();

    private Path configFile;
    private Path stateFile;
    private Path bootstrapTokenFile;

    private volatile boolean enforcement = false;
    private volatile boolean bootstrapUsed = false;
    private volatile boolean storageHealthy = false;
    private volatile String lobbyServer = "lobby";
    private volatile String admincraftApiToken = "";
    private volatile int admincraftApiPort = 8091;
    private HttpServer admincraftApiServer;

    @Inject
    public Access(
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

        try {
            initializeStorage();
            storageHealthy = true;
        } catch (Exception e) {
            storageHealthy = false;

            logger.error(
                "Access opslag kon niet worden geïnitialiseerd.",
                e
            );
        }

        var meta =
            proxy.getCommandManager()
                .metaBuilder("access")
                .plugin(this)
                .build();

        proxy.getCommandManager()
            .register(meta, new AccessCommand());

        startAdmincraftApi();

        logger.info(
            "Access v1.1.0-rc2 gestart; enforcement={}, lobby={}, storage={}.",
            enforcement,
            lobbyServer,
            storageHealthy ? "OK" : "FOUT"
        );
    }

    private void initializeStorage() throws IOException {

        Files.createDirectories(dataDirectory);

        configFile =
            dataDirectory.resolve("config.properties");

        stateFile =
            dataDirectory.resolve("access.properties");

        bootstrapTokenFile =
            dataDirectory.resolve("bootstrap.token");

        synchronized (storageLock) {

            config.clear();
            state.clear();

            if (Files.exists(configFile)) {
                loadProperties(config, configFile);
            }

            if (Files.exists(stateFile)) {
                loadProperties(state, stateFile);
            }

            config.putIfAbsent(
                "enforcement",
                "false"
            );

            config.putIfAbsent(
                "lobby-server",
                "lobby"
            );

            config.putIfAbsent(
                "bootstrap-used",
                "false"
            );

            config.putIfAbsent(
                "admincraft-api-token",
                ""
            );

            config.putIfAbsent(
                "admincraft-api-port",
                "8091"
            );

            enforcement =
                Boolean.parseBoolean(
                    config.getProperty(
                        "enforcement",
                        "false"
                    )
                );

            lobbyServer =
                config.getProperty(
                    "lobby-server",
                    "lobby"
                ).trim();

            bootstrapUsed =
                Boolean.parseBoolean(
                    config.getProperty(
                        "bootstrap-used",
                        "false"
                    )
                );

            admincraftApiToken =
                config.getProperty(
                    "admincraft-api-token",
                    ""
                ).trim();

            String apiPortRaw =
                config.getProperty(
                    "admincraft-api-port",
                    "8091"
                ).trim();

            try {
                int configuredPort = Integer.parseInt(apiPortRaw);
                if (configuredPort < 1 || configuredPort > 65535) {
                    throw new NumberFormatException("port out of range");
                }
                admincraftApiPort = configuredPort;
            } catch (NumberFormatException e) {
                admincraftApiPort = 8091;
                config.setProperty("admincraft-api-port", "8091");
                logger.warn("Ongeldige admincraft-api-port; 8091 wordt gebruikt.");
            }

            saveProperties(
                config,
                configFile,
                "Access configuratie"
            );

            if (!Files.exists(stateFile)) {
                saveProperties(
                    state,
                    stateFile,
                    "Access spelers en beslissingen"
                );
            }
        }
    }

    private void loadProperties(
        Properties properties,
        Path file
    ) throws IOException {

        try (
            Reader reader =
                Files.newBufferedReader(
                    file,
                    StandardCharsets.UTF_8
                )
        ) {
            properties.load(reader);
        }
    }

    private void saveProperties(
        Properties properties,
        Path file,
        String comment
    ) throws IOException {

        Path temp =
            file.resolveSibling(
                file.getFileName().toString() + ".tmp"
            );

        try (
            Writer writer =
                Files.newBufferedWriter(
                    temp,
                    StandardCharsets.UTF_8
                )
        ) {
            properties.store(writer, comment);
        }

        try {
            Files.move(
                temp,
                file,
                StandardCopyOption.REPLACE_EXISTING,
                StandardCopyOption.ATOMIC_MOVE
            );
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(
                temp,
                file,
                StandardCopyOption.REPLACE_EXISTING
            );
        }
    }

    @Subscribe
    public void onShutdown(ProxyShutdownEvent event) {
        stopAdmincraftApi();
    }

    private void startAdmincraftApi() {
        if (admincraftApiToken.isBlank()) {
            logger.warn("Admincraft Access API staat uit: token ontbreekt.");
            return;
        }

        try {
            admincraftApiServer = HttpServer.create(
                new InetSocketAddress("127.0.0.1", admincraftApiPort),
                0
            );
            admincraftApiServer.createContext("/v1/access", this::handleAdmincraftApi);
            admincraftApiServer.setExecutor(null);
            admincraftApiServer.start();
            logger.info("Admincraft Access API luistert lokaal op 127.0.0.1:{}.", admincraftApiPort);
        } catch (IOException e) {
            logger.error("Admincraft Access API kon niet starten.", e);
            admincraftApiServer = null;
        }
    }

    private void stopAdmincraftApi() {
        HttpServer server = admincraftApiServer;
        admincraftApiServer = null;
        if (server != null) server.stop(0);
    }

    private void handleAdmincraftApi(HttpExchange exchange) throws IOException {
        try {
            if (!exchange.getRemoteAddress().getAddress().isLoopbackAddress()) {
                writeApiJson(exchange, 403, "{\"success\":false,\"message\":\"Local access only\"}");
                return;
            }
            if (!authorizedApiRequest(exchange)) {
                writeApiJson(exchange, 401, "{\"success\":false,\"message\":\"Unauthorized\"}");
                return;
            }

            String path = exchange.getRequestURI().getPath();
            if ("GET".equalsIgnoreCase(exchange.getRequestMethod()) && "/v1/access".equals(path)) {
                writeApiJson(exchange, 200, accessStateJson());
                return;
            }

            String prefix = "/v1/access/";
            if ("POST".equalsIgnoreCase(exchange.getRequestMethod()) && path.startsWith(prefix)) {
                String[] parts = path.substring(prefix.length()).split("/");
                if (parts.length != 2) {
                    writeApiJson(exchange, 400, apiError("Invalid Access action path"));
                    return;
                }
                UUID uuid;
                try {
                    uuid = UUID.fromString(parts[0]);
                } catch (IllegalArgumentException e) {
                    writeApiJson(exchange, 400, apiError("Invalid UUID"));
                    return;
                }
                ApiResult result = applyApiAction(uuid, parts[1]);
                writeApiJson(exchange, result.success ? 200 : 409,
                    "{\"success\":" + result.success + ",\"message\":\"" +
                    jsonEscape(result.message) + "\"}");
                return;
            }

            writeApiJson(exchange, 404, apiError("Not found"));
        } catch (Exception e) {
            logger.error("Admincraft Access API fout.", e);
            writeApiJson(exchange, 500, apiError("Internal error"));
        } finally {
            exchange.close();
        }
    }

    private boolean authorizedApiRequest(HttpExchange exchange) {
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (header == null || !header.startsWith("Bearer ")) return false;
        byte[] supplied = header.substring(7).getBytes(StandardCharsets.UTF_8);
        byte[] expected = admincraftApiToken.getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(supplied, expected);
    }

    private void writeApiJson(HttpExchange exchange, int status, String json) throws IOException {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, body.length);
        exchange.getResponseBody().write(body);
    }

    private String apiError(String message) {
        return "{\"success\":false,\"message\":\"" + jsonEscape(message) + "\"}";
    }

    private String accessStateJson() {
        List<UUID> players = new ArrayList<>();
        synchronized (storageLock) {
            for (String key : state.stringPropertyNames()) {
                if (!key.endsWith(".status")) continue;
                String raw = key.substring(0, key.length() - ".status".length());
                try {
                    UUID uuid = UUID.fromString(raw);
                    if (getStatus(uuid) != Status.UNKNOWN) players.add(uuid);
                } catch (IllegalArgumentException ignored) {
                }
            }
        }
        players.sort(Comparator.comparing(this::knownName, String.CASE_INSENSITIVE_ORDER));
        return "{\"success\":true,\"entries\":[" +
            players.stream().map(this::apiEntryJson).collect(java.util.stream.Collectors.joining(",")) +
            "]}";
    }

    private String apiEntryJson(UUID uuid) {
        String p = prefix(uuid);
        String requestedAt;
        String requestedTarget;
        String decidedAt;
        String decidedBy;
        synchronized (storageLock) {
            requestedAt = state.getProperty(p + "requested-at");
            requestedTarget = state.getProperty(p + "requested-target");
            decidedAt = state.getProperty(p + "decided-at");
            decidedBy = state.getProperty(p + "decided-by");
        }
        return "{" +
            "\"uuid\":\"" + jsonEscape(uuid.toString()) + "\"," +
            "\"name\":\"" + jsonEscape(knownName(uuid)) + "\"," +
            "\"status\":\"" + getStatus(uuid).name() + "\"," +
            "\"admin\":" + isAdmin(uuid) + "," +
            jsonNullable("requestedAt", requestedAt) + "," +
            jsonNullable("requestedTarget", requestedTarget) + "," +
            jsonNullable("decidedAt", decidedAt) + "," +
            jsonNullable("decidedBy", decidedBy) +
            "}";
    }

    private String jsonNullable(String key, String value) {
        return "\"" + key + "\":" +
            (value == null ? "null" : "\"" + jsonEscape(value) + "\"");
    }

    private String jsonEscape(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t");
    }

    private ApiResult applyApiAction(UUID uuid, String rawAction) {
        String action = rawAction.toLowerCase(Locale.ROOT);
        if ((action.equals("deny") || action.equals("blacklist") ||
             action.equals("reset") || action.equals("revoke")) && isAdmin(uuid)) {
            return new ApiResult(false, "Access-admin kan niet worden gewijzigd via deze actie.");
        }

        switch (action) {
            case "approve", "allow", "trust" -> {
                if (!setDecision(uuid, Status.TRUSTED, "Admincraft RC2")) {
                    return new ApiResult(false, "Besluit kon niet worden opgeslagen.");
                }
                proxy.getPlayer(uuid).ifPresent(player -> player.sendMessage(
                    Component.text(
                        "Je toegangsverzoek is goedgekeurd. Je kunt nu het netwerk gebruiken.",
                        NamedTextColor.GREEN
                    )
                ));
                logger.info("Access toegestaan via Admincraft: {} ({}).", knownName(uuid), uuid);
                return new ApiResult(true, knownName(uuid) + " is toegelaten.");
            }
            case "deny", "blacklist" -> {
                if (!setDecision(uuid, Status.DENIED, "Admincraft RC2")) {
                    return new ApiResult(false, "Besluit kon niet worden opgeslagen.");
                }
                proxy.getPlayer(uuid).ifPresent(player -> player.disconnect(
                    Component.text(
                        "Je toegang tot dit Minecraft-netwerk is geweigerd.",
                        NamedTextColor.RED
                    )
                ));
                logger.info("Access geweigerd via Admincraft: {} ({}).", knownName(uuid), uuid);
                return new ApiResult(true, knownName(uuid) + " is geweigerd en geblacklist.");
            }
            case "reset", "revoke" -> {
                if (!resetStatus(uuid)) {
                    return new ApiResult(false, "Reset kon niet worden opgeslagen.");
                }
                logger.info("Access ingetrokken via Admincraft: {} ({}).", knownName(uuid), uuid);
                return new ApiResult(true, knownName(uuid) + " is teruggezet naar UNKNOWN.");
            }
            default -> {
                return new ApiResult(false, "Onbekende Access-actie.");
            }
        }
    }

    private static final class ApiResult {
        final boolean success;
        final String message;

        ApiResult(boolean success, String message) {
            this.success = success;
            this.message = message;
        }
    }

    private boolean saveState() {

        synchronized (storageLock) {
            try {
                saveProperties(
                    state,
                    stateFile,
                    "Access spelers en beslissingen"
                );

                return true;

            } catch (IOException e) {

                storageHealthy = false;

                logger.error(
                    "Kon Access spelersbestand niet opslaan.",
                    e
                );

                return false;
            }
        }
    }

    private boolean saveConfig() {

        synchronized (storageLock) {
            try {
                saveProperties(
                    config,
                    configFile,
                    "Access configuratie"
                );

                return true;

            } catch (IOException e) {

                logger.error(
                    "Kon Access configuratie niet opslaan.",
                    e
                );

                return false;
            }
        }
    }

    private String prefix(UUID uuid) {
        return uuid.toString() + ".";
    }

    private Status getStatus(UUID uuid) {

        synchronized (storageLock) {

            String raw =
                state.getProperty(
                    prefix(uuid) + "status",
                    "UNKNOWN"
                );

            try {
                return Status.valueOf(
                    raw.toUpperCase(Locale.ROOT)
                );
            } catch (IllegalArgumentException e) {
                return Status.UNKNOWN;
            }
        }
    }

    private boolean isAdmin(UUID uuid) {

        synchronized (storageLock) {
            return Boolean.parseBoolean(
                state.getProperty(
                    prefix(uuid) + "admin",
                    "false"
                )
            );
        }
    }

    private String knownName(UUID uuid) {

        synchronized (storageLock) {
            return state.getProperty(
                prefix(uuid) + "name",
                uuid.toString()
            );
        }
    }

    private void rememberName(Player player) {

        String key =
            prefix(player.getUniqueId()) + "name";

        synchronized (storageLock) {

            String old =
                state.getProperty(key);

            if (
                old != null
                    && old.equals(player.getUsername())
            ) {
                return;
            }

            state.setProperty(
                key,
                player.getUsername()
            );
        }

        saveState();
    }

    private boolean setPending(
        Player player,
        String target
    ) {

        UUID uuid =
            player.getUniqueId();

        synchronized (storageLock) {

            String p = prefix(uuid);

            state.setProperty(
                p + "name",
                player.getUsername()
            );

            state.setProperty(
                p + "status",
                Status.PENDING.name()
            );

            state.setProperty(
                p + "requested-at",
                Instant.now().toString()
            );

            state.setProperty(
                p + "requested-target",
                target
            );

            state.remove(p + "decided-at");
            state.remove(p + "decided-by");
        }

        return saveState();
    }

    private boolean setDecision(
        UUID uuid,
        Status status,
        String actor
    ) {

        synchronized (storageLock) {

            String p = prefix(uuid);

            state.setProperty(
                p + "status",
                status.name()
            );

            state.setProperty(
                p + "decided-at",
                Instant.now().toString()
            );

            state.setProperty(
                p + "decided-by",
                actor
            );
        }

        return saveState();
    }

    private boolean resetStatus(UUID uuid) {

        synchronized (storageLock) {

            String p = prefix(uuid);

            state.remove(p + "status");
            state.remove(p + "requested-at");
            state.remove(p + "requested-target");
            state.remove(p + "decided-at");
            state.remove(p + "decided-by");
        }

        return saveState();
    }

    private int adminCount() {

        synchronized (storageLock) {

            int count = 0;

            for (
                String key :
                state.stringPropertyNames()
            ) {
                if (
                    key.endsWith(".admin")
                        && Boolean.parseBoolean(
                            state.getProperty(key)
                        )
                ) {
                    count++;
                }
            }

            return count;
        }
    }

    private List<UUID> pendingPlayers() {

        List<UUID> result =
            new ArrayList<>();

        synchronized (storageLock) {

            for (
                String key :
                state.stringPropertyNames()
            ) {

                if (!key.endsWith(".status")) {
                    continue;
                }

                if (
                    !"PENDING".equalsIgnoreCase(
                        state.getProperty(key)
                    )
                ) {
                    continue;
                }

                String uuidText =
                    key.substring(
                        0,
                        key.length()
                            - ".status".length()
                    );

                try {
                    result.add(
                        UUID.fromString(uuidText)
                    );
                } catch (IllegalArgumentException ignored) {
                }
            }
        }

        result.sort(
            Comparator.comparing(
                this::knownName,
                String.CASE_INSENSITIVE_ORDER
            )
        );

        return result;
    }

    private String requestedTarget(UUID uuid) {

        synchronized (storageLock) {
            return state.getProperty(
                prefix(uuid) + "requested-target",
                "netwerk"
            );
        }
    }

    private Optional<UUID> resolvePlayer(
        String value
    ) {

        try {
            return Optional.of(
                UUID.fromString(value)
            );
        } catch (IllegalArgumentException ignored) {
        }

        Optional<Player> online =
            proxy.getPlayer(value);

        if (online.isPresent()) {
            return Optional.of(
                online.get().getUniqueId()
            );
        }

        synchronized (storageLock) {

            for (
                String key :
                state.stringPropertyNames()
            ) {

                if (!key.endsWith(".name")) {
                    continue;
                }

                if (
                    !value.equalsIgnoreCase(
                        state.getProperty(key)
                    )
                ) {
                    continue;
                }

                String uuidText =
                    key.substring(
                        0,
                        key.length()
                            - ".name".length()
                    );

                try {
                    return Optional.of(
                        UUID.fromString(uuidText)
                    );
                } catch (IllegalArgumentException ignored) {
                }
            }
        }

        return Optional.empty();
    }

    private String actor(CommandSource source) {

        if (source instanceof Player player) {
            return player.getUsername();
        }

        return "console";
    }

    private boolean isAuthorizedAdmin(
        CommandSource source
    ) {

        if (!(source instanceof Player player)) {
            return true;
        }

        return isAdmin(
            player.getUniqueId()
        );
    }

    @Subscribe(priority = 100)
    public void onLogin(LoginEvent event) {

        if (!event.getResult().isAllowed()) {
            return;
        }

        if (!enforcement) {
            return;
        }

        /*
         * Bij opslagproblemen laten we de verbinding met
         * Velocity/lobby nog toe. ServerPreConnect sluit
         * daarna alle niet-lobby backends fail-closed af.
         */
        if (!storageHealthy) {
            return;
        }

        UUID uuid =
            event.getPlayer().getUniqueId();

        if (getStatus(uuid) != Status.DENIED) {
            return;
        }

        event.setResult(
            ResultedEvent.ComponentResult.denied(
                Component.text(
                    "Toegang tot dit Minecraft-netwerk is geweigerd.",
                    NamedTextColor.RED
                )
            )
        );
    }

    @Subscribe
    public void onPostLogin(PostLoginEvent event) {

        Player player =
            event.getPlayer();

        rememberName(player);

        if (!isAdmin(player.getUniqueId())) {
            return;
        }

        int pending =
            pendingPlayers().size();

        if (pending > 0) {

            player.sendMessage(
                Component.text(
                    "Access: "
                        + pending
                        + " openstaand"
                        + (pending == 1 ? " verzoek." : "e verzoeken.")
                        + " Gebruik /access pending.",
                    NamedTextColor.GOLD
                )
            );
        }

        if (!enforcement) {

            player.sendMessage(
                Component.text(
                    "Access enforcement staat UIT.",
                    NamedTextColor.YELLOW
                )
            );
        }
    }

    @Subscribe(priority = 100)
    public void onServerPreConnect(
        ServerPreConnectEvent event
    ) {

        if (!event.getResult().isAllowed()) {
            return;
        }

        if (!enforcement) {
            return;
        }

        String target =
            event.getOriginalServer()
                .getServerInfo()
                .getName();

        /*
         * Lobby is de publieke ontvangstzone.
         */
        if (
            target.equalsIgnoreCase(
                lobbyServer
            )
        ) {
            return;
        }

        Player player =
            event.getPlayer();

        UUID uuid =
            player.getUniqueId();

        /*
         * Als opslag defect is, blijft alleen lobby
         * bereikbaar. Geen backend wordt dan per ongeluk
         * opengezet.
         */
        if (!storageHealthy) {

            event.setResult(
                ServerPreConnectEvent.ServerResult.denied()
            );

            player.sendMessage(
                Component.text(
                    "Toegang is tijdelijk niet beschikbaar. "
                        + "Blijf in de lobby en waarschuw een beheerder.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        Status status =
            getStatus(uuid);

        if (status == Status.TRUSTED) {
            return;
        }

        lastAttemptTarget.put(
            uuid,
            target
        );

        event.setResult(
            ServerPreConnectEvent.ServerResult.denied()
        );

        switch (status) {

            case PENDING ->
                player.sendMessage(
                    Component.text(
                        "Je toegangsverzoek wacht nog op beoordeling.",
                        NamedTextColor.YELLOW
                    )
                );

            case DENIED ->
                player.sendMessage(
                    Component.text(
                        "Je toegang is geweigerd.",
                        NamedTextColor.RED
                    )
                );

            default ->
                player.sendMessage(
                    Component.text(
                        "Deze server is alleen toegankelijk na goedkeuring. ",
                        NamedTextColor.YELLOW
                    ).append(
                        Component.text(
                            "Gebruik /access request",
                            NamedTextColor.GREEN
                        )
                    )
                );
        }
    }

    @Subscribe
    public void onServerPostConnect(
        ServerPostConnectEvent event
    ) {

        if (!enforcement) {
            return;
        }

        Player player =
            event.getPlayer();

        Optional<String> current =
            player.getCurrentServer()
                .map(
                    connection ->
                        connection
                            .getServerInfo()
                            .getName()
                );

        if (
            current.isEmpty()
                || !current.get().equalsIgnoreCase(
                    lobbyServer
                )
        ) {
            return;
        }

        Status status =
            getStatus(
                player.getUniqueId()
            );

        if (status == Status.TRUSTED) {
            return;
        }

        if (status == Status.PENDING) {

            player.sendMessage(
                Component.text(
                    "Welkom in de ontvangstlobby. "
                        + "Je toegangsverzoek wacht op beoordeling.",
                    NamedTextColor.YELLOW
                )
            );

        } else {

            player.sendMessage(
                Component.text(
                    "Welkom. Je hebt nog geen toegang tot het netwerk. ",
                    NamedTextColor.YELLOW
                ).append(
                    Component.text(
                        "Gebruik /access request",
                        NamedTextColor.GREEN
                    )
                )
            );
        }
    }

    private Component requestComponent(
        UUID uuid
    ) {

        String name =
            knownName(uuid);

        String target =
            requestedTarget(uuid);

        return Component.text(
            "Toegangsverzoek: "
                + name
                + " → "
                + target
                + " ",
            NamedTextColor.GOLD
        ).append(
            Component.text(
                "[TOESTAAN]",
                NamedTextColor.GREEN
            ).clickEvent(
                ClickEvent.runCommand(
                    "/access approve "
                        + uuid
                )
            )
        ).append(
            Component.space()
        ).append(
            Component.text(
                "[WEIGEREN]",
                NamedTextColor.RED
            ).clickEvent(
                ClickEvent.runCommand(
                    "/access deny "
                        + uuid
                )
            )
        );
    }

    private int notifyAdmins(UUID uuid) {

        int notified = 0;

        Component message =
            requestComponent(uuid);

        for (
            Player player :
            proxy.getAllPlayers()
        ) {

            if (!isAdmin(player.getUniqueId())) {
                continue;
            }

            player.sendMessage(message);
            notified++;
        }

        return notified;
    }

    private final class AccessCommand
        implements SimpleCommand {

        @Override
        public boolean hasPermission(
            Invocation invocation
        ) {
            /*
             * Altijd true:
             * onbekende spelers moeten /access request
             * kunnen uitvoeren. Beheeracties worden
             * intern gecontroleerd.
             */
            return true;
        }

        @Override
        public void execute(
            Invocation invocation
        ) {

            CommandSource source =
                invocation.source();

            String[] args =
                invocation.arguments();

            if (args.length == 0) {
                showHelp(source);
                return;
            }

            String sub =
                args[0].toLowerCase(
                    Locale.ROOT
                );

            switch (sub) {

                case "request" ->
                    request(source);

                case "status" ->
                    status(source, args);

                case "pending" ->
                    pending(source);

                case "approve",
                     "allow" ->
                    approve(source, args);

                case "deny",
                     "blacklist" ->
                    deny(source, args);

                case "trust" ->
                    trust(source, args);

                case "reset" ->
                    reset(source, args);

                case "admin" ->
                    admin(source, args);

                case "enforcement" ->
                    enforcement(source, args);

                case "bootstrap" ->
                    bootstrap(source, args);

                default ->
                    showHelp(source);
            }
        }
    }

    private void showHelp(
        CommandSource source
    ) {

        source.sendMessage(
            Component.text(
                "Access: /access request | /access status",
                NamedTextColor.AQUA
            )
        );

        if (isAuthorizedAdmin(source)) {

            source.sendMessage(
                Component.text(
                    "Admin: /access pending | approve | deny | "
                        + "trust | reset | admin | enforcement",
                    NamedTextColor.GRAY
                )
            );
        }
    }

    private void request(
        CommandSource source
    ) {

        if (!(source instanceof Player player)) {

            source.sendMessage(
                Component.text(
                    "Alleen een speler kan toegang aanvragen.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        UUID uuid =
            player.getUniqueId();

        Status status =
            getStatus(uuid);

        if (status == Status.TRUSTED) {

            player.sendMessage(
                Component.text(
                    "Je hebt al toegang.",
                    NamedTextColor.GREEN
                )
            );

            return;
        }

        if (status == Status.DENIED) {

            player.sendMessage(
                Component.text(
                    "Je toegang is geweigerd.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        if (status == Status.PENDING) {

            player.sendMessage(
                Component.text(
                    "Je verzoek wacht al op beoordeling.",
                    NamedTextColor.YELLOW
                )
            );

            return;
        }

        String target =
            lastAttemptTarget.getOrDefault(
                uuid,
                "netwerk"
            );

        if (!setPending(player, target)) {

            player.sendMessage(
                Component.text(
                    "Het verzoek kon niet veilig worden opgeslagen.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        int admins =
            notifyAdmins(uuid);

        player.sendMessage(
            Component.text(
                admins > 0
                    ? "Toegangsverzoek verzonden naar de beheerder."
                    : "Toegangsverzoek opgeslagen. "
                        + "Een beheerder beoordeelt het later.",
                NamedTextColor.GREEN
            )
        );

        logger.info(
            "Access verzoek: {} ({}) -> {}.",
            player.getUsername(),
            uuid,
            target
        );
    }

    private void status(
        CommandSource source,
        String[] args
    ) {

        UUID uuid;

        if (args.length >= 2) {

            if (!isAuthorizedAdmin(source)) {
                noAdmin(source);
                return;
            }

            Optional<UUID> resolved =
                resolvePlayer(args[1]);

            if (resolved.isEmpty()) {

                source.sendMessage(
                    Component.text(
                        "Speler niet gevonden.",
                        NamedTextColor.RED
                    )
                );

                return;
            }

            uuid = resolved.get();

        } else if (source instanceof Player player) {

            uuid =
                player.getUniqueId();

        } else {

            source.sendMessage(
                Component.text(
                    "Gebruik /access status <speler|uuid>.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        source.sendMessage(
            Component.text(
                knownName(uuid)
                    + " | "
                    + uuid
                    + " | status="
                    + getStatus(uuid)
                    + " | admin="
                    + isAdmin(uuid),
                NamedTextColor.AQUA
            )
        );
    }

    private void pending(
        CommandSource source
    ) {

        if (!isAuthorizedAdmin(source)) {
            noAdmin(source);
            return;
        }

        List<UUID> pending =
            pendingPlayers();

        if (pending.isEmpty()) {

            source.sendMessage(
                Component.text(
                    "Geen openstaande toegangsverzoeken.",
                    NamedTextColor.GREEN
                )
            );

            return;
        }

        source.sendMessage(
            Component.text(
                "Openstaande toegangsverzoeken:",
                NamedTextColor.GOLD
            )
        );

        for (UUID uuid : pending) {
            source.sendMessage(
                requestComponent(uuid)
            );
        }
    }

    private void approve(
        CommandSource source,
        String[] args
    ) {

        if (!isAuthorizedAdmin(source)) {
            noAdmin(source);
            return;
        }

        Optional<UUID> resolved =
            requireTarget(source, args);

        if (resolved.isEmpty()) {
            return;
        }

        UUID uuid =
            resolved.get();

        if (
            !setDecision(
                uuid,
                Status.TRUSTED,
                actor(source)
            )
        ) {
            source.sendMessage(
                Component.text(
                    "Besluit kon niet worden opgeslagen.",
                    NamedTextColor.RED
                )
            );
            return;
        }

        source.sendMessage(
            Component.text(
                knownName(uuid)
                    + " is toegelaten.",
                NamedTextColor.GREEN
            )
        );

        proxy.getPlayer(uuid)
            .ifPresent(
                player ->
                    player.sendMessage(
                        Component.text(
                            "Je toegangsverzoek is goedgekeurd. "
                                + "Je kunt nu het netwerk gebruiken.",
                            NamedTextColor.GREEN
                        )
                    )
            );

        logger.info(
            "Access toegestaan: {} ({}) door {}.",
            knownName(uuid),
            uuid,
            actor(source)
        );
    }

    private void trust(
        CommandSource source,
        String[] args
    ) {

        approve(source, args);
    }

    private void deny(
        CommandSource source,
        String[] args
    ) {

        if (!isAuthorizedAdmin(source)) {
            noAdmin(source);
            return;
        }

        Optional<UUID> resolved =
            requireTarget(source, args);

        if (resolved.isEmpty()) {
            return;
        }

        UUID uuid =
            resolved.get();

        if (isAdmin(uuid)) {

            source.sendMessage(
                Component.text(
                    "Een Access-admin kan niet worden geweigerd. "
                        + "Verwijder eerst de adminstatus.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        if (
            !setDecision(
                uuid,
                Status.DENIED,
                actor(source)
            )
        ) {
            source.sendMessage(
                Component.text(
                    "Besluit kon niet worden opgeslagen.",
                    NamedTextColor.RED
                )
            );
            return;
        }

        source.sendMessage(
            Component.text(
                knownName(uuid)
                    + " is geweigerd en geblacklist.",
                NamedTextColor.RED
            )
        );

        proxy.getPlayer(uuid)
            .ifPresent(
                player ->
                    player.disconnect(
                        Component.text(
                            "Je toegang tot dit Minecraft-netwerk "
                                + "is geweigerd.",
                            NamedTextColor.RED
                        )
                    )
            );

        logger.info(
            "Access geweigerd: {} ({}) door {}.",
            knownName(uuid),
            uuid,
            actor(source)
        );
    }

    private void reset(
        CommandSource source,
        String[] args
    ) {

        if (!isAuthorizedAdmin(source)) {
            noAdmin(source);
            return;
        }

        Optional<UUID> resolved =
            requireTarget(source, args);

        if (resolved.isEmpty()) {
            return;
        }

        UUID uuid =
            resolved.get();

        if (isAdmin(uuid)) {

            source.sendMessage(
                Component.text(
                    "Reset van een Access-admin is geblokkeerd.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        if (!resetStatus(uuid)) {

            source.sendMessage(
                Component.text(
                    "Reset kon niet worden opgeslagen.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        source.sendMessage(
            Component.text(
                knownName(uuid)
                    + " is teruggezet naar UNKNOWN.",
                NamedTextColor.YELLOW
            )
        );
    }

    private void admin(
        CommandSource source,
        String[] args
    ) {

        if (!isAuthorizedAdmin(source)) {
            noAdmin(source);
            return;
        }

        if (args.length < 3) {

            source.sendMessage(
                Component.text(
                    "Gebruik /access admin add|remove <speler|uuid>.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        String action =
            args[1].toLowerCase(
                Locale.ROOT
            );

        Optional<UUID> resolved =
            resolvePlayer(args[2]);

        if (resolved.isEmpty()) {

            source.sendMessage(
                Component.text(
                    "Speler niet gevonden.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        UUID uuid =
            resolved.get();

        if ("add".equals(action)) {

            synchronized (storageLock) {

                String p = prefix(uuid);

                state.setProperty(
                    p + "admin",
                    "true"
                );

                state.setProperty(
                    p + "status",
                    Status.TRUSTED.name()
                );

                proxy.getPlayer(uuid)
                    .ifPresent(
                        player ->
                            state.setProperty(
                                p + "name",
                                player.getUsername()
                            )
                    );
            }

            if (!saveState()) {
                source.sendMessage(
                    Component.text(
                        "Adminwijziging kon niet worden opgeslagen.",
                        NamedTextColor.RED
                    )
                );
                return;
            }

            source.sendMessage(
                Component.text(
                    knownName(uuid)
                        + " is Access-admin en TRUSTED.",
                    NamedTextColor.GREEN
                )
            );

            return;
        }

        if ("remove".equals(action)) {

            if (
                isAdmin(uuid)
                    && adminCount() <= 1
            ) {

                source.sendMessage(
                    Component.text(
                        "De laatste Access-admin kan niet worden verwijderd.",
                        NamedTextColor.RED
                    )
                );

                return;
            }

            synchronized (storageLock) {
                state.remove(
                    prefix(uuid) + "admin"
                );
            }

            saveState();

            source.sendMessage(
                Component.text(
                    knownName(uuid)
                        + " is geen Access-admin meer.",
                    NamedTextColor.YELLOW
                )
            );

            return;
        }

        source.sendMessage(
            Component.text(
                "Gebruik add of remove.",
                NamedTextColor.RED
            )
        );
    }

    private void enforcement(
        CommandSource source,
        String[] args
    ) {

        if (!isAuthorizedAdmin(source)) {
            noAdmin(source);
            return;
        }

        if (args.length < 2) {

            source.sendMessage(
                Component.text(
                    "Enforcement staat "
                        + (enforcement ? "AAN" : "UIT")
                        + ".",
                    enforcement
                        ? NamedTextColor.GREEN
                        : NamedTextColor.YELLOW
                )
            );

            return;
        }

        String value =
            args[1].toLowerCase(
                Locale.ROOT
            );

        if (
            !"on".equals(value)
                && !"off".equals(value)
        ) {

            source.sendMessage(
                Component.text(
                    "Gebruik /access enforcement on|off.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        boolean requested =
            "on".equals(value);

        if (requested) {

            if (!storageHealthy) {

                source.sendMessage(
                    Component.text(
                        "Enforcement kan niet aan: opslag is niet gezond.",
                        NamedTextColor.RED
                    )
                );

                return;
            }

            if (adminCount() < 1) {

                source.sendMessage(
                    Component.text(
                        "Enforcement kan niet aan zonder Access-admin.",
                        NamedTextColor.RED
                    )
                );

                return;
            }
        }

        boolean old =
            enforcement;

        synchronized (storageLock) {
            config.setProperty(
                "enforcement",
                Boolean.toString(requested)
            );
        }

        if (!saveConfig()) {

            synchronized (storageLock) {
                config.setProperty(
                    "enforcement",
                    Boolean.toString(old)
                );
            }

            source.sendMessage(
                Component.text(
                    "Configuratie kon niet worden opgeslagen.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        enforcement =
            requested;

        source.sendMessage(
            Component.text(
                "Access enforcement staat nu "
                    + (requested ? "AAN." : "UIT."),
                requested
                    ? NamedTextColor.GREEN
                    : NamedTextColor.YELLOW
            )
        );

        logger.info(
            "Access enforcement {} door {}.",
            requested ? "AAN" : "UIT",
            actor(source)
        );
    }

    private void bootstrap(
        CommandSource source,
        String[] args
    ) {

        if (!(source instanceof Player player)) {

            source.sendMessage(
                Component.text(
                    "Bootstrap moet door de speler zelf worden uitgevoerd.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        if (bootstrapUsed) {

            player.sendMessage(
                Component.text(
                    "Bootstrap is al gebruikt.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        if (args.length < 2) {

            player.sendMessage(
                Component.text(
                    "Gebruik /access bootstrap <eenmalige-token>.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        final String expected;

        try {
            expected =
                Files.readString(
                    bootstrapTokenFile,
                    StandardCharsets.UTF_8
                ).trim();
        } catch (IOException e) {

            player.sendMessage(
                Component.text(
                    "Bootstrap-token kon niet worden gelezen.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        boolean equal =
            MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8),
                args[1].getBytes(StandardCharsets.UTF_8)
            );

        if (!equal) {

            player.sendMessage(
                Component.text(
                    "Ongeldige bootstrap-token.",
                    NamedTextColor.RED
                )
            );

            logger.warn(
                "Ongeldige Access bootstrap-poging door {} ({}).",
                player.getUsername(),
                player.getUniqueId()
            );

            return;
        }

        UUID uuid =
            player.getUniqueId();

        synchronized (storageLock) {

            String p = prefix(uuid);

            state.setProperty(
                p + "name",
                player.getUsername()
            );

            state.setProperty(
                p + "admin",
                "true"
            );

            state.setProperty(
                p + "status",
                Status.TRUSTED.name()
            );

            state.setProperty(
                p + "decided-at",
                Instant.now().toString()
            );

            state.setProperty(
                p + "decided-by",
                "bootstrap"
            );
        }

        if (!saveState()) {

            player.sendMessage(
                Component.text(
                    "Bootstrap kon niet veilig worden opgeslagen.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        synchronized (storageLock) {
            config.setProperty(
                "bootstrap-used",
                "true"
            );
        }

        if (!saveConfig()) {

            player.sendMessage(
                Component.text(
                    "Adminstatus is opgeslagen, maar configuratie "
                        + "kon niet volledig worden bijgewerkt. "
                        + "Laat enforcement UIT.",
                    NamedTextColor.RED
                )
            );

            return;
        }

        bootstrapUsed = true;

        try {
            Files.deleteIfExists(
                bootstrapTokenFile
            );
        } catch (IOException e) {
            logger.warn(
                "Bootstrap-tokenbestand kon niet worden verwijderd: {}",
                e.getMessage()
            );
        }

        player.sendMessage(
            Component.text(
                "Access bootstrap voltooid. "
                    + "Je bent TRUSTED en Access-admin.",
                NamedTextColor.GREEN
            )
        );

        logger.info(
            "Access bootstrap voltooid voor {} ({}).",
            player.getUsername(),
            uuid
        );
    }

    private Optional<UUID> requireTarget(
        CommandSource source,
        String[] args
    ) {

        if (args.length < 2) {

            source.sendMessage(
                Component.text(
                    "Geef een spelernaam of UUID op.",
                    NamedTextColor.RED
                )
            );

            return Optional.empty();
        }

        Optional<UUID> resolved =
            resolvePlayer(args[1]);

        if (resolved.isEmpty()) {

            source.sendMessage(
                Component.text(
                    "Speler niet gevonden.",
                    NamedTextColor.RED
                )
            );
        }

        return resolved;
    }

    private void noAdmin(
        CommandSource source
    ) {

        source.sendMessage(
            Component.text(
                "Alleen een Access-admin mag dit uitvoeren.",
                NamedTextColor.RED
            )
        );
    }
}
