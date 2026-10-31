const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_MANIFEST = 12000;

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}
function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Plugin backend is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.");
  return { url: url.replace(/\/$/, ""), key };
}
async function supabase(path, { url, key, token, method = "GET", body, prefer } = {}) {
  const response = await fetch(url + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + (token || key),
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}
  if (!response.ok) {
    const error = data?.message || data?.msg || "Database request failed";
    const e = new Error(error); e.status = response.status; throw e;
  }
  return data;
}
async function requireUser(req, cfg) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) { const e = new Error("Sign in is required."); e.status = 401; throw e; }
  const response = await fetch(cfg.url + "/auth/v1/user", {
    headers: { apikey: cfg.key, Authorization: "Bearer " + token }
  });
  if (!response.ok) { const e = new Error("Your session is invalid or expired."); e.status = 401; throw e; }
  const user = await response.json();
  return { user, token };
}
module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return json(res, 405, { error: "Method not allowed." });
  }
  let cfg;
  try { cfg = config(); }
  catch (e) { return json(res, 503, { error: e.message }); }
  try {
    if (req.method === "GET") {
      const rows = await supabase("/rest/v1/plugins?select=id,name,description,version,category,manifest,created_at&status=eq.approved&order=created_at.desc", { ...cfg });
      return json(res, 200, { plugins: rows || [] });
    }
    const body = req.body || {};
    const { user, token } = await requireUser(req, cfg);
    if (body.action === "submit") {
      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      const version = String(body.version || "1.0.0").trim();
      const category = String(body.category || "Utilities").trim();
      const manifest = body.manifest;
      if (!name || name.length > MAX_NAME || !description || description.length > MAX_DESCRIPTION) {
        return json(res, 400, { error: "Provide a plugin name (up to 80 characters) and description (up to 500 characters)." });
      }
      if (!manifest || typeof manifest !== "object" || JSON.stringify(manifest).length > MAX_MANIFEST) {
        return json(res, 400, { error: "A valid plugin manifest under 12 KB is required." });
      }
      if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
        return json(res, 400, { error: "Version must use semantic format, such as 1.0.0." });
      }
      const created = await supabase("/rest/v1/plugins", {
        ...cfg, token, method: "POST", prefer: "return=representation",
        body: { owner_id: user.id, name, description, version, category, manifest, status: "pending" }
      });
      return json(res, 201, { submission: created?.[0] || null, message: "Plugin submitted for review. It is not executable until approved." });
    }
    if (body.action === "install" || body.action === "uninstall") {
      const pluginId = String(body.pluginId || "");
      if (!/^[0-9a-f-]{36}$/i.test(pluginId)) return json(res, 400, { error: "A valid plugin ID is required." });
      if (body.action === "install") {
        await supabase("/rest/v1/plugins?id=eq." + encodeURIComponent(pluginId) + "&status=eq.approved&select=id", { ...cfg, token });
        const rows = await supabase("/rest/v1/plugin_installs", {
          ...cfg, token, method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
          body: { user_id: user.id, plugin_id: pluginId }
        });
        return json(res, 200, { installed: true });
      }
      await supabase("/rest/v1/plugin_installs?user_id=eq." + encodeURIComponent(user.id) + "&plugin_id=eq." + encodeURIComponent(pluginId), {
        ...cfg, token, method: "DELETE", prefer: "return=minimal"
      });
      return json(res, 200, { installed: false });
    }
    return json(res, 400, { error: "Unknown action. Use submit, install or uninstall." });
  } catch (e) {
    return json(res, e.status || 500, { error: e.status ? e.message : "Plugin service error. Check Supabase configuration and database policies." });
  }
};
