/** Money is always integer minor units (cents) plus an ISO currency. Never floats. */
export interface Money {
  amountMinor: number;
  currency: string;
}

export interface StockLevel {
  sku: string;
  title: string;
  available: number;
  locations: Array<{ name: string; available: number }>;
}

export type FulfilmentStatus = "unfulfilled" | "processing" | "shipped" | "out_for_delivery" | "delivered" | "cancelled";

export interface Order {
  id: string;
  name: string; // human-facing, e.g. "#1042"
  customerEmail: string;
  createdAt: string;
  total: Money;
  status: FulfilmentStatus;
  shippingProvince: string;
  trackingNumber?: string;
  carrier?: string;
  lineItems: Array<{ sku: string; title: string; quantity: number }>;
}

export type EscalationReason = "refund_request" | "damaged_item" | "policy_exception" | "agent_uncertain";

export interface Escalation {
  id: string;
  orderId: string;
  reason: EscalationReason;
  summary: string;
  requestedAmount?: Money;
  createdAt: string;
  status: "open" | "approved" | "rejected";
}

export function formatMoney(m: Money): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: m.currency }).format(m.amountMinor / 100);
}
