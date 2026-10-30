async function callGroq(apiKey, systemInstruction, input, messages, task) {
  const groqMessages = [{ role: "system", content: systemInstruction }];
  if (task === "chat" && messages.length) {
    for (const message of messages) {
      groqMessages.push({
        role: message.role === "model" ? "assistant" : "user",
        content: message.text.slice(0, 3000)
      });
    }
  } else {
    groqMessages.push({ role: "user", content: input });
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey
    },
    signal: AbortSignal.timeout(35000),
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: groqMessages,
      temperature: 0.5,
      max_tokens: task === "debate" ? 1700 : 900
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || "Groq request failed (" + response.status + ").";
    throw new Error(detail.slice(0, 220));
  }
  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("Groq returned an empty response.");
  }
  return reply.trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { task = "chat", topic = "", messages = [] } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    let input = "";
    let systemInstruction = "You are the helpful AI inside Debate Room. Be clear, balanced, accurate, and age-appropriate. Explain uncertainty and never invent facts.";
    let safeMessages = [];

    if (task === "debate") {
      if (typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "A topic is required." });
      systemInstruction = "You are the lead moderator of Debate Room. Conduct a fair, evidence-conscious debate. Never invent statistics, sources or quotations. Use clear language suitable for a general audience.";
      input = "Give a concise but useful three-round debate. Use these exact headings:\n\nROUND 1 — INDEPENDENT ANALYSIS\nGive the 2 strongest arguments FOR and 2 AGAINST.\n\nROUND 2 — CHALLENGE AND REBUTTAL\nChallenge the key assumption on each side and give a clear rebuttal.\n\nROUND 3 — FINAL JUDGMENT\nGive a balanced verdict, strongest reason, key trade-off and what evidence could change the conclusion.\n\nTOPIC DEFINITION\nWrite exactly 2 clear, neutral paragraphs explaining the topic, its context and why it matters.\n\nKeep the entire answer focused and avoid repetition. TOPIC: " + topic.slice(0, 1000);
    } else if (task === "definition") {
      if (typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "A topic is required." });
      systemInstruction = "Explain topics neutrally and clearly for a general audience. Do not take either side.";
      input = "Write 2 or 3 complete, well-developed paragraphs explaining the topic, its context and why it matters. Stay neutral. Topic: " + topic.slice(0, 1000);
    } else {
      safeMessages = (Array.isArray(messages) ? messages : []).slice(-10)
        .filter(m => ["user", "model"].includes(m?.role) && typeof m?.text === "string");
      if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
        return res.status(400).json({ error: "Send a message to start the conversation." });
      }
      input = safeMessages.map(m => (m.role === "model" ? "Assistant: " : "User: ") + m.text.slice(0, 3000)).join("\n\n");
    }

    let geminiFailure = null;
    if (geminiKey) {
      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
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
        if (response.ok) {
          let reply = typeof data.output_text === "string" ? data.output_text.trim() : "";
          if (!reply && Array.isArray(data.steps)) {
            reply = data.steps.filter(step => step.type === "model_output")
              .flatMap(step => step.content || [])
              .filter(part => part.type === "text" && typeof part.text === "string")
              .map(part => part.text).join("\n").trim();
          }
          if (reply) return res.status(200).json({ reply, model: "gemini-3.8-flash", provider: "Gemini" });
          geminiFailure = "Gemini returned an empty response.";
        } else {
          const detail = data?.error?.message || "Gemini request failed (" + response.status + ").";
          console.error("Gemini API error:", response.status, detail);
          geminiFailure = response.status === 429
            ? "Gemini free-tier limit reached."
            : "Gemini temporarily unavailable: " + detail.slice(0, 180);
        }
      } catch (error) {
        console.error("Gemini connection error:", error);
        geminiFailure = error.name === "TimeoutError" ? "Gemini timed out." : "Could not connect to Gemini.";
      }
    } else {
      geminiFailure = "Gemini API key is not configured.";
    }

    if (groqKey) {
      try {
        const reply = await callGroq(groqKey, systemInstruction, input, safeMessages, task);
        return res.status(200).json({ reply, model: "openai/gpt-oss-120b", provider: "Groq", fallback: true });
      } catch (error) {
        console.error("Groq fallback error:", error);
        return res.status(502).json({
          error: geminiFailure + " Groq backup also failed: " + error.message
        });
      }
    }

    return res.status(502).json({
      error: geminiFailure + " Add GROQ_API_KEY in Vercel to enable automatic backup."
    });
  } catch (error) {
    console.error("Debate Room API error:", error);
    return res.status(500).json({ error: "The AI service could not complete this request. Please try again." });
  }
}
