export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "Gemini is not configured. Check GEMINI_API_KEY in Vercel Production environment variables." });

  try {
    const { task = "chat", topic = "", round = 0, previous = "", messages = [] } = req.body || {};
    let contents = [];
    let systemText = "You are the helpful AI inside Debate Room. Be clear, balanced, accurate, and age-appropriate. Explain uncertainty and never invent facts.";

    if (task === "debate") {
      const prompts = {
        1: "ROUND 1 — INDEPENDENT ANALYSIS. For the debate topic below, independently examine both sides. Give the strongest 3 arguments FOR and strongest 3 arguments AGAINST. Identify assumptions, practical consequences, and who is affected. Do not decide the winner yet. Be specific and balanced.",
        2: "ROUND 2 — CHALLENGE AND REBUTTAL. Review the previous round's arguments below. Challenge weak assumptions on BOTH sides, give thoughtful rebuttals, identify missing evidence and trade-offs, and explain what evidence would change each side's view. Do not simply repeat the previous answer.",
        3: "ROUND 3 — FINAL JUDGMENT. Consider the full debate below. Give a balanced conclusion, explain which arguments are strongest and why, identify important conditions or caveats, and state what a reasonable person should consider before deciding. Do not pretend uncertainty is certainty."
      };
      if (!topic.trim() || !prompts[round]) return res.status(400).json({ error: "A topic and valid debate round are required." });
      systemText = "You are the lead moderator and analyst of Debate Room. Your job is to conduct a rigorous, fair, evidence-conscious debate. Never fabricate statistics, sources, or quotations. Keep the language clear and suitable for a general audience.";
      contents = [{ role: "user", parts: [{ text: prompts[round] + "\n\nTOPIC: " + topic.slice(0, 1200) + (previous ? "\n\nPREVIOUS ROUND:\n" + previous.slice(0, 9000) : "") }] }];
    } else if (task === "definition") {
      if (!topic.trim()) return res.status(400).json({ error: "A topic is required." });
      systemText = "You explain topics neutrally and clearly for a general audience. Do not take either side.";
      contents = [{ role: "user", parts: [{ text: "Write 2 to 3 complete, well-developed paragraphs (at least 2). Paragraph 1: explain the topic simply and define key terms. Paragraph 2: provide context and explain why it matters in real life. Optional paragraph 3: give a simple example or important distinction. Keep it neutral and educational. Topic: " + topic.slice(0, 1200) }] }];
    } else {
      const safeMessages = (Array.isArray(messages) ? messages : []).slice(-16)
        .filter(m => ["user", "model"].includes(m?.role) && typeof m?.text === "string")
        .map(m => ({ role: m.role, parts: [{ text: m.text.slice(0, 6000) }] }));
      if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
        return res.status(400).json({ error: "Send a message to start the conversation." });
      }
      contents = safeMessages;
    }

    const models = ["gemini-3.8-flash", "gemini-2.5-flash"];
    let lastError = "Gemini could not answer right now.";
    for (const model of models) {
      let response;
      try {
        response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          signal: AbortSignal.timeout(25000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemText }] },
            contents,
            generationConfig: { temperature: 0.6, maxOutputTokens: task === "debate" ? 900 : task === "definition" ? 650 : 1200 }
          })
        });
      } catch (error) {
        lastError = error.name === "TimeoutError" ? "Gemini took too long to respond. Please try again." : "Could not connect to Gemini. Please try again.";
        continue;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = data?.error?.message || "Gemini request failed (" + response.status + ").";
        if ([429, 500, 502, 503, 504].includes(response.status)) continue;
        return res.status(502).json({ error: "Gemini could not answer: " + lastError.slice(0, 240) });
      }
      const reply = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
      if (reply) return res.status(200).json({ reply, model });
      lastError = "Gemini returned an empty response.";
    }
    console.error("Gemini request failed:", lastError);
    return res.status(502).json({ error: lastError });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
