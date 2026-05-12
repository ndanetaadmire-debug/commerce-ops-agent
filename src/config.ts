import { z } from "zod";

/**
 * Configuration is parsed once at boot and fails fast. A misconfigured agent
 * that talks to customers is worse than one that refuses to start.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8080),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

    LLM_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
    LLM_API_KEY: z.string().default(""),
    LLM_MODEL: z.string().default("llama-3.3-70b-versatile"),

    COMMERCE_ADAPTER: z.enum(["memory", "shopify"]).default("memory"),
    SHOPIFY_STORE_DOMAIN: z.string().default(""),
    SHOPIFY_ADMIN_TOKEN: z.string().default(""),
    SHOPIFY_WEBHOOK_SECRET: z.string().default(""),

    REFUND_AUTO_APPROVE_LIMIT_ZAR: z.coerce.number().nonnegative().default(0),
    MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(10).default(4),
  })
  .superRefine((env, ctx) => {
    if (env.COMMERCE_ADAPTER === "shopify") {
      for (const key of ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_TOKEN", "SHOPIFY_WEBHOOK_SECRET"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when COMMERCE_ADAPTER=shopify` });
      }
    }
    if (env.NODE_ENV === "production" && !env.LLM_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["LLM_API_KEY"], message: "LLM_API_KEY is required in production" });
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}
