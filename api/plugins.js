const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_MANIFEST = 12000;
const BUILTIN_PLUGINS = [
  { id: "calculator", name: "Smart Calculator", description: "Evaluate arithmetic expressions, percentages and powers.", category: "Productivity", icon: "∑", version: "1.0.0", source: "Thinkora", builtin: true },
  { id: "json-tools", name: "JSON Formatter", description: "Validate, format and minify JSON data.", category: "Developer", icon: "{ }", version: "1.0.0", source: "Thinkora", builtin: true },
  { id: "text-insights", name: "Text Insights", description: "Count words, characters, sentences and estimated reading time.", category: "Writing", icon: "Aa", version: "1.0.0", source: "Thinkora", builtin: true },
  { id: "slug-maker", name: "URL Slug Maker", description: "Convert titles into clean URL-friendly slugs.", category: "Developer", icon: "↗", version: "1.0.0", source: "Thinkora", builtin: true }
];
function runBuiltin(id, input) {
  const value = String(input ?? "");
  if (value.length > 30000) throw new Error("Input is too long (maximum 30,000 characters).");
  if (id === "calculator") {
    const s = value.replace(/\s+/g, "");
    if (!s || s.length > 180 || !/^[0-9.+*/()%\-^]+$/.test(s)) throw new Error("Enter a valid arithmetic expression.");
    let i = 0, peek = () => s[i] || "", eat = c => peek() === c ? (i++, true) : false;
    const atom = () => { if (eat("+")) return atom(); if (eat("-")) return -atom(); if (eat("(")) { const n = sum(); if (!eat(")")) throw new Error("Missing closing bracket."); return n; } const start=i; while (/[0-9.]/.test(peek())) i++; if (start===i) throw new Error("Expected a number."); const n=Number(s.slice(start,i)); if(!Number.isFinite(n)) throw new Error("Invalid number."); return n; };
    const power = () => { let n=atom(); if(eat("^")) n=Math.pow(n,power()); return n; };
    const product = () => { let n=power(); while(true){ if(eat("*")) n*=power(); else if(eat("/")){const d=power();if(!d)throw new Error("Cannot divide by zero.");n/=d;} else if(eat("%")) n/=100; else break;} return n; };
    const sum = () => { let n=product(); while(true){if(eat("+"))n+=product();else if(eat("-"))n-=product();else break;}return n; };
    const result=sum(); if(i!==s.length||!Number.isFinite(result))throw new Error("Expression is incomplete or result is outside the supported range.");
    return { result: String(Number(result.toPrecision(12))) };
  }
  if (id === "json-tools") { let parsed; try { parsed=JSON.parse(value); } catch(e) { throw new Error("Invalid JSON: "+e.message); } return { result: JSON.stringify(parsed,null,2), compact: JSON.stringify(parsed) }; }
  if (id === "text-insights") { const words=value.trim()?value.trim().split(/\s+/).length:0; const sentences=value.trim()?(value.match(/[.!?]+(?=\s|$)/g)||[]).length:0; return { result: "Words: "+words+"\nCharacters: "+value.length+"\nCharacters (without spaces): "+value.replace(/\s/g,"").length+"\nSentences: "+sentences+"\nEstimated reading time: "+(words?Math.max(1,Math.ceil(words/200))+" min":"0 min") }; }
  if (id === "slug-maker") return { result: value.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,180) };
  throw new Error("Unknown or unavailable built-in plugin.");
}


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
  try {
    if (req.method === "GET") {
      let community = [];
      try {
        const cfg = config();
        community = await supabase("/rest/v1/plugins?select=id,name,description,version,category,manifest,created_at&status=eq.approved&order=created_at.desc", { ...cfg }) || [];
      } catch (error) {
        // Built-in plugins remain available when the optional community database is not configured.
      }
      return json(res, 200, { plugins: [...BUILTIN_PLUGINS, ...community] });
    }
    const body = req.body || {};
    if (body.action === "execute") {
      try {
        const output = runBuiltin(String(body.pluginId || ""), body.input);
        return json(res, 200, { ok: true, plugin: body.pluginId, ...output });
      } catch (error) {
        return json(res, 400, { error: String(error.message || "Plugin execution failed.").slice(0, 240) });
      }
    }
    let cfg;
    try { cfg = config(); } catch (e) { return json(res, 503, { error: e.message }); }
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
