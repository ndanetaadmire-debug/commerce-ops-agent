import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify Shopify's X-Shopify-Hmac-Sha256 header over the RAW request body, in constant time. */
export function verifyShopifyHmac(rawBody: Buffer | string, headerHmac: string | undefined, secret: string): boolean {
  if (!headerHmac || !secret) return false;
  const digest = createHmac("sha256", secret).update(rawBody).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(headerHmac, "base64");
  } catch {
    return false;
  }
  return provided.length === digest.length && timingSafeEqual(provided, digest);
}

/** Shopify delivers at-least-once. Remember webhook IDs for a window so retries are no-ops. */
export class IdempotencyCache {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs = 24 * 60 * 60 * 1000, private readonly now = () => Date.now()) {}

  /** Returns true the first time an id is seen within the TTL. */
  firstSeen(id: string): boolean {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp < t) this.seen.delete(k);
    if (this.seen.has(id)) return false;
    this.seen.set(id, t + this.ttlMs);
    return true;
  }
}
