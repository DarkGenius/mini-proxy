// Minimal Node.js proxy server with prefix-based routing and streaming (SSE) support
// Node >= 18 required (uses global fetch and Web Streams)

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function loadConfig() {
  const configPath = path.join(process.cwd(), "config.json");
  let raw = "{}";
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    console.error(`[proxy] Не найден config.json (${configPath}).`);
    throw err;
  }
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (err) {
    console.error("[proxy] Ошибка парсинга config.json:", err);
    throw err;
  }

  // Defaults
  cfg.port = cfg.port ?? 8787;
  cfg.routes = cfg.routes ?? {};
  cfg.targets = cfg.targets ?? {};
  cfg.cors = cfg.cors ?? {};
  cfg.cors.origin = cfg.cors.origin ?? "*";
  cfg.cors.methods = cfg.cors.methods ?? "*";
  cfg.cors.headers = cfg.cors.headers ?? "*";
  cfg.cors.exposeHeaders = cfg.cors.exposeHeaders ?? "";
  cfg.stripRequestHeaders = cfg.stripRequestHeaders ?? [
    "host",
    "content-length",
  ];
  cfg.streaming = cfg.streaming ?? false;
  return cfg;
}

const config = loadConfig();

function expandEnvInString(value) {
  if (typeof value !== "string") return value;
  const withEnv = value.replace(/\$\{env:([A-Z0-9_]+)\}/g, (_, varName) => {
    const v = process.env[varName];
    if (v === undefined) {
      console.warn(`[proxy] Переменная окружения ${varName} не установлена`);
      return "";
    }
    return v;
  });
  return withEnv.replace(/\$\{file:([^}]+)\}/g, (_, filePath) => {
    const resolved = filePath.startsWith("~/")
      ? path.join(os.homedir(), filePath.slice(2))
      : filePath;
    try {
      return fs.readFileSync(resolved, "utf8").trim();
    } catch {
      console.warn(`[proxy] Не удалось прочитать файл секрета ${resolved}`);
      return "";
    }
  });
}

function expandEnvInObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    out[k] = expandEnvInString(v);
  }
  return out;
}

function findBestRoute(pathname) {
  let bestPrefix = null;
  let bestTargetId = null;
  for (const [prefix, targetId] of Object.entries(config.routes)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      if (!bestPrefix || prefix.length > bestPrefix.length) {
        bestPrefix = prefix;
        bestTargetId = targetId;
      }
    }
  }
  return { bestPrefix, bestTargetId };
}

function joinUrlParts(baseUrl, ...parts) {
  const base = baseUrl.replace(/\/?$/, "");
  const joined = parts
    .filter(Boolean)
    .map((p) => p.replace(/^\/+/, ""))
    .join("/");
  return joined ? `${base}/${joined}` : base;
}

function filterOutgoingRequestHeaders(incomingHeaders, stripList) {
  const headers = new Headers();
  // copy incoming headers
  for (const [name, value] of Object.entries(incomingHeaders)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (stripList.includes(lower)) continue;
    // Node may provide string | string[]
    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

function applyTargetHeaders(headers, targetHeaders) {
  const expanded = expandEnvInObject(targetHeaders || {});
  for (const [k, v] of Object.entries(expanded)) {
    headers.set(k, v);
  }
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", config.cors.origin);
  res.setHeader("Access-Control-Allow-Methods", config.cors.methods);
  res.setHeader("Access-Control-Allow-Headers", config.cors.headers);
  if (config.cors.exposeHeaders) {
    res.setHeader("Access-Control-Expose-Headers", config.cors.exposeHeaders);
  }
}

function filterResponseHeaders(headers, isStreaming) {
  const out = {};
  for (const [k, v] of headers.entries()) {
    const lower = k.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (isStreaming && lower === "content-length") continue;
    out[k] = v;
  }
  return out;
}

// Создаем сервер с увеличенными лимитами и более мягким парсером
const server = http.createServer(
  {
    insecureHTTPParser: true, // Разрешаем более гибкий парсинг HTTP
    maxHeaderSize: 16384, // Увеличиваем лимит размера заголовков
  },
  async (req, res) => {
    const requestId = Math.random().toString(36).substring(2, 9);
    const startTime = Date.now();

    console.log(`[${requestId}] 🔵 Получен запрос: ${req.method} ${req.url}`);

    try {
      // Basic CORS for all requests
      setCorsHeaders(res);

      if (req.method === "OPTIONS") {
        console.log(`[${requestId}] OPTIONS ${req.url} → 204 (preflight)`);
        res.statusCode = 204;
        res.end();
        return;
      }

      // Health check
      if (
        req.url &&
        new URL(req.url, "http://localhost").pathname === "/healthz"
      ) {
        console.log(`[${requestId}] GET /healthz → 200 (health check)`);
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("ok");
        return;
      }

      const parsedUrl = new URL(req.url || "/", "http://localhost");
      const pathname = parsedUrl.pathname;

      console.log(
        `[${requestId}] → ${req.method} ${pathname}${parsedUrl.search}`
      );

      const { bestPrefix, bestTargetId } = findBestRoute(pathname);
      if (!bestPrefix || !bestTargetId) {
        const duration = Date.now() - startTime;
        console.error(
          `[${requestId}] ✗ 404 route_not_found: ${pathname} (${duration}ms)`
        );
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error: "route_not_found",
            message: "Не найден маршрут для данного пути",
            availablePrefixes: Object.keys(config.routes),
          })
        );
        return;
      }

      const target = config.targets[bestTargetId];
      if (!target) {
        const duration = Date.now() - startTime;
        console.error(
          `[${requestId}] ✗ 502 target_not_configured: ${bestTargetId} (${duration}ms)`
        );
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            error: "target_not_configured",
            message: `Целевой target '${bestTargetId}' не найден в config.targets`,
          })
        );
        return;
      }

      const pathAfterPrefix = pathname
        .slice(bestPrefix.length)
        .replace(/^\/+/, "");
      const targetPathPrefix = target.pathPrefix
        ? String(target.pathPrefix)
        : "";
      const targetUrl = new URL(
        joinUrlParts(target.baseUrl, targetPathPrefix, pathAfterPrefix) +
          parsedUrl.search
      );

      console.log(
        `[${requestId}] ⇒ ${bestTargetId}: ${req.method} ${targetUrl.href}`
      );

      const stripList = (config.stripRequestHeaders || []).map((h) =>
        h.toLowerCase()
      );
      const outgoingHeaders = filterOutgoingRequestHeaders(
        req.headers,
        stripList
      );
      applyTargetHeaders(outgoingHeaders, target.headers);

      // Логируем исходящие заголовки для отладки
      if (process.env.DEBUG_HEADERS === "true") {
        console.log(`[${requestId}] 📤 Исходящие заголовки:`);
        for (const [k, v] of outgoingHeaders.entries()) {
          const displayValue =
            k.toLowerCase() === "authorization"
              ? v.substring(0, 20) + "..."
              : v;
          console.log(`[${requestId}]   ${k}: ${displayValue}`);
        }
      }

      const controller = new AbortController();
      const method = req.method || "GET";
      const hasBody = !["GET", "HEAD"].includes(method.toUpperCase());

      const fetchInit = {
        method,
        headers: outgoingHeaders,
        signal: controller.signal,
      };

      if (hasBody) {
        // Для POST/PUT/PATCH запросов: буферизуем тело чтобы избежать проблем со стримингом
        console.log(`[${requestId}] 📥 Начало чтения тела запроса...`);
        const chunks = [];
        try {
          for await (const chunk of req) {
            chunks.push(chunk);
          }
        } catch (readErr) {
          console.error(
            `[${requestId}] ✗ Ошибка чтения тела запроса:`,
            readErr.message
          );
          throw new Error(
            `Не удалось прочитать тело запроса: ${readErr.message}`
          );
        }

        const bodyBuffer = Buffer.concat(chunks);
        console.log(
          `[${requestId}] 📥 Тело запроса прочитано: ${bodyBuffer.length} bytes`
        );

        if (bodyBuffer.length > 0) {
          fetchInit.body = bodyBuffer;
          // Устанавливаем правильный Content-Length
          outgoingHeaders.set("Content-Length", bodyBuffer.length.toString());

          if (process.env.DEBUG_HEADERS === "true") {
            console.log(
              `[${requestId}] 📦 Размер тела запроса: ${bodyBuffer.length} bytes`
            );
            try {
              const bodyText = bodyBuffer.toString("utf8");
              console.log(`[${requestId}] 📦 Тело запроса: ${bodyText}`);
            } catch (e) {
              console.log(`[${requestId}] 📦 Тело запроса (бинарное)`);
            }
          }
        }
      }

      // Abort upstream fetch if client disconnects
      let clientAborted = false;
      req.on("close", () => {
        if (!res.writableEnded) {
          clientAborted = true;
          console.warn(`[${requestId}] ⚠ Клиент закрыл соединение`);
        }
        try {
          controller.abort();
        } catch {}
      });

      let upstreamResponse;
      try {
        upstreamResponse = await fetch(targetUrl, fetchInit);
      } catch (fetchErr) {
        // Более детальная ошибка при проблемах с fetch
        if (fetchErr.name === "AbortError") {
          throw new Error(
            clientAborted
              ? "Клиент закрыл соединение до получения ответа от провайдера"
              : "Запрос к провайдеру был прерван"
          );
        }
        throw fetchErr;
      }

      const duration = Date.now() - startTime;
      console.log(
        `[${requestId}] ← ${upstreamResponse.status} ${upstreamResponse.statusText} (${duration}ms)`
      );

      // Определяем режим: стриминг можно включить глобально или для конкретного target
      const useStreaming = target.streaming ?? config.streaming ?? false;

      // Prepare response headers
      const filteredHeaders = filterResponseHeaders(
        upstreamResponse.headers,
        useStreaming
      );
      for (const [k, v] of Object.entries(filteredHeaders)) {
        res.setHeader(k, v);
      }
      // CORS headers may need to be present alongside upstream headers
      setCorsHeaders(res);

      res.statusCode = upstreamResponse.status;

      const body = upstreamResponse.body; // Web ReadableStream

      if (useStreaming) {
        // Стриминговый режим: передаём ответ потоково без буферизации
        console.log(`[${requestId}] ⇄ Стриминг включен`);
        if (body) {
          const nodeReadable = Readable.fromWeb(body);
          nodeReadable.on("error", (err) => {
            console.error(
              `[${requestId}] ✗ Ошибка чтения ответа:`,
              err.message || err
            );
            res.destroy(err);
          });
          nodeReadable.pipe(res);
        } else {
          res.end();
        }
      } else {
        // Буферизованный режим: загружаем весь ответ перед отправкой
        const responseBody = await upstreamResponse.arrayBuffer();
        const totalDuration = Date.now() - startTime;

        if (responseBody.byteLength > 0) {
          // Логируем ответ при ошибках для диагностики
          if (
            upstreamResponse.status >= 400 &&
            process.env.DEBUG_HEADERS === "true"
          ) {
            try {
              const bodyText = Buffer.from(responseBody).toString("utf8");
              console.error(
                `[${requestId}] ❌ Тело ответа (${upstreamResponse.status}): ${bodyText}`
              );
            } catch (e) {
              console.error(`[${requestId}] ❌ Тело ответа (бинарное)`);
            }
          }

          console.log(
            `[${requestId}] ✓ Отправка ответа (${responseBody.byteLength} bytes, ${totalDuration}ms)`
          );
          res.end(Buffer.from(responseBody));
        } else {
          console.log(`[${requestId}] ✓ Пустой ответ (${totalDuration}ms)`);
          res.end();
        }
      }
    } catch (err) {
      const duration = Date.now() - startTime;
      console.error(
        `[${requestId}] ✗ 502 bad_gateway: ${
          err.message || err
        } (${duration}ms)`
      );

      if (!res.headersSent) {
        res.statusCode = 502;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      const payload = {
        error: "bad_gateway",
        message: "Ошибка при проксировании",
        details: String((err && err.message) || err),
      };
      try {
        res.end(JSON.stringify(payload));
      } catch {
        try {
          res.end();
        } catch {}
      }
    }
  }
);

server.on("error", (err) => {
  console.error("[proxy] ❌ ОШИБКА ЗАПУСКА СЕРВЕРА:", err);
  if (err.code === "EADDRINUSE") {
    console.error(`[proxy] ❌ Порт ${config.port} уже занят другим процессом!`);
    console.error(
      `[proxy] 💡 Попробуйте: sudo lsof -i :${config.port} или sudo netstat -tuln | grep ${config.port}`
    );
  }
  process.exit(1);
});

server.on("connection", (socket) => {
  console.log(
    `[proxy] 🔌 Новое соединение от ${socket.remoteAddress}:${socket.remotePort}`
  );
});

server.on("clientError", (err, socket) => {
  console.error("[proxy] ❌ ОШИБКА КЛИЕНТА:", err.message);
  console.error("[proxy] ❌ Код ошибки:", err.code);
  if (!socket.destroyed) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log("==========================================");
  console.log(`[proxy] ✅ Сервер успешно запущен!`);
  console.log(`[proxy] 🌐 Порт: ${config.port}`);
  console.log(`[proxy] 🔗 URL: http://localhost:${config.port}`);
  console.log("[proxy] 📍 Префиксы маршрутов:", Object.keys(config.routes));
  console.log(
    "[proxy] 🐛 DEBUG_HEADERS:",
    process.env.DEBUG_HEADERS === "true" ? "включен" : "выключен"
  );
  console.log("==========================================");
  console.log("");
});
