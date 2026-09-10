# Market Intelligence V2 — rollout, canary and rollback

Nothing in this document has been executed. No edge function was deployed, no
migration applied, no production data written, no provider called.

## 1. Deployment order

Each step is separately reversible and each one is a no-op for customers until
step 6.

| # | Step | Customer-visible | Reversible by |
|---|---|---|---|
| 1 | Apply `20260910090000_market_intelligence_v2_audit.sql` | no | table is additive and unread; drop is safe but unnecessary |
| 2 | Configure `dealer_profiles.settings.dealer_type` per tenant | no | edit the setting |
| 3 | Configure `dealer_profiles.settings.dealer_identity` (rooftop / dealer / website ids, domains, group id) | no | edit the setting |
| 4 | Deploy the market writer with every flag OFF | no | redeploy previous revision |
| 5 | Enable `market_value_v2_shadow` for the pilot tenant | no | flip the flag off |
| 6 | Enable `market_value_v2_admin` for the pilot tenant | dealer staff only | flip the flag off |
| 7 | Enable `market_value_v2_public` for the pilot tenant | yes | flip the flag off |

Steps 2 and 3 are prerequisites, not conveniences. Without `dealer_type` the
engine refuses to build a provider request at all; the shadow run over the live
lot returned `unavailable` for 130 of 130 vehicles for exactly that reason.

## 2. Configuration written in step 2 and 3

```jsonc
// dealer_profiles.settings
{
  "dealer_type": "franchise",              // or "independent". No default exists.
  "dealer_identity": {
    "rooftopIds":  ["<marketcheck rooftop id>"],
    "dealerIds":   ["<marketcheck dealer id>"],
    "websiteIds":  ["<marketcheck website id>"],
    "domains":     ["harteinfiniti.com"],
    "groupIds":    ["<dealer group id>"],
    "names":       ["Harte Infiniti"]      // last-resort matching only
  },
  "market_flags": {                        // every flag defaults false
    "market_value_v2_shadow": false,
    "market_value_v2_admin": false,
    "market_value_v2_public": false,
    "marketcheck_current_endpoint": false,
    "marketcheck_premium_comparables": false,
    "pricing_position_v2_shadow": false
  }
}
```

## 3. Canary set

Eight vehicles, chosen so every branch of the engine is exercised before the
lot is. Prepared, not run.

| # | Vehicle | What it proves |
|---|---|---|
| 1 | `3PCAJ5FB1SF109708` — 2025 QX50 Sport, CPO | the certification fix, the fee-inclusive basis, own-rooftop exclusion |
| 2 | any non-CPO used unit | `is_certified=false` is sent and is not a mismatch |
| 3 | any new unit | a new car is never graded CPO and never certified |
| 4 | a vehicle with fewer than three comparables | low confidence, neutral styling, no deal claim |
| 5 | a vehicle with a verified adverse history | adverse history lowers weight without inventing a deduction |
| 6 | a vehicle with unknown history | unknown stays unknown and costs confidence |
| 7 | a fee-inclusive tenant (Harte) | `advertised_excludes_doc_fee = false` path |
| 8 | a fee-exclusive tenant, if one exists | `advertised_excludes_doc_fee = true` path |

For each, record and compare:

- old request parameters vs corrected request parameters
- old provider value vs corrected provider value
- old `market_position` vs V2 verdict
- old displayed difference vs V2 normalized difference
- the comparable set: included, secondary, context, excluded, and why
- confidence tier and every reason
- the `vehicle_market_valuations` row id backing the displayed answer
- provider calls spent

Stop the canary and report if any vehicle produces a red verdict whose
`vehicle_market_valuations` row would violate
`vehicle_market_valuations_red_requires_evidence` — that constraint should make
it impossible, and a violation attempt means the engine and the schema
disagree.

## 4. Provider cost

The shadow run measured 35 vehicles of 130 needing a corrected call, at
$0.07 each: **$2.45** one-off for the pilot lot. A full re-price of all 130
would be $9.10. Neither has been spent.

Ongoing cost is bounded by the 7-day target TTL: at most one call per vehicle
per week, and a subject price change re-runs the comparison against the CACHED
prediction without a new call, because the request fingerprint has not moved.

## 5. Rollback

Rollback is flag-only. No migration is reversed, no data is deleted.

```sql
-- Full stop: return every surface to the compatibility columns.
UPDATE public.dealer_profiles
   SET settings = jsonb_set(
         COALESCE(settings, '{}'::jsonb),
         '{market_flags}',
         '{"market_value_v2_shadow": false,
           "market_value_v2_admin": false,
           "market_value_v2_public": false,
           "marketcheck_current_endpoint": false,
           "marketcheck_premium_comparables": false,
           "pricing_position_v2_shadow": false}'::jsonb,
         true)
 WHERE tenant_id = '<tenant>';
```

Partial rollback — public only, keeping dealer staff on V2:

```sql
UPDATE public.dealer_profiles
   SET settings = jsonb_set(settings, '{market_flags,market_value_v2_public}', 'false'::jsonb, true)
 WHERE tenant_id = '<tenant>';
```

What rollback does NOT do, deliberately:

- does not delete `vehicle_market_valuations` or `vehicle_market_comparables`;
  the audit history of what V2 said is evidence and survives
- does not drop any table or column
- does not touch `price`, `advertised_price_before_doc`, `doc_fee`,
  `market_value`, `market_position`, `market_meta`, or any inventory record
- does not discard a stored provider response

Verification after rollback:

```sql
SELECT settings->'market_flags' FROM public.dealer_profiles WHERE tenant_id = '<tenant>';
SELECT count(*) FROM public.vehicle_market_valuations WHERE tenant_id = '<tenant>';  -- unchanged
```

## 6. Kill switch during an incident

The flags are read per request from tenant settings, so flipping them takes
effect on the next page load with no deploy. There is no build step, no cache
to purge and no edge function to redeploy to stop V2.
