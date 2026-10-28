# RECALL_SPEC

The VIN-specific recall contract AutoLabels presents, how the stored recall
record maps onto it, what the customer may read, and the cadence by vehicle
type. Implements master build section 17. Code:
`src/lib/intelligence/recallContract.ts` (`summarizeRecall`, version
`recall-contract-v1.0.0`), built on `src/lib/vehicleTruth/recallView.ts`
(`deriveRecallView`), which reads the stored columns and already refuses to
let a model-level answer or a legacy 404 clear a VIN.

## 1. VIN states

| State | Meaning | Public state |
|---|---|---|
| `OPEN` | a VIN-level check reports an open manufacturer campaign; do-not-drive language is carried as a separate flag | adverse |
| `NO_OPEN` | a VIN-level check reported no open campaigns | verified |
| `CLOSED_CAMPAIGN_ONLY` | no open campaign; one or more earlier campaigns recorded as completed | verified |
| `OEM_SERVICE_CAMPAIGN` | no open safety recall; a manufacturer service campaign applies | warning |
| `ENTITLEMENT_BLOCKED` | the last VIN attempt was refused with 401 or 403 | unavailable |
| `PROVIDER_UNAVAILABLE` | the last VIN attempt hit 429, a 5xx, a timeout or a transport error | unavailable |
| `UNKNOWN` | no VIN-level answer on record, or the product has no record of the VIN | unknown |

Ageing: an answer older than the TTL (30 days, `RECALL_STALE_DAYS`) is
stale. A stale clearance becomes `UNKNOWN` with public state `stale`; a
stale open recall stays `OPEN`, because an open campaign does not expire by
being old. Two stores that disagree (one clear, one reporting a campaign)
are `UNKNOWN` with public state `warning`, never resolved into a clean car.

## 2. Model context

NHTSA's model-level lookup (`MODEL_CAMPAIGNS_FOUND`,
`NO_MODEL_CAMPAIGNS_FOUND`, `MODEL_NOT_FOUND`, `LOOKUP_FAILED`, `STALE`) is
carried beside the VIN state and can never clear a VIN. When the VIN is
unverified the public sentence adds the model context and says in the same
breath that it is not a check of this VIN.

## 3. Reading the stored record

`vehicle_listings.recall_status`, `open_recall_count`,
`closed_recall_count`, `recall_checked_at`, `recall_check` (VIN scope) and
`recall_payload` (model scope) are read by `deriveRecallView`. An unanswered
VIN attempt leaves `recall_check.state = unknown` with the classifier's note
(`_shared/recallState.ts`): `marketcheck_http_401` or `_403` maps to
`ENTITLEMENT_BLOCKED`; `marketcheck_rate_limited`, `marketcheck_http_5xx`
and `marketcheck_transport_error:*` to `PROVIDER_UNAVAILABLE`;
`marketcheck_vin_not_on_file` and anything else to `UNKNOWN`. A caller that
knows the attempt's outcome can pass it explicitly.

## 4. Wording rules

- "A VIN-level recall check reports 1 open manufacturer campaign as of
  October 26, 2026."
- "A VIN-level recall check reports an open manufacturer campaign with
  do-not-drive language as of October 26, 2026. The remedy must be recorded
  before this vehicle is driven or delivered."
- "A VIN-level recall check reported no open campaigns for this vehicle as
  of October 26, 2026."
- "A VIN-level recall check reported no open campaigns as of October 26,
  2026; 2 earlier campaigns are recorded as completed."
- "VIN-level recall status has not been verified for this vehicle. NHTSA
  lists 2 safety campaigns for this year, make and model; that is
  model-level context, not a check of this VIN."
- "The last VIN-level recall check (September 13, 2026) is older than 30
  days; re-check before relying on it."

Never "clean", "guaranteed" or "recall-free" (`FORBIDDEN_RECALL_WORDS`).
Why a VIN is unavailable (entitlement, outage) stays in the state and the
dealer/admin surface; the customer reads "not verified".

## 5. Cadence by vehicle type

| Vehicle | VIN check |
|---|---|
| New | at arrival / frontline, and again pre-delivery |
| Used | at intake, periodically on the TTL (30 days), and pre-sale |

NHTSA model context refreshes with the VIN check. A public Passport view
never triggers a provider call; the checks run through the policy-controlled
jobs, and each call passes the monthly call budget.

## 6. Provider path and entitlement

The documented current path is `/v2/car/autorecalls/{vin}`
(`CURRENT_AUTORECALLS_PATH`). The code still probes the legacy family
(`/v2/recall/car/{vin}` on two hosts, `/v2/recall/car?vin=`,
`/v2/recalls/car/{vin}`), which answers 404 or empty on this account, so
every VIN is honestly `UNKNOWN` today (91 active vehicles carry an
attempted, unanswered record; the enrich cursor re-asks each one every 30
days). The flag `autorecalls_vin` (declared OFF, no reader yet) switches the
callers to the current path once one authorized call has shown the product
is entitled; until then the registry carries the legacy family as
DEPRECATED_REPLACED.

## 7. Tests

`src/lib/intelligence/recallContract.test.ts`: VIN open with count and
date; do-not-drive; VIN no-open; closed-only history; OEM service campaign;
entitlement block, provider outage and VIN-not-on-file all unverified and
never clear; model-only NHTSA context beside an unverified VIN; stale
clearance versus stale open recall; store disagreement; explicit attempt
outcome and configurable TTL; the forbidden-word guard; the note mapping.
