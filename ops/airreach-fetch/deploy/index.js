// src/index.ts
var MAX_BYTES = 9e5;
var MAX_REDIRECTS = 3;
var FETCH_TIMEOUT_MS = 12e3;
var USER_AGENT = "TrillionBank-AirReach/1.0 (+https://trillion-bank.jp/airreach/; readiness-check)";
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "https://trillion-bank.jp",
  "http://127.0.0.1:4000",
  "http://localhost:4000",
  "http://127.0.0.1:8765",
  "http://localhost:8765"
]);
var BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".lan", ".home", ".corp"];
var BLOCKED_HOSTS = /* @__PURE__ */ new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google.com",
  "kubernetes.default",
  "kubernetes.default.svc"
]);
var index_default = {
  async fetch(request) {
    const origin = request.headers.get("Origin");
    const corsOrigin = resolveCorsOrigin(origin);
    if (request.method === "OPTIONS") {
      return handleOptions(request, corsOrigin);
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return jsonError(405, "Method not allowed", corsOrigin);
    }
    if (origin && !corsOrigin) {
      return jsonError(403, "Origin not allowed", null);
    }
    const reqUrl = new URL(request.url);
    if (reqUrl.pathname !== "/" && reqUrl.pathname !== "/fetch") {
      return jsonError(404, "Not found", corsOrigin);
    }
    const targetRaw = reqUrl.searchParams.get("url");
    if (!targetRaw) {
      return jsonError(400, "Missing url query parameter", corsOrigin);
    }
    let target;
    try {
      target = sanitizeTargetUrl(targetRaw);
    } catch (err) {
      return jsonError(400, err instanceof Error ? err.message : "Invalid URL", corsOrigin);
    }
    try {
      const upstream = await fetchPublicDocument(target);
      if (request.method === "HEAD") {
        return new Response(null, {
          status: upstream.status,
          headers: corsHeaders(corsOrigin, {
            "Content-Type": upstream.contentType,
            "X-AirReach-Final-URL": upstream.finalUrl,
            "Cache-Control": "private, max-age=60"
          })
        });
      }
      return new Response(upstream.body, {
        status: upstream.status,
        headers: corsHeaders(corsOrigin, {
          "Content-Type": upstream.contentType,
          "X-AirReach-Final-URL": upstream.finalUrl,
          "Cache-Control": "private, max-age=60"
        })
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fetch failed";
      const status = /timeout|aborted/i.test(message) ? 504 : 502;
      return jsonError(status, message, corsOrigin);
    }
  }
};
function resolveCorsOrigin(origin) {
  if (!origin) return "https://trillion-bank.jp";
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  return null;
}
function handleOptions(request, corsOrigin) {
  if (!corsOrigin) {
    return new Response(null, { status: 403 });
  }
  const reqHeaders = request.headers.get("Access-Control-Request-Headers") || "Content-Type";
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": reqHeaders,
      "Access-Control-Max-Age": "86400",
      Vary: "Origin"
    }
  });
}
function corsHeaders(corsOrigin, extra = {}) {
  const headers = new Headers(extra);
  if (corsOrigin) {
    headers.set("Access-Control-Allow-Origin", corsOrigin);
    headers.set("Vary", "Origin");
  }
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}
function jsonError(status, message, corsOrigin) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: corsHeaders(corsOrigin, { "Content-Type": "application/json; charset=utf-8" })
  });
}
function sanitizeTargetUrl(input) {
  let raw = String(input || "").trim();
  if (!raw) throw new Error("URL is empty");
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL format is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https are allowed");
  }
  url.username = "";
  url.password = "";
  const drop = [
    "token",
    "access_token",
    "auth",
    "key",
    "api_key",
    "apikey",
    "session",
    "sig",
    "signature",
    "password",
    "passwd"
  ];
  for (const k of drop) url.searchParams.delete(k);
  for (const k of Array.from(url.searchParams.keys())) {
    if (/token|secret|auth|key|session|sig/i.test(k)) url.searchParams.delete(k);
  }
  assertPublicHostname(url);
  return url;
}
function assertPublicHostname(url) {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) throw new Error("Hostname is missing");
  if (BLOCKED_HOSTS.has(host)) throw new Error("Hostname is not allowed");
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error("Hostname is not allowed");
  }
  if (host === "0.0.0.0" || host === "::" || host === "::1") {
    throw new Error("IP address is not allowed");
  }
  if (isIpLiteral(host) && isPrivateOrReservedIp(host)) {
    throw new Error("Private or reserved IP is not allowed");
  }
}
function isIpLiteral(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(":")) return true;
  return false;
}
function isPrivateOrReservedIp(ip) {
  if (ip.includes(":")) {
    const normalized = ip.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.") || /^::ffff:(172\.(1[6-9]|2\d|3[0-1])\.)/.test(normalized);
  }
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}
async function fetchPublicDocument(start) {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertPublicHostname(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "User-Agent": USER_AGENT,
          "Accept-Language": "ja,en;q=0.8"
        },
        cf: {
          cacheTtl: 0,
          cacheEverything: false
        }
      });
    } finally {
      clearTimeout(timer);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (!location) throw new Error("Redirect without Location");
      const next = new URL(location, current);
      current = sanitizeTargetUrl(next.toString());
      continue;
    }
    if (!response.ok) {
      throw new Error(`Upstream HTTP ${response.status}`);
    }
    const contentType = (response.headers.get("Content-Type") || "text/html; charset=utf-8").split(";")[0].trim();
    if (contentType && !/^(text\/html|application\/xhtml\+xml|text\/plain|text\/markdown|application\/json)/i.test(contentType)) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }
    const lengthHeader = response.headers.get("Content-Length");
    if (lengthHeader && Number(lengthHeader) > MAX_BYTES) {
      throw new Error("Response too large");
    }
    const body = await readBodyLimited(response, MAX_BYTES);
    return {
      status: response.status,
      body,
      contentType: response.headers.get("Content-Type") || "text/html; charset=utf-8",
      finalUrl: current.toString()
    };
  }
  throw new Error("Too many redirects");
}
async function readBodyLimited(response, maxBytes) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
export {
  index_default as default
};
