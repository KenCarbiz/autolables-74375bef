# Admin 96 data contracts

Status: proposed, Nov 7 2026. Nothing here is applied. The two migrations in
`supabase/proposed/20261114*` need owner approval before apply, and editors
that depend on them must show a blocked / preview-only state until then.

Behaviour checks: `scripts/test-admin96-proposed-sql.sh` (27 checks plus both
rollbacks, run against a scratch local Postgres).

## Where each Admin 96 field lives

| Editor | Field | Storage | State | Writer | Scope |
|---|---|---|---|---|---|
| Identity | Display name, tagline, website, main phone | `onboarding_profiles` | exists | current profile save | tenant |
| Identity | Legal name | `onboarding_profiles.legal_name` | proposed 20261114000000 | `save_shared_brand_profile` | tenant |
| Identity | Rooftop legal / display name | `dealer_stores.legal_name`, `display_name` | exists | inventory network RPCs | rooftop |
| Appearance | Primary / secondary colour | `onboarding_profiles.primary_color`, `secondary_color`; `settings.primary_color` | exists | current saves | tenant |
| Appearance | Named HEX palette | `onboarding_profiles.brand_palette` (array of `{id,name,hex}`) | proposed | `save_shared_brand_profile` | tenant |
| Appearance | Light logo | `onboarding_profiles.logo_url`; `settings.dealer_logo_url` | exists | current upload | tenant |
| Appearance | Dark-surface logo | `onboarding_profiles.logo_dark_url` | proposed | `save_shared_brand_profile` | tenant |
| Hours & Contact | Department phones | `dealer_department_contacts` | proposed | `save_department_contacts` | tenant or rooftop |
| Hours & Contact | Weekly hours, timezone, holidays, routing override | `dealer_business_hours` (versioned) | proposed | `save_business_hours` | tenant or rooftop, per department |
| Hours & Contact | Free-text hours (today) | `settings.dealer_hours`, `settings.dealer_timezone` | exists | `merge_dealer_settings` | tenant |
| Why Buy | Grouped cards | `settings.why_buy_here` | exists (shape extended in jsonb, no migration) | `merge_dealer_settings` | tenant ("All rooftops") |
| Passport modules | Visibility and order | `settings.packet_module_defaults` | exists | `merge_dealer_settings` | tenant |
| Customer actions | Sticky buttons, slide-out CTA | `settings.sticky_bottom_buttons`, `settings.mobile_slideout_cta_variant` | exists | `merge_dealer_settings` | tenant |
| Contact & Routing | Routing tiers | `settings.passport_contact_routing` | exists, server enforced | `merge_dealer_settings` (routing role class) | tenant |
| Service | Canned services, recon thresholds | `settings.recon_canned_services` and recon keys | exists | `merge_dealer_settings` (service class) | tenant |
| Printing | Offsets, scale, label sizes, printer | `dealer_print_settings` | exists | `useDealerPrintSettings` | tenant or location |
| Printing | Four-sided safe margins | `dealer_print_settings.safe_margin_*_inches` | exists; made canonical by 20261114010000 | `useDealerPrintSettings` | tenant or location |
| Printing | Profile name, test sheet printed, verified alignment, measurements | `dealer_print_settings` new columns | proposed 20261114010000 | `record_print_calibration` | tenant or location |
| Plan & Usage | Plan, status, tier | `app_entitlements` | exists (Autocurb is the single writer) | read only | tenant |

`settings` means `dealer_profiles.settings`, patched key by key through
`merge_dealer_settings`. AutoLabels-only presentation keys stay there and need
no migration.

## Shared with AutoFilm

Department phones, business hours, legal name, palette and the dark logo are
shared dealership facts. They live in tables the whole family reads
(`onboarding_profiles` and the two new tables), not in AutoLabels-only
`settings`, so AutoFilm does not need a second copy.

AutoFilm's phone component is not in this repository, so parity with it is not
verified. The contract it would need: E.164 storage, digits-only extension,
one primary per scope, department enum
`main, sales, service, parts, finance, body_shop, used, fleet, other`,
`public_visible` flag, ordered by `sort_order`. If AutoFilm already stores
phones elsewhere, the adapter boundary is a read view over that table rather
than a second writer.

## Rules the RPCs enforce

- Writes need an accepted membership with a settings role
  (`owner, admin, general_manager, gsm, manager`), except calibration events,
  which any accepted member may record, matching who prints today.
- A rooftop id must belong to the tenant.
- Phones must be E.164; at most one primary per tenant/rooftop scope.
- Timezones must be a real IANA name; hours saves carry an expected version and
  a stale version is rejected (`version_conflict`), never overwritten.
- Palette entries need a name and `#RRGGBB`.
- "Calibration verified" requires a recorded test sheet first; printing a new
  test sheet clears the earlier verification.
- Every write appends to `audit_log` with previous and new values.

## Open decisions (not in the migrations)

1. `dealer_print_settings` RLS is `FOR ALL` to any tenant member. Narrowing
   writes to settings roles could lock out staff who calibrate today; left as is.
2. Free-text `settings.dealer_hours` is not converted. Structured hours start
   empty and the editor shows the old text as a reference until a person enters
   the schedule (the handoff forbids guessing ambiguous hours).
3. The legacy `top_/left_safe_margin_inches` columns are kept and marked
   deprecated; dropping them is a later cleanup after the wizard ships.
