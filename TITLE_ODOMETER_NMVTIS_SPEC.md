# TITLE_ODOMETER_NMVTIS_SPEC

How AutoLabels turns an NMVTIS title report and the odometer readings it
already holds into one of four states, what it may say in public about them,
when it asks for a report, and what it is allowed to keep. Implements master
build section 16. Code: `src/lib/intelligence/titleOdometer.ts`
(`classifyTitleOdometer`, version `title-odometer-v1.0.0`); provider access
is `supabase/functions/marketcheck-title-report` (access first, then
generate, manual, Compliance Pro, 50 generates per dealer per month).

## 1. States

| State | Meaning | Public state |
|---|---|---|
| `VERIFIED_NO_ADVERSE_REPORTED` | a report answered, with no title brand, no junk/salvage/total-loss record, and an odometer chronology that holds together | verified |
| `ADVERSE` | a title brand, a junk/salvage/total-loss record, or a rollback indication exists | adverse |
| `REVIEW_REQUIRED` | the odometer readings on record disagree beyond tolerance, the report is older than its TTL, the report is incomplete, or it carries no odometer reading | warning |
| `NOT_VERIFIED` | no report was requested, the entitlement blocked it, or the provider failed | unknown / unavailable |

A provider or entitlement failure is `NOT_VERIFIED`, never a clean title.
Nothing in this module can produce a clearance from a failed call.

## 2. Inputs

- The session summary the title-report function returns (brands with state
  and date; junk/salvage/total-loss records with disposition, entity and
  date; odometer records with date; latest title with state, date and
  odometer; report date; whether the report was complete), plus the outcome
  of the request: `answered`, `entitlement_blocked`, `provider_failed`,
  `not_requested`.
- Other odometer readings, each with a date, a source and an authority class
  from `contracts.ts`: the syndication feed (`provider_listing`), MarketCheck
  listing history (`provider_listing`), the dealer's inspection
  (`verified_inspection`), the DMS (`dealer_system`).
- The clock, so a stale report is stale by the same rule everywhere.

Options, all configuration with defaults: report TTL 90 days (the provider
keeps a generated access report 90 days); conflict tolerance 500 miles;
rollback tolerance 1,000 miles.

## 3. Cross-check rules

Mileage only goes up. Readings are placed in time; undated readings are
listed but not cross-checked.

- A later reading lower than an earlier one by more than the rollback
  tolerance, where both readings come from strong authorities
  (`government_record`, `verified_inspection`, `dealer_system`), is a
  rollback indication: `ADVERSE`.
- A later reading lower than an earlier one by more than the conflict
  tolerance in any other case is a conflict: `REVIEW_REQUIRED`. A feed
  typo is a conflict to review, not a rollback to publish.
- A difference inside the conflict tolerance, or a later higher reading,
  is consistent.
- When more than one pair decreases, the pair with the largest decrease is
  the one named in public.
- A report with no odometer reading at all cannot be verified: its
  chronology was never checked.

## 4. Wording rules

Public statements are evidence-exact and name the date:

- "No NMVTIS title brands reported as of October 21, 2026. No junk, salvage
  or total-loss records reported. Odometer readings on record are consistent."
- "NMVTIS reports as of October 21, 2026: Salvage (CT, March 2, 2024)."
- "Junk, salvage or total-loss record reported: Total loss (An insurer,
  November 10, 2023)."
- "Odometer readings on record decrease over time: 41,287 miles on October
  1, 2026 and 36,000 miles on October 15, 2026."
- "Title history needs review: odometer readings on record disagree (...);
  the NMVTIS report on file is older than 90 days."
- "Title history not verified."

Never: "clean title", "guaranteed", "clear title", an owner count, an
accident history. NMVTIS carries none of those facts and the module's
`FORBIDDEN_TITLE_WORDS` guard is tested against every statement. Why a
report is `NOT_VERIFIED` (entitlement, provider) stays in `reasons` and the
dealer/admin surface; the customer sees only that it is not verified.

## 5. Cadence by vehicle type

| Vehicle | When a report is asked for | Notes |
|---|---|---|
| Used | before a strong public title claim (pre-publication or acquisition), then on the freshness rule (report older than the TTL) or a material event (odometer conflict, new brand signal) | access the existing report first; generate only when none exists or it is stale and policy requires it |
| New | not routine | unsold new inventory does not need the used title workflow |

Today every request is manual (the Compliance Pro panel). The flag
`nmvtis_auto_verify` (declared OFF, no reader yet) is the switch for the
exception-based workflow above; turning it on is a spend and terms decision,
and the 50 generates per dealer per month cap stays.

## 6. Terms boundary

- Report bodies are session-only. The title-report function returns the
  summary for the request and writes nothing but the billing meter
  (`title_report_pulls`); migration `20260721212000` records that rule.
- This module persists nothing. Its conclusion (state, brand labels,
  odometer status, statement, reasons, freshness) is a normalized
  conclusion. Storing even that is allowed only if the current contract
  explicitly permits retaining specific normalized results; until the
  contract is read and the owner decides, conclusions are computed per
  request from a fresh access call, which is cost-effective inside the
  provider's 90-day window.
- The dealer's own attestation (`vehicle_listings.title_verification`) is a
  business record and may be kept; it is an input of `dealer_claim`
  authority, never the provider's answer.

## 7. Tests

`src/lib/intelligence/titleOdometer.test.ts`: no adverse report; title
brand; junk/salvage/total loss; rollback from strong authorities versus a
weak-authority conflict; tolerated differences; stale, incomplete and
odometer-less reports; absent, entitlement-blocked and failed reports are
`NOT_VERIFIED`; the forbidden-word guard; configurable tolerances and TTL;
reading assembly and ordering.
