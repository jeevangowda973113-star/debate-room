# Thinkora

**Think deeper. Build smarter.**

Thinkora is an independent AI application backend and debate workspace. The application code owns the chat workflow, conversation handling, task modes, safety instructions, and debate analysis. Model inference is intended to run on a model server that you control.

## Thinkora Debate Room

- Simulated crowd perspectives for exploring a debate topic
- Three-round AI debate analysis
- Neutral topic explanations
- General-purpose Thinkora AI chat
- Conversation context, coding, learning, reasoning, and creative response modes

## Self-hosted model setup

The `/api/chat` backend no longer calls Gemini or Groq. It sends requests to a self-hosted model server using an OpenAI-compatible chat-completions endpoint.

A practical development setup is Ollama:

1. Install Ollama on a computer or server that you control.
2. Download and run a model supported by your hardware, for example `ollama run qwen2.5:7b`.
3. Make Ollama's OpenAI-compatible endpoint reachable by the deployed Thinkora backend through a secure network or hosted server.
4. Configure these Vercel environment variables:

| Variable | Required | Meaning |
| --- | --- | --- |
| `THINKORA_MODEL_URL` | Yes | Full OpenAI-compatible endpoint, ending in `/v1/chat/completions` |
| `THINKORA_MODEL` | No | Model identifier accepted by your model server; defaults to `qwen2.5:7b` |
| `THINKORA_MODEL_API_KEY` | No | Bearer token if your model server requires authentication |

5. Redeploy Thinkora after setting the variables.

**Important:** Vercel hosts the Thinkora application and API code; it does not host model weights or provide GPU inference. The model server must be running and reachable. Do not put a private model server on the public internet without authentication and appropriate network protection. A local address such as `localhost` on your laptop will not be reachable from Vercel.

## Project structure

- `index.html` — web interface
- `api/chat.js` — Thinkora backend, prompt workflow, context handling, and self-hosted model connection

**Thinkora — Think deeper. Build smarter.**
