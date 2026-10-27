# ENDPOINT_MIGRATION_REPORT

Each MarketCheck path the code calls today, the path the current contract
documents (handoff reference dated 2026-10-21), and the verification state.
Verification means a live read of the provider's OpenAPI/docs or a 2xx answer
on the documented path from this account; neither is possible from this
environment (the egress policy refuses every `*.marketcheck.com` host), so
every row below is `documented, not verified` until the policy is opened or
the OpenAPI 3.1 document is vendored into `contracts/marketcheck/`.

| Legacy / current path in code | Documented current path | Caller | Change | Verification |
|---|---|---|---|---|
| `/v2/dealerships/inventory` | same | marketcheck-sync | none; refusal handling corrected (this tranche) | documented, not verified; answered 2xx until 2026-10-03, refused since Oct 4 by the 5,000-call monthly plan quota (resets on the 1st) |
| `/v2/dealerships/car`, `/v2/dealers/car`, `/v2/dealer/car` | `/v2/dealerships/car` is the canonical directory; the other two are the legacy id space | marketcheck-sync | keep as operator-only fallbacks; registry marks them `legacy` | documented, not verified |
| `/v2/search/car/active` | same | vehicle-enrich, marketcheck-comps | add `fees` / `price_includes_fees` reads (registry + normalizer landed; vehicle-enrich wiring next tranche) | documented, not verified; answering 2xx today |
| `/v2/decode/car/neovin/{vin}/specs` | same; batch endpoint to evaluate | marketcheck-specs | promoted fields (this tranche) | documented, not verified; answers |
| `/v2/decode/car/{vin}/specs`, `/v2/decode/car/{vin}` | same (basic decode) | marketcheck-specs fallback | none | documented, not verified |
| `/v2/predict/car/us/marketcheck_price` | same (Base) | market-valuation-write | none | documented, not verified; answered 2026-09-11 |
| not called | `/v2/predict/car/us/marketcheck_price/comparables` (Premium) | market-valuation-write (planned) | ADD behind `marketcheck_premium_comparables` after one authorized entitlement call | untested |
| not called | `/v2/predict/car/us/marketcheck_price/comparables/decode` (Premium Plus) | intake (planned) | ADD after entitlement call | untested |
| `/v2/history/car/{vin}` | same | vehicle-enrich | TTL and intake trigger (policy) | documented, not verified; refused since Oct 3 |
| `/v2/mds/car` with year/make/model/zip | same, with `vin` + `exact=true`, `ymmt`, optional `include_sold` | vehicle-enrich | MODIFY the ladder to VIN-exact first | documented, not verified; answering |
| `/v2/sales/car` with make/state only | same, with VIN / taxonomy VIN / YMMT / YMM cohorts and geography | vehicle-enrich | MODIFY cohorts; monthly TTL; retire the "make+state only" comment | documented, not verified; refused since Oct 3 |
| `/v2/search/car/recents` | same | vehicle-enrich | keep as listing-level evidence, not the primary aggregate | documented, not verified; refused since Oct 3 |
| not called | Sold Vehicles Summary (current docs) | planned | ADD after entitlement | untested; registry path is a placeholder |
| `/v2/recall/car/{vin}`, `mc-api…/v2/recall/car/{vin}`, `/v2/recall/car?vin=`, `/v2/recalls/car/{vin}` | `/v2/car/autorecalls/{vin}` | marketcheck-recalls, vehicle-enrich | REPLACE the four-path probe with the documented path; keep the honest UNKNOWN; registry retires the legacy family | documented, not verified; legacy family answers 404 / empty |
| `/v2/search/car/incentive/oem` | same, plus `/v2/search/car/incentive/{make}/{zip}` | marketcheck-incentives | ADD make/ZIP program cache before any re-enable | documented, not verified; disabled |
| `/v2/vindata/{generate,access}-report/aamva/{vin}` | same | marketcheck-title-report | access-first order already implemented; automation is an owner decision | documented, not verified; 0 pulls |
| not called | `/v2/search/car/fsbo/active`, `/v2/search/car/auction/active`, `/v2/marketmatch/*` | none | AUTOCURB-RESERVED; registry refuses them | untested |
| not called | webhook intake (portal-configured signed POST) | none | ADD once configured: HMAC-SHA256, timestamp window, delivery id dedup, invalidation only | n/a |

## Code changes landed in this tranche

- `supabase/functions/_shared/pinnedFeedOutcome.ts` + `marketcheck-sync`:
  refusal classified as `provider_refused_<status>`, run row written, pin kept.
- `supabase/migrations/20261027200000_enrich_batch_once_per_day_active_only.sql`:
  cursor floor and archived filter (apply on authorization).
- `supabase/migrations/20261027203000_enrich_batch_recall_retry_window.sql`:
  unanswered VIN recall re-asked every 30 days, not daily (applied
  2026-10-27, 92 vehicles offered a day before, 1 after).
- `supabase/migrations/20261027204000_pause_enrich_sweep_nightly.sql`: the
  nightly sweep cron job paused until the plan quota is settled (applied
  2026-10-27).
- `supabase/migrations/20261027201000_mc_raw_boundary_repair.sql`: legacy
  pricing payloads moved to `market_pricing_legacy_payloads` (apply on
  authorization).
- `src/lib/market/providerRegistry.ts`: the contract registry; every path
  above has an entry with status, trigger, TTL, cost default and entitlement.
- `src/lib/market/listingFeeBasis.ts` + `marketcheck-sync`: `fees` and
  `price_includes_fees` promoted and resolved per listing.
- `supabase/functions/_shared/neovinSheet.ts` + `marketcheck-specs`:
  warranty, options MSRP, MSRP variants, confidence, dimensions, country, EV
  range, taxonomy promoted; `marketcheck-sync` carries them forward.
- `src/lib/market/rawPayloadBoundary.ts`: the one definition of what
  `mc_raw` may hold.

## Not changed, deliberately

- Applied and deployed later the same day, each on explicit authorization:
  the enrich cursor migration, the `mc_raw` boundary repair (with the
  `sandbox_exec` narrowing), `marketcheck-sync` and `marketcheck-specs`.
  Before/after counts are in MARKETCHECK_RECONCILIATION_2026_10.md §9.
- No live provider call was made; the entitlement tests for Premium, Premium
  Plus, AutoRecalls and Sold Summary need one authorized call each.
- `vehicle-enrich`'s MDS and Sales Stats cohorts are unchanged until the
  contract can be read: sending `exact=true` or a taxonomy VIN on a guessed
  parameter name is exactly what §26 says not to do.

## Drift check, proposed

Once `contracts/marketcheck/openapi.json` exists in the repo: a test that
asserts every `PROVIDER_CAPABILITIES[].path` resolves to an operation in the
document and that every query parameter the functions send is declared for
that operation. The registry is the list; the document is the authority.

## Contract read from the MarketCheck MCP schemas, 2026-10-27

The owner connected the provider's MCP server (1.9.3). Its tool schemas
confirm, without a call: the syndication path and its routing from any
dealer identifier; the recents constraints (geography or dealer required,
radius 100, higher rate); the Sold Vehicles Summary parameters and response
envelope (`applied`, `warnings`, `truncated`), path `/v2/sold-vehicles/summary`;
the Premium path and its defaults (miles 50,000, zip 50501, franchise,
not certified); `/v2/dealerships/car` as the group-aware directory with group
facets; `/v2/dealers/car` being phased out; `include_generic` as the NeoVIN
generic switch, which the decoder already sends; `seller_type` dealer | fsbo | auction on the active search.
MDS, AutoRecalls, VINData, Base, Premium Plus and Available Options Packages
are not in the MCP and stay unverified. Details in
MARKETCHECK_RECONCILIATION_2026_10.md §11. Registry and matrix updates follow
in the next tranche.
