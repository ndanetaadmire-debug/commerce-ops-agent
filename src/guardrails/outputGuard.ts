import type { ToolResultRecord } from "../agent/state.js";

/**
 * Output guard: the model may never promise something the system did not do.
 * The classic failure is "your refund has been approved" when only an
 * escalation ticket exists. We check claims against the tool ledger.
 */
const REFUND_CLAIM = /\b(refund(ed)?|money back)\b[^.]{0,60}\b(approved|processed|issued|completed|sent)\b|\b(approved|processed|issued)\b[^.]{0,40}\brefund\b/i;
const DELIVERY_PROMISE = /\b(guarantee[ds]?|definitely|100%)\b[^.]{0,40}\b(arrive|deliver(ed|y)?)\b/i;

export interface OutputVerdict {
  content: string;
  corrected: boolean;
  violations: string[];
}

export function enforceOutputPolicy(content: string, ledger: ToolResultRecord[]): OutputVerdict {
  const violations: string[] = [];
  let out = content;

  const refundActuallyApproved = ledger.some((r) => r.tool === "escalate_refund" && r.ok && (r.data as { autoApproved?: boolean })?.autoApproved === true);
  if (REFUND_CLAIM.test(out) && !refundActuallyApproved) {
    violations.push("unbacked_refund_claim");
    const ticket = ledger.find((r) => r.tool === "escalate_refund" && r.ok)?.data as { escalationId?: string } | undefined;
    out =
      out.replace(REFUND_CLAIM, "refund request has been passed to our team") +
      (ticket?.escalationId
        ? ` Your reference is ${ticket.escalationId}; a team member will confirm the outcome by email.`
        : " A team member will review it and confirm by email.");
  }

  if (DELIVERY_PROMISE.test(out)) {
    violations.push("delivery_guarantee");
    out = out.replace(DELIVERY_PROMISE, (m) => m.replace(/\b(guarantee[ds]?|definitely|100%)\b/i, "expect to"));
  }

  return { content: out, corrected: violations.length > 0, violations };
}
