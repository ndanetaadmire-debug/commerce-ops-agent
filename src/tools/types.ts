import type { z } from "zod";
import type { CommercePort } from "../ports/commerce.js";

export interface ToolContext {
  commerce: CommercePort;
  now: () => Date;
  policy: { refundAutoApproveLimitMinor: number };
}

export type ToolOutcome<T = unknown> = { ok: true; data: T } | { ok: false; error: string; retryable: boolean };

export interface ToolDefinition<S extends z.ZodType = z.ZodType, T = unknown> {
  name: string;
  description: string;
  schema: S;
  execute(args: z.infer<S>, ctx: ToolContext): Promise<ToolOutcome<T>>;
}

export function defineTool<S extends z.ZodType, T>(def: ToolDefinition<S, T>): ToolDefinition<S, T> {
  return def;
}
