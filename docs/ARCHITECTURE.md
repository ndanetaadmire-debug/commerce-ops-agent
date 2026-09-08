# Architecture

## Goals and non-goals

**Goals**
1. Answer the four questions that make up most retail support volume — *is it in stock, where is my order, when will it arrive, I want my money back* — accurately, from live data.
2. Make unsafe behaviour **structurally impossible**, not merely discouraged by a prompt.
3. Stay provider-agnostic and fully testable offline.

**Non-goals**
- Autonomously moving money. The agent opens tickets; humans (or an explicit policy in code) approve refunds.
- Open-ended chit-chat. Off-topic requests get a short redirect.

## Layering (ports & adapters)

```
            ┌─────────────────────────── http/ ───────────────────────────┐
            │ Fastify · SSE · webhooks (HMAC, idempotency) · rate limit   │
            └──────────────────────────────┬──────────────────────────────┘
                                           │
            ┌──────────────────────── agent/ (core) ──────────────────────┐
            │  LangGraph state machine  ·  guardrails/  ·  tools/         │
            │  depends ONLY on ports/                                     │
            └───────────────┬─────────────────────────────┬───────────────┘
                            │ CommercePort                │ Planner
            ┌───────────────▼──────────┐     ┌────────────▼──────────────┐
            │ ShopifyCommerce          │     │ OpenAiCompatiblePlanner   │
            │ InMemoryCommerce         │     │ ScriptedPlanner (tests)   │
            └──────────────────────────┘     └───────────────────────────┘
```

The core never imports a vendor SDK. That is what lets the test suite run the *real* graph with a `ScriptedPlanner` and `InMemoryCommerce`, and what makes switching Groq → Azure OpenAI a config change.

## The graph

| Node | Kind | Responsibility |
|---|---|---|
| `guard` | deterministic | Size cap, Unicode normalisation, injection and exfiltration patterns. Blocks → `END` with a safe redirect. |
| `plan` | LLM | Returns exactly one decision: call one tool, or answer. Provider errors are caught and routed to `handoff`. |
| `act` | deterministic | Validates arguments with Zod, executes, normalises errors into `{ ok:false, retryable }`, appends to the **ledger**. |
| `finalize` | deterministic | Output guard compares claims with the ledger and corrects them. |
| `handoff` | deterministic | Reached on step budget exhaustion or planner failure. Never leaves the customer without a reply. |

State uses LangGraph reducers: `history`, `ledger` and `trace` are append-only; `steps` is additive; `pending`, `final` and `outcome` are last-write-wins. The append-only **ledger** is the source of truth the output guard checks against.

### Why one tool per step?

Parallel tool calls make the ledger order non-deterministic and the output guard harder to reason about. Retail questions rarely need more than two sequential calls, so the latency cost is small and the safety gain is large.

## Security model

| Threat | Control | Where |
|---|---|---|
| Prompt injection / role override | Pattern guard before the model; model can only act via typed tools | `guardrails/inputGuard.ts` |
| Order enumeration / PII leakage | Two-factor lookup (order # + email); identical error for "wrong email" and "no such order" | `tools/trackOrder.ts` |
| Hallucinated commitments | Ledger-checked output guard | `guardrails/outputGuard.ts` |
| Unauthorised refunds | Ticket-only tool; approval policy in code | `tools/escalateRefund.ts` |
| Forged webhooks | HMAC-SHA256 over raw body, `timingSafeEqual` | `http/webhooks.ts` |
| Replay / duplicate webhooks | Webhook-ID idempotency cache | `http/webhooks.ts` |
| Abuse / cost blow-up | Per-IP token bucket, input cap, bounded loop | `http/rateLimit.ts`, `agent/graph.ts` |
| Secrets in logs | Pino redaction + PII scrubber | `http/server.ts`, `guardrails/redact.ts` |

## Reliability

- **Timeouts everywhere**: 8s to Shopify, 20s to the model, via `AbortSignal.timeout`.
- **Retries with backoff** honour Shopify's `Retry-After` on 429 and retry 5xx with jitter.
- **Fail-fast config**: invalid environment refuses to boot.
- **Graceful shutdown** on `SIGTERM` so in-flight SSE streams close cleanly during deploys.

## Scaling path

The service is stateless apart from three in-process stores (sessions, rate limits, webhook IDs). Each sits behind a small class with a narrow interface, so moving to Redis is a drop-in (see ADR-003). Webhook handling is fire-and-forget today; under load it moves to a queue (SQS / BullMQ) with the same idempotency key.

## Testing strategy

| Layer | Approach |
|---|---|
| Guardrails | Table-driven adversarial inputs, including Unicode bypass attempts |
| Tools | Real tools against `InMemoryCommerce` with a frozen clock (cut-off, weekends, SA public holidays) |
| Graph | Real compiled LangGraph + `ScriptedPlanner`: happy path, malformed calls, hallucinated approvals, loop bound, provider failure |
| Adapters | `fetch` stubs for 429 retry, GraphQL errors, open-model inline tool-call recovery |
| HTTP | `fastify.inject` for chat, session memory, SSE framing, webhook signatures and dedupe |
