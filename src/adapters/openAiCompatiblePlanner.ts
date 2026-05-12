import type { ChatTurn, Planner, PlannerDecision, ToolSpec } from "../ports/planner.js";
import { isToolName } from "../tools/registry.js";

export const SYSTEM_PROMPT = `You are the operations assistant for an online hair retailer in South Africa.
You help customers with: product stock, order status and tracking, delivery estimates, and refunds/returns.

Rules:
- Use tools for facts. Never invent stock levels, order statuses, tracking numbers or dates.
- To look up an order you need BOTH the order number and the checkout email. Ask for whichever is missing.
- You cannot approve refunds. Use escalate_refund to open a ticket and tell the customer a team member will confirm.
- Call at most one tool per step. When you have enough information, answer.
- Be concise, warm and specific. Prices are in ZAR.`;

interface Options {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Planner backed by any OpenAI-compatible chat completions endpoint
 * (Groq, Azure OpenAI, OpenAI, vLLM). Uses native tool calling and degrades
 * gracefully when open-weight models emit malformed tool-call JSON.
 */
export class OpenAiCompatiblePlanner implements Planner {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: Options) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async decide({ history, toolSpecs }: { history: ChatTurn[]; toolSpecs: ToolSpec[] }): Promise<PlannerDecision> {
    const res = await this.fetchImpl(`${this.opts.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
      body: JSON.stringify({
        model: this.opts.model,
        temperature: 0.2,
        parallel_tool_calls: false,
        tool_choice: "auto",
        tools: toolSpecs.map((t) => ({ type: "function", function: t })),
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...toMessages(history)],
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const body = (await res.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: Array<{ function: { name: string; arguments: string } }> } }>;
    };
    return parseDecision(body.choices[0]?.message);
  }
}

export function parseDecision(message: { content: string | null; tool_calls?: Array<{ function: { name: string; arguments: string } }> } | undefined): PlannerDecision {
  const call = message?.tool_calls?.[0];
  if (call && isToolName(call.function.name)) {
    return { type: "tool", tool: call.function.name, args: safeJson(call.function.arguments), rationale: message?.content ?? "" };
  }
  // Some open models write the call into content instead of tool_calls.
  const inline = message?.content?.match(/<function=(\w+)>\s*(\{[\s\S]*?\})\s*<\/function>/);
  if (inline?.[1] && isToolName(inline[1])) {
    return { type: "tool", tool: inline[1], args: safeJson(inline[2] ?? "{}"), rationale: "recovered inline tool call" };
  }
  return { type: "answer", content: (message?.content ?? "").trim() || "Sorry, could you rephrase that?" };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { __malformed: s }; // fails schema validation → reported back to the planner
  }
}

function toMessages(history: ChatTurn[]) {
  // Tool results are replayed as compact user-visible context; this keeps the
  // transcript provider-agnostic (no provider-specific tool_call_id bookkeeping).
  return history.map((t) =>
    t.role === "tool" ? { role: "user", content: `[tool:${t.toolName} result] ${t.content}` } : { role: t.role, content: t.content },
  );
}
