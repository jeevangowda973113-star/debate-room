export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Gemini is not configured yet. Add GEMINI_API_KEY in Vercel Environment Variables." });
  }

  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const safeMessages = messages
      .slice(-16)
      .filter((m) => ["user", "model"].includes(m?.role) && typeof m?.text === "string")
      .map((m) => ({
        role: m.role,
        parts: [{ text: m.text.slice(0, 6000) }]
      }));

    if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
      return res.status(400).json({ error: "Send a message to start the conversation." });
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are the helpful AI assistant inside Debate Room. Answer questions clearly and naturally, like a capable general-purpose assistant. Explain reasoning in a concise, understandable way, ask a clarifying question when needed, and remember the conversation context supplied in the messages. Be honest about uncertainty. Do not claim to browse the web or perform actions unless a tool actually provides that ability. Keep responses safe and age-appropriate."
            }]
          },
          contents: safeMessages,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1200
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data?.error?.message || response.status);
      return res.status(response.status === 429 ? 429 : 502).json({
        error: response.status === 429
          ? "Gemini's free usage limit may have been reached. Please wait and try again."
          : "Gemini could not answer right now. Please try again."
      });
    }

    const answer = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!answer) {
      return res.status(502).json({ error: "Gemini returned an empty response. Try asking in a different way." });
    }

    return res.status(200).json({ reply: answer });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
