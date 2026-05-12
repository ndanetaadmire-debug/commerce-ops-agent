import { randomUUID } from "node:crypto";
import type { Escalation, Order, StockLevel } from "../domain/types.js";
import type { CommercePort } from "../ports/commerce.js";

/** Deterministic adapter for local development, demos and tests. */
export class InMemoryCommerce implements CommercePort {
  readonly escalations: Escalation[] = [];

  constructor(
    private readonly products: StockLevel[] = SEED_PRODUCTS,
    private readonly orders: Order[] = SEED_ORDERS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getStockBySku(sku: string) {
    return this.products.find((p) => p.sku.toLowerCase() === sku.toLowerCase()) ?? null;
  }

  async searchProducts(query: string, limit = 5) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.products
      .map((p) => ({ p, score: terms.filter((t) => p.title.toLowerCase().includes(t)).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.p);
  }

  async getOrderByName(orderName: string) {
    return this.orders.find((o) => o.name === orderName) ?? null;
  }

  async createEscalation(input: Omit<Escalation, "id" | "createdAt" | "status">) {
    const e: Escalation = { ...input, id: `ESC-${randomUUID().slice(0, 8).toUpperCase()}`, createdAt: this.clock().toISOString(), status: "open" };
    this.escalations.push(e);
    return e;
  }
}

export const SEED_PRODUCTS: StockLevel[] = [
  { sku: "LW-BOB-12", title: "Brazilian Bob Wig 12 inch", available: 7, locations: [{ name: "Johannesburg", available: 5 }, { name: "Durban", available: 2 }] },
  { sku: "LW-BDW-22", title: "Body Wave Bundle 22 inch", available: 0, locations: [{ name: "Johannesburg", available: 0 }] },
  { sku: "LW-FRT-13X4", title: "13x4 HD Lace Frontal Straight", available: 3, locations: [{ name: "Johannesburg", available: 3 }] },
  { sku: "LW-KNK-18", title: "Kinky Curly Wig 18 inch", available: 12, locations: [{ name: "Johannesburg", available: 8 }, { name: "Cape Town", available: 4 }] },
];

export const SEED_ORDERS: Order[] = [
  {
    id: "gid://shopify/Order/5001", name: "#1042", customerEmail: "thandi@example.com", createdAt: "2026-11-10T09:12:00Z",
    total: { amountMinor: 189_900, currency: "ZAR" }, status: "shipped", shippingProvince: "Gauteng",
    trackingNumber: "TCG123456789", carrier: "The Courier Guy",
    lineItems: [{ sku: "LW-BOB-12", title: "Brazilian Bob Wig 12 inch", quantity: 1 }],
  },
  {
    id: "gid://shopify/Order/5002", name: "#1043", customerEmail: "lindiwe@example.com", createdAt: "2026-11-12T15:40:00Z",
    total: { amountMinor: 349_900, currency: "ZAR" }, status: "processing", shippingProvince: "KwaZulu-Natal",
    lineItems: [{ sku: "LW-KNK-18", title: "Kinky Curly Wig 18 inch", quantity: 1 }, { sku: "LW-FRT-13X4", title: "13x4 HD Lace Frontal Straight", quantity: 1 }],
  },
];
