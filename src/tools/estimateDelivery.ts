import { z } from "zod";
import { defineTool } from "./types.js";

/** Courier SLA in business days from dispatch, by destination province (South Africa). */
export const PROVINCE_SLA: Record<string, { min: number; max: number }> = {
  gauteng: { min: 1, max: 2 },
  "western cape": { min: 2, max: 3 },
  kwazulunatal: { min: 2, max: 3 },
  "eastern cape": { min: 2, max: 4 },
  "free state": { min: 2, max: 4 },
  mpumalanga: { min: 2, max: 3 },
  limpopo: { min: 3, max: 4 },
  "north west": { min: 2, max: 4 },
  "northern cape": { min: 3, max: 5 },
};

/** Fixed-date SA public holidays (MM-DD). Easter-based holidays are handled by the carrier feed in production. */
const FIXED_HOLIDAYS = new Set(["01-01", "03-21", "04-27", "05-01", "06-16", "08-09", "09-24", "12-16", "12-25", "12-26"]);
const DISPATCH_CUTOFF_HOUR_SAST = 14;

export function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  const mmdd = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return day !== 0 && day !== 6 && !FIXED_HOLIDAYS.has(mmdd);
}

export function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(d)) added++;
  }
  return d;
}

export function normalizeProvince(p: string): string {
  return p.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim().replace("kwazulu natal", "kwazulunatal");
}

export const estimateDelivery = defineTool({
  name: "estimate_delivery",
  description: "Estimate a delivery window for an order placed now to a South African province.",
  schema: z.object({ province: z.string().trim().min(3).max(40) }),
  async execute({ province }, { now }) {
    const key = normalizeProvince(province);
    const sla = PROVINCE_SLA[key];
    if (!sla) return { ok: false, error: `We don't have delivery times for "${province}". We ship within South Africa.`, retryable: false };

    // Orders after the cut-off (SAST = UTC+2), or on non-business days, dispatch next business day.
    const current = now();
    const sastHour = (current.getUTCHours() + 2) % 24;
    const dispatchToday = isBusinessDay(current) && sastHour < DISPATCH_CUTOFF_HOUR_SAST;
    const dispatch = dispatchToday ? current : addBusinessDays(current, 1);

    const earliest = addBusinessDays(dispatch, sla.min);
    const latest = addBusinessDays(dispatch, sla.max);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { ok: true, data: { province: key, dispatchDate: iso(dispatch), earliest: iso(earliest), latest: iso(latest), businessDays: sla } };
  },
});
