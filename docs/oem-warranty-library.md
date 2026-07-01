# OEM Factory Warranty Library

The OEM Warranty Library powers the Factory Warranty modal on the customer
vehicle passport and the Great Buy report's warranty confidence signal. It turns
a decoded VIN into an accurate, source-backed warranty display — different for
new vs used/pre-owned vehicles — without storing warranty data per VIN.

## Why rule-driven, not VIN-keyed

We do **not** keep a giant table of every VIN with hand-entered warranty terms.
That approach is impossible to keep correct and invites fabricated data. Instead
warranty coverage is stored as **OEM rules** keyed by:

- make
- model-year range
- model (optional — `null` = applies to all of the make's models)
- market/country
- powertrain / fuel type (optional)
- coverage type

The VIN only *identifies* the vehicle. The pipeline is:

```
VIN → decode (year/make/model/trim/powertrain/fuel)
    → match an OEM warranty PROGRAM (specificity ladder)
    → calculate the display state (new = terms; used = remaining)
    → save a per-VIN SNAPSHOT (fast reload + dealer audit trail)
```

VIN decoding uses MarketCheck NeoVIN (`marketcheck-specs`). NHTSA's vPIC can also
decode manufacturer-submitted VIN specs and NHTSA provides recall lookups, but
neither is a complete OEM factory-warranty database — so AutoLabels matches the
decoded vehicle against its **own verified** warranty library.

## Where things live

| Layer | File |
| --- | --- |
| Domain types | `src/lib/warranty/types.ts` |
| Seed program library | `src/data/oemWarrantyPrograms.ts` |
| Display-mode + program matching | `src/lib/warranty/match.ts` |
| Remaining-coverage calculation | `src/lib/warranty/calculate.ts` |
| Modal display-model builder | `src/lib/warranty/displayModel.ts` |
| Coverage tracker (running list) | `src/lib/warranty/coverageReport.ts` |
| Persistence (foundation) | `supabase/migrations/20260701000000_oem_warranty_library.sql` |
| Import template | `data/oem-warranty/` |
| Curated per-brand reference (existing) | `src/data/oemWarrantyReference.ts` |
| Dealer-verified terms + admin UI (existing) | `src/lib/oemWarranty.ts`, `src/components/admin/OemWarrantyPanel.tsx` |

The database tables in the migration are the storage foundation. The runtime
currently reads the seeded library from TypeScript; moving reads to the tables is
a later phase (needs an edge-function read path). This keeps the demo working
while the persistence layer is reviewed.

## How VIN matching works

`matchOemWarrantyProgram(vehicle)` walks a specificity ladder and returns the
first tier that matches — so a precise program always beats a generic one:

1. exact make + model + model-year + trim + powertrain
2. make + model + model-year + powertrain
3. make + model + model-year
4. make + model-year range (model-agnostic program)
5. make default for the model year
6. **fallback** — no match → `needs_dealer_confirmation = true`, no terms invented

`getWarrantyDisplayMode(vehicle)` returns `'new' | 'used' | 'cpo'` from
`condition` / `isNew` / `certified` / `cpo` / `isCertifiedPreOwned` fields.

## New vs used display

**New** — coverage hasn't started counting down (it begins at delivery), so the
modal shows **term figures only**:

- Warranty Start: **At Delivery Date** (no end date, no percentages, no remaining)
- Bumper-to-Bumper: e.g. 4 Years / 50,000 Miles
- Powertrain: e.g. 6 Years / 70,000 Miles
- Notice: "Factory coverage begins when you take delivery of your vehicle."

**Used / pre-owned / CPO** — remaining coverage is calculated from the original
**in-service date** and **current mileage**:

- Warranty Start: the in-service date, sub-labeled "(In-Service Date)"
- Warranty End: calculated from in-service date + term
- Per-coverage percentage remaining, years/months remaining, miles remaining,
  and expiration date/mileage
- Used/CPO buyers are **subsequent owners**, so reduced transfer terms apply
  (e.g. Hyundai powertrain 10 yr / 100k → 5 yr / 60k after transfer).

## Adding new OEM warranty records

1. Fill the import template in `data/oem-warranty/` (`import-template.csv` or
   `oem-warranty-template.json`). One row per **coverage**; rows sharing make +
   model + model-year range + country + powertrain form one program.
2. Attach a real source (`source_url` / `source_document_name`,
   `source_effective_date`) and set `source_last_verified_at` once a human has
   confirmed the terms against the model-year warranty booklet.
3. Only then set `confidence_status: verified`. Until verified, a program stays
   `needs_review` and must not be presented as fact.
4. Add the make to `LOADED_MAKES` in `src/data/oemWarrantyPrograms.ts` (or seed
   it directly). The coverage tracker will pick it up automatically.

### Currently loaded (Phase 1)

INFINITI (incl. a 2026 QX60 model-specific program), NISSAN, VOLKSWAGEN,
HYUNDAI — all `needs_review`, derived from the app's curated reference terms.

Use `buildWarrantyCoverageReport()` to see, at any time, which makes are loaded,
which curated makes are still **pending** a program, and which loaded makes still
need source verification. Suggested rollout order after Phase 1:

- Phase 2: Toyota / Lexus, Honda / Acura, Ford / Lincoln, GM
- Phase 3: Kia, Subaru, Mazda, CDJR
- Phase 4: German luxury + EV-specific rules
- Phase 5: admin approval dashboard + source-refresh reminders

## Source verification requirements

- Every production coverage row must have a real source and a verification date.
- `confidence_status` gates whether a program is treated as fact.
- Seeded/demo data is explicitly `needs_review` with a placeholder source.
- Do **not** bulk-import unverified terms for many OEMs at once.

## Dealer confirmation fallback

When a program can't be matched, or a used vehicle is missing its in-service date
or mileage, the display model sets `needs_dealer_confirmation = true` and surfaces
a small disclosure ("Ask the dealer to confirm…") — never a fabricated figure and
never a customer-facing "Pending" in the primary cards. Dealer edits are recorded
in `warranty_overrides` for auditability.

## Warranty snapshots

After a vehicle is matched and calculated, a snapshot (`vehicle_warranty_snapshots`)
stores the matched program, display mode, the inputs used (in-service date,
mileage), `needs_dealer_confirmation`, and the full display model as
`snapshot_json`. This gives fast passport loads and an auditable record of exactly
what was shown for a VIN and when.

## Compliance notes

- CPO coverage is shown only when the vehicle is certified or the copy clearly
  says "may qualify" for the brand's CPO program.
- Standard disclaimers accompany every warranty display:
  - "Coverage terms may vary by manufacturer, model year, vehicle use, in-service
    date, mileage, and transfer rules."
  - "Confirm final warranty coverage with the dealer or manufacturer."
  - "For pre-owned vehicles, remaining coverage depends on original in-service
    date and current mileage."
- The FTC Used Car Rule permits disclosing that a manufacturer's warranty still
  applies; wording and accuracy matter, which is why sources, verification dates,
  and the dealer-confirmation fallback are first-class in this system.
