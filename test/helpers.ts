import { InMemoryCommerce } from "../src/adapters/inMemoryCommerce.js";
import { buildAgentGraph } from "../src/agent/graph.js";
import type { ChatTurn, Planner, PlannerDecision } from "../src/ports/planner.js";
import type { ToolContext } from "../src/tools/types.js";

/** A planner that replays a fixed script and records what it was shown. */
export class ScriptedPlanner implements Planner {
  readonly seen: ChatTurn[][] = [];
  constructor(private readonly script: Array<PlannerDecision | Error>) {}
  async decide({ history }: { history: ChatTurn[] }): Promise<PlannerDecision> {
    this.seen.push(structuredClone(history));
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return next;
  }
}

// Thursday 13 Nov 2026, 10:00 SAST
export const FIXED_NOW = new Date("2026-11-13T08:00:00Z");

export function makeCtx(overrides: Partial<ToolContext> = {}) {
  const commerce = new InMemoryCommerce(undefined, undefined, () => FIXED_NOW);
  const ctx: ToolContext = { commerce, now: () => FIXED_NOW, policy: { refundAutoApproveLimitMinor: 0 }, ...overrides };
  return { ctx, commerce };
}

export function makeAgent(script: Array<PlannerDecision | Error>, opts: { maxToolSteps?: number; ctx?: ToolContext } = {}) {
  const planner = new ScriptedPlanner(script);
  const { ctx, commerce } = makeCtx();
  const agent = buildAgentGraph({ planner, tools: opts.ctx ?? ctx, maxToolSteps: opts.maxToolSteps ?? 4 });
  return { agent, planner, commerce };
}

export const user = (content: string): ChatTurn => ({ role: "user", content });
