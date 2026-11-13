const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const authRoutes = require("./routes/auth");
const structureRoutes = require("./routes/structure");
const userRoutes = require("./routes/users");
const teamRoutes = require("./routes/team");
const kaizenRoutes = require("./routes/kaizens");
const settingsRoutes = require("./routes/settings");

function limiter({ windowMs, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: message, code: "rate_limited" },
  });
}

/**
 * Builds the Express app without starting a server, so tests can mount it on any port.
 * options.rateLimits — force rate limiting on/off (defaults to on, except under NODE_ENV=test).
 */
function createApp(options = {}) {
  const useRateLimits = options.rateLimits ?? process.env.NODE_ENV !== "test";

  const app = express();

  // Behind nginx/Caddy set TRUST_PROXY=1 so rate limits see the real client IP.
  if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

  // Photos are loaded through the API as blobs, so img-src must allow blob:. Everything else stays 'self'.
  // upgrade-insecure-requests is off: it would break plain-http use on a local network; HTTPS comes from the tunnel/proxy.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { "img-src": ["'self'", "data:", "blob:"], "upgrade-insecure-requests": null },
      },
    })
  );

  // The Vite dev proxy / production reverse proxy make the API same-origin, so CORS is
  // off unless explicitly enabled for specific origins: CORS_ORIGIN=https://a.example,https://b.example
  const allowedOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) app.use(cors({ origin: allowedOrigins }));

  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  if (useRateLimits) {
    // Only failed logins count: a typo-prone user is not locked out by their own successes.
    app.use(
      "/api/auth/login",
      limiter({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        skipSuccessfulRequests: true,
        message: "Слишком много неудачных попыток входа. Повторите через 15 минут.",
      })
    );
    app.use(
      "/api/auth/activate",
      limiter({ windowMs: 15 * 60 * 1000, limit: 10, message: "Слишком много попыток активации. Повторите через 15 минут." })
    );
    app.use("/api", limiter({ windowMs: 60 * 1000, limit: 600, message: "Слишком много запросов. Повторите позже." }));
  }

  app.use("/api/auth", authRoutes);
  app.use("/api/structure", structureRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/team", teamRoutes);
  app.use("/api/kaizens", kaizenRoutes);
  app.use("/api/settings", settingsRoutes);

  app.use("/api", (req, res) => res.status(404).json({ error: "Не найдено", code: "not_found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Некорректный JSON", code: "bad_json" });
    if (err && err.type === "entity.too.large") return res.status(413).json({ error: "Слишком большой запрос", code: "too_large" });
    if (process.env.NODE_ENV !== "test") console.error(err);
    res.status(500).json({ error: "Внутренняя ошибка сервера", code: "server_error" });
  });

  // One process serves both the API and the built website (client/dist), so a single tunnel/port is enough.
  const clientDist =
    options.clientDist === false ? null : options.clientDist || process.env.CLIENT_DIST || path.join(__dirname, "..", "..", "client", "dist");
  const indexFile = clientDist && path.join(clientDist, "index.html");
  if (indexFile && fs.existsSync(indexFile)) {
    app.use("/assets", express.static(path.join(clientDist, "assets"), { immutable: true, maxAge: "30d", fallthrough: false }));
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    // Any other GET that is not the API is a page of the single-page app.
    app.get(/^\/(?!api(\/|$)).*/, (req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(indexFile);
    });
  }

  return app;
}

module.exports = { createApp };
