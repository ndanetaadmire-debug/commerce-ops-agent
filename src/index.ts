import { InMemoryCommerce } from "./adapters/inMemoryCommerce.js";
import { OpenAiCompatiblePlanner } from "./adapters/openAiCompatiblePlanner.js";
import { ShopifyCommerce } from "./adapters/shopifyCommerce.js";
import { buildAgentGraph } from "./agent/graph.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./http/server.js";

const config = loadConfig();

const commerce =
  config.COMMERCE_ADAPTER === "shopify"
    ? new ShopifyCommerce({ storeDomain: config.SHOPIFY_STORE_DOMAIN, adminToken: config.SHOPIFY_ADMIN_TOKEN })
    : new InMemoryCommerce();

const agent = buildAgentGraph({
  planner: new OpenAiCompatiblePlanner({ baseUrl: config.LLM_BASE_URL, apiKey: config.LLM_API_KEY, model: config.LLM_MODEL }),
  tools: { commerce, now: () => new Date(), policy: { refundAutoApproveLimitMinor: Math.round(config.REFUND_AUTO_APPROVE_LIMIT_ZAR * 100) } },
  maxToolSteps: config.MAX_TOOL_STEPS,
});

const app = buildServer({ agent, webhookSecret: config.SHOPIFY_WEBHOOK_SECRET, logLevel: config.LOG_LEVEL });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting_down");
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: "0.0.0.0" });
