import { describe, expect, it, vi } from "vitest";
import { parseDecision } from "../src/adapters/openAiCompatiblePlanner.js";
import { mapFulfilment, ShopifyCommerce } from "../src/adapters/shopifyCommerce.js";

describe("planner response parsing", () => {
  it("reads native tool calls", () => {
    expect(parseDecision({ content: null, tool_calls: [{ function: { name: "check_stock", arguments: '{"sku":"A1"}' } }] }))
      .toMatchObject({ type: "tool", tool: "check_stock", args: { sku: "A1" } });
  });
  it("recovers inline <function=…> calls from open-weight models", () => {
    expect(parseDecision({ content: '<function=estimate_delivery>{"province":"Limpopo"}</function>' }))
      .toMatchObject({ type: "tool", tool: "estimate_delivery", args: { province: "Limpopo" } });
  });
  it("marks unparseable arguments so schema validation rejects them", () => {
    expect(parseDecision({ content: null, tool_calls: [{ function: { name: "check_stock", arguments: "{sku:" } }] }))
      .toMatchObject({ type: "tool", args: { __malformed: "{sku:" } });
  });
  it("ignores hallucinated tool names", () => {
    expect(parseDecision({ content: "ok", tool_calls: [{ function: { name: "delete_store", arguments: "{}" } }] })).toEqual({ type: "answer", content: "ok" });
  });
});

describe("Shopify adapter", () => {
  it("maps fulfilment states", () => {
    expect(mapFulfilment({ cancelledAt: "x", displayFulfillmentStatus: "FULFILLED", fulfillments: [] })).toBe("cancelled");
    expect(mapFulfilment({ cancelledAt: null, displayFulfillmentStatus: "FULFILLED", fulfillments: [{ displayStatus: "DELIVERED", trackingInfo: [] }] })).toBe("delivered");
    expect(mapFulfilment({ cancelledAt: null, displayFulfillmentStatus: "UNFULFILLED", fulfillments: [] })).toBe("unfulfilled");
  });

  it("retries on 429 then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(Response.json({ data: { productVariants: { nodes: [] } } }));
    const shop = new ShopifyCommerce({ storeDomain: "s.myshopify.com", adminToken: "t", fetchImpl, maxRetries: 2 });
    await expect(shop.getStockBySku("A1")).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces GraphQL errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ errors: [{ message: "Throttled" }] }));
    const shop = new ShopifyCommerce({ storeDomain: "s.myshopify.com", adminToken: "t", fetchImpl });
    await expect(shop.searchProducts("wig")).rejects.toThrow(/Throttled/);
  });
});
