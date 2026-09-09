# GATE 2.5 — VEHICLE TRUTH RECONCILIATION DRY RUN

Read-only. No migration was applied, no function was deployed, no row was written. Every number below is a
SELECT against live Supabase project `onnbmmdbrsgytfozfozn` on 2026-09-09, pilot tenant Harte Infiniti
`3f0f97f5-4151-4e32-88ef-e2d6fc5a3142`, repo at `24f7cb06`.

This describes what a truth reconciliation WOULD do against today's live state. It is not a proposal to
rewrite history: the corrective path named in section 9 appends a new resolved snapshot version and leaves
every raw provider payload and every prior snapshot exactly where it is.

---

## 1. Scope and method

**Population.** 130 active listings (`vehicle_listings.tenant_id = <pilot>`, `archived_at IS NULL`). All 130
carry `status = 'published'`.

**Stored truth compared.**
- `vehicle_facts` — 2,400 rows across 125 vehicles. Five vehicles hold no fact at all.
- `vehicle_snapshots` — 125 vehicles, latest version each. Oldest latest-snapshot 2026-07-28, newest
  2026-09-08 16:46. Five vehicles hold no snapshot at all.
- The latest snapshot was checked field-by-field against the winning fact for `total_msrp`, `base_msrp`,
  `engine`, `transmission`, `make`, `trim`, `exterior_color` and `advertised_price` on all 125 vehicles:
  **zero divergence**. The snapshot layer introduces no independent drift, so the whole reconciliation is
  characterised by `vehicle_facts` against the source candidates.

**Currently eligible authoritative source candidates**, exactly as `candidatesFromListing`
(`supabase/functions/_shared/factorySticker/lib/vehicleTruth/ingest.ts`) reads them today:
- **Dealer columns** — `vehicle_listings.condition`, `.mileage`, `.price`, `.trim`.
- **Feed structured keys** — `vehicle_listings.mc_attributes.*` (`engine`, `transmission`, `drivetrain`,
  `fuel_type`, `body_type`, `exterior_color`, `interior_color`, `trim`, `base_msrp`, `delivery_charges`,
  `total_msrp`) and `mc_attributes.build_sheet.*` (`pricing`, `options`, `packages`, `key_features`,
  `standard`). Identity (`make`/`model`/`model_year`) still comes from `parseYmm(vehicle_listings.ymm)`.
- **NeoVIN snapshot payload** — `neovin_snapshots.payload`, present for 130/130 active VINs. The resolver
  does **not** read this table. It reads NeoVIN only second-hand, through whatever `marketcheck-specs` last
  lifted into `mc_attributes`. Section 6 measures the gap this opens, and it is the single most consequential
  finding in this dry run.

**Grid.** 130 vehicles x 23 fact keys = 2,990 cells.

---

## 2. Headline counts

| Class | Cells | Meaning |
|---|---:|---|
| **ADD** | **96** | No `vehicle_facts` row exists; an eligible source holds an answer. |
| **SUPERSEDE** | **204** | A fact exists and the eligible source now says something different. |
| **UNCHANGED** | **2,196** | Fact and source agree byte-for-byte. |
| **UNKNOWN** | **494** | No candidate from any eligible source and no stored fact. |
| ORPHAN (stored, no candidate) | 0 | No fact would be stranded by a re-resolve. |
| **CONFLICT** | **321** | Two eligible authoritative sources disagree TODAY (feed key vs NeoVIN payload). |

2,196 + 204 = 2,400, which is exactly the stored fact count. 96 + 204 + 2,196 + 494 = 2,990, the full grid.

CONFLICT is scored on a separate axis: it counts cells where the feed value the resolver would write
disagrees with the NeoVIN payload the estate already holds for the same key. A cell can be both UNCHANGED
and CONFLICT — that is the dangerous case, because it means the stored fact and the resolver agree with each
other and both disagree with the stronger source.

**Vehicles touched.** 126 of 130 would change (11 gain facts, 121 have at least one superseded fact).
Every fact key in play is in `MATERIAL_FIELDS`, so each of those 126 vehicles would mint a new
`vehicle_snapshots` version and raise `stale_document_flags` against its issued documents. 157 documents on
these vehicles are `published` (98 `factory_sticker`, 57 `window`, 1 `addendum`, 1 `buyers_guide`).

---

## 3. Counts by fact key

| Fact key | Source kind | ADD | SUPERSEDE | UNCHANGED | UNKNOWN | CONFLICT (feed vs NeoVIN) |
|---|---|---:|---:|---:|---:|---:|
| advertised_price | dealer_confirmed | 11 | 99 | 18 | 2 | n/a |
| base_msrp | neovin | 4 | 1 | 124 | 1 | 0 |
| body_configuration | marketcheck | 5 | 0 | 125 | 0 | 0 |
| condition | dealer_confirmed | 5 | 3 | 122 | 0 | n/a |
| destination_charge | neovin | 4 | 1 | 124 | 1 | 0 |
| drivetrain | marketcheck | 4 | 0 | 125 | 1 | 0 |
| engine | marketcheck | 4 | 0 | 123 | 3 | 0 |
| exterior_color | marketcheck | 5 | 9 | 114 | 2 | **70** |
| factory_options | neovin | 4 | 1 | 106 | 19 | n/a |
| factory_options_total | neovin | 4 | 1 | 104 | 21 | n/a |
| factory_packages | neovin | 0 | 0 | 0 | **130** | n/a |
| fuel_type | marketcheck | 4 | 0 | 125 | 1 | 0 |
| interior_color | marketcheck | 6 | 6 | 115 | 3 | **126** |
| make | marketcheck | 5 | 0 | 124 | 1 | n/a |
| manufacturer | neovin | 0 | 0 | 0 | **130** | n/a |
| mileage | dealer_confirmed | 4 | 1 | 82 | 43 | n/a |
| model | marketcheck | 5 | 0 | 124 | 1 | n/a |
| model_year | marketcheck | 5 | 0 | 124 | 1 | n/a |
| standard_equipment | neovin / marketcheck | 5 | 1 | 124 | 0 | n/a |
| stock_number | dealer_confirmed | 0 | 0 | 0 | **130** | n/a |
| total_msrp | neovin | 4 | 1 | 124 | 1 | 0 |
| transmission | marketcheck | 4 | 71 | 54 | 1 | **120** |
| trim | marketcheck | 4 | 9 | 115 | 2 | 5 |
| **Total** | | **96** | **204** | **2,196** | **494** | **321** |

---

## 4. Facts to ADD — all 96

Eleven vehicles. Format: `VIN | fact_key | source_kind | stored | candidate (source)`.

Five of the eleven hold **no facts and no snapshot at all** and account for 88 of the 96 adds:
`JN8AZ3BE9V9730002`, `JN8AZ3CC4V9640124`, `JN8AZ3DB9V9450387`, `JN8AZ3DB9V9450437`, `JTMABABA5PA005774`.
Their `orchestrated_at` is 2026-07-27 / 2026-08-01, before or beside the first truth write, and their
sticker settled `published`, so `refreshVehicleTruth` has never run for them again. That is the
sticker-freezes-truth defect, visible as absence rather than as a wrong value.

```
5N1DL1FS6RC335049 | advertised_price      | dealer_confirmed | (none) | 38876   (vehicle_listings.price)
5NPEH4J21MH101448 | advertised_price      | dealer_confirmed | (none) | 19876   (vehicle_listings.price)
JN1BV7AR6FM406806 | advertised_price      | dealer_confirmed | (none) | 17883   (vehicle_listings.price)
JN1BV7AR6FM406806 | interior_color        | marketcheck      | (none) | Graphite  (mc_attributes.interior_color)
JN1EV7CR8PM540616 | advertised_price      | dealer_confirmed | (none) | 35201   (vehicle_listings.price)
JN8AZ2NE3L9254199 | advertised_price      | dealer_confirmed | (none) | 25756   (vehicle_listings.price)
JTJBM7FX3J5192431 | advertised_price      | dealer_confirmed | (none) | 28862   (vehicle_listings.price)
JTJBM7FX3J5192431 | mileage               | dealer_confirmed | (none) | 113159  (vehicle_listings.mileage)

JN8AZ3BE9V9730002 | advertised_price      | dealer_confirmed | (none) | 90876   (vehicle_listings.price)
JN8AZ3BE9V9730002 | base_msrp             | neovin           | (none) | 94590   (mc_attributes.base_msrp, NeoVIN decode 2026-09-06)
JN8AZ3BE9V9730002 | body_configuration    | marketcheck      | (none) | SUV     (mc_attributes.body_type)
JN8AZ3BE9V9730002 | condition             | dealer_confirmed | (none) | new     (vehicle_listings.condition)
JN8AZ3BE9V9730002 | destination_charge    | neovin           | (none) | 2245    (mc_attributes.delivery_charges)
JN8AZ3BE9V9730002 | drivetrain            | marketcheck      | (none) | 4WD     (mc_attributes.drivetrain)
JN8AZ3BE9V9730002 | engine                | marketcheck      | (none) | 3.5L V6 (mc_attributes.engine)
JN8AZ3BE9V9730002 | exterior_color        | marketcheck      | (none) | White   (mc_attributes.exterior_color)   [NeoVIN: Radiant White]
JN8AZ3BE9V9730002 | factory_options       | neovin           | (none) | 3 options (build_sheet.options)
JN8AZ3BE9V9730002 | factory_options_total | neovin           | (none) | 1370    (build_sheet options+packages msrp sum)
JN8AZ3BE9V9730002 | fuel_type             | marketcheck      | (none) | Premium Unleaded (mc_attributes.fuel_type)
JN8AZ3BE9V9730002 | interior_color        | marketcheck      | (none) | Graphite (mc_attributes.interior_color)  [NeoVIN: Graphite Perforated Leather]
JN8AZ3BE9V9730002 | make                  | marketcheck      | (none) | INFINITI (vehicle_listings.ymm, parseYmm)
JN8AZ3BE9V9730002 | mileage               | dealer_confirmed | (none) | 17      (vehicle_listings.mileage)
JN8AZ3BE9V9730002 | model                 | marketcheck      | (none) | QX80    (vehicle_listings.ymm, parseYmm)
JN8AZ3BE9V9730002 | model_year            | marketcheck      | (none) | 2027    (vehicle_listings.ymm, parseYmm)
JN8AZ3BE9V9730002 | standard_equipment    | neovin           | (none) | 383 items (build_sheet.key_features + standard)
JN8AZ3BE9V9730002 | total_msrp            | neovin           | (none) | 98205   (mc_attributes.total_msrp, NeoVIN decode 2026-09-06)
JN8AZ3BE9V9730002 | transmission          | marketcheck      | (none) | Automatic (mc_attributes.transmission) [NeoVIN: Automatic With Manual Mode Trans]
JN8AZ3BE9V9730002 | trim                  | marketcheck      | (none) | Luxe    (vehicle_listings.trim)

JN8AZ3CC4V9640124 | advertised_price      | dealer_confirmed | (none) | 106595  (vehicle_listings.price)
JN8AZ3CC4V9640124 | base_msrp             | neovin           | (none) | 112990  (mc_attributes.base_msrp, NeoVIN decode 2026-09-06)
JN8AZ3CC4V9640124 | body_configuration    | marketcheck      | (none) | SUV     (mc_attributes.body_type)
JN8AZ3CC4V9640124 | condition             | dealer_confirmed | (none) | new     (vehicle_listings.condition)
JN8AZ3CC4V9640124 | destination_charge    | neovin           | (none) | 2245    (mc_attributes.delivery_charges)
JN8AZ3CC4V9640124 | drivetrain            | marketcheck      | (none) | 4WD     (mc_attributes.drivetrain)
JN8AZ3CC4V9640124 | engine                | marketcheck      | (none) | 3.5L V6 (mc_attributes.engine)
JN8AZ3CC4V9640124 | exterior_color        | marketcheck      | (none) | White   (mc_attributes.exterior_color)   [NeoVIN: Radiant White]
JN8AZ3CC4V9640124 | factory_options       | neovin           | (none) | 1 option (build_sheet.options)
JN8AZ3CC4V9640124 | factory_options_total | neovin           | (none) | 695     (build_sheet options+packages msrp sum)
JN8AZ3CC4V9640124 | fuel_type             | marketcheck      | (none) | Premium Unleaded (mc_attributes.fuel_type)
JN8AZ3CC4V9640124 | interior_color        | marketcheck      | (none) | Graph Semi Aniline Premi (mc_attributes.interior_color) [NeoVIN: Graphite Quilted Semi-Aniline Leather]
JN8AZ3CC4V9640124 | make                  | marketcheck      | (none) | INFINITI (vehicle_listings.ymm, parseYmm)
JN8AZ3CC4V9640124 | mileage               | dealer_confirmed | (none) | 17      (vehicle_listings.mileage)
JN8AZ3CC4V9640124 | model                 | marketcheck      | (none) | QX80    (vehicle_listings.ymm, parseYmm)
JN8AZ3CC4V9640124 | model_year            | marketcheck      | (none) | 2027    (vehicle_listings.ymm, parseYmm)
JN8AZ3CC4V9640124 | standard_equipment    | neovin           | (none) | 415 items (build_sheet.key_features + standard)
JN8AZ3CC4V9640124 | total_msrp            | neovin           | (none) | 115930  (mc_attributes.total_msrp, NeoVIN decode 2026-09-06)
JN8AZ3CC4V9640124 | transmission          | marketcheck      | (none) | Automatic (mc_attributes.transmission) [NeoVIN: Automatic With Manual Mode Trans]
JN8AZ3CC4V9640124 | trim                  | marketcheck      | (none) | Autograph (vehicle_listings.trim)

JN8AZ3DB9V9450387 | advertised_price      | dealer_confirmed | (none) | 96770   (vehicle_listings.price)
JN8AZ3DB9V9450387 | base_msrp             | neovin           | (none) | 102590  (mc_attributes.base_msrp, NeoVIN decode 2026-09-06)
JN8AZ3DB9V9450387 | body_configuration    | marketcheck      | (none) | SUV     (mc_attributes.body_type)
JN8AZ3DB9V9450387 | condition             | dealer_confirmed | (none) | new     (vehicle_listings.condition)
JN8AZ3DB9V9450387 | destination_charge    | neovin           | (none) | 2245    (mc_attributes.delivery_charges)
JN8AZ3DB9V9450387 | drivetrain            | marketcheck      | (none) | 4WD     (mc_attributes.drivetrain)
JN8AZ3DB9V9450387 | engine                | marketcheck      | (none) | 3.5L V6 (mc_attributes.engine)
JN8AZ3DB9V9450387 | exterior_color        | marketcheck      | (none) | Mineral (mc_attributes.exterior_color)   [NeoVIN: Mineral Black]
JN8AZ3DB9V9450387 | factory_options       | neovin           | (none) | 1 option (build_sheet.options)
JN8AZ3DB9V9450387 | factory_options_total | neovin           | (none) | 695     (build_sheet options+packages msrp sum)
JN8AZ3DB9V9450387 | fuel_type             | marketcheck      | (none) | Premium Unleaded (mc_attributes.fuel_type)
JN8AZ3DB9V9450387 | interior_color        | marketcheck      | (none) | Graphite (mc_attributes.interior_color)  [NeoVIN: Dusk Blue Perforated Semi-Aniline Leather]
JN8AZ3DB9V9450387 | make                  | marketcheck      | (none) | INFINITI (vehicle_listings.ymm, parseYmm)
JN8AZ3DB9V9450387 | model                 | marketcheck      | (none) | QX80    (vehicle_listings.ymm, parseYmm)
JN8AZ3DB9V9450387 | model_year            | marketcheck      | (none) | 2027    (vehicle_listings.ymm, parseYmm)
JN8AZ3DB9V9450387 | standard_equipment    | neovin           | (none) | 398 items (build_sheet.key_features + standard)
JN8AZ3DB9V9450387 | total_msrp            | neovin           | (none) | 105530  (mc_attributes.total_msrp, NeoVIN decode 2026-09-06)
JN8AZ3DB9V9450387 | transmission          | marketcheck      | (none) | Automatic (mc_attributes.transmission) [NeoVIN: Automatic With Manual Mode Trans]
JN8AZ3DB9V9450387 | trim                  | marketcheck      | (none) | Sport   (vehicle_listings.trim)

JN8AZ3DB9V9450437 | advertised_price      | dealer_confirmed | (none) | 95893   (vehicle_listings.price)
JN8AZ3DB9V9450437 | base_msrp             | neovin           | (none) | 102590  (mc_attributes.base_msrp, NeoVIN decode 2026-09-06)
JN8AZ3DB9V9450437 | body_configuration    | marketcheck      | (none) | SUV     (mc_attributes.body_type)
JN8AZ3DB9V9450437 | condition             | dealer_confirmed | (none) | new     (vehicle_listings.condition)
JN8AZ3DB9V9450437 | destination_charge    | neovin           | (none) | 2245    (mc_attributes.delivery_charges)
JN8AZ3DB9V9450437 | drivetrain            | marketcheck      | (none) | 4WD     (mc_attributes.drivetrain)
JN8AZ3DB9V9450437 | engine                | marketcheck      | (none) | 3.5L V6 (mc_attributes.engine)
JN8AZ3DB9V9450437 | exterior_color        | marketcheck      | (none) | White   (mc_attributes.exterior_color)   [NeoVIN: Radiant White]
JN8AZ3DB9V9450437 | factory_options       | neovin           | (none) | 1 option (build_sheet.options)
JN8AZ3DB9V9450437 | factory_options_total | neovin           | (none) | 695     (build_sheet options+packages msrp sum)
JN8AZ3DB9V9450437 | fuel_type             | marketcheck      | (none) | Premium Unleaded (mc_attributes.fuel_type)
JN8AZ3DB9V9450437 | interior_color        | marketcheck      | (none) | Graphite (mc_attributes.interior_color)  [NeoVIN: Dusk Blue Perforated Semi-Aniline Leather]
JN8AZ3DB9V9450437 | make                  | marketcheck      | (none) | INFINITI (vehicle_listings.ymm, parseYmm)
JN8AZ3DB9V9450437 | model                 | marketcheck      | (none) | QX80    (vehicle_listings.ymm, parseYmm)
JN8AZ3DB9V9450437 | model_year            | marketcheck      | (none) | 2027    (vehicle_listings.ymm, parseYmm)
JN8AZ3DB9V9450437 | standard_equipment    | neovin           | (none) | 398 items (build_sheet.key_features + standard)
JN8AZ3DB9V9450437 | total_msrp            | neovin           | (none) | 105530  (mc_attributes.total_msrp, NeoVIN decode 2026-09-06)
JN8AZ3DB9V9450437 | transmission          | marketcheck      | (none) | Automatic (mc_attributes.transmission) [NeoVIN: Automatic With Manual Mode Trans]
JN8AZ3DB9V9450437 | trim                  | marketcheck      | (none) | Sport   (vehicle_listings.trim)

JTMABABA5PA005774 | advertised_price      | dealer_confirmed | (none) | 20876   (vehicle_listings.price)
JTMABABA5PA005774 | body_configuration    | marketcheck      | (none) | SUV     (mc_attributes.body_type)
JTMABABA5PA005774 | condition             | dealer_confirmed | (none) | used    (vehicle_listings.condition)
JTMABABA5PA005774 | exterior_color        | marketcheck      | (none) | Black   (mc_attributes.exterior_color)
JTMABABA5PA005774 | interior_color        | marketcheck      | (none) | Black   (mc_attributes.interior_color)
JTMABABA5PA005774 | make                  | marketcheck      | (none) | Subaru  (vehicle_listings.ymm, parseYmm)
JTMABABA5PA005774 | mileage               | dealer_confirmed | (none) | 41679   (vehicle_listings.mileage)
JTMABABA5PA005774 | model                 | marketcheck      | (none) | SOLTERRA (vehicle_listings.ymm, parseYmm)
JTMABABA5PA005774 | model_year            | marketcheck      | (none) | 2023    (vehicle_listings.ymm, parseYmm)
JTMABABA5PA005774 | standard_equipment    | marketcheck      | (none) | 575 items (mc_attributes.features -- no build sheet on this VIN)
```

`JTMABABA5PA005774` gains no engine, drivetrain or MSRP: its NeoVIN snapshot returned HTTP 200 with a
6-key body carrying none of those fields, and it is the one active vehicle with no `build_sheet` in
`mc_attributes`. For that vehicle the blanks are honest UNKNOWNs, not a resolver failure.

---

## 5. Facts to SUPERSEDE — all 204

### 5a. `advertised_price` — 99 (dealer_confirmed)

Stored source: `vehicle_facts.fact_value->v` where `fact_key='advertised_price'`, written by the last
`refreshVehicleTruth` for that vehicle (date shown). Candidate source: `vehicle_listings.price`, the
dealer's current asking figure, refreshed hourly by `marketcheck-sync` and by the advertised-price crawl.

Deltas: median absolute 1,000; mean absolute 1,670; 50 of 99 are 1,000 or more; range -12,379 to +4,400.
The largest is `JN8AZ3BEXV9730011`. This is the number a salesperson quotes.

```
VIN               | stored (observed)      | candidate
19UUB2F6XKA007202 | 24985  (2026-08-25)    | 25880
1C4HJXDN4PW657311 | 31981  (2026-08-28)    | 32876
1C6SRFFT2NN400176 | 29999  (2026-08-01)    | 25876
1FTYR2CM3KKB53305 | 24981  (2026-08-29)    | 25876
1HGCY1F3XPA041710 | 24376  (2026-08-02)    | 23604
1HGCY2F59SA016460 | 29335  (2026-08-08)    | 28389
2HGFE1F74NH314504 | 17946  (2026-08-06)    | 17855
3GKALXEG9PL159028 | 27981  (2026-07-29)    | 26876
3GNAXUEV9LS593826 | 14925  (2026-07-29)    | 14861
3N1AB8BV3MY259117 | 15981  (2026-07-28)    | 14876
3PCAJ5BB0SF103257 | 39981  (2026-08-23)    | 40876
3PCAJ5BB3PF113420 | 29981  (2026-07-29)    | 30762
3PCAJ5BB6PF110401 | 29550  (2026-08-01)    | 30129
3PCAJ5BB8PF113283 | 28940  (2026-07-28)    | 30886
3PCAJ5FB1SF109708 | 42981  (2026-08-23)    | 43876
3PCAJ5FB2SF105392 | 39981  (2026-08-01)    | 40883
3PCAJ5FB8SF104621 | 42981  (2026-08-14)    | 43876
3PCAJ5JR0SF106450 | 37981  (2026-07-29)    | 38876
3PCAJ5JR1SF103167 | 38981  (2026-07-28)    | 38179
3PCAJ5JR2PF102214 | 31416  (2026-07-29)    | 30883
3PCAJ5KR0SF101800 | 40488  (2026-08-01)    | 39793
3VWEM7BU8RM082795 | 19876  (2026-08-03)    | 19330
5N1AC0EX8VC603569 | 55655  (2026-08-11)    | 55550
5N1AC0FX0VC605623 | 59876  (2026-08-23)    | 58876
5N1AC0FX2VC606224 | 60210  (2026-08-18)    | 60105
5N1AC0FX4VC605169 | 58635  (2026-08-14)    | 58530
5N1AC0FX5VC605679 | 58310  (2026-08-11)    | 57205
5N1AC0FX5VC605746 | 59005  (2026-08-10)    | 57900
5N1AC0FX5VC605844 | 60210  (2026-08-18)    | 60105
5N1AC0FX5VC606038 | 59210  (2026-08-18)    | 59105
5N1AC0FX6VC605481 | 58886  (2026-08-22)    | 57886
5N1AC0FX7VC605411 | 59005  (2026-08-10)    | 57900
5N1AC0FX7VC606820 | 59205  (2026-08-25)    | 58205
5N1AC0FX8VC605868 | 59210  (2026-08-10)    | 59105
5N1AC0JX1VC605072 | 66660  (2026-08-10)    | 65555
5N1AC0JX3VC606305 | 67560  (2026-08-18)    | 67455
5N1AC0JX9VC600671 | 67800  (2026-07-28)    | 66800
5N1AC0JXXVC601120 | 66905  (2026-08-11)    | 65895
5N1AL1E89VC331662 | 54265  (2026-07-28)    | 53765
5N1AL1F80VC330527 | 59035  (2026-07-28)    | 56535
5N1AL1F81VC331105 | 59730  (2026-07-28)    | 56893
5N1AL1F82VC330223 | 59680  (2026-07-28)    | 56892
5N1AL1F82VC339553 | 58540  (2026-08-10)    | 59435
5N1AL1F83VC332112 | 59935  (2026-07-28)    | 59435
5N1AL1F83VC338928 | 59730  (2026-07-28)    | 56893
5N1AL1F83VC338945 | 59995  (2026-08-10)    | 60890
5N1AL1F83VC338993 | 57995  (2026-08-11)    | 58890
5N1AL1F84VC332006 | 59035  (2026-07-28)    | 56535
5N1AL1F86VC331178 | 59730  (2026-07-28)    | 56894
5N1AL1F86VC332265 | 61390  (2026-07-28)    | 58890
5N1AL1F87VC331187 | 58335  (2026-08-10)    | 59230
5N1AL1F87VC332307 | 58335  (2026-08-10)    | 59230
5N1AL1F89VC339940 | 58540  (2026-08-11)    | 59435
5N1AL1F8XVC330826 | 59730  (2026-07-28)    | 56876
5N1AL1F90VC336143 | 64070  (2026-07-28)    | 61570
5N1AL1F94VC330815 | 64170  (2026-07-29)    | 61670
5N1AL1F96VC330170 | 63120  (2026-07-28)    | 60620
5N1AL1F96VC337944 | 62470  (2026-08-10)    | 63365
5N1AL1F9XVC330155 | 63815  (2026-07-28)    | 61315
5N1AL1FS2TC330859 | 58885  (2026-08-10)    | 53882
5N1AL1FS7TC339685 | 56493  (2026-07-28)    | 60893
5N1AL1FS9TC358190 | 58560  (2026-07-29)    | 61560
5N1AL1FW1TC358803 | 61075  (2026-07-28)    | 64890
5N1AL1FW1TC358865 | 63495  (2026-08-10)    | 58382
5N1AL1FW2TC341119 | 51981  (2026-08-01)    | 52876
5N1AL1FW7TC357977 | 62795  (2026-08-10)    | 57780
5N1AL1FW8TC344302 | 51981  (2026-08-01)    | 52876
5N1AL1FWXTC358105 | 62885  (2026-08-10)    | 58382
5N1AL1HU0TC333564 | 56988  (2026-07-29)    | 55876
5N1DL1GS6PC365387 | 37905  (2026-08-21)    | 38800
5XYK6CDF1RG201968 | 29695  (2026-08-01)    | 28883
5XYRLDJC9RG278742 | 28915  (2026-07-28)    | 27812
5YFEPMAE0NP335131 | 20981  (2026-08-01)    | 20050
JF2SKAJC9MH531918 | 23685  (2026-08-01)    | 22876
JM1NDAC72L0414832 | 25630  (2026-08-04)    | 26892
JM3KFBCL5S0602539 | 26415  (2026-08-01)    | 25876
JM3KFBDM4J0373454 | 16981  (2026-08-01)    | 15876
JN1EV7CR9PM540897 | 35981  (2026-08-14)    | 36876
JN1FV7AR5LM660049 | 27981  (2026-08-18)    | 28876
JN8AZ3AE0T9720795 | 76298  (2026-08-10)    | 77193
JN8AZ3AE1T9720885 | 77189  (2026-08-10)    | 78084
JN8AZ3BB0V9451110 | 94570  (2026-08-10)    | 92465
JN8AZ3BB1V9451052 | 94665  (2026-08-10)    | 92560
JN8AZ3BB3V9450369 | 90735  (2026-08-10)    | 88630
JN8AZ3BB4V9450493 | 90735  (2026-08-10)    | 88630
JN8AZ3BB7V9451105 | 95470  (2026-08-10)    | 93365
JN8AZ3BB8T9435718 | 89535  (2026-07-28)    | 86535
JN8AZ3BEXV9730011 | 103255 (2026-07-28)    | 90876
JN8AZ3CC8T9621721 | 100995 (2026-08-10)    | 101890
JN8AZ3CC9T9622022 | 102195 (2026-08-10)    | 103090
JN8AZ3DB3T9431184 | 87657  (2026-08-01)    | 85478
JN8AZ3DB6T9435116 | 100998 (2026-08-10)    | 93194
JN8AZ3DB7V9451165 | 97981  (2026-08-10)    | 95876
JTEAAAAH8RJ158018 | 39991  (2026-08-01)    | 37883
JTMABABA1PA008560 | 26500  (2026-08-01)    | 23544
JTMABABA1PA013354 | 22981  (2026-08-16)    | 22876
NMTKHMBXXMR129285 | 20999  (2026-08-01)    | 19785
SJKCH5CR6HA024710 | 14881  (2026-08-27)    | 15776
ZASPAKBN5L7C99407 | 23981  (2026-07-29)    | 20876
```

### 5b. `transmission` — 71 (marketcheck). Every one is a DOWNGRADE.

Stored source: `vehicle_facts` (written when `mc_attributes.transmission` still held the NeoVIN decode's
`transmission_description`). Candidate source: `mc_attributes.transmission` today, which is the coarse
syndication-feed value. The richer answer is still held verbatim in
`neovin_snapshots.payload->>'transmission_description'`.

**stored `Automatic With Manual Mode Trans` -> candidate `Automatic` (59 VINs)**
```
19UUB2F6XKA007202  1C4HJXDN4PW657311  1C6SRFFT2NN400176  1FMDE8BH9SLA76303  1FTYR2CM3KKB53305
3GNAXUEV9LS593826  3VWEM7BU8RM082795  5N1AC0FX0VC605623  5N1AC0FX0VC607758  5N1AC0FX2VC606224
5N1AC0FX2VC607129  5N1AC0FX4VC605169  5N1AC0FX5VC605844  5N1AC0FX5VC606038  5N1AC0FX6VC605481
5N1AC0FX6VC607554  5N1AC0FX7VC606820  5N1AC0FX9VC607600  5N1AC0FX9VC607757  5N1AC0JX1VC606660
5N1AC0JX3VC606305  5N1AC0JX9VC600671  5N1AL1E89VC331662  5N1AL1F80VC330527  5N1AL1F81VC331105
5N1AL1F82VC330223  5N1AL1F83VC332112  5N1AL1F83VC338928  5N1AL1F84VC332006  5N1AL1F86VC331178
5N1AL1F86VC332265  5N1AL1F87VC332307  5N1AL1F8XVC330826  5N1AL1F90VC336143  5N1AL1F96VC330170
5N1AL1F9XVC330155  5N1AL1FS7TC339685  5N1AL1FW1TC358803  5N1AL1HZ8VC342883  5N1DL1FS6RC335049
5N1DL1FS8PC368244  5N1DL1GS6PC365387  5NPEH4J21MH101448  5XYRLDJC9RG278742  JM3KFBCL5S0602539
JN1BV7AR6FM406806  JN1EV7CR5PM543599  JN1EV7CR8PM540616  JN1EV7CR9PM540897  JN1FV7AR5LM660049
JN8AZ2NE3L9254199  JN8AZ3BB8T9435718  JN8AZ3BEXV9730011  JN8AZ3CCXT9624250  JN8AZ3DB0V9452464
JN8AZ3DB7V9451165  JTJBM7FX3J5192431  YV4A22PK3J1375505  ZASPAKBN5L7C99407
```

**stored `Continuously Trans With Manual Mode` -> candidate `CVT` (8 VINs)**
```
3CZRU6H59LM724411  3PCAJ5BB0SF103257  3PCAJ5BB8PF113283  3PCAJ5FB1PF122711
3PCAJ5FB1SF109708  3PCAJ5FB8SF104621  5N1BT3BB2TC779545  NMTKHMBXXMR129285
```

**stored `Automatic Trans` -> candidate `Automatic` (2 VINs)**: `JTMABABA1PA008560`, `JTMABABA1PA013354`

**stored `Dual Clutch Sequential Trans (DCT)` -> candidate `Automatic` (1 VIN)**: `SJKCH5CR6HA024710`

**stored `Manual Trans` -> candidate `Manual` (1 VIN)**: `JM1NDAC72L0414832`

### 5c. `exterior_color` — 9 (marketcheck)

```
VIN               | stored (observed)              | candidate (mc_attributes.exterior_color) | NeoVIN payload
3PCAJ5BB0SF103257 | Hermosa Blue   (2026-08-23)    | Blue          | Hermosa Blue
5N1AC0FX4VC605169 | Mineral Black  (2026-08-14)    | Mineral       | Mineral Black
5N1AC0FX8VC605868 | Radiant White  (2026-08-10)    | White         | Radiant White
5N1AL1F81VC331105 | Gray           (2026-07-28)    | Harbor Gray   | Harbor Mist Gray Pearl
5N1AL1F83VC332112 | Radiant White  (2026-07-28)    | White         | Radiant White
5N1DL1FS6RC335049 | Mineral Black  (2026-08-22)    | Mineral       | Mineral Black
JN1BV7AR6FM406806 | Venetian Ruby  (2026-08-05)    | Venetian      | Venetian Ruby
JN1EV7CR8PM540616 | Majestic White (2026-09-05)    | Majestic      | Majestic White
JN1EV7CR9PM540897 | Grand Blue     (2026-08-14)    | Blue          | Grand Blue
```
Eight of nine are downgrades; only `5N1AL1F81VC331105` improves, and even there the candidate
(`Harbor Gray`) is short of the NeoVIN name (`Harbor Mist Gray Pearl`).

### 5d. `interior_color` — 6 (marketcheck)

```
VIN               | stored (observed)                        | candidate      | NeoVIN payload
5N1AC0FX4VC605169 | Graph Tailorfit Appointed  (2026-08-14)  | Graphite       | Graphite TailorFit Synthetic Leather
5N1AC0FX7VC606820 | Graph Tailorfit Appointed  (2026-08-25)  | Graphite       | Graphite TailorFit Synthetic Leather
5N1AL1F81VC331105 | Graph Tailorfit Appointed  (2026-07-28)  | Graphite       | Graphite TailorFit Synthetic Leather
5N1AL1F83VC332112 | Graph Tailorfit Appointed  (2026-07-28)  | Graphite       | Graphite TailorFit Synthetic Leather
5NPEH4J21MH101448 | Dark Gray/Camel            (2026-08-22)  | Dark Gray      | (no interior name in payload)
JN8AZ3BEXV9730011 | Sepia Bwn Lth Appointed    (2026-07-28)  | Sepia Brown    | Sepia Brown Perforated Leather
```
All six are downgrades.

### 5e. `trim` — 9 (marketcheck). Case only.

```
5N1AC0FX0VC605623  SPORT -> Sport      5N1AC0FX6VC605481  SPORT -> Sport
5N1AC0FX7VC606820  SPORT -> Sport      JN8AZ3BB0V9451110  LUXE  -> Luxe
JN8AZ3BB1V9451052  LUXE  -> Luxe       JN8AZ3BB3V9450369  LUXE  -> Luxe
JN8AZ3BB4V9450493  LUXE  -> Luxe       JN8AZ3BB7V9451105  LUXE  -> Luxe
JN8AZ3BEXV9730011  LUXE  -> Luxe
```
Stored source `vehicle_facts`; candidate source `vehicle_listings.trim`. These are the six semantic matches
Gate 2 already recorded, plus three more. Cosmetic, but each one is a MATERIAL field and would mint a
snapshot version and stale-flag the vehicle's sticker.

### 5f. `condition` — 3 (dealer_confirmed)

```
VIN               | stored (observed)   | candidate (vehicle_listings.condition)
3PCAJ5BB8PF113283 | cpo  (2026-07-28)   | used
5N1DL1FS6RC335049 | used (2026-08-22)   | cpo
JN1EV7CR8PM540616 | used (2026-09-05)   | cpo
```
Two vehicles gain CPO status, one loses it. Condition drives the Buyers Guide and the whole used/new
document split, so these three are the highest-consequence supersedes per row in the run.

### 5g. `mileage` — 1 (dealer_confirmed)

```
3PCAJ5BB8PF113283 | stored 32357 (2026-07-28) | candidate 32417 (vehicle_listings.mileage)
```

### 5h. `JN8AZ3BEXV9730011` pricing and equipment — 6 (neovin)

One vehicle, six facts, all traceable to NeoVIN re-decoding the same VIN on 2026-09-06 with
`record_confidence` 0 -> 95 and `msrp_label` newly set to `build_specs_msrp`.

```
fact_key              | stored (vehicle_facts, observed 2026-07-28)      | candidate (mc_attributes, NeoVIN decode 2026-09-06)
base_msrp             | 107995                                          | 94590
destination_charge    | 2495                                            | 2245
total_msrp            | 111240                                          | 98205
factory_options       | ["Metallic Paint"]                              | ["INFINITI Radiant Silver Illuminated Kick Plates","Premium Paint","USB Charging Cable Set (PIO)"]
factory_options_total | 750                                             | 1370
standard_equipment    | 409 items                                       | 383 items
```

---

## 6. CONFLICTS — 321 cells where two eligible authoritative sources disagree today

This is the finding that governs everything else in this dry run.

`candidatesFromListing` never reads `neovin_snapshots`. It reads `mc_attributes`, and it trusts
`mc_attributes.engine / transmission / drivetrain / fuel_type / body_type / exterior_color /
interior_color` as if those keys were the decode. They are not, any more.

`marketcheck-specs` writes the decode into those keys
(`index.ts:286  setIf("transmission", build.transmission_description ?? build.transmission)`), and
`marketcheck-sync` then rebuilds `mc_attributes` from scratch on every run
(`index.ts:1132-1180`), writing `transmission: b.transmission`, `exterior_color: l.exterior_color`,
`interior_color: l.interior_color` from the syndication feed. Its `DECODE_OWNED_KEYS` guard
(`index.ts:95-99`) protects `build_sheet`, `base_msrp`, `delivery_charges`, `total_msrp` and the `specs_*`
bookkeeping — and nothing else. Engine, transmission, drivetrain, fuel type and both colours are outside
the guard and are overwritten with the coarse feed value.

`marketcheck-sync` is cron job 2, schedule `7 * * * *` — **hourly**. `specs-backfill` is job 25 at
`45 3 * * *`, once a day. So the decode's richer answer survives in `mc_attributes` for roughly twenty-two
minutes a day and is coarse for the rest.

Measured across the 130 active vehicles, feed key against latest `neovin_snapshots.payload`:

| Fact key | Agree | **Conflict** | Feed blank, NeoVIN has it | NeoVIN blank, feed has it | Both blank |
|---|---:|---:|---:|---:|---:|
| transmission | 9 | **120** | 0 | 0 | 1 |
| interior_color | 0 | **126** | 2 | 1 | 1 |
| exterior_color | 57 | **70** | 1 | 1 | 1 |
| trim | 122 | **5** | 2 | 0 | 1 |
| engine | 127 | 0 | 0 | 0 | 3 |
| drivetrain | 129 | 0 | 0 | 0 | 1 |
| fuel_type | 129 | 0 | 0 | 0 | 1 |
| body_configuration | 129 | 0 | 0 | 1 | 0 |
| base_msrp | 108 | 0 | 21 | 0 | 1 |
| destination_charge | 108 | 0 | 21 | 0 | 1 |
| total_msrp | 108 | 0 | 21 | 0 | 1 |

Corroboration by provenance: of the 128 feed-sourced vehicles, **127 have had
`mc_attributes.transmission` overwritten away from the NeoVIN `transmission_description`, and zero still
hold it** (the 128th has no transmission value on either side). Of the two
hand-added vehicles (`feed_source IS NULL`, so `marketcheck-sync` never touches them),
`JN8AZ3CC5T9624253` still holds `Automatic With Manual Mode Trans` — the decoded value, intact. That is the
control case, and it isolates the cause to the sync rebuild rather than to the decoder.

The 63 pricing rows marked "feed blank, NeoVIN has it" are **not** conflicts: on all 21 of those vehicles
`mc_attributes.build_sheet.pricing` agrees exactly with the latest NeoVIN `msrp` / `combined_msrp`, and the
ingest already falls back to `build_sheet.pricing`. Pricing has no conflict anywhere in the estate.

**Character of the colour conflicts.** Almost all are truncation — the feed holds the base colour family and
NeoVIN holds the OEM name:

```
feed "Graphite"   vs NeoVIN "Graphite TailorFit Synthetic Leather"      22 vehicles
feed "Graphite"   vs NeoVIN "Graphite Leather"                          16
feed "White"      vs NeoVIN "Radiant White"                             13
feed "Stone Gray" vs NeoVIN "Stone Grey TailorFit Synthetic Leather"     9
feed "Mineral"    vs NeoVIN "Mineral Black"                              8
feed "Black"      vs NeoVIN "Black Cloth"                                6
```

Two are not truncation but a **different colour**: on `JN8AZ3DB9V9450387` and `JN8AZ3DB9V9450437` the feed
says interior `Graphite` while NeoVIN decoded `Dusk Blue Perforated Semi-Aniline Leather`. Both of those
vehicles are in the ADD set, so a reconciliation run today would put `Graphite` onto a factory-sticker
reproduction for a car NeoVIN says is Dusk Blue. One of the two answers is wrong and the truth layer has no
way to tell which; that is an owner decision, not a ranking decision.

**Why this is not merely cosmetic.** All six affected keys are in `MATERIAL_FIELDS` and every one of them
`affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"]`. Superseding on
the feed value would replace the decoded answer on 98 published factory stickers and 57 published window
labels, and would flag every one of them stale in the same pass.

---

## 7. UNKNOWNS — 494 cells with no candidate from any eligible source

| Fact key | Cells | Why |
|---|---:|---|
| `stock_number` | 130 | `vehicle_listings` has no `stock_number` column and `mc_attributes.stock_no` is absent on all 130. The ingest reads only those two. `vehicle_files.stock_number` is populated on 130/130 (DUPLICATE_READ_PATHS C4) and is never read by the truth layer — so a MATERIAL field that the dealer owns and the Vehicle File displays is UNKNOWN in truth on every car. |
| `factory_packages` | 130 | No active build sheet carries a non-empty `packages` array. |
| `manufacturer` | 130 | Neither `build_sheet.manufacturer` nor `mc_attributes.manufacturer` exists on any active vehicle. NeoVIN carries `manufacturer_code`, not a name. |
| `mileage` | 43 | `vehicle_listings.mileage IS NULL` on 43 new cars. `vehicle_files.mileage` holds `0` for these, which is why a `vehicle_files` reader prints "0 mi"; the truth layer correctly declines to assert it. |
| `factory_options_total` | 21 | Build sheet holds no priced options or packages. |
| `factory_options` | 19 | Build sheet `options` array empty or absent. |
| `engine` | 3 | Two Subaru Solterras (battery-electric, no engine string anywhere) plus `JTMABABA5PA005774`. |
| `interior_color` | 3 | `JN8AZ3CC5T9624253`, `5N1AT3CB7MC736556`, `19UUB2F6XKA007202`. |
| `advertised_price` | 2 | `JN8AZ3CC5T9624253` and `5N1AT3CB7MC736556`, both `price IS NULL`. Both are the hand-added rows with `feed_source IS NULL`. |
| `exterior_color` | 2 | `JN8AZ3CC5T9624253`, `5N1AT3CB7MC736556`. |
| `trim` | 2 | `JN8AZ3CC5T9624253` and `JTMABABA5PA005774`: `vehicle_listings.trim` and `mc_attributes.trim` both null. |
| `make`, `model`, `model_year` | 1 each | `JN8AZ3CC5T9624253`: `vehicle_listings.ymm IS NULL`, and `parseYmm` is the only identity source the ingest reads. The answer (`2026 INFINITI QX80 Autograph`) is sitting in that VIN's NeoVIN payload. |
| `base_msrp`, `destination_charge`, `total_msrp`, `drivetrain`, `fuel_type`, `transmission` | 1 each | All `JTMABABA5PA005774`, whose NeoVIN response is a 6-key body with none of these fields and which has no `build_sheet`. |

None of these is a candidate for invention. `stock_number` is the one that is worth an owner decision,
because the answer exists in `vehicle_files` and only the ingest's source list is stopping it.

---

## 8. The Gate 2 examples, checked against live data

### 8a. "Five vehicles render nothing for engine, drivetrain and MSRP" — CONFIRMED for four, REFUTED for the fifth, and one vehicle Gate 2 did not name belongs in the set

`currentValues.truthValue` renders a Vehicle Truth line only when the vehicle has a `vehicle_snapshots` row
AND a `vehicle_facts` row for that key (`src/lib/vehicleFile/currentValues.ts:134-159`). Live state today:

| VIN | snapshot | engine | drivetrain | total_msrp | year/make/model/trim | Verdict |
|---|---|---|---|---|---|---|
| `JN8AZ3BE9V9730002` | none | blank | blank | blank | blank | **CONFIRMED** |
| `JN8AZ3CC4V9640124` | none | blank | blank | blank | blank | **CONFIRMED** |
| `JN8AZ3DB9V9450387` | none | blank | blank | blank | blank | **CONFIRMED** |
| `JN8AZ3DB9V9450437` | none | blank | blank | blank | blank | **CONFIRMED** |
| `JN8AZ3CC5T9624253` | v2, 2026-09-07 08:40 | `3.5L V6` | `4WD` | `113690` | blank | **REFUTED for engine/drivetrain/MSRP; CONFIRMED for identity** |
| `JTMABABA5PA005774` | none | blank | blank | blank | blank | **CONFIRMED, not named by Gate 2** |

Detail on the two that move:

- **`JN8AZ3CC5T9624253`** was resolved on 2026-09-07 08:40 (facts first created 2026-09-04 16:44,
  completed 2026-09-07). Its snapshot v2 `material_changes` records exactly the fields Gate 2 said were
  missing arriving for the first time: `mechanical.engine` null -> `3.5L V6`, `mechanical.drivetrain`
  null -> `4WD`, `pricing.baseMsrp` null -> 111500, `pricing.totalMsrp` null -> 113690. Its
  `base_msrp`/`total_msrp` facts match `mc_attributes` today, so they are UNCHANGED in this run.
  What is still blank is year, make, model and trim, and the cause is different from the sticker-freeze:
  `vehicle_listings.ymm IS NULL` and `.trim IS NULL` on this row (it is one of the two hand-added
  vehicles), and `parseYmm(ymm)` is the ingest's only identity source. The answer
  (`2026 / INFINITI / QX80 / Autograph`) is in that VIN's `neovin_snapshots.payload`, which the ingest
  does not read. This vehicle therefore contributes **zero** ADDs to this run: no new candidate exists
  for it under the current source list.
- **`JTMABABA5PA005774`** (2023 Subaru Solterra) is blank for engine, drivetrain and MSRP and has no
  snapshot and no facts. It is a fifth vehicle in exactly the state Gate 2 described. Its blanks for
  engine/drivetrain/MSRP are honest UNKNOWNs, though: its NeoVIN snapshot is a 6-key HTTP 200 body with
  none of those fields, and it is the one active vehicle with no `build_sheet`. A reconciliation gives it
  ten facts (price, mileage, condition, identity, body, colours, 575 feature items) and still no MSRP.

The mechanism Gate 2 named is confirmed exactly for the four QX80s: `orchestrated_at` 2026-07-27 03:30,
sticker settled `published`, `refreshVehicleTruth` never ran again, and NeoVIN has since re-decoded all four
(2026-09-06) with answers nobody has read.

### 8b. "`JN8AZ3BEXV9730011` stored MSRP 111,240 against NeoVIN 98,205" — CONFIRMED exactly

```
vehicle_facts   fact_key total_msrp, source_kind neovin, confidence VERIFIED
                fact_value {"v": 111240}, observed_at 2026-07-28 02:28:01

vehicle_snapshots v1 (the only version)  pricing.totalMsrp = 111240

neovin_snapshots  2026-07-28 01:28:32   msrp 107995  combined_msrp 111240  delivery_charges 2495
                                        record_confidence 0    msrp_label (absent)
neovin_snapshots  2026-09-06 03:17:42   msrp  94590  combined_msrp  98205  delivery_charges 2245
                                        record_confidence 95   msrp_label "build_specs_msrp"

mc_attributes today  base_msrp 94590   total_msrp 98205   delivery_charges 2245
                     specs_decoded_at 2026-09-06T03:17:42.163Z
```

The stored fact is the July decode. NeoVIN re-decoded the same VIN on 2026-09-06 and moved the total MSRP
by **13,035**, moved `record_confidence` from 0 to 95, and newly labelled the base figure
`build_specs_msrp`. `marketcheck-specs` lifted the new numbers into `mc_attributes` on the same day.
Nothing has re-resolved the vehicle since, because its sticker is published.

Two things Gate 2 did not report, both visible in the same row:
- `advertised_price` is stale by **12,379** on this VIN (fact 103,255 from 2026-07-28 against
  `vehicle_listings.price` 90,876 today) — the largest advertised-price drift in the estate.
- Its `factory_options` fact still reads `["Metallic Paint"]` at 750, while the 2026-09-06 build sheet
  carries three options totalling 1,370. The option list on a published factory-sticker reproduction is
  wrong on this car, not only the total.

---

## 9. The corrective path: exactly one call, append-only, zero provider cost

### 9a. The call

```
POST https://onnbmmdbrsgytfozfozn.supabase.co/functions/v1/factory-sticker-orchestrate
Authorization: Bearer <SERVICE_ROLE_KEY>          (or a manager JWT holding the "regenerate" permission)
Content-Type: application/json

{ "action": "refresh_truth_sweep",
  "tenant_id": "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142",
  "only_missing": true,
  "sync": true }
```

Handler: `supabase/functions/factory-sticker-orchestrate/index.ts`, the `refresh_truth_sweep` branch
(line 1384 in the deployed build at `24f7cb06`). It selects the tenant's non-archived listings, then calls
`refreshVehicleTruth(admin, tenantId, listing)` in
`supabase/functions/factory-sticker-orchestrate/truth.ts:153` once per vehicle inside a 90-second budget.

- `only_missing: true` (the default) filters to vehicles with **no `vehicle_snapshots` row**. Today that is
  exactly the five never-resolved vehicles, and the run produces the 96 ADDs and nothing else.
- `only_missing: false` re-resolves all 130 and additionally applies the 204 SUPERSEDEs.
- `sync: true` runs inline and returns the counts; without it the work goes to `EdgeRuntime.waitUntil`
  and the response is only an acknowledgement.

This action exists in the currently deployed function. It needs no migration. The Gate 2.5 build's
`20260909112000_truth_refresh_decoupling.sql` (unapplied) adds a `truth_refresh_candidates` RPC, a `mode`
vocabulary and a `truth-refresh-nightly` cron job; `cron.job` today holds 22 jobs and none of them is
`truth-refresh-nightly`, and `public.truth_refresh_candidates` does not exist. **The rebuilt handler in the
working tree calls that RPC and returns a named 500 without it**, so if the new `index.ts` is deployed
ahead of the migration this call fails closed rather than sweeping nothing silently. Deploy order matters:
migration first, then the function.

### 9b. It is append-only with respect to history

`refreshVehicleTruth` performs exactly these writes:

| Table | Operation | History impact |
|---|---|---|
| `vehicle_snapshots` | `INSERT` only, `snapshot_version = n+1`, `parent_snapshot_id = <current>` | **Append.** No UPDATE, no DELETE anywhere in the module. The prior version stays readable, and the new row's `material_changes` records `previous` and `next` for every field that moved, so a superseded value is preserved as evidence rather than erased. |
| `vehicle_facts` | `UPSERT` on `(vehicle_id, fact_key, source_kind)` | Candidate ledger, replaced in place. The superseded value survives in the parent snapshot's `snapshot_json` and in the new snapshot's `material_changes`. |
| `vehicle_fact_conflicts` | `UPSERT` on `(vehicle_id, fact_key)` | Refreshed, status reset to `open`. |
| `vehicle_exceptions` | insert/update one truth-conflict row per vehicle | Queue bookkeeping. |
| `stale_document_flags` | delete this document's `open` rows, insert current ones | Reviewed rows are left alone as an audit trail. |
| `audit_log` | insert on partial fact-write failure | |

`vehicle_source_records` is written only by `recordSourcePayload`, which the sweep path never calls.
`neovin_snapshots` is not touched at all. No provider payload and no snapshot is mutated by this path.

It also does **not** regenerate anything. On a material change it raises `stale_document_flags` against
documents already in `approved` / `printed` / `published` and stops there — no `document_status` write, no
PDF, no republish. What to do about a stale sticker stays a human decision.

### 9c. Provider cost is ZERO — verified, not assumed

`grep -rn "fetch(\|XMLHttpRequest\|net.http"` over `supabase/functions/factory-sticker-orchestrate/truth.ts`
and the entire `supabase/functions/_shared/factorySticker/lib/vehicleTruth/` directory (`ingest.ts`,
`snapshot.ts`, `precedence.ts`, `materialChange.ts`, `tenantAuthority.ts`, `existingQueues.ts`,
`historyFacts.ts`, `refreshPolicy.ts`, `recallView.ts`) returns **NONE**. The `refresh_truth_sweep` branch
itself issues no outbound request either.

Every input is already held:

| Input | Table / column | Already stored |
|---|---|---|
| Dealer columns | `vehicle_listings.condition/.mileage/.price/.trim/.ymm` | yes |
| Feed structured keys | `vehicle_listings.mc_attributes` | yes, refreshed hourly by `marketcheck-sync` at no incremental cost to this call |
| NeoVIN build sheet + lifted pricing | `mc_attributes.build_sheet`, `.base_msrp`, `.delivery_charges`, `.total_msrp` | yes, written by `marketcheck-specs` (130/130 have a NeoVIN snapshot; 129/130 have a build sheet) |
| Source Authority | `source_authority_rules` | yes |
| Current snapshot | `vehicle_snapshots` | yes |

No MarketCheck, NeoVIN, NHTSA, EPA, Black Book or Firecrawl call is made. Nothing is marked `billable`.
The provider cost of the corrective path is **zero**, and it is zero because the corrective path reads
sources the estate already paid for and stored. It does not need to be stopped.

### 9d. Freshness, so the size of the job is not a guess

| | Vehicles |
|---|---:|
| Never resolved (no fact, no snapshot) | 5 |
| Last resolved more than 20 h ago | 125 |
| Last resolved within 20 h | 0 |
| Last resolved more than 30 days ago | 77 |
| Oldest resolution | 2026-07-28 02:27 |
| Newest resolution | 2026-09-08 16:46 |

Every active vehicle in the pilot is outside the 20-hour window the proposed nightly job uses, so the first
`mode: "due"` run would sweep the whole lot. At the observed rate a 90-second budget covers a few dozen
vehicles; the call is re-invokable and the worklist is ordered oldest-truth-first, so two or three passes
clear 130.

---

## 10. What is safe to run, what is not, and what the owner has to decide

### 10a. Safe to run today, unchanged

`{"action":"refresh_truth_sweep","tenant_id":"<pilot>","only_missing":true,"sync":true}`

`only_missing` filters on the absence of a `vehicle_snapshots` row, so this run touches the five
never-resolved vehicles and no others. It writes **88 of the 96 ADDs**, mints five first snapshots (version
1, no parent, `material_changes` empty by definition), supersedes nothing, and stale-flags nothing, because
a first snapshot invalidates no prior document. Provider cost zero.

The remaining 8 ADDs sit on six vehicles that already have a snapshot
(`5N1DL1FS6RC335049`, `5NPEH4J21MH101448`, `JN1BV7AR6FM406806`, `JN1EV7CR8PM540616`, `JN8AZ2NE3L9254199`,
`JTJBM7FX3J5192431`) and can only be reached with `only_missing: false`, which also applies all 204
supersedes. They cannot be separated by the current handler.

One caveat even on this path: four of the five vehicles receive `transmission = "Automatic"` and truncated
colours from the feed, and two of them (`JN8AZ3DB9V9450387`, `JN8AZ3DB9V9450437`) receive interior
`Graphite` where NeoVIN decoded `Dusk Blue Perforated Semi-Aniline Leather`. Those four facts per vehicle
would be written onto a factory-sticker reproduction.

### 10b. NOT safe to run today

`{"action":"refresh_truth_sweep", ... ,"only_missing":false}` against the pilot, before the source order is
fixed, because:

1. **86 of the 204 supersedes are downgrades** — 71 transmission, 9 exterior colour, 6 interior colour —
   replacing a decoded OEM answer with a coarse syndication-feed one, on fields that print on the OEM
   window-sticker reproduction.
2. **2 of them are outright colour disagreements**, not truncations.
3. It would mint a new snapshot version on **126 of 130** vehicles and raise `stale_document_flags` against
   **157 published documents** (98 factory stickers, 57 window labels, 1 addendum, 1 buyers guide) in a
   single pass — including 9 vehicles whose only change is trim letter-case.
4. The condition of three vehicles would flip (two into CPO, one out), which changes which document family
   they belong to.

### 10c. Fix the cause before the wholesale run

The 321 conflicts all have one cause, and it is in the write path, not the read path: `marketcheck-sync`
(cron every hour at minute 7) rebuilds `mc_attributes` from the syndication feed and its `DECODE_OWNED_KEYS`
allow-list protects `build_sheet` and the lifted pricing but not `engine`, `transmission`, `drivetrain`,
`fuel_type`, `body_type`, `exterior_color` or `interior_color` — the same keys `marketcheck-specs` writes
the NeoVIN decode into. Two candidate corrections, both one-line-ish and neither performed here:

- **(i) Widen the guard.** Add those seven keys to `DECODE_OWNED_KEYS` so a decoded value survives a sync.
  Smallest change; keeps the truth ingest exactly as it is. Risk: it also freezes a genuinely corrected
  feed value on a car that was never decoded.
- **(ii) Read the decode at its source.** Give `candidatesFromListing` a `neovin_snapshots.payload`
  candidate for these keys, sourced `neovin` and therefore ranked above `marketcheck` by
  `precedenceFor`. This is the same rule Gate 2.5 already adopted for identity — provider answers come from
  structured identity, not from whatever a later writer left in a shared bag — and it makes the truth layer
  independent of the hourly rebuild rather than dependent on winning a race with it. It also closes the
  `JN8AZ3CC5T9624253` identity gap (year/make/model/trim are in that payload) and would let both colour
  conflicts be surfaced as `vehicle_fact_conflicts` for a person to settle instead of being silently
  resolved by whichever writer ran last.

Option (ii) is the one consistent with the rest of this gate. Neither is in scope for this dry run.

### 10d. Nothing here proposes rewriting history

No step above mutates a `vehicle_snapshots` row, edits a `neovin_snapshots` payload, deletes a
`vehicle_source_records` row, or backdates a `checked_at`. Superseded values are not erased: the corrective
path writes a new snapshot version whose `material_changes` carries `previous` and `next` for every field
that moved, and the parent snapshot remains readable at its own version number. That record — not a
rewritten fact row — is the evidence that a value changed and when.

### 10e. Owner decisions this dry run cannot make

1. **Colour and transmission provenance.** Fix (i) or fix (ii) in 10c — or accept the downgrade. This
   decides 86 supersedes and 321 conflicts.
2. **`JN8AZ3DB9V9450387` and `JN8AZ3DB9V9450437` interior colour.** Feed says `Graphite`, NeoVIN says
   `Dusk Blue Perforated Semi-Aniline Leather`. One is wrong and both are printed on a compliance
   document. Which is authoritative?
3. **Three condition flips.** `3PCAJ5BB8PF113283` cpo -> used, `5N1DL1FS6RC335049` used -> cpo,
   `JN1EV7CR8PM540616` used -> cpo. Is `vehicle_listings.condition` authoritative over the stored fact?
4. **`stock_number`.** UNKNOWN on 130/130 in truth while `vehicle_files.stock_number` is populated on
   130/130. May the truth ingest read `vehicle_files` as a `dealer_confirmed` source?
5. **`JN8AZ3CC5T9624253` identity.** `ymm` and `trim` are NULL on the listing, so year/make/model/trim stay
   blank on the Vehicle File no matter how often truth is refreshed. Fix the listing row, or let the ingest
   read identity from the NeoVIN payload?
6. **Staging.** 157 published documents would be stale-flagged in one pass. Run it in one go, or scope the
   first wholesale run to the vehicles whose pricing actually moved?

### 10f. Follow-on, outside this report

`marketcheck-specs` re-decoded 21 vehicles into `build_sheet.pricing` without lifting `base_msrp` /
`delivery_charges` / `total_msrp` to the top level of `mc_attributes`. The ingest's fallback to
`build_sheet.pricing` catches every one of them and they agree with NeoVIN exactly, so there is no error
today — but the top-level lift is the documented contract and 21 rows are not honouring it.
