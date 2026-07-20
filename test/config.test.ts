import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("applies safe defaults", () => {
    expect(loadConfig({})).toMatchObject({ COMMERCE_ADAPTER: "memory", REFUND_AUTO_APPROVE_LIMIT_ZAR: 0, MAX_TOOL_STEPS: 4 });
  });
  it("fails fast on incomplete Shopify config", () => {
    expect(() => loadConfig({ COMMERCE_ADAPTER: "shopify" })).toThrow(/SHOPIFY_ADMIN_TOKEN/);
  });
  it("requires an LLM key in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/LLM_API_KEY/);
  });
});
