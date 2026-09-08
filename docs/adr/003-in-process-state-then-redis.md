# ADR-003: In-process sessions and rate limits first, Redis when we scale out

**Status:** Accepted

## Context
A single instance handles the current retailer's volume comfortably. Introducing Redis on day one adds an operational dependency without a present need.

## Decision
`SessionStore`, `TokenBucket` and `IdempotencyCache` are small classes with narrow interfaces and in-memory implementations. When running more than one replica, each gets a Redis implementation (`SET NX EX` for dedupe, sliding-window Lua script for rate limits, hash with TTL for sessions).

## Consequences
- Zero infra to run locally or on a single container.
- Multi-replica deployment **requires** the Redis implementations; this is called out in the README roadmap.
