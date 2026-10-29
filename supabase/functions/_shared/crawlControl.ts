// The advertised-price crawl's two server-side switches (crawl_control,
// proposed migration 20261104000000), read by the crawler at the start of every
// request and again before each vehicle. Both default OFF, and anything other
// than a clear "on" from the database is OFF: a missing table or function, a
// read error, an empty or malformed answer.
//
//   execution  off: every request is answered with CRAWL_PAUSED_MESSAGE and
//              nothing is read, rendered or written
//   promotion  off: observations and evidence are stored, listing prices are
//              not changed (the database enforces this again at write time)

import { controlMissing } from "./crawlCommit.ts";

export const CRAWL_PAUSED_MESSAGE = "Temporarily paused for pricing verification";

export interface CrawlControl {
  execution: boolean;
  promotion: boolean;
  version: number | null;
  source: "control" | "missing" | "unreadable";
}

export const CRAWL_OFF = (source: CrawlControl["source"]): CrawlControl => ({ execution: false, promotion: false, version: null, source });

// deno-lint-ignore no-explicit-any
export function parseCrawlControl(data: any, error: any): CrawlControl {
  if (error) return CRAWL_OFF(controlMissing(error) ? "missing" : "unreadable");
  const r = Array.isArray(data) ? data[0] : data;
  if (!r || typeof r !== "object") return CRAWL_OFF("unreadable");
  return {
    execution: r.execution_enabled === true,
    promotion: r.promotion_enabled === true,
    version: Number.isFinite(Number(r.version)) ? Number(r.version) : null,
    source: "control",
  };
}

// deno-lint-ignore no-explicit-any
export async function readCrawlControl(admin: any): Promise<CrawlControl> {
  try {
    const { data, error } = await admin.rpc("crawl_control_state");
    return parseCrawlControl(data, error);
  } catch {
    return CRAWL_OFF("unreadable");
  }
}

export const pausedBody = (c: CrawlControl) => ({
  ok: false, paused: true, error: "crawl_paused", message: CRAWL_PAUSED_MESSAGE, control: c.source,
});
