# ADR-001: Model the agent as an explicit LangGraph state machine

**Status:** Accepted

## Context
A ReAct-style `while (model wants tools)` loop hides control flow inside the prompt. We need hard guarantees: guardrails always run, loops are bounded, and every exit path produces a customer-safe reply.

## Decision
Use LangGraph.js with explicit nodes (`guard`, `plan`, `act`, `finalize`, `handoff`) and conditional edges. Deterministic nodes wrap the single LLM node.

## Consequences
- Control flow is visible, reviewable and unit-testable without a model.
- Step traces fall out naturally from graph updates and power the SSE "thinking" UI.
- Slightly more code than a loop; worth it for the guarantees.
