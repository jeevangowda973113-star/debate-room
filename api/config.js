export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  const supabaseUrl = process.env.SUPABASE_URL || "";
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    configured: Boolean(supabaseUrl && supabaseAnonKey)
  });
}
