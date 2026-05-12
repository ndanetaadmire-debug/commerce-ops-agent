import { z } from "zod";
import { defineTool } from "./types.js";

/**
 * Money never moves on the model's say-so. This tool only *creates a ticket*.
 * Auto-approval is a business policy (default limit 0 = always human), decided
 * here in code, never by the LLM.
 */
export const escalateRefund = defineTool({
  name: "escalate_refund",
  description:
    "Open a refund / return / damaged-item ticket for a human to review. Requires order number, checkout email and a short reason. Never tell the customer a refund is approved unless this tool says autoApproved=true.",
  schema: z.object({
    orderName: z.string().trim().regex(/^#?\d{3,10}$/).transform((s) => (s.startsWith("#") ? s : `#${s}`)),
    email: z.string().trim().toLowerCase().email(),
    reason: z.enum(["refund_request", "damaged_item", "policy_exception"]),
    summary: z.string().trim().min(5).max(500),
  }),
  async execute({ orderName, email, reason, summary }, { commerce, policy }) {
    const order = await commerce.getOrderByName(orderName);
    if (!order || order.customerEmail.toLowerCase() !== email) {
      return { ok: false, error: "We couldn't match that order number and email.", retryable: false };
    }
    if (order.status === "cancelled") return { ok: false, error: "This order was already cancelled and refunded.", retryable: false };

    const escalation = await commerce.createEscalation({ orderId: order.id, reason, summary, requestedAmount: order.total });
    const autoApproved = reason !== "policy_exception" && order.total.amountMinor <= policy.refundAutoApproveLimitMinor;
    return { ok: true, data: { escalationId: escalation.id, autoApproved, slaHours: autoApproved ? 0 : 24 } };
  },
});
