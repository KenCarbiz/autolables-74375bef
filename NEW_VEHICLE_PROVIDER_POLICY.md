# NEW_VEHICLE_PROVIDER_POLICY (`AUTOLABELS_NEW_POLICY`)

A new vehicle is a factory configuration, an MSRP, a dealer price, an
incentive, an availability state and a compliance question. It is not a
used-car intelligence problem, and the handoff (§19) forbids running the used
endpoints on it by routine. This is the starting policy, expressed against the
provider registry (`src/lib/market/providerRegistry.ts`); every value is a
default that tenant configuration may override, not a constant.

Status words: `routine` is bought without a tenant opt-in; `opt-in` needs a
named tenant setting; `never` is refused by the registry for this vehicle
type.

| Capability (registry key) | New-vehicle use | Trigger | Target TTL | Notes |
|---|---|---|---|---|
| `syndication` | routine | nightly schedule | 24 h | inventory, price, availability, in-transit; refusal never retires a car |
| `neovin` (or `price_premium_plus` once proven) | routine, first seen | intake | immutable | retry only on failure, generic decode, conflict or provider correction |
| `active_search` | routine | daily, or on a material price event | 24 h | cross-channel same-VIN price integrity; fee basis from `fees` / `price_includes_fees` |
| `incentives_make_zip` / `incentives_oem` | opt-in (owner policy, currently off) | program freshness | 24 h, cached by make x market x program | never per VIN; never a Vehicle Score input |
| `autorecalls` | routine once entitled | arrival / frontline, pre-delivery | 30 d | VIN scope only; NHTSA model context stays separate |
| `cached_images` | passive | never requested | n/a | links arrive on the feed |
| `vin_history` | never by routine | - | - | a new unsold car has no listing history worth buying |
| `mds` | opt-in (management use only) | 7 d | 7 d | not required for factory truth |
| `sales_stats`, `recents`, `sold_summary` | opt-in (management use only) | monthly | 30 d | stocking context, not a Passport fact |
| `vindata_access`, `vindata_generate` | never by routine | - | - | no used-title workflow on new inventory |
| `blackbook_used_vin` | never | - | - | |
| `fsbo`, `auction`, `marketmatch`, `marketmatch_dealers` | never | - | - | AutoCurb-reserved |

## Outputs the New Passport read model draws from

- Factory Verified state: NeoVIN strict decode, `build_sheet.generic = false`,
  provider confidence (`neovin_confidence`) at or above the tenant threshold.
- Exact configuration: year/make/model/trim/version, drivetrain, powertrain,
  colours with codes, installed packages and options with codes and MSRP.
- MSRP reconciliation: `base_msrp`, `installed_options_msrp`,
  `delivery_charges`, `total_msrp`, with `msrp_variants` kept labelled.
- Dealer offer: advertised price, `fee_basis` (listing-level), tenant doc fee.
- Price integrity: same-VIN observations across channels with their fee
  basis and timestamps; states Verified Consistent / Review Required / Unknown.
- Availability: `vehicle_status`, `in_transit`, first/last seen.
- Incentives: program rows when enabled, with validity and eligibility.
- Warranty: NeoVIN `factory_warranty` as ORIGINAL terms; remaining coverage
  only when an in-service date and mileage support it (never for an unsold
  new car).
- Recall: VIN state when entitled, else UNKNOWN.

## What this policy refuses

A used-style predicted value is not presented on a new vehicle. A Vehicle
Score is not computed for a new vehicle. No paid call is caused by a public
Passport load (`publicBrowseMayTrigger` is `false` on every capability).

## Configuration surface (proposed, not yet read by code)

`dealer_profiles.settings.provider_policy.new`:

```jsonc
{
  "mds": false,                 // management opt-in
  "sales_stats": false,
  "incentives": false,          // also gated by MARKETCHECK_INCENTIVES_ENABLED
  "recall_cadence_days": 30,
  "price_integrity_daily": true,
  "cost_overrides_usd": {}      // registry key -> unit cost
}
```

Until a reader exists for these keys, the registry defaults apply and the
keys are documentation of intent, not controls.
