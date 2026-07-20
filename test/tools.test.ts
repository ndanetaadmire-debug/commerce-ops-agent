import { describe, expect, it } from "vitest";
import { addBusinessDays, isBusinessDay } from "../src/tools/estimateDelivery.js";
import { runTool, toolSpecs } from "../src/tools/registry.js";
import { FIXED_NOW, makeCtx } from "./helpers.js";

describe("tool registry", () => {
  it("exposes JSON-schema specs for every tool", () => {
    const specs = toolSpecs();
    expect(specs.map((s) => s.name).sort()).toEqual(["check_stock", "escalate_refund", "estimate_delivery", "track_order"]);
    for (const s of specs) expect(s.parameters).toHaveProperty("type", "object");
  });

  it("turns malformed model arguments into a retryable error, not an exception", async () => {
    const { ctx } = makeCtx();
    const out = await runTool("track_order", { orderName: "banana" }, ctx);
    expect(out).toMatchObject({ ok: false, retryable: true });
    if (!out.ok) expect(out.error).toMatch(/Invalid arguments/);
  });

  it("rejects unknown tools", async () => {
    const { ctx } = makeCtx();
    expect(await runTool("drop_tables", {}, ctx)).toMatchObject({ ok: false });
  });

  it("wraps upstream failures", async () => {
    const { ctx } = makeCtx({ commerce: { getStockBySku: async () => { throw new Error("ECONNRESET"); } } as never });
    expect(await runTool("check_stock", { sku: "X1" }, ctx)).toMatchObject({ ok: false, retryable: true, error: expect.stringMatching(/ECONNRESET/) });
  });
});

describe("check_stock", () => {
  it("finds by SKU and by fuzzy name", async () => {
    const { ctx } = makeCtx();
    expect(await runTool("check_stock", { sku: "lw-bob-12" }, ctx)).toMatchObject({ ok: true, data: { matches: [{ available: 7 }] } });
    const byName = await runTool("check_stock", { query: "kinky curly" }, ctx);
    expect(byName).toMatchObject({ ok: true, data: { matches: [{ sku: "LW-KNK-18" }] } });
  });
});

describe("track_order", () => {
  it("requires the matching email (no order enumeration)", async () => {
    const { ctx } = makeCtx();
    const wrong = await runTool("track_order", { orderName: "#1042", email: "attacker@example.com" }, ctx);
    const missing = await runTool("track_order", { orderName: "#9999", email: "attacker@example.com" }, ctx);
    expect(wrong).toEqual(missing); // indistinguishable errors
  });

  it("returns tracking for the right customer and normalises the order number", async () => {
    const { ctx } = makeCtx();
    const out = await runTool("track_order", { orderName: "1042", email: "THANDI@example.com" }, ctx);
    expect(out).toMatchObject({ ok: true, data: { status: "shipped", trackingNumber: "TCG123456789" } });
  });
});

describe("estimate_delivery", () => {
  it("skips weekends and public holidays", () => {
    expect(isBusinessDay(new Date("2026-11-14T10:00:00Z"))).toBe(false); // Saturday
    expect(isBusinessDay(new Date("2026-12-16T10:00:00Z"))).toBe(false); // Day of Reconciliation
    expect(addBusinessDays(new Date("2026-12-15T00:00:00Z"), 1).toISOString().slice(0, 10)).toBe("2026-12-17");
  });

  it("dispatches same day before the 14:00 SAST cut-off", async () => {
    const { ctx } = makeCtx();
    const out = await runTool("estimate_delivery", { province: "Gauteng" }, ctx);
    expect(out).toMatchObject({ ok: true, data: { dispatchDate: "2026-11-13", earliest: "2026-11-16", latest: "2026-11-17" } });
  });

  it("rolls to next business day after cut-off", async () => {
    const late = new Date("2026-11-13T13:30:00Z"); // 15:30 SAST Friday
    const { ctx } = makeCtx({ now: () => late });
    const out = await runTool("estimate_delivery", { province: "KwaZulu-Natal" }, ctx);
    expect(out).toMatchObject({ ok: true, data: { dispatchDate: "2026-11-16" } });
  });

  it("refuses unknown regions", async () => {
    const { ctx } = makeCtx();
    expect(await runTool("estimate_delivery", { province: "Atlantis" }, ctx)).toMatchObject({ ok: false });
  });
  void FIXED_NOW;
});

describe("escalate_refund", () => {
  const args = { orderName: "#1043", email: "lindiwe@example.com", reason: "damaged_item", summary: "Lace frontal arrived torn" };

  it("creates a ticket and never auto-approves at the default limit", async () => {
    const { ctx, commerce } = makeCtx();
    const out = await runTool("escalate_refund", args, ctx);
    expect(out).toMatchObject({ ok: true, data: { autoApproved: false, slaHours: 24 } });
    expect(commerce.escalations).toHaveLength(1);
    expect(commerce.escalations[0]).toMatchObject({ reason: "damaged_item", requestedAmount: { amountMinor: 349_900 } });
  });

  it("auto-approves only under the configured policy limit", async () => {
    const { ctx } = makeCtx({ policy: { refundAutoApproveLimitMinor: 500_000 } });
    expect(await runTool("escalate_refund", args, ctx)).toMatchObject({ ok: true, data: { autoApproved: true } });
    expect(await runTool("escalate_refund", { ...args, reason: "policy_exception" }, ctx)).toMatchObject({ ok: true, data: { autoApproved: false } });
  });
});
