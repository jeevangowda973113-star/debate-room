const crypto = require("crypto");

const buckets = new Map();
const MAX_LOCAL_BUCKETS = 5000;
const WINDOW_MS = 60_000;

function clientId(req) {
  const ip = req.headers["x-real-ip"] ||
    String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress || "unknown";
  return crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);
}

async function distributedCount(key, windowMs) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return n";
  const response = await fetch(url.replace(/\/$/, ""), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", script, "1", key, String(windowMs)]),
    signal: AbortSignal.timeout(1500)
  });
  if (!response.ok) throw new Error("Rate-limit store unavailable");
  const data = await response.json();
  if (typeof data.result !== "number") throw new Error("Invalid rate-limit response");
  return data.result;
}

function localCount(key, now, windowMs) {
  let entry = buckets.get(key);
  if (!entry || now - entry.start >= windowMs) entry = { start: now, count: 0 };
  entry.count += 1;
  buckets.set(key, entry);
  if (buckets.size > MAX_LOCAL_BUCKETS) {
    for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
    if (buckets.size > MAX_LOCAL_BUCKETS) buckets.clear();
  }
  return entry.count;
}

async function guardRequest(req, options = {}) {
  const name = options.name || "api";
  const limit = options.limit || 30;
  const windowMs = options.windowMs || WINDOW_MS;
  const maxBytes = options.maxBytes || 1_000_000;
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > maxBytes) {
    return { ok: false, status: 413, error: "Request is too large." };
  }
  if (req.body !== undefined) {
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(req.body)); } catch { size = maxBytes + 1; }
    if (size > maxBytes) return { ok: false, status: 413, error: "Request is too large." };
  }
  const key = "thinkora:rl:" + name + ":" + clientId(req);
  let count;
  let distributed = false;
  try {
    count = await distributedCount(key, windowMs);
    distributed = count !== null;
  } catch (error) {
    console.warn("Thinkora shared rate-limit store unavailable; using per-instance fallback:", String(error.message || error));
  }
  if (count === undefined || count === null) count = localCount(key, Date.now(), windowMs);
  return {
    ok: count <= limit,
    status: 429,
    error: "Too many requests. Please wait a minute and try again.",
    limit,
    remaining: Math.max(0, limit - count),
    distributed
  };
}

module.exports = { guardRequest };
