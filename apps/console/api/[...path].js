import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const REQUEST_HEADER_BLOCKLIST = new Set(["connection", "host"]);
const RESPONSE_HEADER_BLOCKLIST = new Set([
  "connection",
  "content-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function buildProxyHeaders(req) {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined || REQUEST_HEADER_BLOCKLIST.has(name.toLowerCase())) continue;

    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  return headers;
}

async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length > 0) return Buffer.concat(chunks);
  if (req.body === undefined || req.body === null) return undefined;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);

  return Buffer.from(JSON.stringify(req.body));
}

function looksLikeCookieStart(value, index) {
  let cursor = index;
  while (value[cursor] === " ") cursor += 1;

  const nameStart = cursor;
  while (cursor < value.length) {
    const char = value[cursor];
    if (char === "=") return cursor > nameStart;
    if (char === "," || char === ";") return false;
    if (!/[!#$%&'*+\-.^_`|~0-9A-Za-z]/.test(char)) return false;
    cursor += 1;
  }

  return false;
}

function splitSetCookieHeader(value) {
  const cookies = [];
  let start = 0;
  let inQuotes = false;

  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (char === '"') inQuotes = !inQuotes;

    if (char === "," && !inQuotes && looksLikeCookieStart(value, cursor + 1)) {
      cookies.push(value.slice(start, cursor).trim());
      start = cursor + 1;
    }
  }

  cookies.push(value.slice(start).trim());
  return cookies.filter(Boolean);
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();

  const value = headers.get("set-cookie");
  return value ? splitSetCookieHeader(value) : [];
}

function stripCookieDomain(cookie) {
  return cookie.replace(/;\s*domain=[^;]*/gi, "");
}

function copyResponseHeaders(upstream, res) {
  const dropsContentLength = upstream.headers.has("content-encoding");

  for (const [name, value] of upstream.headers) {
    const lowerName = name.toLowerCase();
    if (lowerName === "set-cookie") continue;
    if (RESPONSE_HEADER_BLOCKLIST.has(lowerName)) continue;
    if (lowerName === "content-length" && dropsContentLength) continue;

    res.setHeader(name, value);
  }

  const setCookies = getSetCookieHeaders(upstream.headers).map(stripCookieDomain);
  if (setCookies.length > 0) res.setHeader("set-cookie", setCookies);
}

function sendText(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(message);
}

export default async function handler(req, res) {
  const backendBaseUrl = process.env.BENZO_API_URL?.trim().replace(/\/$/, "");

  if (!backendBaseUrl) {
    sendText(res, 500, "BENZO_API_URL is not set. Configure it to the deployed Benzo API base URL.");
    return;
  }

  const method = req.method ?? "GET";
  const target = backendBaseUrl + (req.url ?? "/api").replace(/^\/api/, "");

  try {
    const body = method === "GET" || method === "HEAD" ? undefined : await readRawBody(req);
    const upstream = await fetch(target, {
      method,
      headers: buildProxyHeaders(req),
      body,
      redirect: "manual",
    });

    res.statusCode = upstream.status;
    copyResponseHeaders(upstream, res);

    if (!upstream.body) {
      res.end();
      return;
    }

    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy error";

    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }

    sendText(res, 502, `Failed to proxy request to BENZO_API_URL: ${message}`);
  }
}
