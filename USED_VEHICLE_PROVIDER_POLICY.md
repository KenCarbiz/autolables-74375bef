# USED_VEHICLE_PROVIDER_POLICY (`AUTOLABELS_USED_POLICY`)

A used vehicle is where the deep intelligence goes (§20): factory identity,
listing history, title and odometer, market evidence, liquidity, velocity,
trend, recall state and the dealer's own physical evidence. This is the
starting policy against the provider registry
(`src/lib/market/providerRegistry.ts`). Every TTL is a configurable default.

| Capability (registry key) | Used-vehicle use | Trigger | Target TTL | Notes |
|---|---|---|---|---|
| `syndication` | routine | nightly schedule | 24 h | canonical inventory state |
| `price_premium_plus` | intake candidate (entitlement test first) | intake | decode immutable; market 7 d | prediction + comparables + NeoVIN in one call; replaces `neovin` + `price_base` at intake if proven |
| `neovin` | routine, first seen (until Premium Plus proven) | intake | immutable | strict first, generic fallback once, three attempts |
| `price_premium` | refresh (entitlement test first) | 7 d, or a material event | 7 d | never rebuys the decode |
| `price_base` | fallback for the above | valuation writer | 7 d | reserved under the tenant budget |
| `active_search` | routine | intake, daily price integrity, material event | 24 h | fee-normalized comparables; one cohort snapshot informs its siblings |
| `vin_history` | routine | intake, then a long TTL or a material event | 30 d | mileage chronology, price trajectory, prior exposure; never an owner count |
| `mds` | routine | 7 d | 7 d | `vin` + `exact=true` first, then YMMT local, YMM local, model local, national; tier persisted |
| `sales_stats` | routine | monthly (provider regeneration) | 30 d | VIN / taxonomy VIN + local, + state, YMMT + state, YMM + state, broader; cohort persisted |
| `recents` | supporting evidence | monthly | 30 d | listing-level; medians only leave the function |
| `sold_summary` | routine once entitled | monthly | 30 d | 3- and 6-month direction; inferred-sold semantics stored with the cohort |
| `vindata_access` then `vindata_generate` | pre-publication, exception-based (owner spend decision) | before a strong public title claim; freshness rule | provider's 90 d | access before generate; session-only by terms; 50 generates per dealer per month |
| `autorecalls` | routine once entitled | intake, periodic, pre-sale | 30 d | VIN scope; UNKNOWN is honest until it answers; the enrich cursor re-asks an unanswered VIN only on this window (`p_recall_retry_days`) |
| `blackbook_used_vin` | when configured | intake, 7 d | 7 d | not a live signal until rows populate |
| `cached_images` | passive | never requested | n/a | |
| `fsbo`, `auction`, `marketmatch`, `marketmatch_dealers` | never | - | - | AutoCurb-reserved |

Material events that may trigger a refresh ahead of TTL: a subject price
change (re-compares against the CACHED prediction; it does not buy a new
one, because the request fingerprint has not moved), a mileage change beyond
the comparable band, certification change, a NeoVIN correction, a feed
reappearance after removal, a dealer-confirmed condition change.

## What one intake costs at public list, with the registry defaults

| Call | Count | Unit | Subtotal |
|---|---|---|---|
| NeoVIN strict (+ generic fallback at most once) | 1-2 | 0.08 | 0.08-0.16 |
| Active search ladder (first tier that answers) | 1-5 | 0.002 | 0.002-0.01 |
| Rank and trim counts | 2-3 | 0.002 | 0.004-0.006 |
| VIN history | 1 | 0.006 | 0.006 |
| MDS ladder | 1-3 | 0.002 | 0.002-0.006 |
| Sales Stats (monthly, shared by cohort) | 0-1 | 0.002 | 0-0.002 |
| MarketCheck Price Base (reserved) | 1 | 0.07 | 0.07 |
| AutoRecalls (when entitled) | 1 | 0.07 | 0.07 |
| **Intake total** | | | **about $0.23-0.33** |

Unit costs are the 2026-10-27 list (MDS and Sales Stats 0.002, recents
0.0025) resolved through the registry; a tenant override replaces any of
them without a code change.

Recurring, per used vehicle per week after intake: one Premium or Base
refresh (0.07), one MDS (0.002), one active-search integrity pass a day
(7 x 0.002), and a monthly Sales Stats share: about $0.09 a week, against
roughly $0.70 a week that the twice-daily sweep spent on the same car before
the cursor fix. The cheaper MDS and Sales Stats do not shorten their TTLs:
both follow the provider's regeneration (7 d and monthly), because buying an
unchanged number sooner buys nothing.

## Outputs the Used Passport read model draws from

Exact identity and configuration; Vehicle Score and Data Confidence (later
tranche); title and odometer state (`VERIFIED_NO_ADVERSE_REPORTED` /
`ADVERSE` / `REVIEW_REQUIRED` / `NOT_VERIFIED`); current condition
(AutoFilm / dealer); dealer provenance; AutoLabels Market Value with range and
confidence; Deal Rating; Buyer Recommendation with hard gates; exact MDS and
tier; sales velocity; trend; VIN history; recall state; evidence timeline;
source and freshness detail.

## Configuration surface (read by `src/lib/market/providerPolicy.ts`)

`dealer_profiles.settings.provider_policy.used`. The provider policy engine
(`decideProviderCall` and `planVisit`, mirrored into the edge library and
consulted by `vehicle-enrich` before every paid call) reads these keys. A key
that is absent, or holds a value of the wrong shape, leaves the registry
cadence in force. Nothing here can switch on a capability the registry
forbids, a trigger the registry does not list, or an entitlement the account
does not hold.

```jsonc
{
  "refresh_days": 7,               // TTL for price_base and price_premium
  "mds_days": 7,                   // TTL for mds
  "history_days": 30,              // TTL for vin_history
  "sales_stats_days": 30,          // TTL for sales_stats, recents, sold_summary
  "recall_cadence_days": 30,       // TTL for autorecalls
  "nmvtis_auto_verify": false,     // allow vindata on a non-operator trigger; cap stays 50/month
  "ttl_days": {},                  // registry key -> days, for any capability
  "opt_in": {},                    // registry key -> true, for `optional` capabilities
  "cost_overrides_usd": {},        // registry key -> unit cost used in plan estimates
  "intake_bundle": "neovin+base"   // documented intent; not read until Premium Plus is entitled
}
```

`dealer_profiles.settings.provider_policy.entitlements` is shared by both
vehicle types: registry key to `"entitled"`, `"not_entitled"` or `"unknown"`.
A capability the registry marks `entitlement_blocked` is skipped with reason
`entitlement_blocked` until this map says `entitled` for it, and its market
flag must also be on (`sold_summary`, `autorecalls_vin`,
`premium_used_refresh`, `premium_plus_used_intake`, `blackbook_live`,
`available_options_packages`, `oem_incentives_v2`).

Defaults come from the registry: active search 24 hours; MDS 7 days; sales
stats, recents, sold summary, VIN history and AutoRecalls 30 days; the price
predictions 7 days; NMVTIS 90 days; NeoVIN bought once on first sight and
never refreshed.

The decision, in order: a public Passport load buys nothing; the registry's
vetoes apply (`never_triggered`, `autocurb_reserved`, `deprecated_replaced`,
`not_active`, `not_for_used`); an `optional` capability needs an opt-in; the
entitlement and the flag must both be on; then the trigger decides. Intake
and scheduled visits buy a capability when it was never checked or its TTL
has elapsed. An operator request buys it regardless of age. A material event
brings forward only the capabilities listed for it, and only where the
registry lists `material_event` among that capability's triggers:
`price_change` the active search; `mileage_change` the active search, MDS and
VIN history; `certification_change` the active search and MDS;
`neovin_correction` the active search and MDS; `feed_reappearance` the active
search, VIN history and AutoRecalls; `condition_change` nothing. No event
re-buys a decode or a price prediction; a price change is re-compared against
the cached prediction.

Stamps `vehicle-enrich` reads and writes per vehicle: `market_meta.search_checked_at`
(falling back to the shared `checked_at`), `market_meta.mds_checked_at`,
`market_meta.sold_stats.checked_at`, `history_payload.checked_at` and
`recall_check.attempted_at` or `recall_checked_at`. A stamp is written only
when the call answered, so a missing stamp means the evidence was never
bought. The plan for each visit is stored as `market_meta.last_visit_plan`
(due keys, skipped keys with their reason, estimated calls and cost as
ceilings) and returned as `plan` in the function's response. The call budget
gate in `_shared/providerBudget.ts` still admits every request the plan
allows.
