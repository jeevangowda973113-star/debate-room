export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Gemini is not configured. Check GEMINI_API_KEY in Vercel Production environment variables." });

  try {
    const { task = "chat", topic = "", round = 0, previous = "", messages = [] } = req.body || {};
    let input = "";
    let systemInstruction = "You are the helpful AI inside Debate Room. Be clear, balanced, accurate, and age-appropriate. Explain uncertainty and never invent facts.";

    if (task === "debate") {
      const prompts = {
        1: "ROUND 1 — INDEPENDENT ANALYSIS. Examine both sides of this topic. Give the strongest 3 arguments FOR and 3 AGAINST. Explain practical effects, assumptions and who is affected. Do not decide a winner. Keep it concise but useful.",
        2: "ROUND 2 — CHALLENGE AND REBUTTAL. Challenge weak assumptions on both sides of the previous arguments. Give rebuttals, identify missing evidence and trade-offs, and explain what could change each side's view. Avoid repetition.",
        3: "ROUND 3 — FINAL JUDGMENT. Give a balanced conclusion. Explain the strongest arguments and why, important conditions or caveats, and what a reasonable person should consider. Be clear about uncertainty."
      };
      if (!topic.trim() || !prompts[round]) return res.status(400).json({ error: "A topic and valid debate round are required." });
      systemInstruction = "You are the lead moderator of Debate Room. Conduct a fair, evidence-conscious debate. Never invent statistics, sources or quotations. Use clear language suitable for a general audience.";
      input = prompts[round] + "\n\nTOPIC: " + topic.slice(0, 1000) + (previous ? "\n\nPREVIOUS ROUNDS:\n" + previous.slice(0, 5000) : "");
    } else if (task === "definition") {
      if (!topic.trim()) return res.status(400).json({ error: "A topic is required." });
      systemInstruction = "Explain topics neutrally and clearly for a general audience. Do not take either side.";
      input = "Write 2 or 3 complete, well-developed paragraphs (at least 2). First explain the topic simply and define key terms. Second provide context and why it matters in real life. Optional third paragraph: a simple example or important distinction. Stay neutral. Topic: " + topic.slice(0, 1000);
    } else {
      const safeMessages = (Array.isArray(messages) ? messages : []).slice(-12)
        .filter(m => ["user", "model"].includes(m?.role) && typeof m?.text === "string");
      if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
        return res.status(400).json({ error: "Send a message to start the conversation." });
      }
      input = safeMessages.map(m => (m.role === "model" ? "Assistant: " : "User: ") + m.text.slice(0, 4000)).join("\n\n");
    }

    // Gemini Interactions API, with low thinking effort to reduce latency.
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(50000),
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        input,
        system_instruction: systemInstruction,
        store: false,
        generation_config: { thinking_level: "low" }
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || "Gemini request failed (" + response.status + ").";
      console.error("Gemini Interactions API error:", response.status, detail);
      const message = response.status === 429
        ? "Gemini is busy or the API usage limit was reached. Wait a little and try again."
        : response.status >= 500
          ? "Gemini is temporarily unavailable. Please try again shortly."
          : "Gemini API error: " + detail.slice(0, 220);
      return res.status(response.status === 429 ? 429 : 502).json({ error: message });
    }

    let reply = typeof data.output_text === "string" ? data.output_text.trim() : "";
    if (!reply && Array.isArray(data.steps)) {
      reply = data.steps.filter(step => step.type === "model_output")
        .flatMap(step => step.content || [])
        .filter(part => part.type === "text" && typeof part.text === "string")
        .map(part => part.text).join("\n").trim();
    }
    if (!reply) {
      console.error("Gemini response had no output text:", JSON.stringify(data).slice(0, 1500));
      return res.status(502).json({ error: "Gemini returned an empty response. Please try again." });
    }
    return res.status(200).json({ reply, model: "gemini-3.8-flash" });
  } catch (error) {
    console.error("Gemini endpoint error:", error);
    return res.status(error.name === "TimeoutError" ? 504 : 500).json({
      error: error.name === "TimeoutError" ? "Gemini took too long to respond. Please try again." : "Could not connect to Gemini. Please try again."
    });
  }
}
