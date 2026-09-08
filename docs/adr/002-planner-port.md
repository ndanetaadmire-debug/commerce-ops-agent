# ADR-002: Hide the LLM behind a narrow Planner port

**Status:** Accepted

## Context
Model providers change pricing, latency and behaviour constantly. Open-weight models served via Groq sometimes emit tool calls inline in `content` or with invalid JSON.

## Decision
The core depends on `Planner.decide(history, toolSpecs) → { tool | answer }`. One adapter targets any OpenAI-compatible endpoint and normalises quirks (inline `<function=…>` calls, malformed arguments). Tests use a `ScriptedPlanner`.

## Consequences
- Switching Groq ↔ Azure OpenAI ↔ self-hosted vLLM is configuration.
- CI is deterministic and free; no LLM calls in tests.
- Provider-specific features (e.g. parallel tool calls) are deliberately not exposed.
