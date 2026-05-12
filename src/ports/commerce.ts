import type { Escalation, Order, StockLevel } from "../domain/types.js";

/**
 * Port: everything the agent may know about or do to the store.
 * Adapters (in-memory, Shopify) implement it; the agent never touches a vendor SDK directly.
 */
export interface CommercePort {
  getStockBySku(sku: string): Promise<StockLevel | null>;
  searchProducts(query: string, limit?: number): Promise<StockLevel[]>;
  getOrderByName(orderName: string): Promise<Order | null>;
  createEscalation(input: Omit<Escalation, "id" | "createdAt" | "status">): Promise<Escalation>;
}
