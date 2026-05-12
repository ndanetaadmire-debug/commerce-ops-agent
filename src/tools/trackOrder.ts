import { z } from "zod";
import { defineTool } from "./types.js";

/**
 * Order lookup requires BOTH order number and the email on the order.
 * Without the second factor anyone could enumerate "#1001, #1002…" and read
 * other customers' addresses. The tool returns a deliberately generic error so
 * it can't be used as an oracle for which orders exist.
 */
export const trackOrder = defineTool({
  name: "track_order",
  description: "Get status and tracking for an order. Requires the order number (e.g. #1042) and the email used at checkout.",
  schema: z.object({
    orderName: z
      .string()
      .trim()
      .regex(/^#?\d{3,10}$/, "Order numbers look like #1042")
      .transform((s) => (s.startsWith("#") ? s : `#${s}`)),
    email: z.string().trim().toLowerCase().email(),
  }),
  async execute({ orderName, email }, { commerce }) {
    const order = await commerce.getOrderByName(orderName);
    if (!order || order.customerEmail.toLowerCase() !== email) {
      return { ok: false, error: "We couldn't match that order number and email.", retryable: false };
    }
    return {
      ok: true,
      data: {
        orderName: order.name,
        status: order.status,
        carrier: order.carrier ?? null,
        trackingNumber: order.trackingNumber ?? null,
        placedAt: order.createdAt,
        items: order.lineItems.map((li) => `${li.quantity} × ${li.title}`),
        shippingProvince: order.shippingProvince,
      },
    };
  },
});
