export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Gemini is not configured. Check GEMINI_API_KEY in Vercel Production environment variables." });

  try {
    const { task = "chat", topic = "", messages = [] } = req.body || {};
    let input = "";
    let systemInstruction = "You are the helpful AI inside Debate Room. Be clear, balanced, accurate, and age-appropriate. Explain uncertainty and never invent facts.";

    if (task === "debate") {
      if (!topic.trim()) return res.status(400).json({ error: "A topic is required." });
      systemInstruction = "You are the lead moderator of Debate Room. Conduct a fair, evidence-conscious debate. Never invent statistics, sources or quotations. Use clear language suitable for a general audience.";
      input = "Give a concise but useful three-round debate. Use these exact headings:\n\nROUND 1 — INDEPENDENT ANALYSIS\nGive the 2 strongest arguments FOR and 2 AGAINST.\n\nROUND 2 — CHALLENGE AND REBUTTAL\nChallenge the key assumption on each side and give a clear rebuttal.\n\nROUND 3 — FINAL JUDGMENT\nGive a balanced verdict, strongest reason, key trade-off and what evidence could change the conclusion.\n\nTOPIC DEFINITION\nWrite exactly 2 clear, neutral paragraphs explaining the topic, its context and why it matters.\n\nKeep the entire answer focused and avoid repetition. TOPIC: " + topic.slice(0, 1000);
    } else {
      if (task === "definition") {
        if (!topic.trim()) return res.status(400).json({ error: "A topic is required." });
        systemInstruction = "Explain topics neutrally and clearly for a general audience. Do not take either side.";
        input = "Write 2 or 3 complete, well-developed paragraphs explaining the topic, its context and why it matters. Stay neutral. Topic: " + topic.slice(0, 1000);
      } else {
        const safeMessages = (Array.isArray(messages) ? messages : []).slice(-10)
          .filter(m => ["user", "model"].includes(m?.role) && typeof m?.text === "string");
        if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
          return res.status(400).json({ error: "Send a message to start the conversation." });
        }
        input = safeMessages.map(m => (m.role === "model" ? "Assistant: " : "User: ") + m.text.slice(0, 3000)).join("\n\n");
      }
    }

    // Official Gemini Interactions API: thinking_level is a top-level field.
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(35000),
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        input,
        system_instruction: systemInstruction,
        generation_config: {
          thinking_level: "low",
          max_output_tokens: task === "debate" ? 1700 : 900
        },
        store: false
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.error?.message || "Gemini request failed (" + response.status + ").";
      console.error("Gemini Interactions API error:", response.status, detail);
      const message = response.status === 429
        ? "Gemini daily free-tier request limit reached. It should reset after the time shown in Google AI Studio. Debate Room now uses one Gemini request per debate instead of four."
        : response.status >= 500
          ? "Gemini is temporarily busy. Please try again shortly."
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
    if (!reply) return res.status(502).json({ error: "Gemini returned an empty response. Please try again." });
    return res.status(200).json({ reply, model: "gemini-3.8-flash" });
  } catch (error) {
    console.error("Gemini endpoint error:", error);
    return res.status(error.name === "TimeoutError" ? 504 : 500).json({
      error: error.name === "TimeoutError" ? "Gemini took too long to respond. Please try again." : "Could not connect to Gemini. Please try again."
    });
  }
}
