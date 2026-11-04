// @vitest-environment node
// Generates the shared rtgip/2 cross-app corpus from the REAL producers of all three apps and
// proves the committed corpus is exactly what they produce today. With RTGIP_CORPUS_OUT set it
// also writes the corpus there (used to refresh the committed copy in all three repos).
import { expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import committed from "../rtgip2/rtgip2-corpus.v2.json";
import { signEnvelope, type AppId, type EnvelopeV2 } from "../rtgip2/protocol.ts";
import { keyOf, syntheticRegistry, T0, INSTANCE, EPISODE } from "../rtgip2/fixtures.ts";
import * as L from "../rtgip2-autolabels/producer.ts";
import * as C from "../rtgip2-autocurb/producer.ts";
import * as F from "../rtgip2-autoframe/producer.ts";
import { AT, approval, cmeta, curbRecords, curbScope, firstEpisode, frameRecords, frameScope, inst, meta, revocation, revocationRecords, scope } from "./scenario.ts";

type Out = { target: AppId; envelope: EnvelopeV2; body: string }[];
type Call = { producer: string; args: unknown[] };
const calls: Call[] = [
  { producer: "autolabels.identityRegistered", args: [scope, inst, { year: 2024, make: "Synthetic", model: "Sedan", trim: null, registered_at: AT }, meta("al-id-1", INSTANCE), ["autocurb", "autoframe"]] },
  { producer: "autolabels.episodeOpened", args: [scope, inst, firstEpisode, { opened_at: AT }, meta("al-ep-1", EPISODE), ["autocurb", "autoframe"]] },
  { producer: "autolabels.pricePublished", args: [scope, inst, { vehicle_selling_price_cents: 2_450_000, doc_fee_cents: 49_900, total_advertised_price_cents: 2_499_900, published_at: AT }, meta("al-price-1", "listing-syn-1"), ["autocurb"]] },
  { producer: "autolabels.listingAvailabilityChanged", args: [scope, inst, true, "passport-syn-1001", AT, meta("al-avail-1", "listing-syn-1", 2, { autoframe: null }), ["autoframe"]] },
  { producer: "autocurb.appraisalCompleted", args: [curbScope, curbRecords("appraisal_completed"), cmeta("ac-apr-1"), ["autolabels", "autoframe"]] },
  { producer: "autocurb.acquisitionMilestone", args: [curbScope, curbRecords("deal_finalized"), cmeta("ac-m-1"), ["autolabels"]] },
  { producer: "autocurb.purchaseCompleted", args: [curbScope, curbRecords("purchase_complete"), cmeta("ac-pur-1", 2, { autolabels: 1, autoframe: null }), ["autolabels", "autoframe"]] },
  { producer: "autoframe.mediaApproved", args: [approval(1), frameScope(null), frameRecords(1), ["autolabels", "autocurb"]] },
  { producer: "autoframe.mediaRevoked", args: [revocation(2, 1), frameScope(1), revocationRecords(2), ["autolabels", "autocurb"]] },
];
const impl: Record<string, Record<string, (...a: unknown[]) => Promise<Out>>> = {
  autolabels: L as unknown as Record<string, (...a: unknown[]) => Promise<Out>>,
  autocurb: C as unknown as Record<string, (...a: unknown[]) => Promise<Out>>,
  autoframe: F as unknown as Record<string, (...a: unknown[]) => Promise<Out>>,
};

it("the committed corpus is exactly what the three apps' producers generate", async () => {
  const reg = syntheticRegistry();
  const gw = keyOf(reg, "gw-dev-1");
  const entries = [];
  let n = 0;
  for (const c of calls) {
    const [app, fn] = c.producer.split(".") as [string, string];
    const args = JSON.parse(JSON.stringify(c.args)) as unknown[];
    for (const out of await impl[app]![fn]!(...args)) {
      const nonce = `gw_corpus_${String(++n).padStart(8, "0")}`;
      entries.push({
        seq: n, route: out.envelope.route, event_type: out.envelope.event_type, producer: c.producer, producer_args: args,
        body: out.body, gateway_headers: await signEnvelope(out.body, out.envelope, gw, T0, nonce),
      });
    }
  }
  expect(entries).toHaveLength(15);
  const corpus = {
    schema: "rtgip/2-corpus/2",
    note: "Synthetic, fictitious data. DEV-literal keys from fixtures.ts. Event ids use derivation rtgip/2-event/v2. Verify with nowSec = T0.",
    t0: T0, gateway_key_id: "gw-dev-1", entries,
  };
  if (process.env.RTGIP_CORPUS_OUT) writeFileSync(process.env.RTGIP_CORPUS_OUT, JSON.stringify(corpus, null, 2) + "\n");
  else {
    // The corpus is frozen for the Gateway. AutoCurb's Phase 3D producer needs more source
    // rows (rooftop binding, title step, custody evidence) to emit the same bytes, and AutoFrame's
    // now takes an identity rooftop_scope, so their recorded producer_args predate that; bodies
    // and signed headers must still match exactly.
    const strip = (c: typeof committed) => ({ ...c, entries: c.entries.map((e) => (e.producer.startsWith("autocurb.") || e.producer.startsWith("autoframe.") ? { ...e, producer_args: null } : e)) });
    expect(strip(JSON.parse(JSON.stringify(corpus)))).toEqual(strip(committed));
  }
});
