# ENTITLEMENT_AND_TERMS_REPORT

What this account is actually entitled to (as production has answered), what
the provider's terms permit us to keep, and what cannot be verified from this
environment. Dated 2026-10-27; facts from read-only SQL and source on `main`
at `621466b`.

## 1. Entitlement as observed in production

| Product | Last answered | Last refused | Reading |
|---|---|---|---|
| Dealer Inventory Syndication | 2026-10-03 (128 units, HTTP 200) | every night since 2026-10-04 (HTTP 429 on the pinned rooftop) | Plan quota, confirmed 2026-10-27. The portal's account-level usage alerts show 5,000 calls a month, crossed on Jul 29, Sep 11 and Oct 4; the run history matches exactly (refused Jul 29-31, back Aug 1; no run rows Sep 12-30, back Oct 1; refused since Oct 4). The quota resets on the 1st. `/search/car/active` and MDS keep answering past 100%, so the cap is enforced per product; which products is on the Subscriptions page. |
| Active inventory search | 2026-10-27 | none observed | Entitled and answering. |
| NeoVIN | 2026-10-03 (last decode needed) | none observed | Entitled; nothing new to decode since. |
| VIN history | 2026-10-03 | 0 refreshes in 7 days despite 2 enrich passes a day | Refused or failing since Oct 3 (the function returns null on any non-2xx and keeps the old payload, so the status is not recorded). |
| Market Days Supply | 2026-10-27 | none observed | Entitled and answering. |
| Inferred Sales Stats / recents | 2026-10-03 | 0 refreshes in 7 days | Refused or failing since Oct 3 (same silent-null path). |
| MarketCheck Price (Base) | 2026-09-11 (one reserved call) | none | Entitled; policy disabled since. |
| Premium / Premium Plus | never called | n/a | Unknown. One authorized call decides it. |
| AutoRecalls | never a usable answer; stamps say `marketcheck_autorecalls` with empty campaign lists; `recall_check` last written 2026-09-04 | 404 / empty on every path variant | Not entitled on the current path, and the current documented path (`/v2/car/autorecalls/{vin}`) has never been tried. Every VIN is honestly UNKNOWN. |
| OEM incentives | n/a | n/a | Disabled by owner decision 2026-07-28 (`MARKETCHECK_INCENTIVES_ENABLED` unset). |
| VINData / NMVTIS | 0 pulls recorded | n/a | Available to Compliance Pro, manual only; never exercised in the ledger. |
| Sold Vehicles Summary, FSBO, auction, MarketMatch, webhooks, NeoVIN batch, listing details, incentives by make/ZIP | never called | n/a | Unknown. |
| Black Book | never | n/a | Not configured (no base URL or credential in the environment). |

The refusal cluster (syndication, history, recents/sales) starts the day the
quota is exhausted and ends on the 1st. On the current plan the feed answers
again on Nov 1 and stays live only as long as the enrich sweep does not
spend the quota first. The sweep was contained the same evening: cursor
amended (`20261027203000`, 92 vehicles a day offered before, 1 after;
`20261028000000` keeps the window on the visit clock) and
the nightly job paused (`20261027204000`); see
PROVIDER_COST_AND_CACHE_REPORT.md §2.

## 2. Terms that constrain storage and display

| Source | Constraint | Where enforced | Status |
|---|---|---|---|
| VINData / NMVTIS (AAMVA) | No caching or persistence beyond a single user session; the provider's 90-day access report is the only cache | `marketcheck-title-report` returns a session summary and writes nothing but the billing meter; `20260721212000_title_reports_no_persist_vindata.sql` | Honoured. Any automated used-vehicle workflow (§16) must keep this boundary unless the current contract explicitly allows retaining specific normalized conclusions. The dealer's own attestation (`title_verification`) is a business record and may be kept. |
| MarketCheck active-listing data | Retained only as normalized evidence supporting a valuation for one tenant, scoped by RLS, excluded from public payloads; no images, descriptions, VDP URLs or provider identifiers beyond the dealer name | `market_cohort_snapshots` migration comment; `marketSnapshot.ts` header; `market_meta.sold_stats` stores medians only | Honoured in design; the comps route and `comparables` column do expose dealer names, distance and one image URL per comparable on the public Passport. That exposure predates this program and is listed in CUSTOMER_DISPLAY_LICENSE_MATRIX.md §3 as an owner decision. |
| MarketCheck "sold" | Inferred from inventory disappearance; last advertised price is not a transaction price | `fetchSoldStats` stores `scope`, `window_days: 90`, `source` | Honoured; copy must keep saying "inferred". |
| MarketCheck history | Not a title history; no owner count, no accident history | `fetchHistory` sets `owners: null` by design | Honoured. |
| CARFAX badge flags on the feed | Low-authority listing claims | `readHistoryFlag` three-state; precedence puts `marketcheck` ahead of `dealer_vdp` for history facts | Honoured; `carfax_clean_title` has never been sent on this plan. |
| NHTSA model recalls | Model context; can never clear a VIN | `recallState.ts` types and CHECK constraints | Honoured. |
| Public list prices in `mcCost.ts` | Operator estimate only, never shown to a dealer | comment in `mcCost.ts`; sync run summary only | Honoured; must move to configuration (§23). |

## 3. Switches and gates in force

- Provider policy for the valuation writer: `disabled`; `market_provider_budgets`
  marketcheck `enabled=false`, monthly 0.07. One reservation ever, succeeded.
- Flags on the pilot tenant: `market_invalid_claim_suppression` true,
  `market_value_v2_shadow` true, the other five false. Shadow cohort 39 VINs.
- Incentives: env gate off; cron still scheduled 03:30 and refused in-function.
- NMVTIS: Compliance Pro plan tier, 50 generates per dealer per month,
  manual only.
- Decode: `shouldDecodeVin` three attempts, strict-once, refusals uncounted.
- Comps route: 12-hour cache per slug; a cache miss is a paid call from an
  anonymous page (§21 violation to close).

## 4. What cannot be verified from this environment

The sandbox egress policy returns HTTP 403 (CONNECT refused) for
`api.marketcheck.com`, `docs.marketcheck.com`, `developers.marketcheck.com`,
`apidocs.marketcheck.com` and `marketcheck.com`. Consequences:

1. The handoff's instruction to re-check the current OpenAPI/docs at
   execution time cannot be carried out here. The 2026-10-21 reference
   (`15_CURRENT_MARKETCHECK_API_REFERENCE.md`, `20_MARKETCHECK_2026_RELEASE_REVIEW.md`)
   is the contract baseline; every endpoint it names is marked `(ref)` in the
   capability matrix until verified.
2. No entitlement test (Premium, Premium Plus, AutoRecalls current path, Sold
   Summary, MDS `exact=true`, Sales Stats cohorts) can be run from here even
   if authorized; it must run from a deployed edge function or from the
   owner's machine.
3. Two ways to unblock: open `docs.marketcheck.com` in the environment's
   network policy, or vendor the OpenAPI 3.1 document into the repo
   (`contracts/marketcheck/openapi.json`) so the registry and CI drift checks
   can read it offline. The second is the durable one and is what §26 asks for.

## 5. Decisions only the owner can make

1. MarketCheck plan quota: raise the 5,000-call monthly quota on the
   Subscriptions page, or keep it and hold the sweep inside it (the cursor
   amendment); and read there which products the cap is enforced on.
2. Whether to run one authorized Premium Plus call for a used VIN and one
   Premium call, to learn entitlement, cost and response shape.
3. Whether AutoRecalls is to be licensed (portal terms) so the current VIN path
   can answer.
4. Whether OEM incentives return for new vehicles, under a program/market
   cache and a budget.
5. Whether NMVTIS moves from manual to exception-based for used vehicles
   pre-publication, within the existing 50/month cap and the non-persistence
   terms.
6. Black Book credentials and base URL, or a formal "unavailable".
7. Webhook configuration in the MarketCheck portal (a signing secret must be
   set as a project secret).
8. Whether the comparables shown on the public Passport (dealer name,
   distance, image) are within the active-listing data terms for public
   redisplay, or must be reduced to aggregates.
9. The drizzle migration system Lovable added on 2026-10-24: keep as a tool,
   or remove and keep Supabase migrations as the single system of record.
