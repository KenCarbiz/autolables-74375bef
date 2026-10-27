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

## Configuration surface (proposed, not yet read by code)

`dealer_profiles.settings.provider_policy.used`:

```jsonc
{
  "intake_bundle": "neovin+base",   // or "premium_plus" once proven
  "refresh_days": 7,
  "mds_days": 7,
  "history_days": 30,
  "sales_stats_days": 30,
  "nmvtis_auto_verify": false,      // owner decision; cap stays 50/month
  "recall_cadence_days": 30,
  "cost_overrides_usd": {}
}
```
