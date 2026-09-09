# Gate 2.5 — Recall reconciliation DRY RUN

Read-only. Nothing in this document has been executed. No row was written, no
migration was applied, no function was deployed. Produced 2026-09-09 against
the live Supabase project `onnbmmdbrsgytfozfozn`, pilot tenant Harte Infiniti
`3f0f97f5-4151-4e32-88ef-e2d6fc5a3142`, 130 active (non-archived) listings, all
130 of them `status = 'published'`. Repository at `24f7cb06`; the Gate 2.5 code
and migrations exist as uncommitted files and are **not deployed**, so every
"today" statement below describes the code that is actually running.

---

## 0. The one thing this document must not do

A model-level NHTSA answer is not VIN-level clearance. Under the owner lock the
two questions are permanently separate:

| | question | states | who may answer |
|---|---|---|---|
| **VIN scope** | does THIS VIN have an applicable open recall? | `VERIFIED_CLEAR` / `OPEN` / `UNKNOWN` (`STALE` derived from the check date) | a VIN-level provider only |
| **MODEL scope** | does NHTSA hold campaigns for this year/make/model? | `MODEL_CAMPAIGNS_FOUND` / `NO_MODEL_CAMPAIGNS_FOUND` / `MODEL_NOT_FOUND` / `LOOKUP_FAILED` | NHTSA |

**Stated plainly, as the owner required: the VIN-scope state is `UNKNOWN` for all
130 active pilot vehicles, in every one of the six groups below, without
exception.** No VIN-level source has ever returned a recall list for this
tenant. That is not an inference — it is the stored evidence:

- `recall_payload->>'source'` across all 285 listings: `nhtsa` on 276, absent on 9.
  **Zero rows carry `marketcheck`.**
- The 9 rows without a `source` key are 5 rows whose payload carries
  `rawProvider = 'marketcheck_autorecalls'` with `"recalls": []`, and 4 whose
  payload carries `rawProvider = 'nhtsa'`. The 5 are *not* AutoRecalls answers;
  they are HTTP 404s converted into a clearance by
  `marketcheck-recalls/index.ts` (`if (res.status === 404) { return { ok: true,
  data: normalize(vin, { recalls: [] }) ... } }`, `fetchRecalls`). Three of those
  5 are in the active pilot 130, and all three are published customer pages
  today.

So the AutoRecalls product has produced **zero** recall lists and **five**
fabricated clearances. Everything else in this database is the free model-level
NHTSA fallback.

---

## 1. Verification I performed myself

The sandbox proxy blocks `api.nhtsa.gov`, so every probe below was issued from
the database with `net.http_get` and read back from `net._http_response`. All
are GETs against a public federal endpoint; no key, no secret, no write to any
application table.

### 1.1 Catalogue calls — the disambiguator

`GET /products/vehicle/models?modelYear=<y>&make=<m>&issueType=r`

The 130 active pilot vehicles reduce to **37 distinct (year, make) pairs** (129
vehicles; the 130th has a NULL `ymm` and no year at all). I made **37 catalogue
calls, one per distinct pair**, caching by pair. Caching saved 92 calls
(129 − 37). Every one of the 37 returned **HTTP 200**; none failed, so no group
below is contaminated by a catalogue outage.

Request ids `34143`–`34179` in `net._http_response`.

### 1.2 Corroboration calls

The catalogue alone was not sufficient, and finding out why changed the
classification (see §1.3). I made **55 further `recallsByVehicle` calls**:

- **18** reproducing the exact query the writer sent for each distinct
  (year, make, model) triple among the 74 zero rows — ids `34180`–`34197`.
  **All 18 returned HTTP 400 with `{"Count":0,"Message":"Results returned
  successfully","results":[]}` today**, byte-identical to the stored evidence.
  The stored state is reproducible, not a transient outage.
- **37** probing corrected model tokens and same-year/same-make controls —
  ids `34198`–`34208`, `34211`–`34230`, `34231`–`34236`.

**Total NHTSA calls made for this dry run: 92** (37 catalogue + 55 recalls).
Cost: zero — NHTSA is free.

### 1.3 A methodological finding that changed the answer

The catalogue and the recalls endpoint **do not share one model vocabulary**,
so catalogue membership alone would have misclassified rows in both directions.
Proof, from my own calls:

| year / make | catalogue holds | bare token to `recallsByVehicle` | catalogue token to `recallsByVehicle` |
|---|---|---|---|
| 2026 INFINITI | `QX80 ICE` | `QX80` → **200, Count 2** | `QX80 ICE` → 400, Count 0 |
| 2026 INFINITI | `QX60 ICE` | `QX60` → 400, Count 0 | `QX60 ICE` → 400, Count 0 |
| 2019 FORD | `TRANSIT VAN` (exact) | `Transit` → **200, Count 9** | `Transit Van` → 400, Count 0 |
| 2025 HONDA | `ACCORD SEDAN`, `ACCORD HYBRID` | `Accord` → 400, Count 0 | `Accord Sedan` → 400 · `Accord Hybrid` → **200, Count 2** |

Consequences, both applied below:

1. For 2026 INFINITI the accepted token is the **bare** name, proven by the
   QX80 control. So `2026 INFINITI QX60` returning 400/Count 0 is a **genuine
   zero**, not an unrecognised model — even though the catalogue spells it
   `QX60 ICE`.
2. `2019 Ford Transit Van` is an **exact** catalogue entry and still returns
   400/Count 0, while `Transit` returns 9 campaigns. The context note that
   assumed this was a genuine clear is wrong; it is our query that is wrong.

Every group-1 assignment below is therefore backed by a **same-year, same-make
control that returned HTTP 200**, so "zero campaigns" is never confused with
"the endpoint is not answering for this make/year".

---

## 2. Classification of every active pilot vehicle

130 rows. Groups are mutually exclusive and total exactly 130.

| # | group | rows |
|---|---|---|
| G1 | model recognised by NHTSA, zero campaigns returned | **42** |
| G2 | model NOT in the NHTSA catalogue | **25** |
| G3 | malformed make/model request — our own defect | **7** |
| G4 | provider failure (timeout, 5xx, unparseable) | **0** |
| G5 | known model campaigns found | **53** |
| G6 | other, or no attempt on record | **3** |
| | **total** | **130** |

### G1 — model recognised by NHTSA, zero campaigns returned (42)

Evidence per row: `recall_payload.note = 'no_nhtsa_record_http_400'`, source
`nhtsa`; the model **is** in the catalogue for its year+make (exact, or under
the 2026-INFINITI powertrain-suffix rule proven in §1.3); a same-year/same-make
control returns HTTP 200; the reproduction call today returns 400/Count 0.

| year / make / model sent | n | catalogue evidence | control |
|---|---|---|---|
| 2020 INFINITI Q50 | 1 | exact (`Q50` in 2020 list) | 2020 QX80 → open campaigns stored |
| 2023 INFINITI Q50 | 3 | exact | 2023 QX50 → open campaigns stored |
| 2025 INFINITI QX50 | 4 | exact (`QX50` in 2025 list) | 2025 QX60 → 200/1, QX80 → 200/4 |
| 2026 INFINITI QX60 | 10 | `QX60 ICE`, bare token accepted (§1.3) | 2026 QX80 → 200/2 |
| 2027 INFINITI QX60 | 20 | exact (`QX60` in 2027 list) | 2027 QX80 → 200/1 |
| 2021 Subaru Forester | 1 | exact | 2021 Outback → 200/4 |
| 2022 Toyota Corolla | 1 | exact | 2022 Camry → 200/1 |
| 2024 Volkswagen Jetta | 1 | exact | 2024 Tiguan → 200/2 |
| 2025 Mazda CX-5 | 1 | exact | 2025 CX-90 → 200/2 |

VINs (42):

```
2020 INFINITI Q50   JN1FV7AR5LM660049
2023 INFINITI Q50   JN1EV7CR5PM543599, JN1EV7CR8PM540616, JN1EV7CR9PM540897
2025 INFINITI QX50  3PCAJ5BB0SF103257, 3PCAJ5FB1SF109708, 3PCAJ5FB2SF105392, 3PCAJ5FB8SF104621
2026 INFINITI QX60  5N1AL1FS2TC330859, 5N1AL1FS7TC339685, 5N1AL1FS9TC358190, 5N1AL1FW1TC358803,
                    5N1AL1FW1TC358865, 5N1AL1FW2TC341119, 5N1AL1FW7TC357977, 5N1AL1FW8TC344302,
                    5N1AL1FWXTC358105, 5N1AL1HU0TC333564
2027 INFINITI QX60  5N1AL1E89VC331662, 5N1AL1F80VC330527, 5N1AL1F82VC330223, 5N1AL1F82VC339553,
                    5N1AL1F83VC332112, 5N1AL1F83VC338928, 5N1AL1F83VC338945, 5N1AL1F83VC338993,
                    5N1AL1F84VC332006, 5N1AL1F86VC331178, 5N1AL1F86VC332265, 5N1AL1F87VC331187,
                    5N1AL1F87VC332307, 5N1AL1F89VC339940, 5N1AL1F8XVC330826, 5N1AL1F90VC336143,
                    5N1AL1F96VC330170, 5N1AL1F96VC337944, 5N1AL1F9XVC330155, 5N1AL1HZ8VC342883
2021 Subaru Forester      JF2SKAJC9MH531918
2022 Toyota Corolla       5YFEPMAE0NP335131
2024 Volkswagen Jetta     3VWEM7BU8RM082795
2025 Mazda CX-5           JM3KFBCL5S0602539
```

### G2 — model NOT in the NHTSA catalogue (25)

The model we asked about does not exist in NHTSA's recall catalogue for that
year and make under any normalisation. NHTSA has no record of the vehicle line,
so it cannot say anything about it — the honest model-scope answer is
`MODEL_NOT_FOUND`, not zero.

| year / make / model sent | n | catalogue for that year+make | control |
|---|---|---|---|
| 2027 INFINITI QX65 | 22 | `QX60`, `QX80` only — no QX65 | 2027 QX80 → 200/1 |
| 2025 INFINITI QX55 | 3 | `QX50`, `QX60`, `QX80` only — no QX55 | 2025 QX60 → 200/1 |

VINs (25):

```
2027 INFINITI QX65  5N1AC0EX8VC603569, 5N1AC0FX0VC605623, 5N1AC0FX0VC607758, 5N1AC0FX2VC606224,
                    5N1AC0FX2VC607129, 5N1AC0FX4VC605169, 5N1AC0FX5VC605679, 5N1AC0FX5VC605746,
                    5N1AC0FX5VC605844, 5N1AC0FX5VC606038, 5N1AC0FX6VC605481, 5N1AC0FX6VC607554,
                    5N1AC0FX7VC605411, 5N1AC0FX7VC606820, 5N1AC0FX8VC605868, 5N1AC0FX9VC607600,
                    5N1AC0FX9VC607757, 5N1AC0JX1VC605072, 5N1AC0JX1VC606660, 5N1AC0JX3VC606305,
                    5N1AC0JX9VC600671, 5N1AC0JXXVC601120
2025 INFINITI QX55  3PCAJ5JR0SF106450, 3PCAJ5JR1SF103167, 3PCAJ5KR0SF101800
```

### G3 — malformed make/model request, our own defect (7)

**This is the most serious group and it is not the group anyone expected.** For
each of these seven vehicles I sent a string NHTSA does not accept as a model,
got 400/Count 0, and stored `open_recall_count = 0`. When I re-asked with the
correct token, NHTSA returned campaigns. **63 model campaigns are currently
hidden behind a stored zero on seven live, published cars.**

| VIN | ymm we sent | model token sent | correct token | today | corrected |
|---|---|---|---|---|---|
| `1FTYR2CM3KKB53305` | 2019 Ford Transit Van | `Transit Van` | `Transit` | 400 / 0 | **200 / 9 campaigns** |
| `1FMDE8BH9SLA76303` | 2025 Ford Bronco 4-Door | `Bronco 4-Door` | `Bronco` | 400 / 0 | **200 / 19** |
| `1C4HJXDN4PW657311` | 2023 Jeep Wrangler 4-Door | `Wrangler 4-Door` | `Wrangler` | 400 / 0 | **200 / 14** |
| `1C6SRFFT2NN400176` | 2022 RAM Ram 1500 Pickup | `Ram 1500 Pickup` | `1500` | 400 / 0 | **200 / 16** |
| `JM1NDAC72L0414832` | 2020 Mazda MX-5 Miata | `MX-5 Miata` | `MX-5` | 400 / 0 | **200 / 1** |
| `JTJBM7FX3J5192431` | 2018 Lexus GX | `GX` | `GX460` | 400 / 0 | **200 / 2** |
| `1HGCY2F59SA016460` | 2025 Honda Accord (trim `Hybrid Sport`) | `Accord` | `Accord Hybrid` | 400 / 0 | **200 / 2** |

Two distinct sub-causes, both ours, both needing different fixes:

- **G3a — a marketing/body-style token in the model field** (Transit **Van**,
  Bronco **4-Door**, Wrangler **4-Door**, **Ram** 1500 **Pickup**, MX-5
  **Miata**). Note that this is *not* a display-string splitting defect:
  `mc_attributes->>'model'` itself holds `"Wrangler 4-Door"`, `"Ram 1500
  Pickup"`, `"Transit Van"`. Using structured identity, as the owner lock
  requires, does not fix these — the structured field carries the marketing
  name. What is missing is a **provider vocabulary normalisation** between our
  model and NHTSA's.
- **G3b — a vocabulary granularity mismatch** (`GX` vs `GX460`, `Accord` vs
  `Accord Hybrid`). Our string is a real model name; NHTSA's token is more
  specific. The Honda case is the sharpest: the car's trim is `Hybrid Sport`,
  NHTSA holds 2 campaigns under `Accord Hybrid`, and we are showing zero.

`Accord` is accepted by NHTSA for 2023 and returns campaigns, and rejected for
2025 — so no static per-model mapping fixes this either. The catalogue call is
the only reliable resolver, which is why the built writer's per-(year, make)
cached catalogue lookup is the right shape.

### G4 — provider failure (timeout, 5xx, unparseable) — 0 rows

**Zero, and the zero itself is a finding.** Estate-wide across all 285 listings
there are exactly four payload shapes:

| `recall_payload->>'note'` | `source` | `rawProvider` | `recall_status` | rows |
|---|---|---|---|---|
| `no_nhtsa_record_http_400` | `nhtsa` | — | NULL | 123 |
| — | `nhtsa` | — | `open_recalls` | 153 |
| — | — | `nhtsa` | `open_recalls` | 4 |
| — | — | `marketcheck_autorecalls` | `clear` | 5 |

There is no note for a 5xx, a timeout or an unparseable body anywhere in the
estate. That is not because failures never happen: since commit `55f7cf1a`,
`fetchNhtsaRecalls` returns `null` on any non-200 and on a 200 without a results
array, and `vehicle-enrich` then **writes nothing at all**. A provider failure
therefore leaves no trace in the row — it is indistinguishable from "never
attempted". The absence of a G4 population is evidence of missing telemetry,
not evidence of a healthy provider.

### G5 — known model campaigns found (53)

`recall_payload.source = 'nhtsa'` with a non-empty `campaigns` array; NHTSA
returned HTTP 200 and real campaign records. Payload dates 2026-08-08 →
2026-09-09T03:08Z. Campaign counts 1–10.

| ymm | open_recall_count | n | VINs |
|---|---|---|---|
| 2015 INFINITI Q50 | 3 | 1 | `JN1BV7AR6FM406806` |
| 2017 INFINITI QX30 | 4 | 1 | `SJKCH5CR6HA024710` |
| 2018 Mazda CX-5 | 3 | 1 | `JM3KFBDM4J0373454` |
| 2018 Volvo XC90 | 3 | 1 | `YV4A22PK3J1375505` |
| 2019 Acura TLX | 6 | 1 | `19UUB2F6XKA007202` |
| 2019 Honda Accord | 6 | 1 | `1HGCV1F50KA083807` |
| 2020 Alfa Romeo Stelvio | 6 | 1 | `ZASPAKBN5L7C99407` |
| 2020 Chevrolet Equinox | 4 | 1 | `3GNAXUEV9LS593826` |
| 2020 Honda HR-V | 5 | 1 | `3CZRU6H59LM724411` |
| 2020 INFINITI QX80 | 2 | 1 | `JN8AZ2NE3L9254199` |
| 2021 Hyundai Sonata | 4 | 1 | `5NPEH4J21MH101448` |
| 2021 NISSAN Rogue | 10 | 1 | `5N1AT3CB7MC736556` |
| 2021 Nissan Sentra | 3 | 1 | `3N1AB8BV3MY259117` |
| 2021 Toyota C-HR | 1 | 1 | `NMTKHMBXXMR129285` |
| 2022 BMW X7 | 2 | 1 | `5UXCW2C03N9J22405` |
| 2022 Honda Civic | 4 | 1 | `2HGFE1F74NH314504` |
| 2023 GMC Terrain | 2 | 1 | `3GKALXEG9PL159028` |
| 2023 Honda Accord | 5 | 1 | `1HGCY1F3XPA041710` |
| 2023 INFINITI QX50 | 1 | 4 | `3PCAJ5BB3PF113420`, `3PCAJ5BB6PF110401`, `3PCAJ5BB8PF113283`, `3PCAJ5FB1PF122711` |
| 2023 INFINITI QX55 | 1 | 1 | `3PCAJ5JR2PF102214` |
| 2023 INFINITI QX60 | 3 | 2 | `5N1DL1FS8PC368244`, `5N1DL1GS6PC365387` |
| 2023 Subaru SOLTERRA | 4 | 3 | `JTMABABA1PA008560`, `JTMABABA1PA013354`, `JTMABABA5PA005774` |
| 2024 INFINITI QX60 | 3 | 1 | `5N1DL1FS6RC335049` |
| 2024 Kia Sorento | 2 | 1 | `5XYRLDJC9RG278742` |
| 2024 Kia Sportage | 3 | 1 | `5XYK6CDF1RG201968` |
| 2024 Toyota Venza | 1 | 1 | `JTEAAAAH8RJ158018` |
| 2026 INFINITI QX80 | 2 | 8 | `JN8AZ3AE0T9720795`, `JN8AZ3AE1T9720885`, `JN8AZ3BB8T9435718`, `JN8AZ3CC8T9621721`, `JN8AZ3CC9T9622022`, `JN8AZ3CCXT9624250`, `JN8AZ3DB3T9431184`, `JN8AZ3DB6T9435116` |
| 2026 Nissan Rogue | 2 | 1 | `5N1BT3BB2TC779545` |
| 2027 INFINITI QX80 | 1 | 12 | `JN8AZ3BB0V9451110`, `JN8AZ3BB1V9451052`, `JN8AZ3BB3V9450369`, `JN8AZ3BB4V9450493`, `JN8AZ3BB7V9451105`, `JN8AZ3BE9V9730002`, `JN8AZ3BEXV9730011`, `JN8AZ3CC4V9640124`, `JN8AZ3DB0V9452464`, `JN8AZ3DB7V9451165`, `JN8AZ3DB9V9450387`, `JN8AZ3DB9V9450437` |

**No campaign in any of these 53 payloads contains do-not-drive, stop-sale,
park-outside or fire-risk language** (regex over `recall_payload::text`: 0 rows).
So nothing in this correction can retroactively unpublish a car, in either
direction. That is verified, not assumed.

### G6 — other, or no attempt on record (3)

The three fabricated clearances. `recall_status = 'clear'`,
`open_recall_count = 0`, `closed_recall_count = 0`, `recall_checked_at` set,
`recall_check = {checked_at, has_open:false, do_not_drive:false, campaigns:[]}`,
`recall_payload = {vin, recalls: [], recallStatus: "clear", openRecallCount: 0,
closedRecallCount: 0, emissionIssueCount: 0, serviceCampaignCount: 0, checkedAt,
rawProvider: "marketcheck_autorecalls"}`.

| VIN | ymm | check date | fresh <30d today | how it was produced |
|---|---|---|---|---|
| `JN8AZ3CC5T9624253` | **NULL** | 2026-09-04T16:43:52Z | **yes** | MarketCheck HTTP 404 → clear; `ymm` NULL so `fetchNhtsa` returned null and no NHTSA attempt was possible at all |
| `5N1AL1F94VC330815` | 2027 INFINITI QX60 | 2026-06-29T15:43:31Z | no | MarketCheck 404 → clear; NHTSA returned 400 and was discarded |
| `5N1AL1F81VC331105` | 2027 INFINITI QX60 | 2026-06-29T15:43:25Z | no | as above |

These are in G6 rather than G1/G2 because **no NHTSA model answer is stored on
them at all** — `recall_payload` holds a VIN-level MarketCheck object, not a
model answer. Stamping them with a model state would be fabricating an attempt
that never landed.

Note also that `fetchRecalls` discards `raw: { status: 404 }` — it is not
persisted — so the row does not even record **which** of the four candidate
endpoints 404'd. That evidence is already lost and cannot be recovered by any
SQL.

---

## 3. Per-group state under the locked model, with exact stored values

`open_recall_count`, `closed_recall_count`, `recall_status`, `recall_checked_at`
and `recall_check` are the **VIN-scope** columns. `recall_payload` is the
**MODEL-scope** store. The VIN-scope answer is `UNKNOWN` in all six groups.

### G1 — 42 rows

- **VIN scope: `UNKNOWN`.** No VIN-level source has answered. Source used: none.
- **MODEL scope: `NO_MODEL_CAMPAIGNS_FOUND`.** Source: NHTSA
  `recallsByVehicle`, disambiguated by NHTSA `products/vehicle/models`.
- Before → after:

| column | before | after |
|---|---|---|
| `recall_status` | `NULL` (33) / `NULL` (9) | `NULL` (unchanged) |
| `open_recall_count` | `0` | `NULL` |
| `closed_recall_count` | `NULL` (33) / `0` (9) | `NULL` |
| `recall_checked_at` | `NULL` | `NULL` (unchanged) |
| `recall_check` | `NULL` | `NULL` (unchanged) |
| `recall_payload` | `{note:'no_nhtsa_record_http_400', source:'nhtsa', campaigns:[], checked_at:…}` | same keys **untouched**, plus `scope:'model'`, `state:'no_model_campaigns_found'`, `queried:{year,make,model}`, `catalogue:{status:'in_catalogue', matched_model, match_rule, verified_at}` |

### G2 — 25 rows

- **VIN scope: `UNKNOWN`.** Source used: none.
- **MODEL scope: `MODEL_NOT_FOUND`.** Source: NHTSA models catalogue (HTTP 200,
  model absent).
- Before → after: identical column moves to G1 (`open_recall_count 0 → NULL`,
  `closed_recall_count NULL/0 → NULL`), payload gains
  `state:'model_not_found'` and `catalogue:{status:'not_in_catalogue',
  catalogue_models:[…], verified_at}`.

### G3 — 7 rows

- **VIN scope: `UNKNOWN`.** Source used: none.
- **MODEL scope: `LOOKUP_FAILED`.** Source: NHTSA — the request was invalid on
  our side, so NHTSA never answered the question we meant to ask. This is
  deliberately **not** `MODEL_NOT_FOUND`: the model exists and has campaigns.
- Before → after: counts withdrawn as above; payload gains
  `state:'lookup_failed'`, `failure:'malformed_model_token'`,
  `queried.model` (what we sent), `corrected_model_token`,
  `campaigns_missed_at_corrected_token` (9 / 19 / 14 / 16 / 1 / 2 / 2) and
  `verified_at`. **No campaign body is written**, because the corrected lookup
  has not been run by the writer — recording campaigns here would be
  manufacturing an answer this dry run only probed.

### G4 — 0 rows

Nothing to state. Recommended action is telemetry, not data: record the HTTP
status and body prefix on a failed lookup so this group can ever be non-empty.

### G5 — 53 rows

- **VIN scope: `UNKNOWN`.** The `open_recalls` status and the 1–10 counts on
  these rows were derived from a **model-level** answer and are being read
  everywhere as VIN-specific. Source used for a VIN-level answer: none.
- **MODEL scope: `MODEL_CAMPAIGNS_FOUND`,** 1–10 campaigns each, source NHTSA,
  `checked_at` 2026-08-08 → 2026-09-09.
- Before → after:

| column | before | after |
|---|---|---|
| `recall_status` | `'open_recalls'` | `NULL` |
| `open_recall_count` | `1`–`10` | `NULL` |
| `closed_recall_count` | `NULL` (46) / `0` (7) | `NULL` |
| `recall_checked_at` | `NULL` (46) / set (7) | `NULL` |
| `recall_check` | `NULL` (46) / `{checked_at, has_open:true, do_not_drive:false, campaigns:[…]}` (7) | `NULL` (46) / same object with `checked_at` **renamed** `attempted_at`, plus `scope:'vin'`, `state:'unknown'`, `source`, `note` (7) |
| `recall_payload` | `{source:'nhtsa', campaigns:[…], checked_at}` | **campaigns untouched**, plus `scope:'model'`, `state:'model_campaigns_found'`, `campaign_count`, `queried`, `catalogue`, `verified_at` |

**The warning is not lost, and this is the load-bearing part.** All 156 open
`recall_service_tasks` for this tenant survive the change untouched, and the
publish gate reads those tasks, not the column. After migration
`20260909110000` is applied, `fire_recall_service_task` raises from
`recall_payload` in state `model_campaigns_found`, so the same campaigns keep
raising the same tasks with the same signature. What is withdrawn is only the
VIN-level *assertion* — "this car has 6 open recalls" — which no VIN-level
source ever supported.

### G6 — 3 rows

- **VIN scope: `UNKNOWN`.** Source *attempted*: MarketCheck AutoRecalls, which
  returned HTTP 404 (no record) — and a 404 is an absence of record, never a
  clearance. This is the same "absence means clear" defect as the NHTSA 400,
  in the licensed path.
- **MODEL scope: no answer on record.** For `JN8AZ3CC5T9624253` no model query
  was even possible (`ymm` is NULL). For the two 2027 QX60s a model query was
  made and discarded.
- Before → after (this is migration `20260909110000`'s second UPDATE; listed
  here for completeness because it is part of the same reconciliation):

| column | before | after |
|---|---|---|
| `recall_status` | `'clear'` | `'unknown'` |
| `open_recall_count` / `closed_recall_count` | `0` / `0` | `NULL` / `NULL` |
| `recall_checked_at` | set | `NULL` |
| `recall_check` | `{checked_at, has_open:false, do_not_drive:false, campaigns:[]}` | `{campaigns:[], do_not_drive:false, scope:'vin', state:'unknown', source:'marketcheck_autorecalls', attempted_at:<the same timestamp>, note:'marketcheck_absence_recorded_as_clear_withdrawn'}` |
| `recall_payload` | MarketCheck normalized object | **untouched** — it is the provider response and stays as evidence |

`checked_at` becomes `attempted_at` rather than being deleted: the attempt is
preserved, but it can no longer satisfy `listings_with_stale_recalls`' 30-day
freshness test or any reader keyed on a check date.

### Freshness after the correction

Today 2 of the 130 pilot rows are "fresh" under `listings_with_stale_recalls`
(`recall_check->>'checked_at'` within 30 days): `JN8AZ3CC5T9624253` (a
fabricated clear) and `5N1AT3CB7MC736556` (2026-08-19). After the correction
**0 of 130** are fresh and all 130 report `missing`. That is the correct
reading: no VIN-level recall check has ever been completed for this tenant.
The worklist getting longer is the honest outcome, not a regression.

---

## 4. What each existing reader shows, per group

Line references are to the code running today (`24f7cb06`). "Will show" is what
the built-but-undeployed Gate 2.5 readers produce once the correction lands.
Only the ten surfaces the owner named are listed.

Because G1/G2/G3 are identical in the stored columns today (`recall_status`
NULL, `open_recall_count` 0, no `recall_check`), they render identically today
and differ only in the *reason* shown afterwards.

| reader | G1 (42) today → after | G2 (25) today → after | G3 (7) today → after | G5 (53) today → after | G6 (3) today → after |
|---|---|---|---|---|---|
| **Vehicle File** — readiness checklist `types.ts:137` `!!(recall_status \|\| recall_check)`; `RecallCard.tsx:118-122` | "Recall checked" **unticked**; grey card "Not checked yet" → relabelled "**Recall verified for this VIN**", still unticked; card gains a fourth state "**Not verified**" naming the model context "NHTSA holds no campaigns for 2027 INFINITI QX60" | same → "Not verified · **NHTSA has no record of this model**" | same → "Not verified · **our query was malformed; NHTSA holds 14 campaigns under `Wrangler`**" | **ticked** (status non-null); grey/neutral card → **unticked**; card shows model-scope campaigns and a blocker naming the VIN scope | **ticked**, **emerald "Clear · No active recalls"** → **unticked**, "Not verified — a MarketCheck 404 was recorded as a clearance" |
| **Passport** (`/v/:slug`, locked layout) — `verificationSummary.ts:84,281,461`; `passportV2Data.ts:605-607,753`; `PassportPanel.tsx:1626,2202`; `vehicleInsights.ts:68-70`; `PublicListing.tsx:628` | recall check already **pending** (status is NULL) — **but** Vehicle Strengths shows an emerald "**No open recalls**" badge off `open_recall_count === 0`, and the price-confidence bullet "**No open safety recalls**" is pushed with no gate at all → **both suppressed**; check reads "Recall verification is unavailable for this VIN", with the model finding as context | same → same, model finding reads "NHTSA has no record of this model line" | same → same, and this is the group where the badge was actively **false** — 63 campaigns hidden | pending; no green claim; confidence score already deducts 12 → unchanged in outcome; deduction now keyed on `riskSignalled` at any scope so it survives the count being withdrawn | **green "Recall — Verified", "No open safety recalls found in NHTSA campaigns as of 29 Jun 2026", "No Recalls / NHTSA checked" chip, "No open recalls" Why-Buy bullet, "no open recalls are reported"** → **all removed**; check becomes pending, "Recall verification is unavailable for this VIN" |
| **Compliance Center** — `complianceData.ts:587-600` `openRecalls = open_recall_count ?? 0` | zero raises **no exception**: the car passes compliance silently → new **attention** exception "Recall verification unavailable for this VIN" | same → same, carrying `MODEL_NOT_FOUND` | same → same, plus the malformed-query cause | **critical** "N open NHTSA recalls" → **critical**, relabelled "open model campaigns · **VIN scope unverified**" (severity preserved) | passes silently → **attention** exception |
| **Delivery clearance** — `clearance.ts:57-58`, `workspaceStatus.ts:56`, `serviceStatus.ts:66` | the `do_not_drive` substring test runs against `recall_status`, which only ever holds `clear`/`open_recalls` — **the test is dead and has never blocked anything** → reads `recall.doNotDrive` from stored evidence; still **does not block** (no do-not-drive text on any pilot row, verified) | same → same | same → same | same → same; blocks **more** than today only if a do-not-drive campaign ever arrives | same → same; the difference is it can no longer *clear* on a model-level or absent answer |
| **Inventory** — `InventoryModern.tsx:362-363,415,1069-1085,1128`; `InventoryCommandCenterV2.tsx:49-51` | grey chip (status NULL); excluded from the open-recall filter; counted as "readiness met" because `!openRecall` → grey chip relabelled "**Recall Unverified**"; still excluded from the open filter; **no longer** counted toward readiness | same → same | same → same | emerald? no — orange/red "N Open Recalls", in the open-recall filter, readiness fail → **unchanged in effect**: `riskSignalled` reads the model campaigns, so the chip, the filter and the lot counter all still fire | **emerald "No Recalls"** and counted as clear → grey "**Recall Unverified**" |
| **Get Ready / Service** — `ServiceQueue.tsx`, `ServiceVehicleWorkspace.tsx`, `vinPackage.ts:105-123`, `recall_service_tasks` | Command Center recall row: `openCount` falls back to 0 → green "**Ready · no open recalls**" → "**pending · VIN recall verification unavailable**" | same → same | same → same | open task → `retry_required`/`blocked`; publish blocked by the open task → **unchanged**; the 156 open tasks are not touched and the rewritten trigger keeps raising from model scope | green "Ready · Checked 04 Sep 2026 · no open recalls" → **pending** |
| **AutoFilm (sister-app lot feed)** — `_shared/lotFeedRow.ts` ships `recall_status`, `open_recall_count`, `recall_payload` raw | AutoFilm receives `open_recall_count: 0` as a fact about the car → receives `recall_status: null`, `open_recall_count: null`, plus a `recall` object with `vin` (unknown), `model_campaign_context`, `do_not_drive`, `campaigns` | same → same | same → same | receives `open_recalls` / N → receives `recall_status:'open_recalls'` (a warning is never withheld) with `open_recall_count: null` and the model context | receives `clear` / `0` → `null` / `null` |
| **Description Intelligence** — `_shared/description-core.ts:413-418` | `if (listing.recall_status)` is false → fact **omitted** entirely → fact emitted as `status:"pending"` with both scopes; `usable_in_copy:false` unchanged | same → same | same → same | fact emitted `status:"verified", source:"nhtsa/marketcheck"` for a model-level answer → `status:"pending"`, real provider, both scopes | fact emitted `status:"verified"` off a 404 → `status:"pending"` |
| | | | | | |
| **Reports — audit-defence packet** `auditPacket.ts:283-285,313-314` | calls `nhtsa-recall` live at packet time; `openRecallCount = Array.isArray(recalls) ? length : 0`, so a failed lookup prints "**Open recalls: 0**" in a compliance record → `open_recall_count` is `null` unless a VIN check answered and renders "**Not verified**"; new `recall_vin_state`, `recall_model_state`, `recall_campaigns_on_record` | same → same | same → same | prints the campaign count → prints it as model-scope evidence, VIN state "not verified" | prints 0 → "Not verified" |
| **Reports — customer document packet** `PublicDocuments.tsx:215-221` | `open = open_recall_count ?? 0` → `on_file` "**No Open Recalls — NHTSA Verified**" | same → `coming_soon` "Recall Verification Unavailable" + reason | same → same | `action_required` "Recall Pending — See Dealer" → unchanged | `on_file` "No Open Recalls — NHTSA Verified" → `coming_soon` |
| **Reports — MarketCheck data-health** `MarketcheckDataHealthCard.tsx:64` | `!!recall_status` false → not counted → unchanged | same | same | counted as MarketCheck recall coverage **though MarketCheck has never answered** → not counted; panel relabelled "Recalls (VIN-level)" and honestly reports **0 %** | counted → not counted |

### The three worst live consequences, stated plainly

1. **`PublicListing.tsx:628`** pushes the price-confidence bullet "No open
   safety recalls" on `recallCount === 0` **with no gate whatsoever** — not even
   the `recall_check.checked_at` gate that guards the badge two lines earlier.
   All 74 unverified cars carry that bullet today.
2. **`vehicleInsights.ts:68-70`** renders an emerald "No open recalls" strength
   badge on `open_recall_count === 0`. Same 74 cars, on the locked Passport and
   in the AutoFilm talking points.
3. **The three G6 cars** make a full green "Verified · No open safety recalls
   found in NHTSA campaigns" claim on a published customer page, derived from an
   HTTP 404. One of them has a NULL `ymm`, so no recall query of any kind has
   ever been made about it.

---

## 5. Corrective SQL — NOT EXECUTED

### 5.1 Ordering and preconditions

1. Migration `20260909110000_recall_two_scope_semantics.sql` **must be applied
   first**. It (a) withdraws the 123 estate-wide unfounded zeros, (b) demotes
   the 5 fabricated clears including this tenant's 3, (c) adds the five CHECK
   constraints, and (d) re-points `fire_recall_service_task` at
   `recall_payload` state `model_campaigns_found`. Running §5.3 before (d) would
   withdraw `open_recall_count` on the 53 G5 rows while the trigger still keys on
   that column, and no new task could be raised afterwards.
2. §5.3 is **idempotent**: every UPDATE is predicate-guarded on the absence of
   the `scope` key and becomes a no-op on a second run.
3. Scope. The classification below is evidence-bound to the **130 active pilot
   rows I verified**. The G1/G2/G3 statements depend on catalogue calls I made
   for this tenant's 37 (year, make) pairs, so those three UPDATEs address VINs
   explicitly. G5 is predicate-safe estate-wide (a non-empty NHTSA campaigns
   array is `MODEL_CAMPAIGNS_FOUND` regardless of catalogue) and is written that
   way, covering 157 estate rows. The remaining 49 estate `http_400` rows outside
   the pilot are left **unstamped** — their counts are already withdrawn by the
   migration, so they are safe, but they must be classified with their own
   catalogue calls before they are given a model state. Do not blanket-relabel
   them.

### 5.2 How the original provider response is preserved — three mechanisms

1. **Preservation in place.** Not one existing key of `recall_payload` is
   deleted, renamed or rewritten. `source`, `checked_at`, `note`, `campaigns`
   (and, on the G6 rows, the whole MarketCheck object) survive byte-for-byte.
   The envelope keys are **added alongside** with `||`. Read the payload after
   the change and you still read exactly what the provider returned.
2. **An append-only pre-image in `audit_log`.** Step 1 writes one
   `recall_scope_reclassified` row per corrected VIN carrying the complete
   before-state (`recall_status`, both counts, `recall_checked_at`,
   `recall_payload`, `recall_check`) plus the group, the evidence and the NHTSA
   request ids. History is not rewritten; a second record is added beside it.
3. **No fabricated check date.** Every timestamp written is either copied from
   the row's own existing evidence or is `verified_at` — the time *I* made the
   catalogue call, explicitly labelled as a classification event, never as a
   recall check. No `checked_at` is created anywhere. The 7 G5 rows that carry a
   `recall_check.checked_at` have it **renamed** to `attempted_at`, the same
   demotion the migration applies to the 5 clears, so an unanswered VIN lookup
   can never satisfy the publish gate's 30-day freshness test. After this runs,
   `listings_with_stale_recalls` reports 130 of 130 as `missing` — which is true.

### 5.3 The SQL

```sql
-- ─────────────────────────────────────────────────────────────────────
-- GATE 2.5 — recall row reclassification.
-- PRECONDITION: 20260909110000_recall_two_scope_semantics.sql applied.
-- DO NOT RUN WITHOUT OWNER SIGN-OFF ON THIS DRY RUN.
--
-- Evidence: 37 NHTSA models-catalogue calls (one per distinct year+make,
-- all HTTP 200) and 55 recallsByVehicle calls made 2026-09-09 from this
-- database via net.http_get; net._http_response ids 34143-34236.
-- ─────────────────────────────────────────────────────────────────────
BEGIN;

-- ── 0. Guard: refuse to run before the two-scope migration ───────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vehicle_listings_recall_payload_is_model_scope') THEN
    RAISE EXCEPTION
      'apply 20260909110000_recall_two_scope_semantics.sql first: the model-scope constraint is absent';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'recall_model_open_count') THEN
    RAISE EXCEPTION
      'apply 20260909110000 first: fire_recall_service_task cannot yet raise from a model-scope payload';
  END IF;
END $$;

-- ── 1. Pre-image, append-only. This is the evidence record. ──────────
INSERT INTO public.audit_log (action, entity_type, entity_id, store_id, details)
SELECT 'recall_scope_reclassified', 'vehicle_listing', v.vin, v.tenant_id::text,
       jsonb_build_object(
         'gate', 'gate_2_5',
         'classified_at', now(),
         'evidence', 'nhtsa models catalogue + recallsByVehicle, net._http_response 34143-34236',
         'before', jsonb_build_object(
           'recall_status',       v.recall_status,
           'open_recall_count',   v.open_recall_count,
           'closed_recall_count', v.closed_recall_count,
           'recall_checked_at',   v.recall_checked_at,
           'recall_payload',      v.recall_payload,
           'recall_check',        v.recall_check))
  FROM public.vehicle_listings v
 WHERE v.tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'
   AND v.status IS DISTINCT FROM 'archived'
   AND NOT (coalesce(v.recall_payload, '{}'::jsonb) ? 'scope');
-- expected: 130 rows

-- ── 2. G1 — model recognised, zero campaigns (42 rows) ───────────────
-- open_recall_count/closed_recall_count are already NULL after 20260909110000;
-- they are restated here so this script is correct if run standalone.
UPDATE public.vehicle_listings v
   SET open_recall_count   = NULL,
       closed_recall_count = NULL,
       recall_payload = v.recall_payload || jsonb_build_object(
         'scope', 'model',
         'state', 'no_model_campaigns_found',
         'campaign_count', 0,
         'queried', jsonb_build_object('year', c.y, 'make', c.mk, 'model', c.md),
         'catalogue', jsonb_build_object(
           'status', 'in_catalogue',
           'matched_model', c.matched,
           'match_rule', c.rule,
           'control_model', c.control,
           'verified_at', '2026-09-09T00:00:00Z'))
  FROM (VALUES
    ('2020','INFINITI','Q50','Q50','catalogue_exact','2020 QX80 (campaigns stored)'),
    ('2023','INFINITI','Q50','Q50','catalogue_exact','2023 QX50 (campaigns stored)'),
    ('2025','INFINITI','QX50','QX50','catalogue_exact','2025 QX60 HTTP 200 count 1'),
    ('2026','INFINITI','QX60','QX60 ICE','catalogue_powertrain_suffix','2026 QX80 HTTP 200 count 2'),
    ('2027','INFINITI','QX60','QX60','catalogue_exact','2027 QX80 HTTP 200 count 1'),
    ('2021','Subaru','Forester','FORESTER','catalogue_exact','2021 Outback HTTP 200 count 4'),
    ('2022','Toyota','Corolla','COROLLA','catalogue_exact','2022 Camry HTTP 200 count 1'),
    ('2024','Volkswagen','Jetta','JETTA','catalogue_exact','2024 Tiguan HTTP 200 count 2'),
    ('2025','Mazda','CX-5','CX-5','catalogue_exact','2025 CX-90 HTTP 200 count 2')
  ) AS c(y, mk, md, matched, rule, control)
 WHERE v.tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'
   AND v.status IS DISTINCT FROM 'archived'
   AND v.ymm = c.y || ' ' || c.mk || ' ' || c.md
   AND v.recall_status IS NULL
   AND v.recall_payload->>'note' = 'no_nhtsa_record_http_400'
   AND NOT (v.recall_payload ? 'scope');
-- expected: 42 rows

-- ── 3. G2 — model not in the NHTSA catalogue (25 rows) ───────────────
UPDATE public.vehicle_listings v
   SET open_recall_count   = NULL,
       closed_recall_count = NULL,
       recall_payload = v.recall_payload || jsonb_build_object(
         'scope', 'model',
         'state', 'model_not_found',
         'queried', jsonb_build_object('year', c.y, 'make', c.mk, 'model', c.md),
         'catalogue', jsonb_build_object(
           'status', 'not_in_catalogue',
           'catalogue_models', c.models,
           'control_model', c.control,
           'verified_at', '2026-09-09T00:00:00Z'))
  FROM (VALUES
    ('2027','INFINITI','QX65','QX60, QX80','2027 QX80 HTTP 200 count 1'),
    ('2025','INFINITI','QX55','QX50, QX60, QX80','2025 QX60 HTTP 200 count 1')
  ) AS c(y, mk, md, models, control)
 WHERE v.tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'
   AND v.status IS DISTINCT FROM 'archived'
   AND v.ymm = c.y || ' ' || c.mk || ' ' || c.md
   AND v.recall_status IS NULL
   AND v.recall_payload->>'note' = 'no_nhtsa_record_http_400'
   AND NOT (v.recall_payload ? 'scope');
-- expected: 25 rows

-- ── 4. G3 — our own malformed model token (7 rows) ───────────────────
-- No campaign body is written. The corrected lookup has not been run by the
-- writer, and this script must not manufacture an answer it only probed.
UPDATE public.vehicle_listings v
   SET open_recall_count   = NULL,
       closed_recall_count = NULL,
       recall_payload = v.recall_payload || jsonb_build_object(
         'scope', 'model',
         'state', 'lookup_failed',
         'failure', 'malformed_model_token',
         'queried', jsonb_build_object('year', c.y, 'make', c.mk, 'model', c.sent),
         'catalogue', jsonb_build_object(
           'status', 'query_not_in_vocabulary',
           'corrected_model_token', c.fixed,
           'campaigns_at_corrected_token', c.n,
           'sub_cause', c.cause,
           'verified_at', '2026-09-09T00:00:00Z'))
  FROM (VALUES
    ('1FTYR2CM3KKB53305','2019','Ford','Transit Van','Transit',9,'marketing_body_token'),
    ('1FMDE8BH9SLA76303','2025','Ford','Bronco 4-Door','Bronco',19,'marketing_body_token'),
    ('1C4HJXDN4PW657311','2023','Jeep','Wrangler 4-Door','Wrangler',14,'marketing_body_token'),
    ('1C6SRFFT2NN400176','2022','RAM','Ram 1500 Pickup','1500',16,'make_repeated_in_model'),
    ('JM1NDAC72L0414832','2020','Mazda','MX-5 Miata','MX-5',1,'marketing_body_token'),
    ('JTJBM7FX3J5192431','2018','Lexus','GX','GX460',2,'vocabulary_granularity'),
    ('1HGCY2F59SA016460','2025','Honda','Accord','Accord Hybrid',2,'vocabulary_granularity')
  ) AS c(vin, y, mk, sent, fixed, n, cause)
 WHERE v.vin = c.vin
   AND v.tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'
   AND v.recall_status IS NULL
   AND NOT (v.recall_payload ? 'scope');
-- expected: 7 rows

-- ── 5. G5 — model campaigns found; withdraw the VIN-level assertion ──
-- Predicate-safe estate-wide: a non-empty NHTSA campaigns array is a model
-- answer whatever the catalogue says. The campaigns array is NOT touched.
-- fire_recall_service_task (as rewritten by 20260909110000) fires on this
-- UPDATE and refreshes the same task from the same campaigns.
UPDATE public.vehicle_listings v
   SET recall_status       = NULL,
       open_recall_count   = NULL,
       closed_recall_count = NULL,
       recall_checked_at   = NULL,
       recall_payload = v.recall_payload || jsonb_build_object(
         'scope', 'model',
         'state', 'model_campaigns_found',
         'campaign_count', jsonb_array_length(v.recall_payload->'campaigns'),
         'queried', jsonb_build_object('ymm', v.ymm),
         'catalogue', jsonb_build_object(
           'status', 'answered_200',
           'note', 'NHTSA returned campaigns for this year/make/model; scope is the model line, not this VIN',
           'verified_at', '2026-09-09T00:00:00Z')),
       recall_check = CASE
         WHEN v.recall_check IS NULL THEN NULL
         ELSE (v.recall_check - 'checked_at') || jsonb_build_object(
           'scope', 'vin',
           'state', 'unknown',
           'source', coalesce(v.recall_payload->>'source', v.recall_payload->>'rawProvider', 'nhtsa'),
           'attempted_at', coalesce(v.recall_check->>'checked_at', v.recall_payload->>'checked_at'),
           'note', 'model_level_answer_recorded_as_vin_check_withdrawn')
       END
 WHERE v.recall_status = 'open_recalls'
   AND jsonb_typeof(v.recall_payload->'campaigns') = 'array'
   AND jsonb_array_length(v.recall_payload->'campaigns') > 0
   AND NOT (v.recall_payload ? 'scope');
-- expected: 53 rows in the pilot tenant, 157 estate-wide

-- ── 6. G6 — the 3 fabricated clears ──────────────────────────────────
-- No statement here. 20260909110000's second UPDATE already demotes them,
-- and their recall_payload is a VIN-level MarketCheck response that must
-- stay exactly as it is. Stamping a model state on them would fabricate an
-- NHTSA attempt that never landed (one of the three has a NULL ymm, so no
-- model query was ever possible).

-- ── 7. Verification ──────────────────────────────────────────────────
-- 7a. Nobody may still hold a count without a VIN-level answer.
SELECT count(*) AS must_be_zero
  FROM public.vehicle_listings
 WHERE (open_recall_count IS NOT NULL OR closed_recall_count IS NOT NULL)
   AND recall_status NOT IN ('verified_clear', 'open_recalls');

-- 7b. The pilot's six groups, after.
SELECT recall_payload->>'scope' AS scope,
       recall_payload->>'state' AS model_state,
       recall_status            AS vin_state,
       count(*)
  FROM public.vehicle_listings
 WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'
   AND status IS DISTINCT FROM 'archived'
 GROUP BY 1, 2, 3 ORDER BY 4 DESC;
-- expected: model/no_model_campaigns_found/NULL 42; model/model_not_found/NULL 25;
--           model/model_campaigns_found/NULL 53; model/lookup_failed/NULL 7;
--           NULL/NULL/unknown 3

-- 7c. No block was lost.
SELECT count(*) AS open_tasks_still_open
  FROM public.recall_service_tasks
 WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142' AND status = 'open_review';
-- expected: >= 156 (the pre-change count)

-- 7d. No unearned freshness survives.
SELECT count(*) AS must_be_zero
  FROM public.vehicle_listings
 WHERE tenant_id = '3f0f97f5-4151-4e32-88ef-e2d6fc5a3142'
   AND status IS DISTINCT FROM 'archived'
   AND recall_check ? 'checked_at';

-- 7e. The pre-image exists for every corrected row.
SELECT count(*) FROM public.audit_log WHERE action = 'recall_scope_reclassified';
-- expected: 130

COMMIT;
```

### 5.4 Rollback

```sql
-- Every before-state is in audit_log; this restores from it.
UPDATE public.vehicle_listings v
   SET recall_status       = (a.details->'before'->>'recall_status'),
       open_recall_count   = (a.details->'before'->>'open_recall_count')::int,
       closed_recall_count = (a.details->'before'->>'closed_recall_count')::int,
       recall_checked_at   = (a.details->'before'->>'recall_checked_at')::timestamptz,
       recall_payload      =  a.details->'before'->'recall_payload',
       recall_check        =  a.details->'before'->'recall_check'
  FROM public.audit_log a
 WHERE a.action = 'recall_scope_reclassified'
   AND a.entity_id = v.vin
   AND v.tenant_id::text = a.store_id;
-- Requires the CHECK constraints from 20260909110000 to be dropped first,
-- because the before-state violates them by construction. That is the point.
```

### 5.5 Side effects the owner should decide on before this runs

1. **The enrich queue grows to all 130.** `next_enrich_batch` re-queues on
   `vl.recall_status IS NULL`. Today 74 pilot rows are permanently in that
   queue; after §5.3 all 130 are (the 53 G5 rows join it, the 3 G6 rows leave
   it because the migration sets them to `'unknown'`). At the map's ~$0.17 per
   `vehicle-enrich` VIN visit that is ~$22 per full pass instead of ~$13, of
   which $9.10 is 130 AutoRecalls calls that return nothing until the terms are
   accepted. Setting `recall_status = 'unknown'` instead of `NULL` would keep
   them out of the queue — but would also stop the model context refreshing.
   **Note the inconsistency in the built work:** `recallState.ts` writes `NULL`
   for an unknown VIN lookup deliberately, while migration `20260909110000`
   writes `'unknown'` for the 5 demoted clears. One of the two should change.
2. **`do_not_drive` is not being derived from the 53 campaign bodies.** It
   would be a new block on historic rows, and the owner forbade new policy.
   It is moot today — 0 pilot payloads contain do-not-drive language — but the
   rewritten `unpublish_on_do_not_drive_recall` reads `recall_payload`, so if a
   future backfill ever sets that key on a published car it will unpublish it.
3. **The stale-recall worklist goes from 128 to 130.** Correct, and it will
   stay at 130 until a VIN-level source answers.

---

## 6. The owner's four questions

### 6.1 Are the AutoRecalls terms the only blocker, or is something else required?

**No — the terms are necessary but demonstrably not sufficient. At least four
further things are required, three of them in our own code.**

Evidence:

1. **The terms.** `vehicle-enrich/index.ts:627-631`: "MarketCheck recalls come
   from the licensed 3rd-party AutoRecalls product, which returns nothing until
   that product's terms are accepted in the MarketCheck portal." The acceptance
   state itself is recorded as Unknown #8 in
   `PROVIDER_COST_AND_ENTITLEMENT_MAP.md` — it is not in the repo.
2. **The endpoint is unverified.** `marketcheck-recalls/index.ts` does not know
   the path: it tries **four** candidates in order
   (`/v2/recall/car/{vin}`, `https://mc-api.marketcheck.com/v2/recall/car/{vin}`,
   `/v2/recall/car?vin=`, `/v2/recalls/car/{vin}`) "so the feature works without
   a docs round-trip". Something answered **404** for the 5 estate rows, and
   `raw: { status: 404 }` is discarded rather than persisted, so we do not know
   which. A 404 from a wrong path and a 404 from an unentitled product are
   indistinguishable in our data. The UI already anticipates this:
   `RecallCard.tsx:140` — "MarketCheck recall endpoint not reachable — likely no
   AutoRecalls access on the key."
3. **The 404-as-clear defect must be fixed first.** Today, the moment
   AutoRecalls is switched on, any VIN it does not hold still becomes a
   clearance. That is how all 5 fabricated clears were produced. Turning the
   product on before deploying the corrected writer would multiply the defect
   across the lot rather than fix it.
4. **Nothing can produce `VERIFIED_CLEAR` until the built code is deployed.**
   Migration `20260909110000`'s
   `vehicle_listings_recall_verified_clear_provenance` constraint rejects
   `verified_clear` unless `recall_check` carries `scope:'vin'`, a non-empty
   `source` and a non-empty `checked_at`. The current
   `marketcheck-recalls.persist()` writes a `recall_check` with none of those
   keys, so with the migration applied and the old function deployed, a genuine
   AutoRecalls clearance would be **rejected by the database**.
5. **The owner lock's canary is a precondition, not a formality.** It has to
   establish that the response is truly VIN-specific before any clearance is
   trusted. Nothing in the repo proves the endpoint is VIN-scoped rather than
   a VIN-keyed model lookup.

### 6.2 Does the endpoint carry additional cost?

**Per-call: yes, $0.07 list. Additional call volume from enabling it: no —
those calls are already being made and, on the repo's own model, already
billed.**

- `_shared/mcCost.ts:22`: `auto_recalls: 0.07`, and
  `billingProductForUrl` maps `/recall/car/` and `/autorecalls/` to it. Price
  source: `marketcheck.com/apis public list, 2026-08-01`. At $0.07 it is the
  joint second most expensive per-call MarketCheck product in the table, tied
  with `price_prediction` and behind `oem_incentive` ($0.20) and `neovin`
  ($0.08); it is **28×** the cost of `dealer_api` and **35×** `inventory_search`.
- `PROVIDER_COST_AND_ENTITLEMENT_MAP.md` §1.14: `vehicle-enrich` is "predict
  0.07 + about 4 × inventory_search 0.002 + vin_history 0.006 + mds 0.006 +
  recents 0.006 + sales 0.006 + **auto_recalls 0.07** = about $0.17 per VIN
  visited". The AutoRecalls call is already inside that per-VIN estimate and
  `vehicle-enrich` makes it on **every** VIN it visits (`:636`, before the NHTSA
  fallback at `:663`).
- So enabling the product adds **no new call site and no new call**. It changes
  what those calls return. Straight-line arithmetic for this tenant: 130 VINs ×
  $0.07 = **$9.10 per full lot pass**; the enrich sweep runs nightly at 03:15
  UTC and re-queues on `recall_status IS NULL`, so today's 74 unresolvable rows
  are being re-charged every night in perpetuity — roughly **$5.18 a night, or
  ~$155/month, for a VIN-level product that has never once answered**. Whether
  MarketCheck actually bills an unentitled call is **UNKNOWN from the repo**:
  `mcCost.ts` meters by URL, not by outcome, and its own header says "everything
  here is an ESTIMATE for operator visibility — never a bill".
- The one thing that *would* get cheaper: with AutoRecalls answering, the free
  NHTSA fallback fires less. That reduces free calls, not paid ones.

### 6.3 Does the existing MarketCheck contract or licensing permit the intended internal and customer-facing use?

**UNKNOWN.** `CUSTOMER_DISPLAY_LICENSE_MATRIX.md` is the record and it says so
explicitly, in three places:

- Row 17 (Recall status): licence basis is "NHTSA: code asserts free federal
  source; **AutoRecalls: product terms unaccepted**"; classification
  "NHTSA-sourced: CUSTOMER DISPLAY CLEARED pending owner acceptance of the
  basis (17 U.S.C. 105 …); **MarketCheck-sourced: UNKNOWN — REVIEW REQUIRED**".
- Unknown #3: "AutoRecalls product terms (MarketCheck portal) and whether its
  output, when present, may be shown. **UNKNOWN.**"
- Row 10 / Unknown #7: `recall_payload` is deliberately shipped to **two**
  sister-app endpoints (`autofilm-feed` and `vehicle-lookup`, both via
  `shapeLotRow`; `vehicle-lookup` LIST mode up to 500 rows per page). That is
  product-to-product redistribution of a licensed third-party product with "no
  in-repo basis" — **UNKNOWN / REVIEW REQUIRED**.

I am not going to guess. The MarketCheck contract itself is not in the
repository. What the repo *does* establish is that today's exposure is
code-path only for the customer-facing question — 0 rows carry
`recall_payload.source = 'marketcheck'`, so no MarketCheck-sourced recall text
has ever reached a customer. It also establishes a live labelling defect that
must be fixed **before** AutoRecalls is enabled:
`src/lib/passport/verificationSummary.ts:449` hardcodes `src("nhtsa")` and
`:239` labels it "NHTSA recalls", so a MarketCheck-sourced answer would be
displayed to a customer as a federal source. That is a licensing and an
accuracy problem at once, and it is a one-line fix that should land with the
switch, not after it.

### 6.4 Would enabling AutoRecalls change any current provider budget?

**No, because no MarketCheck budget exists to change — and that is the finding.**

- The **only** budget objects in the repository are
  `description_generation_budgets` and `description_budget_overrides`
  (`20260727225826_…sql:410,429`), which govern AI description generation. There
  is no MarketCheck budget table, no spend cap, no quota guard, and no
  per-tenant switch for recalls
  (`PROVIDER_COST_AND_ENTITLEMENT_MAP.md` finding 6: enrichment, NeoVIN decode,
  **recalls**, EPA, Firecrawl, OEM harvest and reviews "have NO tenant switch;
  they run for every tenant with inventory").
- Spend would also stay **invisible**. The one usage surface,
  `MarketcheckApiUsagePanel.tsx`, reads
  `marketcheck_sync_config.last_status.api_usage`, which is written only by
  `marketcheck-sync` (`:1745`) — and `marketcheck-sync` never calls a recall
  endpoint. `vehicle-enrich` and `marketcheck-recalls`, the two functions that
  do, **do not import `mcCost.ts` at all**
  (`PROVIDER_COST_AND_ENTITLEMENT_MAP.md` finding 1: "roughly 80 percent of
  MarketCheck call volume is unmetered"). The panel's "AutoRecalls" row
  (`MarketcheckApiUsagePanel.tsx:54`) will read $0.00 forever, before and after.
- The rate controls that do exist are pacing, not budget: `recall-sweep` at
  `45 3 * * *` with `{"sweep":true,"limit":500}`, a 30-day staleness gate via
  `listings_with_stale_recalls`, a 24-hour per-VIN skip, 250 ms pacing, and a
  break on `rate_limited`. **One caution:** this correction takes the stale
  worklist from 128 to 130 and holds it there, so the sweep's 30-day gate stops
  suppressing anything — combined with the enrich sweep's `recall_status IS
  NULL` re-queue, both paths will call AutoRecalls for every VIN, every night,
  with nothing to stop them.

**Recommendation on budget, for the owner to accept or reject:** before
accepting the AutoRecalls terms, import `mcCost.ts` into `vehicle-enrich` and
`marketcheck-recalls` and give recalls a per-run call ceiling, so the canary and
the first sweeps are observable and bounded. That is not part of this dry run.

---

## 7. What this dry run could not establish

Stated plainly rather than guessed:

1. Whether MarketCheck bills a call to an unentitled product. Not in the repo.
2. Which of the four candidate MarketCheck recall endpoints returned the 404s.
   `raw: {status: 404}` was never persisted; the evidence is gone.
3. Whether AutoRecalls output may be shown to a customer, or redistributed to
   AutoFilm and `vehicle-lookup`. `CUSTOMER_DISPLAY_LICENSE_MATRIX.md` records
   both as UNKNOWN; the contract is not in the repo.
4. Whether `recall-sweep` is actually firing. `cron.job` was not queried (Gate 1
   rule); `recall_checked_at` max 2026-09-04 on 10 rows is consistent with
   either answer.
5. The correct classification of the 49 non-pilot estate rows with
   `note = 'no_nhtsa_record_http_400'`. Their counts are withdrawn by
   `20260909110000`, so they are safe, but they need their own catalogue calls
   before they are given a model state. §5.3 deliberately leaves them alone.
6. Whether NHTSA's 400-with-`Count 0` will always behave this way. It is
   undocumented behaviour that we are now depending on; the catalogue call is
   the mitigation, and the same-make control pattern used in §1.3 should be
   built into the writer's diagnostics rather than only into this report.
