# AutoLabels Vehicle Truth Expansion — Assessment

Five-agent read-only investigation, 2026-09-08. Repo `KenCarbiz/autolables-74375bef`,
Supabase `onnbmmdbrsgytfozfozn`, Harte INFINITI tenant `3f0f97f5`, 132 active vehicles.

Every claim below is **VERIFIED** (read in code at a cited line, or returned by a SELECT
run during the investigation), **INFERRED**, or **UNKNOWN**. Where two agents disagreed,
the disagreement and its resolution are recorded rather than smoothed over.

---

## EXECUTIVE VERDICT

**PARTIALLY — and not where the brief expected.**

The investigation was framed as "what should we build?" Four of five agents returned a
variant of the same answer: **it is already built, it is not wired to anything, and it is
quietly wrong.**

The Vehicle Truth layer is not a design sketch. It is four migrated tables holding 5,042
facts, 312 immutable snapshots and 222 raw source records, with per-source confidence
ceilings, field-aware precedence, dispute detection and an AI hard-cap already in code.
**Thirteen of the seventeen attributes in the proposed fact carry already exist.** What
does not exist is a reader: the sticker calls `refreshVehicleTruth` and then normalises
from `mc_attributes` anyway; the customer Passport reads `vehicle_listings`; descriptions
run a parallel `description_fact_snapshots`. One vehicle truth is a record. It is simply
not the record anything opens.

The cost of that is not theoretical. **99 of 119 live vehicles carry a resolved price that
was true six weeks ago, every one labelled `confidence: VERIFIED`, and `autofilm-feed` is
serving them today** — 32 of them understating the price, which is the direction that
matters to a regulator.

So the answer to "is there value here" is: **yes, but almost all of it is in connecting,
correcting and labelling what exists, not in acquiring more.** The single highest-value
outcome of this investigation is a *smaller* build than the brief anticipated, and three
data-integrity defects that outrank every expansion item on the list.

**The through-line.** Three separate findings turned out to be one defect:
`classifyCrawlOutcome` labels rate limits as credit exhaustion; `record_provider_payload_shape`
labels the syndication endpoint as the search endpoint; `advertised_prices` carries no
`captured_method`, so feed rows are indistinguishable from observed ones. Each is a
provenance label that is **wrong or absent — on a platform whose entire value proposition
is provenance.** That is the thing to fix, and it is cheap.

---

## A. CURRENT STATE — what AutoLabels actually does today

| Subsystem | Reality |
|---|---|
| Inventory ingest | `/v2/dealerships/inventory` (syndication), hourly cron gated to nightly per tenant. Pinned-scope validation, three-layer rooftop isolation, purity ≥0.95, per-segment + run-level archive breakers. **Far more defended than the brief assumed.** |
| Enrichment | `vehicle-enrich` calls MDS, comparables, price prediction, sales velocity, listing history, recalls. Populated on **130/132**. |
| Truth layer | `vehicle_facts` 5,042 · `vehicle_snapshots` 312 (append-only, UPDATE blocked by trigger) · `vehicle_source_records` 222 · `vehicle_fact_conflicts` **0**. Written by `factory-sticker-orchestrate/truth.ts`. Read by two staff panels and one export feed. |
| Price observation | `crawl-advertised-prices` with Firecrawl fallback, doc-fee-aware ladder decomposition, screenshot + SHA-256. **Last real capture 2026-08-24.** |
| Packet curation | Fully built and **server-enforced** — `public-listing-view:768-800` deletes excluded modules from the payload. |
| OEM sticker | Fetcher built and wired (`oem-window-sticker`, `intake-autoprovision:984`, `packet-backfill:241`). **Short-circuits on an unset API key.** |
| Precedence config | `source_authority_rules` — **0 rows, every tenant.** The entire tenant-configurable-authority feature has never run against real data. |

---

## B. DATA WE ALREADY RECEIVE AND USE

`dom`, `dom_active`, `price_change_percent`, `ref_price`, `price`, `msrp`, `build`,
`inventory_type`, `media`/photos, `vdp_url`, `stock_no`, `dealer`/`mc_dealership` (isolation),
`source` (isolation). Plus every `vehicle-enrich` product: Market Days Supply (130/132),
comparables (130/132), market geography, price prediction, sales velocity, listing history,
recalls. NeoVIN supplies base/destination/total MSRP, priced packages and options, standard
equipment, colour codes, assembly plant, EPA economy (128/132) and warranty (132/132).

---

## C. DATA WE RECEIVE BUT DO NOT USE

| Field | Where it sits | Assessment |
|---|---|---|
| `last_seen_at` | `mc_attributes` | **The natural substrate for an archive grace period, already paid for, zero readers.** |
| `first_seen_at`, `scraped_at`, `dom_180`, `ref_miles` | `mc_attributes` | No readers. |
| `in_transit` | `mc_attributes`, 130/132 populated | **Zero readers.** A shopper shown "available now" for a car in transit is a live accuracy problem. |
| `id` (MC listing id) | `mc_attributes.mc_listing_id` | Deliberately captured for a future `/v2/listing/car/{id}` call. Correct forethought. |
| `screenshot_sha256` | `advertised_prices` | Written, **read nowhere**. A hash nobody checks is a comment. |
| `override_expires_days`, `auto_replace_override` | `source_authority_rules` + settings UI | **A dealer can set an override to expire and nothing will ever expire it.** |
| `usable_in_copy` | `vehicle_facts` | `true` on 5,042/5,042. A gate with no hand on it. |

---

## D. DATA AVAILABLE BUT NOT CURRENTLY INGESTED

`first_seen_at_mc`, `first_seen_at_source`, `dos_active`, `data_source`, `ref_price_dt`
(dates the markdown — "reduced $1,200 twelve days ago" beats "reduced 4%"), per-photo
metadata (UNKNOWN whether the plan sends more than URL arrays).

Off-page but reachable: NMVTIS title brands (`marketcheck-title-report` exists), original
Monroney via VinAudit (fetcher exists, key unset).

---

## E. DATA WE SHOULD NOT USE

1. **Anything inside a VDP description block.** It is our own generated copy syndicated back.
2. **Any element labelled MSRP on a dealer VDP.** The Harte page states MSRP three ways —
   hidden `#vdpmsrp` 36925, disclaimer $24,981, description $56,945 — and only the last is a
   Monroney figure, sourced from our own text.
3. **CARFAX `data-snapshotkey`** harvested by scraping (see §G).
4. **CarStory panel content.** Licensed to the dealer; we already pay MarketCheck for comps.
5. **`is_searchable`, `level_ss`** — verifiably absent from the payload (0/201). Not a gap.
6. **`heading`, `seller_type`, `ref_miles*`** on our own car — meaningful for comps, meaningless
   for the dealer's own vehicle.

---

## F. SOURCE-OF-TRUTH GAPS

1. **No reader.** The layer is written and not read (§A).
2. **No recency gate.** `resolveFact` ranks recency only as a *third* tiebreak. The engine has
   no concept of "too old to use."
3. **No artefact evidence.** `vehicle_facts.evidence` points at a JSON payload. It cannot point
   at a PDF, a screenshot or a document — though `document_assets.checksum`,
   `evidence_receipts.chain_root` and `advertised_prices.screenshot_sha256` all exist.
4. **One producer.** `candidatesFromListing` is the only wired producer.
   `candidatesFromDealerEdits` is dead code. Recall, EPA, market, history, Get Ready,
   inspections, crawled prices and documents never become facts.
5. **The dispute machinery has never run.** `vehicle_fact_conflicts` = 0 rows; no
   `(vehicle_id, fact_key)` has more than one candidate. **In production no fact has ever had
   two sources.**
6. **A dealer edit can wear OEM provenance.** The dealer path is dead, so edits land on
   `mc_attributes` and are re-ingested by `candidatesFromListing`, which attributes anything
   inside `build_sheet` to `neovin` — VERIFIED at `ingest.ts:185-186`. A dealer edit to
   `mc_attributes.base_msrp` is re-read as a NeoVIN VERIFIED manufacturer fact, raising no
   dispute because there is only ever one candidate.
7. **Fact-key drift.** `MANUFACTURER_CONTROLLED` holds `factory_option` (singular);
   `candidatesFromListing` emits `factory_options` (plural). Confirmed in the DB: factory
   options store as `authority='shared'`, so **a disputed factory option can never block an OEM
   sticker.**

---

## G. PROVIDER / LICENSING / TECHNICAL LIMITATIONS

**CARFAX — four distinct acts, ranked most to least defensible.** The two agents who examined
this reached the same verdict on different grounds; the disagreement is worth preserving.

| Act | Verdict | Basis |
|---|---|---|
| 1. Store the **link** (what we do today) | **DEFENSIBLE** | A URL, never content. `carfaxLink.ts:10-13` already codifies why. Dealer-revocable. Open item: a dealer-ToS line authorising republication — an engineering task, not a legal one. |
| 2. Store `data-snapshotkey`, render CARFAX's own embed | **REJECT as scraped — but PURSUE by asking** | Agent 2 called this redistribution. Agent 4 disagrees and is right: CARFAX serves its own content to the shopper's browser and we store nothing, like embedding a video player. The real objection is **credential misuse and origin scope** — the key is the dealer's entitlement for the dealer's domain. That makes this the one CARFAX act **available by consent**: have the dealer paste their own key into settings, or get a CARFAX partner agreement. Do not let the word "redistribution" close it — it is our highest-value CARFAX option. |
| 3. Restate findings in our own words | **NOT DEFENSIBLE — and already happened** | The live Harte VDP carries AutoLabels copy asserting "CARFAX reports no accidents… no title brands." The current engine has stopped doing this; the residual exposure is stale syndicated copy we cannot retract. |
| 4. Scrape the report behind the link | **INDEFENSIBLE** | Access, copyright, contract and competitive posture all fail at once. Should be a written prohibition — the mechanism is trivial to add. |

**Needs a lawyer, not an engineer:** CARFAX embed terms and domain scoping (in practice: ask
CARFAX); self-hosting a purchased VinAudit Monroney render; whether `dom` / `price_change_percent`
/ `ref_price` may be displayed to consumers on a public page (the MarketCheck contract is not in
the repo — **UNKNOWN**, and `lotFeedRow.ts:28-37` already frames blackbook/comparables as an
unresolved licensing question rather than a settled one).

**Technical:** Firecrawl plan limit is **11 requests/minute** (the 429 body names it). Harte's
plain fetch 403s but Firecrawl's *basic* proxy succeeds at **1 credit** — no stealth proxy needed
for this dealer. 2,133 bot-challenge skips in 30 days is the real CARFAX-coverage blocker, not
extraction.

---

## H. CURRENT DATA COVERAGE (132 active, VERIFIED)

Full: `warranty_info` 132 · `mc_attributes.features` 132 · `packet_modules` 132 (all `{}` = inherit)
Near-full: `market_value` 131 · `history_payload` 131 · `comparables` 130 · `website_sale_price` 130 ·
`photos` 130 · `dom` 130 · `epa_economy` 128 · `options` 113
Partial: `carfax_1_owner` 57 (all MarketCheck-sourced) · `recall_status` 57 · `description` 17
Empty: `history_report_url` **1** · `carfax_clean_title` **0** · `certification` **0** ·
`oem_sticker_url` **0** · `oem_sticker_checked_at` **0** · operational facts in the ledger **0**

---

## I. MARKETCHECK SYNC FINDING — the 57 vs 132 question, answered

**"57 seen" was one manual run at 16:45, not the nightly. The 03:07 nightly saw 129 of 132.**

Three verified parts:

1. **The pinned owned feed contains zero new cars.** `mc_rooftop_id=385292&owned=true` returns
   `num_found: 59, match: 59, purity: 1.00, new_units: 0`. 41 used + 18 CPO = 59 exactly.
   MarketCheck does not attribute Harte's 71 new units as owned by that rooftop. **Why is a
   vendor question, not a code question — UNKNOWN, needs a MarketCheck ticket.**
2. **The 71 new cars arrive only through a secondary backstop** —
   `source=harteinfiniti.com&owned=false&car_type=new` → 70 ingested. 59 + 70 = 129.
3. **On the manual run the backstop broke out of its probe loop after one car.**
   `marketcheck-sync/index.ts:1509` is `if (ingested > 0 || capped) break;`. A transient 1-car
   answer from `mc_location_id=1393150` pre-empted the 70-car answer four probes later.

Nothing was lost — `prune_skipped: "inventory_collapsed:58_vs_129"`, `removed: 0`.

### The part that matters more than the question asked

**A latent mass-archive path is still open.** On that run `segments.new` was
`{prior: 71, accepted: 1, reported: 0}` — and the per-segment gate **passed**, because every
blocking clause in `segmentPrunePreflight` requires `accepted === 0`, and the backstop bug
produces exactly `accepted === 1`. Only the coarse run-level 60% breaker saved 70 live cars.

**At a store with 20 new units in a 120-car lot, losing all 20 leaves 100 ≥ 72 — neither guard
fires and the entire new-car lot is archived.** That is the 2026-08-01 incident, reachable
through a different door. This is the single most dangerous finding in the investigation.

**Secondary:** `removed_from_feed` is unusable as an alert — 5,532 events across 268 VINs
(avg 20.6, worst 51), with **85 of the 132 live vehicles carrying removal events**, because
`emitChange` never dedups. A real removal is invisible in that noise.

---

## J. FIRECRAWL FINDING — what we scrape, retain, and get wrong

**The 402/429 question, settled with the raw bodies.** Both appeared in one 9-second window:

```
18:00:07–12  402 ×10  "Insufficient credits to perform this request … or try
                       changing the request limit to a lower value."
18:00:13–16  429 ×15  "Rate limit exceeded. Consumed (req/min): 11,
                       Remaining (req/min): 0 …"
```

Both were recorded as `render_credits_exhausted`. **Do not top up the account.** The dashboard
shows 1,328 credits and a single scrape returned 200/`creditsUsed: 1` today. The 429 is a plan
rate limit that names its own number — 11/min against 25 renders fired in 9 seconds. The 402 is
a per-request refusal whose own suggested remedy is *"change the request limit to a lower value"*
— request shape, not balance.

Two agents disagreed here and both were partly wrong: "the account was empty" is refuted by the
balance and by today's successful scrape; "it is all one rate wall" is refuted by the 402 body.
The resolution is that the format bundle explains the 402 and the burst explains the 429.

**Cheapest reliable format:** `formats:["html"]` = **1 credit, VERIFIED**. Drop `json` (+4) — it
is a fallback of a fallback, VIN- and MSRP-gated, and Harte's price stack resolves deterministically
through `DEFAULT_PRICE_LABELS` which already contains "Sale Price". Screenshot only on price change.
~132 credits/night against 660-792. **The 1-credit pattern already exists in-repo** at
`firecrawl-scrape/index.ts:80`.

**The evidence chain does not survive a challenge.** Six breaks, all VERIFIED: the "Evidence" link
renders a **private storage path with no `createSignedUrl` anywhere for that bucket — it has 404'd
for its entire existence**; the SHA-256 is never re-verified; coverage is 21 of 284 VINs; 2.59 GB
with no retention policy; screenshots are captured only on parse *success*, so the failed-parse
case — exactly where a human needs the picture — is discarded.

**The worst finding in this section is not a missing field.** `advertised_prices` is being
backfilled from the MarketCheck feed (`marketcheck-sync:1198`) with `source_channel='website'`,
`captured_by` null and no screenshot. The crawler's last real capture was 2026-08-24, so those
58 rows are now indistinguishable from 1,532 screenshot-backed ones — and `auditPacket.ts:130`
selects `*` unfiltered. **Every compliance packet generated since 16:45 today reports a feed echo
as an observed advertisement.**

---

## K. OEM STICKER FINDING

**ALREADY EXISTS — this is procurement, not engineering.** `oem-window-sticker/index.ts` is a
complete VinAudit/MonroneyLabels fetcher, wired at `intake-autoprovision:984` and
`packet-backfill:241`. `oem_sticker_checked_at` is NULL on 132/132 because it short-circuits on an
unset key — **returning HTTP 200 while doing nothing**, which is why no alarm ever fired.

**But buying the key yields less than expected.** NeoVIN already supplies base/destination/total
MSRP, priced packages, priced options, standard equipment, colour codes and assembly plant. An
original adds **provenance, not fields**. And the fetcher stores a PDF and two columns — it never
parses the Monroney, and `buildSheetSource` can only return `neovin` or `other_structured`. So
today, buying the key produces an image and **zero change to resolved truth**.

**A provenance leak worth fixing regardless.** 196 AutoLabels *reproductions* exist and 0
originals. The PDF disclaimer is blocking, but `PublicDocuments.tsx:107-124` titles the
reproduction "OEM Window Sticker / Original factory window sticker… as delivered from the
manufacturer" and `VehiclePassportDocuments.tsx:573-576` calls it "Original Factory Build & MSRP
Record". `lotFeedRow.ts:176-202` (`WindowStickerKind`) already solves this correctly — copy it.

The claimed "Window Sticker control on the dealer VDP" is **not in the fixture** — unsupported.

---

## L. CARFAX FINDING

Coverage `history_report_url` = **1/132** (8 tenant-wide including archived). This is **not an
extractor problem** — the extractor produced 8 tokenized links and is verified working against the
real fixture. The cause is 2,133 bot-challenge skips in 30 days.

MarketCheck sends `carfax_1_owner` (90/201 raw rows, correctly absent on new) and **never sends
`carfax_clean_title`** — 0/201, recorded as `"absent"` rather than `"null"`. No CARFAX report URL
arrives under any name. The iPacket-parity CARFAX gap is a genuine vendor gap.

`carfax_clean_title` is now correctly **unset everywhere**, because its only source was our own
description. Unset is the honest state; the passport's title module must read *unverified*.

---

## M. CERTIFICATION FINDING

The footer-nav fix holds — verified against the real fixture and by test. **The same bug class
survives in two places:** the 400-character anchor cap means Similar-Vehicles cards are not
stripped, and non-anchor chrome is never stripped at all. Scoping detection to the VIN's own
container closes both.

`condition = 'cpo'` **is** derived from MarketCheck's `is_certified` (`marketcheck-sync:966`) and
the raw flag is discarded — the code comment's claim is correct, so `condition` genuinely cannot
corroborate the feed.

**Structured CPO record: REJECT.** There is no source for program name, inspection-point count,
warranty term, certificate number or expiry. Building the schema would invite fabrication.

---

## N. ADVERTISED FINANCE / OFFER FINDING

**Not Vehicle Truth. A separate expiring Advertised Offer snapshot — and a narrow one.**

The type system already decided this. `CandidateFact` has `sourceTimestamp` and no `validUntil`.
`resolveFact` is single-valued while an APR is simultaneously true at N credit tiers. And
`dealer_vdp` is capped at MEDIUM — right for a CARFAX badge, wrong for a published offer, which is
*primary* evidence of publication and *zero* evidence of applicability. One confidence axis cannot
express "certainly published / conditionally applicable."

**But capture only the verbatim disclosure text, its expiry, and a screenshot reference.**
Field-decomposing APR/term/down/payment/lender is **DEFER**: it is TILA partial-disclosure risk,
nothing consumes the fields, and a real advertised payment on the passport would contradict the
`DEFAULT_APR_PERCENT` estimate already shown there.

The value agent goes further and says **REJECT for now** — Harte has **912 open work items with 1
completed and 7,080 unreviewed stale flags**. Adding a legal-flavoured alert to an unworked queue
is negative value. Both positions are recorded; the reconciliation is in the matrix (P2, gated on
someone owning the queue).

---

## O. PRICE RECONCILIATION FINDING

The proposed rule — *a fee difference reconciles only if the scrape captured the fee as an explicit
line item* — is **correct in principle and already implemented in substance**, as of today.

`reconcileGap` now substitutes `advertised_price_before_doc` (the fee-exclusive figure the crawler
parsed off the ladder) when the snapshot is recognisably that page's fee-inclusive total, and
compares like with like **exactly, with no widened tolerance**. A genuine $895 discrepancy on top
of the fee still reports $895. It declines to substitute when no ladder was parsed, when the page
added no fee, or when the snapshot no longer matches the page. That is the owner's rule, enforced
by arithmetic rather than by a magic constant.

**Remaining defect:** the misparse guard at `crawl-advertised-prices:1400` compares
`advertised_price_before_doc` (fee-exclusive) against `vehicle_listings.price` (fee-inclusive for
this dealer) with a 2% tolerance — but the doc fee is ~3.6%. **The guard is loose by more than its
own tolerance and will miss a real mis-parse in the 2–3.6% band.**

---

## P. GET READY / OPERATIONAL TRUTH FINDING

**Zero of 5,042 facts are operational.** `prep_sign_offs` and `detail_signoffs` are empty; all 275
Get Ready records are `pending`.

The consumer already exists and is named in code: `autofilm-feed/index.ts:22-25` documents the
detail endpoint as "the call that backs generated talking points" and `:168` selects
`fact_key, fact_value, source_kind, confidence, authority, evidence` from `vehicle_facts`. Writing
recon truth there feeds AutoFilm with **no AutoLabels UI work**.

And the description engine already bans the exact claims Get Ready would substantiate —
`_shared/description-core.ts:124-125` blocks `new tires`, `new brakes`, `fully inspected` with
`requires: "__never"`. **The owner's own good example is unconditionally banned copy today, even
when true.** The unblock is one line below at `:899`.

**But the sequencing correction matters:** flipping `__never` to `requires: "tires_replaced"`
against an empty table is a **no-op** — the lookup finds nothing and raises the same violation. It
ships in the same change as the producer or not at all. And the producer is gated on whether Harte
will actually run Get Ready in-app, which **no code change answers** — that is a conversation with
the dealer, and it is the real dependency.

---

## Q. PROVENANCE / CIRCULAR EVIDENCE FINDING

**The rule to adopt, verbatim:** *AutoLabels-derived content cannot become independent evidence for
the facts that generated it.*

**Path 1 — badge detectors. FIXED, verified against the real fixture.** The Harte VDP's description
block is our own unrendered markdown, and `"no title brands"` appears there and nowhere else on the
page. `stripDescriptionBlocks` removes it; one-owner survives on genuine CARFAX badge art, clean
title correctly goes false.

**Path 2 — price extractors. LIVE, and the fix this morning missed it.** `evidenceHtml` is applied
at only three call sites, all badge detectors. Every `extractAdvertised` and `extractPriceComponents`
call receives raw HTML. Running the real extractor against the real fixture narrowed the exposure
precisely:

- **Advertised price — guarded, but by accident.** Not by the `BAD` list: `moneyRe` captures context
  as `[a-z .,'-]{0,40}`, and the character before our `**$56,945**` is `*`, so `ctx` is empty and the
  guard never sees "msrp" or "sticker". Our number is admitted as a clean candidate. What beats it is
  the dealer's `" sale price "` label scoring 9 against its 0. **Protection comes from the dealer's
  markup, not from anything we built — it does not generalise.**
- **`result.msrp` — exposed but inert.** Never written to any column.
- **`extractPriceComponents` — genuinely exposed.** `valueForLabel` is first-match-wins with **no BAD
  list at all**, and its `dealerDiscount` alternation includes bare `savings` and `discount`. It
  persists *and displays*: `:1424` → `passportV2Data.ts:530` → `priceModel.ts:327` renders a **"Dealer
  Discount" line on the customer passport.** One argument fixes it.
- Side finding: with no GOOD label present the tie-break picks the **lowest** score-0 value — on this
  fixture, `$2,498`, the down payment — saved only by a plausibility ratio.

**Path 3 — `vdp-ingest:301,124` — LATENT.** Writes scraped `og:description` and `warranty_text` back
with no strip. Dead only because `merge_scraped_vdp` was revoked and never re-granted. Delete it
rather than relying on the revoke.

**Checked clean:** MarketCheck sync (never reads `description`), the description engine
(snapshot-gated with preflight blocks), AutoFilm (`vehicle_facts` + `usable_in_copy`), MSRP
reconciliation, `value_props`. `description-reconcile-nightly` does not exist.

---

## R. PACKET_MODULES FINDING

**ALREADY EXISTS, fully built and server-enforced.** `src/lib/packetModules.ts`,
`PassportPacketSection.tsx`, `PacketDefaultsPanel.tsx`, and `public-listing-view:768-800` which
**deletes** excluded modules from the payload rather than hiding them client-side, with per-vehicle
override → store default → visible precedence. `packet_modules = {}` on 132/132 means "inherit",
which is the correct default. **CLAUDE.md's roadmap line calling packet curation MISSING is out of
date and should be corrected.**

The owner's rule — presentation policy only, never canonical truth — is already how it behaves.

**One compliance hole, found by cross-review.** `public-listing-view:794-796`:

```
if (!vis("documents")) row.documents = vis("oemSticker") ? docs.filter(d => d.type === "window_sticker") : []
```

The documents array is free-form `{name, url, type}` with **no compliance carve-out** — an attached
Buyers Guide or CT K-208 is deleted server-side by a presentation toggle. **Presentation control must
never be able to suppress a mandated disclosure.** The adjacent line proves the fix is trivial:
`window_sticker` already gets carved out by type. Live exposure is **nil today** (0 overrides, empty
documents JSONB on 132/132), which is why this is P1 and not P0. Recall is genuinely non-curatable —
verified. Separately: the Buyers Guide is not served on `/v/:slug/documents` at all, only as a
"request" chip.

---

## S. SCHEMA GAP ANALYSIS

**Do not build the seven-domain enum.** Five of the seven are already purpose-built tables with
better columns than a generic fact row would give them — C = `advertised_prices` (with a screenshot
hash), E = `vehicle_value_history`, F = `get_ready_records`/`safety_inspections`, G =
`usable_in_copy`. A and B are literal restatements of `FactAuthority`. Domain *is* orthogonal to
authority, but its useful residue is **one bit, not seven**: does this decay?

**And do not build `effective_until` either** — the cross-review reversed that recommendation and I
find it convincing. ~90% of these facts never expire; ~8% are *superseded* rather than expired, which
is unknowable at write time; ~2% have a horizon already covered by `*_checked_at`. It encodes a
read-site policy question as a producer-side column. **Put max-age in `ResolveOptions` instead** —
no migration at all.

**Do not build:** a v2 facts table (13 of 17 attributes exist), a new staleness surface
(`stale_document_flags` 7,080 rows + `vehicle_exceptions` 914 already exist, and `existingQueues.ts`
was written specifically to avoid a second one), a new evidence table (add jsonb keys to
`vehicle_facts.evidence` instead), a fifth raw-payload store (there are four), a second
change-history table (`vehicle_change_history`, 6,004 rows), a quarantine table
(`rejected_other_rooftop` = 0 on every run).

**Genuinely needed, all extensions:** widen two CHECK constraints; add `captured_method` to
`advertised_prices`; add document/screenshot keys inside the existing `evidence` jsonb.

---

## T. UI / VEHICLE FILE OPPORTUNITY

Source freshness as a **query over existing columns**, not a new screen: `oem_sticker_checked_at`
NULL on 132/132 and `scrape_last_synced_at` 0/132 are two paid providers that have never run, and
no surface says so. That is the whole opportunity, and it is a column on the Overview tab.

---

## U. PASSPORT OPPORTUNITY — not implemented, per the lock

| Opportunity | Surface |
|---|---|
| Suppress "available now" when `in_transit` (130/132 populated, zero readers) | **EXISTING SURFACE CAN USE THIS NOW** — bugfix/data-wiring, which the lock permits |
| Date the price markdown from `ref_price_dt` | **EXISTING SURFACE** (Market Timing) — subject to the MarketCheck display question |
| Show badge attribution ("Per dealer listing") for MEDIUM-confidence history facts | **EXISTING SURFACE** — data already carried, deliberately not rendered pending owner sign-off |
| CARFAX embed via a dealer-supplied key | **NEW SURFACE — OWNER APPROVAL NEEDED**, and gated on §G |
| Recon / Get Ready module | **NEW SURFACE — OWNER APPROVAL NEEDED**, and must not be built before the data exists |

---

## V. AUTOFILM OPPORTUNITY — and a live defect first

**Defect, VERIFIED.** 119 live VINs, every fact `usable_in_copy: true`, **99 (83%) disagreeing with
the live price**, 46 off by more than $1,000, worst **+$12,379**, **$165,289 misstated in total**,
every one labelled `confidence: VERIFIED`. **32 understate the price** — the FTC-relevant direction.
The payload is self-contradictory: the `vehicle` block is live, `facts[]` is stale, one response
carrying two prices with VERIFIED on the wrong one. **UNKNOWN** whether Harte's integration is
provisioned, which is the only reason this may not yet have reached a customer.

**Fix is one line:** deny-list `DEALER_CONTROLLED` facts from `facts[]` — the live block already
carries them.

**Opportunity, after that:** operational facts from Get Ready are exactly what talking points need,
and the consumer is already wired.

---

## W. DESCRIPTION INTELLIGENCE OPPORTUNITY

The engine is the most defended surface in the platform — snapshot-gated, preflight-blocked, with an
`excluded_claims_json` audit trail. The opportunity is narrow and specific: **unblock the three
`__never` service claims by backing them with real Get Ready facts.** Ships with the producer, never
before.

---

## X. COMPLIANCE OPPORTUNITY

Ranked by exposure, not by novelty:

1. `advertised_prices` feed contamination — a compliance packet that reports a feed echo as an
   observed advertisement.
2. The evidence link that has always 404'd.
3. Packet curation able to delete a Buyers Guide.
4. The "Dealer Discount" line derived from our own copy.
5. The misparse guard looser than the doc fee it is meant to see past.

None of these is on the original expansion list. All five outrank it.

---

## PRIORITY MATRIX

### P0 — DATA INTEGRITY / FIX FIRST

| # | Recommendation | Current state | Value | Cplx | Risk | Cost | Dependencies | Downstream benefit |
|---|---|---|---|---|---|---|---|---|
| P0-1 | Make `segmentPrunePreflight` proportional (block when `accepted < prior × 0.5`) and fix the backstop `break` at `marketcheck-sync:1509` | Both bugs live; only the coarse breaker saved 70 cars | **10** | 3 | LOW | LOW | none | Prevents a whole-segment inventory wipe at any dealer with a smaller new-car share |
| P0-2 | Deny-list `DEALER_CONTROLLED` facts from `autofilm-feed` `facts[]` | 83% of live VINs serving a stale VERIFIED price; 32 understate | **10** | 1 | LOW | LOW | none | Stops misstated prices in generated talking points today |
| P0-3 | Add `captured_method` to `advertised_prices`; filter the audit packet on it; stop the feed writing `source_channel='website'` | Feed rows indistinguishable from observed ones in every packet since today | **10** | 2 | LOW | LOW | none | Restores the compliance packet's meaning |
| P0-4 | Pass `evidenceHtml` to `extractPriceComponents` (and the other extractors) | Live circular path rendering a "Dealer Discount" from our own copy | **9** | 1 | LOW | LOW | none | Closes the last known circular-evidence path |
| P0-5 | Fix `classifyCrawlOutcome` 429-before-402 ordering | 18 days of rate limits reported as credit exhaustion | **9** | 1 | LOW | LOW | none | Stops the operator surface lying; prevents a pointless top-up |
| P0-6 | Pace renders below 11/min; drop the `json` format; `waitFor` 10s → 4s | Crawl has produced nothing since 2026-08-24 | **9** | 2 | LOW | LOW | P0-5 | Restores price observation at ~1/5 the credit cost |
| P0-7 | Sign the evidence URL (`createSignedUrl` on `price-evidence`) | Every "Evidence" link has always 404'd | **8** | 1 | LOW | LOW | none | Makes 2.59 GB of evidence viewable for the first time |
| P0-8 | Widen the two CHECK constraints (`dealer_vdp`, `history_provider`) **and** add error handling at `truth.ts:155` | Latent trap with a **silent** failure mode | **8** | 2 | LOW | LOW | none | The upsert result is discarded, so a rejected row would silently drop all ~20 facts for that VIN while reporting success |

### P1 — HIGH-VALUE VEHICLE TRUTH EXPANSION

| # | Recommendation | Current state | Value | Cplx | Risk | Cost | Dependencies |
|---|---|---|---|---|---|---|---|
| P1-1 | Close the read loop — but sequenced: price sanity floor → max-age in `ResolveOptions` → make `usable_in_copy` real → per-fact-family rollout, **manufacturer facts only** | Written, unread, stale on 99/119 | 9 | 6 | MED | MED | P0-2, P0-8 |
| P1-2 | Fix the `factory_option(s)` singular/plural drift | Factory options resolve as `shared`; cannot block an OEM sticker | 7 | 1 | LOW | LOW | none |
| P1-3 | Carve compliance document types out of packet curation | A toggle can delete a Buyers Guide; live exposure nil | 8 | 2 | LOW | LOW | none |
| P1-4 | Fix the OEM-reproduction provenance labels (`WindowStickerKind` already solves it) | Reproductions titled "Original factory window sticker" | 8 | 2 | LOW | LOW | none |
| P1-5 | Persist `last_seen_at`; give the prune a 2-run grace period; dedup `removed_from_feed` | No grace period; 5,532 noise events | 7 | 5 | MED | LOW | P0-1 |
| P1-6 | Fix the misparse guard to compare like-for-like price definitions | Looser than the doc fee it must see past | 7 | 2 | LOW | LOW | none |
| P1-7 | Scope badge detection to the VIN's own container | Similar-Vehicles cards and non-anchor chrome unstripped | 7 | 5 | MED | LOW | none |

### P2 — PRODUCT / PRESENTATION

`in_transit` on the passport · source-freshness column on the Vehicle File · `advertised_offer_snapshots`
(verbatim disclosure + expiry + screenshot ref **only**) · `ref_price_dt` to date the markdown ·
reconcile `dom` vs `dom_active` to one accessor · Get Ready → `vehicle_facts` **with** the description
`__never` unblock, shipped together · honour `override_expires_days` · NMVTIS for real title brands.

### P3 — NICE TO HAVE

Screenshot on render success rather than parse success · evidence retention policy · `price-evidence`
pruning · paginate the new-car backstop · investigate why `blackbook` is 0/132 · align `vehicle_listings`
RLS with the `tenant_members IN (…)` shape before tenant #2.

### REJECTED

Seven-domain enum · `effective_until` column · a v2 facts table · new evidence/staleness/quarantine/raw-payload
tables · CARFAX `data-snapshotkey` **scraping** (pursue by consent instead) · scraping the CARFAX report ·
CarStory content scraping · rehosting the VDP gallery · full APR field decomposition · structured CPO record ·
DataOne/Auto.dev purchase · `is_searchable`/`level_ss` · ingesting `dos_active`/`heading`/`seller_type`/`ref_miles` ·
the source-choice rule as proposed · a new passport recon module before the data exists · any new
`vehicle_exceptions` type until someone works the 912 open ones.

---

## FINAL QUESTIONS, ANSWERED

**1. Are MarketCheck and Firecrawl used to their full practical value?**
MarketCheck: closer than the brief assumed — MDS, comps, geography, prediction, velocity, history and
recalls are all live on 130/132. The unused residue is small and mostly low-value. Firecrawl: no — it has
produced nothing for 15 days and costs 5-6× what it needs to.

**2. Five highest-value unused data points.**
`last_seen_at` (an archive grace period, already paid for) · `in_transit` (130/132, zero readers, live
accuracy problem) · `screenshot_sha256` (written, never verified, link broken) · `usable_in_copy` (a gate
with no hand on it) · `override_expires_days` (a dealer setting that does nothing).

**3. Five highest-value Vehicle Truth improvements.**
Close the read loop, sequenced · make `usable_in_copy` real · add a recency gate at read time · point
`evidence` at documents and screenshots · fix the fact-key drift so a disputed factory option can actually
block a sticker.

**4. What should NEVER be canonical Vehicle Truth.**
Anything derived from AutoLabels-generated content · advertised finance terms · third-party market opinion ·
any VDP element labelled MSRP · CARFAX findings we did not read from CARFAX.

**5. What should be evidence only.**
Screenshots and their hashes · raw provider payloads · the CARFAX link · the verbatim disclosure block ·
the OEM PDF.

**6. What should be an expiring Offer record.**
The advertised finance disclosure — verbatim text, `expires_at`, screenshot reference. Nothing decomposed.

**7. What stays Market Intelligence.**
MarketCheck predicted value, comparables, MDS, DOM, price-change history, CarStory (by reference only).

**8. What should come from Get Ready.**
Inspection completed · tire and brake measurements · repair completed and reinspected · detail completed ·
dealer accessories installed · CPO inspection · delivery clearance. **Facts, never adjectives** — "four new
tires installed by dealer", never "meticulously reconditioned".

**9. Is OEM sticker ingestion worth prioritising?**
**No, not yet.** It is built; the key is unset. Buying it today yields a PDF and zero change to resolved
truth, because nothing parses the Monroney and NeoVIN already supplies the fields. Fix the provenance
*labels* first — that is where the real exposure is.

**10. Is following the CARFAX link worth prioritising?**
**No — following it is indefensible.** The defensible high-value move is the CARFAX *embed*, obtained by
asking the dealer for their own key or via a partner agreement. Different act, different risk, far better
outcome.

**11. Is advertised finance monitoring worth building?**
**Narrowly, and not first.** Verbatim disclosure + expiry + screenshot, once someone owns the compliance
queue. Today that queue has 912 open items and 1 completed.

**12. Is MarketCheck lifecycle data worth surfacing?**
Mostly already surfaced. The genuinely valuable unused piece is `last_seen_at` as prune-safety
infrastructure, not as a customer-facing timeline.

**13. Does `packet_modules` belong, and what should it control?**
Yes, and it already does exactly what it should: presentation policy, server-enforced, per-vehicle override
→ store default → visible. It must control **module visibility only**, never truth — and it must be
prevented from deleting a mandated disclosure.

**14. Do we currently have circular evidence anywhere?**
**Yes — one live path**, in `extractPriceComponents`, which persists and renders a "Dealer Discount" derived
from our own copy. One latent path in `vdp-ingest`. The badge detectors are fixed and verified.

**15. What should we NOT implement?**
See REJECTED. The largest single saving is the seven-domain schema and every new table that would follow it.

**16. If we implement only three things.**

1. **P0-1 — the archive guard.** It is the only finding that can destroy a dealer's live inventory, and it
   is three lines.
2. **P0-2 + P0-3 + P0-4 as one "provenance labels" change.** Three wrong-or-absent labels — a stale
   VERIFIED price in AutoFilm, feed rows posing as website observations in the compliance packet, and a
   discount derived from our own marketing copy. Together they are the difference between a platform that
   *claims* provenance and one that *has* it.
3. **P0-6 — restore the crawl at 1 credit with pacing.** Six capabilities are downstream of it: CARFAX link
   capture, one-owner corroboration, clean-title, certification, advertised-price observation, and every
   passport claim that depends on them. Nothing in P1 or P2 matters while it is dead.

**What this investigation did not find:** a missing data source. Every high-value item is a connection, a
correction, or a label.
