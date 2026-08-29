package io.admincraft.minecraft.status;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.slf4j.Logger;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.Properties;

final class AdmincraftNetworkApi {
    private final NetworkStatus plugin;
    private final Logger logger;
    private final Path dataDirectory;
    private HttpServer server;
    private String token = "";
    private int port = 8092;

    AdmincraftNetworkApi(NetworkStatus plugin, Logger logger, Path dataDirectory) {
        this.plugin = plugin;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
    }
    void start() {
        try {
            loadConfig();
            if (token.isBlank()) {
                logger.info("Admincraft Network API uitgeschakeld: geen token geconfigureerd.");
                return;
            }
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
            server.createContext("/v1/network", this::handleNetwork);
            server.start();
            logger.info("Admincraft Network API luistert op 127.0.0.1:{}.", port);
        } catch (Exception e) {
            logger.error("Kon Admincraft Network API niet starten: {}", e.getMessage());
        }
    }

    void stop() {
        HttpServer current = server;
        if (current != null) {
            current.stop(0);
            server = null;
        }
    }

    private void loadConfig() throws IOException {
        Files.createDirectories(dataDirectory);
        Path configPath = dataDirectory.resolve("config.properties");
        if (!Files.exists(configPath)) {
            Files.writeString(
                configPath,
                "admincraft-api-token=\nadmincraft-api-port=8092\n",
                StandardCharsets.UTF_8
            );
        }
        Properties properties = new Properties();
        try (var reader = Files.newBufferedReader(configPath, StandardCharsets.UTF_8)) {
            properties.load(reader);
        }
        token = properties.getProperty("admincraft-api-token", "").trim();
        String rawPort = properties.getProperty("admincraft-api-port", "8092").trim();
        try {
            int parsed = Integer.parseInt(rawPort);
            port = parsed >= 1 && parsed <= 65535 ? parsed : 8092;
        } catch (NumberFormatException ignored) {
            port = 8092;
        }
    }

    private void handleNetwork(HttpExchange exchange) throws IOException {
        try {
            if (!exchange.getRemoteAddress().getAddress().isLoopbackAddress()) {
                respond(exchange, 403, "{\"success\":false,\"error\":\"forbidden\"}");
                return;
            }
            if (!authorized(exchange)) {
                respond(exchange, 401, "{\"success\":false,\"error\":\"unauthorized\"}");
                return;
            }
            if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.getResponseHeaders().set("Allow", "GET");
                respond(exchange, 405, "{\"success\":false,\"error\":\"method_not_allowed\"}");
                return;
            }
            respond(exchange, 200, plugin.admincraftNetworkJson());
        } finally {
            exchange.close();
        }
    }

    private boolean authorized(HttpExchange exchange) {
        String header = exchange.getRequestHeaders().getFirst("Authorization");
        if (header == null || !header.startsWith("Bearer ")) return false;
        byte[] expected = token.getBytes(StandardCharsets.UTF_8);
        byte[] supplied = header.substring(7).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expected, supplied);
    }

    private void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }
}
