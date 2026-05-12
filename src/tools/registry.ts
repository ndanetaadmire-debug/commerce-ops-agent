import { z } from "zod";
import type { ToolSpec } from "../ports/planner.js";
import { checkStock } from "./checkStock.js";
import { escalateRefund } from "./escalateRefund.js";
import { estimateDelivery } from "./estimateDelivery.js";
import { trackOrder } from "./trackOrder.js";
import type { ToolContext, ToolDefinition, ToolOutcome } from "./types.js";

export const TOOLS = {
  check_stock: checkStock,
  track_order: trackOrder,
  estimate_delivery: estimateDelivery,
  escalate_refund: escalateRefund,
} as const satisfies Record<string, ToolDefinition<any, any>>;

export type ToolName = keyof typeof TOOLS;

export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

export function isToolName(n: string): n is ToolName {
  return n in TOOLS;
}

export function toolSpecs(): ToolSpec[] {
  return TOOL_NAMES.map((name) => ({
    name,
    description: TOOLS[name].description,
    parameters: z.toJSONSchema(TOOLS[name].schema, { io: "input" }) as Record<string, unknown>,
  }));
}

/**
 * Single choke point for tool execution: validate → execute → normalise errors.
 * Models routinely produce malformed arguments; that is a recoverable condition,
 * reported back to the planner, not an exception that kills the conversation.
 */
export async function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!isToolName(name)) return { ok: false, error: `Unknown tool "${name}"`, retryable: true };
  const tool = TOOLS[name] as ToolDefinition;
  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
    return { ok: false, error: `Invalid arguments: ${msg}`, retryable: true };
  }
  try {
    return await tool.execute(parsed.data, ctx);
  } catch (err) {
    return { ok: false, error: `Upstream error: ${(err as Error).message}`, retryable: true };
  }
}
