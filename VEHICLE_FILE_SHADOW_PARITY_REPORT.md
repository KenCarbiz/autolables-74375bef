# VEHICLE FILE — SHADOW PARITY REPORT (Gate 2)

Date: 2026-09-09 (UTC). Repo `KenCarbiz/autolables-74375bef` at `caf8ee78`. Shadow run: six pages of 25 over
`vehicle-file-read-model` (`action: "shadow_parity"`), pilot tenant Harte Infiniti
`3f0f97f5-4151-4e32-88ef-e2d6fc5a3142`. Nothing a user sees was changed: the projection reads and never
writes, and no consumer is wired to it.

## Headline

**PASS on the §51 standard.** VIN, stock, current mileage and current retail are 100% explained, with zero
UNEXPLAINED cases anywhere in the run. Of 1,560 field comparisons, 1,535 match outright, 6 differ only in
form, and 19 are cases where the Vehicle File shows something wrong or shows nothing at all while a source
holds the answer. Not one comparison came out with the read model wrong.

## The numbers

| | |
|---|---|
| Active VINs | 130 |
| Compared VINs | 130 (100%) |
| Field comparisons | 1,560 (130 × 12 critical fields) |
| MATCH | 1,535 |
| SEMANTIC MATCH | 6 |
| EXPECTED SOURCE DIFFERENCE | 0 |
| CURRENT OLD VALUE WRONG | 19 |
| NEW VALUE WRONG | 0 |
| **UNEXPLAINED** | **0** |
| Stale resolved values | 0 |
| Unresolved conflicts | 0 |
| Total run time | 193 s across six pages |

### §51 — the four that must be fully explained

| Field | Verdict |
|---|---|
| VIN | 130/130 MATCH |
| Stock | 130/130 MATCH |
| Mileage | 130/130 MATCH |
| Advertised retail | 130/130 MATCH |

Stock matching is not a null result. The Vehicle File reaches `vehicle_files.stock_number` only third in a
seven-candidate client-side precedence, and the read model takes it directly; they agree because the other
six candidates are empty on every pilot vehicle, which is what the maps predicted.

Advertised retail agrees because the owner's Gate 1 decision defines current retail as the dealer's own
current claim, the same figure the Passport serves. The crawler's ladder is a separate question and is
reported under `publicAdvertisement`, not compared against it.

### By field

| Field | MATCH | SEMANTIC | APP WRONG | MODEL WRONG | UNEXPLAINED |
|---|---|---|---|---|---|
| vin | 130 | 0 | 0 | 0 | 0 |
| stock | 130 | 0 | 0 | 0 | 0 |
| mileage | 130 | 0 | 0 | 0 | 0 |
| advertised_retail | 130 | 0 | 0 | 0 | 0 |
| condition | 130 | 0 | 0 | 0 | 0 |
| year | 129 | 0 | 1 | 0 | 0 |
| model | 128 | 0 | 2 | 0 | 0 |
| make | 127 | 1 | 2 | 0 | 0 |
| engine | 126 | 0 | 4 | 0 | 0 |
| drivetrain | 126 | 0 | 4 | 0 | 0 |
| msrp | 125 | 0 | 5 | 0 | 0 |
| trim | 124 | 5 | 1 | 0 | 0 |

## The 19 differences, all explained

**Five vehicles the Vehicle File cannot describe at all (16 of the 19).** `JN8AZ3BE9V9730002`,
`JN8AZ3CC4V9640124`, `JN8AZ3DB9V9450387`, `JN8AZ3DB9V9450437` and `JN8AZ3CC5T9624253` render nothing for
engine, drivetrain and MSRP — and for the last of those, nothing for year, make, model or trim either. The
NeoVIN decode snapshot holds every one of those answers. The page shows blanks because it reads them from
`vehicle_facts`, and facts are only written when the sticker orchestrator runs, which it never does again
for a vehicle whose sticker is PUBLISHED.

**One stale MSRP (1 of 19).** `JN8AZ3BEXV9730011`: the truth card renders 111,240 from a fact the
orchestrator wrote on 2026-07-28. The NeoVIN snapshot says 98,205. A $13,035 difference on the number a
salesperson quotes as the sticker.

**The Alfa Romeo (2 of 19).** `ZASPAKBN5L7C99407` shows make "Alfa" and model "Romeo Stelvio". The page
splits the combined `ymm` string on whitespace and takes the first token as the make, so a two-word make
loses its second word to the model. It is one vehicle today and it will be wrong for every Land Rover,
Alfa Romeo, Aston Martin or Mercedes-Benz that arrives.

**The 6 semantic matches** are case only: "NISSAN" against "Nissan", "Luxe" against "LUXE" on five
Infinitis. No action needed; recorded so the count reconciles.

## Missing sources

| Gap | Vehicles | Reading |
|---|---|---|
| `publicAdvertisement` has no candidate | 110 of 130 | Correct and expected. Only 20 vehicles have a website observation so far; the crawler is rotating a 57-car universe daily and new cars are held out by the seven-day refusal backoff. |
| `vehicle_value_history` query timed out | 50 of 130 | **A defect in the fetch layer, not in the data.** The model reported the gap rather than silently omitting the section, which is the behaviour that was designed, but the query needs an index or a tighter bound before Gate 3. |

## Source freshness

No resolved value came out STALE and no field came out CONFLICTED, on any of the 130 vehicles. That is a
consequence of the epoch-stamp fix: MarketCheck writes its timestamps as epoch seconds, the contract's date
reader could not parse them, and before the fix every feed-written value would have reported an unknown
observation time and aged as UNKNOWN. Freshness is now computed from each writer's own stamp.

## What the run found beyond parity

**74 of 130 vehicles are presented as having no open recalls when nobody knows.** Their `recall_payload`
carries `note: "no_nhtsa_record_http_400"` with an empty campaign list; `recall_status` is NULL and
`open_recall_count` is 0. Every reader of that column — the Vehicle File, the Passport, the Compliance
Center, delivery clearance — shows "no open recalls". The lookup failed; the failure was stored as a clean
answer. Verified independently of the read model by direct query. This is a compliance and safety finding,
not a parity finding, and it is the single most important thing this run surfaced.

**Query fan-out.** One vehicle costs 36 queries in a fixed, batched set, against roughly 89 requests and
about 35 tables from the browser today across five tabs. Payload 86 KB per vehicle.

## Verdict and next gate

Gate 2 passes: parity is 100% explained on the four fields the standard names, there are no unexplained
mismatches on any field, and the read model was never the wrong one. Two items should close before Gate 3
(Vehicle File V2 pilot enable):

1. The `vehicle_value_history` timeout on 50 vehicles.
2. The recall finding, which is not a Vehicle File problem and should not wait for one.

Nothing here proposes enabling V2 for any tenant. That is Gate 3 and it needs owner approval.
