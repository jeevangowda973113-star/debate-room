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
      max_tokens: task === "debate" ? 1700 : 1200
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


async function callClaude(apiKey, systemInstruction, input, messages, task) {
  const claudeMessages = task === "chat" && messages.length
    ? messages.map(message => ({
        role: message.role === "model" ? "assistant" : "user",
        content: message.text.slice(0, 3000)
      }))
    : [{ role: "user", content: input }];

  const model = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    signal: AbortSignal.timeout(35000),
    body: JSON.stringify({
      model,
      max_tokens: task === "debate" ? 2200 : 1400,
      system: systemInstruction,
      messages: claudeMessages
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || "Claude request failed (" + response.status + ").";
    throw new Error(detail.slice(0, 220));
  }

  const reply = Array.isArray(data?.content)
    ? data.content.filter(block => block.type === "text" && typeof block.text === "string")
        .map(block => block.text).join("\n").trim()
    : "";
  if (!reply) throw new Error("Claude returned an empty response.");
  return { reply, model };
}

const THINKORA_CHAT_INSTRUCTION = `You are Thinkora AI, a capable general-purpose assistant inside the Thinkora project.

Your goal is to help users understand, create, plan, learn, and solve problems.
For every request:
1. Identify what the user is actually trying to achieve.
2. Use the conversation context when it is relevant; do not ask for information the user has already provided.
3. For difficult tasks, analyse the important parts, compare reasonable approaches, and check the answer for contradictions before responding.
4. Give the user the useful conclusion first, followed by clear reasoning or practical steps.
5. Separate verified facts from assumptions and opinions. Never invent statistics, sources, quotations, or capabilities.
6. If information may be outdated and you cannot verify it, say so clearly.
7. If a request is unclear, ask one focused clarification instead of guessing.
8. Match the user's level of knowledge and explain technical terms simply when helpful.
9. Be respectful, balanced, concise by default, and age-appropriate.
10. Do not reveal private internal chain-of-thought. Provide a brief explanation, key steps, or a concise rationale instead.

You do not have live web browsing or external tools in this API request. Never claim that you searched the internet, opened a website, ran code, or verified live information unless that action actually happened.`;

const THINKORA_DEBATE_INSTRUCTION = `You are Thinkora's debate moderator and critical-thinking analyst.

Run a fair, evidence-conscious analysis. First understand the exact question. Distinguish factual claims, assumptions, predictions, and value judgments. Present the strongest reasonable version of each side rather than weak arguments. Consider practical effects, affected groups, costs, risks, trade-offs, and missing evidence. Challenge assumptions on both sides. Never invent statistics, studies, sources, or quotations. If evidence is uncertain, say so. Do not pretend a simulated crowd vote is scientific evidence.

Use these exact headings:
ROUND 1 — INDEPENDENT ANALYSIS
Give the 2 strongest arguments FOR and 2 AGAINST. Explain the key assumptions behind them.

ROUND 2 — CHALLENGE AND REBUTTAL
Challenge the most important assumption on each side and give a fair rebuttal. Identify what evidence would help settle the disagreement.

ROUND 3 — FINAL JUDGMENT
Give a balanced, conditional verdict; the strongest reason; the main trade-off; and what could change the conclusion.

TOPIC DEFINITION
Write exactly 2 clear, neutral paragraphs explaining the topic, its context, and why it matters.

Keep the answer focused, readable, and suitable for a general audience. Do not reveal private internal chain-of-thought; give concise reasoning and conclusions.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { task = "chat", topic = "", messages = [] } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;\n    const claudeKey = process.env.ANTHROPIC_API_KEY;
    let input = "";
    let systemInstruction = THINKORA_CHAT_INSTRUCTION;
    let safeMessages = [];

    if (task === "debate") {
      if (typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "A topic is required." });
      systemInstruction = THINKORA_DEBATE_INSTRUCTION;
      input = "Analyse this debate topic using the required three-round structure:\n\n" + topic.slice(0, 1000);
    } else if (task === "definition") {
      if (typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "A topic is required." });
      systemInstruction = "You are Thinkora's neutral explainer. Explain topics clearly for a general audience. Define important terms, give relevant context, distinguish facts from opinions, and do not take either side. Never invent facts or sources. Do not reveal private internal chain-of-thought; provide a clear explanation.";
      input = "Write 2 or 3 complete, well-developed paragraphs explaining the topic, its context, and why it matters. Stay neutral. Topic: " + topic.slice(0, 1000);
    } else {
      safeMessages = (Array.isArray(messages) ? messages : []).slice(-10)
        .filter(m => ["user", "model"].includes(m?.role) && typeof m?.text === "string")
        .map(m => ({ role: m.role, text: m.text.slice(0, 3000) }));
      if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
        return res.status(400).json({ error: "Send a message to start the conversation." });
      }
      input = safeMessages.map(m => (m.role === "model" ? "Assistant: " : "User: ") + m.text).join("\n\n");
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
              max_output_tokens: task === "debate" ? 2200 : 1200
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

    let claudeFailure = null;
    if (claudeKey) {
      try {
        const result = await callClaude(claudeKey, systemInstruction, input, safeMessages, task);
        return res.status(200).json({
          reply: result.reply,
          model: result.model,
          provider: "Claude",
          fallback: true
        });
      } catch (error) {
        console.error("Claude fallback error:", error);
        claudeFailure = " Claude backup failed: " + error.message;
      }
    }

    if (groqKey) {
      try {
        const reply = await callGroq(groqKey, systemInstruction, input, safeMessages, task);
        return res.status(200).json({ reply, model: "openai/gpt-oss-120b", provider: "Groq", fallback: true });
      } catch (error) {
        console.error("Groq fallback error:", error);
        return res.status(502).json({
          error: geminiFailure + (claudeFailure || " Claude backup is not configured.") + " Groq backup also failed: " + error.message
        });
      }
    }

    return res.status(502).json({
      error: geminiFailure + (claudeFailure || " Add ANTHROPIC_API_KEY in Vercel to enable Claude backup.") +
        " Add GROQ_API_KEY in Vercel to enable Groq backup."
    });
  } catch (error) {
    console.error("Thinkora API error:", error);
    return res.status(500).json({ error: "The AI service could not complete this request. Please try again." });
  }
}
