# Thinkora AI reasoning support

Thinkora's AI endpoint lives in `api/chat.js`. It uses the configured Gemini model first and can fall back to Groq when a Groq API key is configured.

## What this update adds

- A clearer assistant instruction for understanding the user's goal and relevant conversation context.
- A problem-solving workflow for complex requests: analyse, compare options, check consistency, and explain the result.
- Better separation of facts, assumptions, opinions, and uncertainty.
- Stronger debate guidance: steelman both sides, challenge assumptions, identify trade-offs, and state what evidence could change the verdict.
- A reminder not to claim live web searches, code execution, or verification unless those actions actually happened.
- Clear explanations instead of exposing private internal chain-of-thought.

## Simplified educational model

The following Python example illustrates the *workflow* used to organise an AI request. It is not the source code or architecture of Gemini, Groq, or any other foundation model.

```python
class ThinkoraReasoning:
    def understand(self, prompt, conversation=None):
        return {
            "goal": prompt.strip(),
            "context": conversation or [],
        }

    def make_plan(self, request):
        return [
            "Understand the user's goal",
            "Use relevant conversation context",
            "Break a complex task into smaller parts",
            "Compare possible answers",
            "Check assumptions and uncertainty",
            "Present a clear conclusion and useful steps",
        ]

    def answer_outline(self, request):
        plan = self.make_plan(request)
        return {
            "goal": request["goal"],
            "approach": plan,
            "response_style": "clear, balanced, and age-appropriate",
        }


assistant = ThinkoraReasoning()
request = assistant.understand("How can I improve my small business?")
print(assistant.answer_outline(request))
```

## Important

This workflow improves the instructions sent to the configured AI models; it does not train a new model or guarantee that every answer is correct. Actual model capability and availability depend on the provider, model access, and configured API keys.
