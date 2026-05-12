import { z } from "zod";
import { defineTool } from "./types.js";

export const checkStock = defineTool({
  name: "check_stock",
  description: "Check live stock for a product. Use `sku` when the customer gives a code, otherwise `query` with the product name.",
  schema: z
    .object({
      sku: z.string().trim().min(2).max(64).optional(),
      query: z.string().trim().min(2).max(80).optional(),
    })
    .refine((v) => v.sku || v.query, { message: "Provide either sku or query" }),
  async execute({ sku, query }, { commerce }) {
    if (sku) {
      const level = await commerce.getStockBySku(sku);
      return level ? { ok: true, data: { matches: [level] } } : { ok: false, error: `No product with SKU ${sku}`, retryable: false };
    }
    const matches = await commerce.searchProducts(query!, 5);
    if (matches.length === 0) return { ok: false, error: `No products match "${query}"`, retryable: false };
    return { ok: true, data: { matches } };
  },
});
