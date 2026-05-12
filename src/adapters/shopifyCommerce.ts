import type { Escalation, FulfilmentStatus, Order, StockLevel } from "../domain/types.js";
import type { CommercePort } from "../ports/commerce.js";

const API_VERSION = "2025-10";

interface ShopifyOptions {
  storeDomain: string;
  adminToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Shopify Admin GraphQL adapter.
 * - Bounded timeouts and retries with jittered backoff on 429/5xx (Shopify's leaky-bucket throttling).
 * - Escalations are written back as order tags + a timeline note so staff work inside Shopify, not a new tool.
 */
export class ShopifyCommerce implements CommercePort {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ShopifyOptions) {
    this.endpoint = `https://${opts.storeDomain}/admin/api/${API_VERSION}/graphql.json`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getStockBySku(sku: string): Promise<StockLevel | null> {
    const data = await this.gql<{ productVariants: { nodes: VariantNode[] } }>(VARIANTS_QUERY, { q: `sku:${JSON.stringify(sku)}`, first: 1 });
    const v = data.productVariants.nodes[0];
    return v ? toStock(v) : null;
  }

  async searchProducts(query: string, limit = 5): Promise<StockLevel[]> {
    const data = await this.gql<{ productVariants: { nodes: VariantNode[] } }>(VARIANTS_QUERY, { q: `title:*${query.replace(/["\\]/g, "")}*`, first: limit });
    return data.productVariants.nodes.map(toStock);
  }

  async getOrderByName(orderName: string): Promise<Order | null> {
    const data = await this.gql<{ orders: { nodes: OrderNode[] } }>(ORDER_QUERY, { q: `name:${JSON.stringify(orderName)}` });
    const o = data.orders.nodes[0];
    return o ? toOrder(o) : null;
  }

  async createEscalation(input: Omit<Escalation, "id" | "createdAt" | "status">): Promise<Escalation> {
    const id = `ESC-${Date.now().toString(36).toUpperCase()}`;
    await this.gql(TAGS_ADD, { id: input.orderId, tags: ["agent-escalation", `esc:${input.reason}`, id] });
    await this.gql(NOTE_UPDATE, { input: { id: input.orderId, note: `[${id}] ${input.reason}: ${input.summary}` } });
    return { ...input, id, createdAt: new Date().toISOString(), status: "open" };
  }

  private async gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const maxRetries = this.opts.maxRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.opts.adminToken },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 8_000),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000 || 2 ** attempt * 250;
        await new Promise((r) => setTimeout(r, retryAfter + Math.random() * 100));
        continue;
      }
      if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
      const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
      if (body.errors?.length) throw new Error(`Shopify GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
      return body.data as T;
    }
  }
}

interface VariantNode {
  sku: string;
  displayName: string;
  inventoryQuantity: number;
  inventoryItem: { inventoryLevels: { nodes: Array<{ location: { name: string }; quantities: Array<{ name: string; quantity: number }> }> } };
}
interface OrderNode {
  id: string; name: string; email: string; createdAt: string; cancelledAt: string | null;
  displayFulfillmentStatus: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  shippingAddress: { province: string } | null;
  fulfillments: Array<{ displayStatus: string | null; trackingInfo: Array<{ number: string; company: string }> }>;
  lineItems: { nodes: Array<{ sku: string; title: string; quantity: number }> };
}

function toStock(v: VariantNode): StockLevel {
  return {
    sku: v.sku,
    title: v.displayName,
    available: v.inventoryQuantity,
    locations: v.inventoryItem.inventoryLevels.nodes.map((l) => ({
      name: l.location.name,
      available: l.quantities.find((q) => q.name === "available")?.quantity ?? 0,
    })),
  };
}

export function mapFulfilment(o: Pick<OrderNode, "cancelledAt" | "displayFulfillmentStatus" | "fulfillments">): FulfilmentStatus {
  if (o.cancelledAt) return "cancelled";
  const latest = o.fulfillments.at(-1)?.displayStatus;
  if (latest === "DELIVERED") return "delivered";
  if (latest === "OUT_FOR_DELIVERY") return "out_for_delivery";
  if (o.displayFulfillmentStatus === "FULFILLED") return "shipped";
  if (o.displayFulfillmentStatus === "IN_PROGRESS" || o.displayFulfillmentStatus === "PARTIALLY_FULFILLED") return "processing";
  return "unfulfilled";
}

function toOrder(o: OrderNode): Order {
  const tracking = o.fulfillments.at(-1)?.trackingInfo[0];
  return {
    id: o.id,
    name: o.name,
    customerEmail: o.email,
    createdAt: o.createdAt,
    total: { amountMinor: Math.round(Number(o.totalPriceSet.shopMoney.amount) * 100), currency: o.totalPriceSet.shopMoney.currencyCode },
    status: mapFulfilment(o),
    shippingProvince: o.shippingAddress?.province ?? "",
    trackingNumber: tracking?.number,
    carrier: tracking?.company,
    lineItems: o.lineItems.nodes,
  };
}

const VARIANTS_QUERY = /* GraphQL */ `
  query Variants($q: String!, $first: Int!) {
    productVariants(first: $first, query: $q) {
      nodes {
        sku displayName inventoryQuantity
        inventoryItem { inventoryLevels(first: 10) { nodes { location { name } quantities(names: ["available"]) { name quantity } } } }
      }
    }
  }`;

const ORDER_QUERY = /* GraphQL */ `
  query Order($q: String!) {
    orders(first: 1, query: $q) {
      nodes {
        id name email createdAt cancelledAt displayFulfillmentStatus
        totalPriceSet { shopMoney { amount currencyCode } }
        shippingAddress { province }
        fulfillments(first: 5) { displayStatus trackingInfo { number company } }
        lineItems(first: 50) { nodes { sku title quantity } }
      }
    }
  }`;

const TAGS_ADD = /* GraphQL */ `mutation Tag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`;
const NOTE_UPDATE = /* GraphQL */ `mutation Note($input: OrderInput!) { orderUpdate(input: $input) { userErrors { message } } }`;
