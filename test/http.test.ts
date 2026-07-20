import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/http/server.js";
import { IdempotencyCache, verifyShopifyHmac } from "../src/http/webhooks.js";
import { makeAgent } from "./helpers.js";

const SECRET = "whsec_test";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("base64");

describe("webhook security", () => {
  it("verifies HMAC in constant time and rejects tampering", () => {
    const body = '{"id":1}';
    expect(verifyShopifyHmac(body, sign(body), SECRET)).toBe(true);
    expect(verifyShopifyHmac('{"id":2}', sign(body), SECRET)).toBe(false);
    expect(verifyShopifyHmac(body, undefined, SECRET)).toBe(false);
  });

  it("dedupes retried deliveries", () => {
    const c = new IdempotencyCache();
    expect(c.firstSeen("w1")).toBe(true);
    expect(c.firstSeen("w1")).toBe(false);
  });
});

describe("HTTP API", () => {
  it("serves a chat turn and keeps session memory", async () => {
    const { agent, planner } = makeAgent([
      { type: "answer", content: "Hi! What's your order number?" },
      { type: "answer", content: "Thanks, and the email?" },
    ]);
    const app = buildServer({ agent, webhookSecret: SECRET, logLevel: "silent" });
    const sessionId = randomUUID();
    const r1 = await app.inject({ method: "POST", url: "/v1/chat", payload: { sessionId, message: "hello" } });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ reply: "Hi! What's your order number?", outcome: "answered" });
    await app.inject({ method: "POST", url: "/v1/chat", payload: { sessionId, message: "#1042" } });
    expect(planner.seen[1]?.map((t) => t.content)).toEqual(["hello", "Hi! What's your order number?", "#1042"]);
    await app.close();
  });

  it("validates requests", async () => {
    const { agent } = makeAgent([]);
    const app = buildServer({ agent, webhookSecret: SECRET, logLevel: "silent" });
    const r = await app.inject({ method: "POST", url: "/v1/chat", payload: { sessionId: "nope", message: "" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("streams step events over SSE", async () => {
    const { agent } = makeAgent([
      { type: "tool", tool: "estimate_delivery", args: { province: "Gauteng" }, rationale: "" },
      { type: "answer", content: "1–2 business days." },
    ]);
    const app = buildServer({ agent, webhookSecret: SECRET, logLevel: "silent" });
    const r = await app.inject({ method: "POST", url: "/v1/chat/stream", payload: { sessionId: randomUUID(), message: "how long to Joburg?" } });
    expect(r.headers["content-type"]).toContain("text/event-stream");
    expect(r.body).toContain("event: step");
    expect(r.body).toContain('"tool":"estimate_delivery"');
    expect(r.body).toContain("event: final");
    expect(r.body.trim().endsWith("data: {}")).toBe(true);
    await app.close();
  });

  it("accepts signed webhooks once and rejects bad signatures", async () => {
    const { agent } = makeAgent([]);
    const onOrderEvent = vi.fn().mockResolvedValue(undefined);
    const app = buildServer({ agent, webhookSecret: SECRET, logLevel: "silent", onOrderEvent });
    const body = JSON.stringify({ id: 5001, name: "#1042" });
    const headers = { "content-type": "application/json", "x-shopify-topic": "orders/updated", "x-shopify-webhook-id": "abc" };

    const bad = await app.inject({ method: "POST", url: "/webhooks/shopify", payload: body, headers: { ...headers, "x-shopify-hmac-sha256": "AAAA" } });
    expect(bad.statusCode).toBe(401);

    const ok = await app.inject({ method: "POST", url: "/webhooks/shopify", payload: body, headers: { ...headers, "x-shopify-hmac-sha256": sign(body) } });
    const dup = await app.inject({ method: "POST", url: "/webhooks/shopify", payload: body, headers: { ...headers, "x-shopify-hmac-sha256": sign(body) } });
    expect(ok.json()).toEqual({ status: "accepted" });
    expect(dup.json()).toEqual({ status: "duplicate" });
    expect(onOrderEvent).toHaveBeenCalledTimes(1);
    await app.close();
  });
});
