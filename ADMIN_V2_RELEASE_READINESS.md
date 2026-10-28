# Administration V2 release readiness

Date: 2026-10-28. Scope: the owner's six sign-off conditions of 2026-10-28
(pricing permissions, dealer programs, visual accuracy, functional
verification, MarketCheck protection, this report). Statuses are
**Verified** (evidence below, reproducible), **Untested** (no evidence yet),
**Blocked** (waiting on a decision or an approval) and **Failed** (evidence
shows it does not work). Nothing in this report was applied to production;
every production check was a read or a block that always rolled back.

## 1. Status board

| # | Feature | Status | Evidence | Outstanding risk |
| --- | --- | --- | --- | --- |
| 1 | Settings write authority, 7 key families x 18 principals | Verified | 126 replica cases, section 3 | none found |
| 2 | Direct `dealer_profiles` writes closed to members | Verified | 10 replica cases | none found |
| 3 | Products and applicability rules limited to add-on roles | Verified | 75 replica cases | platform administrators cannot edit a dealership's catalog unless they are members (predates V2, section 3.3) |
| 4 | Price-column guard (live rule) and recall override | Verified | 60 replica cases | INSERT is unguarded: any member who can create a listing can set its price (decision 6.3) |
| 5 | Pricing restricted to pricing roles, with delegation | Blocked | proposal verified in 96 replica cases; not applied by instruction | needs the owner's decisions in section 6 |
| 6 | Fee Review & Apply, preview step | Verified (fixed) | failed on every call until the fix was applied 2026-10-28 ~16:03 UTC on the owner's approval; after: function md5 `2a1468b9…`, grants unchanged, a rolled-back owner-identity preview returned counts; 29 of 29 replica fee cases pass | none known; the first real fee review in the app is still to be observed |
| 7 | Fee Review & Apply, apply step | Verified in replica; Untested in production | the 23 fee review cases that do not depend on the preview pass on the live functions: role refusals, idempotency, version conflict, archived scope, disabled fee, verification stamps kept, audit and ledger rows | cannot be reached in production until 6 is fixed; the screen keeps Apply disabled when the preview fails (page test) |
| 8 | Fee recalculation behind the fallback | Verified | 12 replica cases against the hosted definition | an open invitation for a pricing role can run it; fixed in the proposal |
| 9 | Settings persistence (value, version, audit, merge) | Verified in replica; production first write not yet observed | 7 replica cases; the 2026-10-29 check-in reports production writes | none found |
| 10 | Health reads (policy version, feed last success, job status) | Verified | 9 replica cases; job status returns no URL or key | none found |
| 11 | Dealer program library limited to add-on roles | Verified | 5 replica cases plus the dealer-program row of the settings matrix (server); 6 panel tests (screen) | none found |
| 12 | Salespeople view, select and apply approved programs | Verified | 2 replica cases (read, per-vehicle withhold); 4 panel tests (per-addendum include without touching the library) | the per-addendum choice is kept with the document, not re-read when a saved document is reopened |
| 13 | Lead escalation function | Verified in isolation; first live escalation Untested | 22 checks running the deployed source unmodified | production has no valid destination and no leads, so it cannot send yet; a failed lead update after an accepted send would repeat the email (section 7) |
| 14 | MarketCheck quota protection and paused sweep | Verified | ledger, scheduler and 38-screen mount test (section 8) | the daily feed retries a quota refusal twice (3 refused calls a day until Nov 1) |
| 15 | Scheduled monitoring | Verified (configured) | trigger read back (section 9) | results arrive 2026-10-29 07:40 UTC |
| 16 | Visual acceptance | Not met; exceptions pending | Target 95% per screen: on `7716842` all 13 screens are below 94% (85.60-90.64%); per-screen exception requests in section 10.1 | Owner review of the exception requests |

## 2. How the evidence was produced

- **Isolated database replica** (`scripts/db-verify`). A local PostgreSQL
  16 rebuilds the production pre-state, applies both Administration V2
  migrations verbatim from `supabase/migrations`, and checks 38 function
  and policy fingerprints against the hosted project: **38 of 38 match**.
  Every case runs as one principal (17 synthetic users, one per role, a
  second dealership's owner, an unaccepted invitation, a platform
  administrator, anon, the service role) inside a block that is always
  rolled back. Run: `PGHOST=<socket dir> PGPORT=<port>
  scripts/db-verify/run.sh --proposed`. Latest run: 766 cases; the only 6
  failures are the preview defect in the live stage (section 4).
- **Escalation run** (`scripts/escalation-verify`). The deployed function
  file runs unmodified under Deno against a local PostgREST over the same
  replica, with a gateway that fakes the mail sender. The five source files
  match the deployed commit `6746a95` blob for blob.
- **Screen tests** (vitest). Fee review page, dealer program panel, and a
  mount of every Administration screen.
- **Production reads** through the Lovable query tool, read-only, plus one
  rolled-back call of the preview function (section 4).

## 3. Permission rules

### 3.1 Settings authority (live)

`merge_dealer_settings` is the only writer of dealer settings for members.
Each key family needs its own role set; a save that touches two families
needs both.

| Key family | Roles that may write | Cases |
| --- | --- | --- |
| Pricing (doc fee and the other pricing keys) | owner, admin, GM, GSM | 18 |
| Lead routing | + manager, sales manager, used-car manager, finance | 18 |
| Publishing | owner, admin, GM, GSM, manager | 18 |
| Dealer programs and other add-on keys | + sales manager, used-car manager, finance, office, compliance | 18 |
| Service policy | owner, admin, GM, GSM, manager, service manager | 18 |
| Workspace (label defaults and two others) | any accepted member | 18 |
| Identity and brand | owner, admin, GM, GSM, manager | 18 |

Platform administrators pass every family; an unaccepted invitation and
another dealership's owner pass none. A refused save writes nothing and
audits nothing; an allowed save keeps every key it does not name, raises the
policy version by one and writes one audit row for policy families.

### 3.2 Products, rules, prices, recalls (live)

Products and applicability rules: add-on roles only (75 cases). Vehicle
price columns: owner, admin, GM, GSM, manager, inventory manager, used-car
manager; recall overrides: owner, admin, GM, GSM, manager, compliance,
office, finance (60 cases). Service jobs pass. Non-price edits are open to
every member. A read of every client write path found no screen that
changes a price on an existing listing; only the fee review functions do.

### 3.3 Finding: platform administrators and tenant data

A platform administrator who is not a member of a dealership cannot see that
dealership's products, rules or vehicles, so an edit from the app matches no
row. This predates V2; the server authority document now says so.

## 4. Fee Review & Apply: failed, fixed 2026-10-28

`admin_doc_fee_change_preview` appends a plain sentence to a text array.
PostgreSQL reads the untyped sentence as an array literal and raises
`22P02 malformed array literal`. The closing sentence is appended on every
call, so the preview fails on every call. Confirmed three ways:

1. In the replica, all six preview cases fail with `22P02`.
2. On production's PostgreSQL 17.6 the same expression fails.
3. On production, the preview was called with the dealership owner's
   identity on real data inside a block that always rolls back: it failed
   with `22P02`. Nothing was written.

Effect: the Review step shows "The review is no longer valid" and Apply stays
disabled (page test `FeeReviewPage.test.tsx`). No wrong price can be written;
no fee change can be made through Administration either.

Fix: `supabase/proposed/20261029120000_fix_fee_preview_warnings.sql` casts
the two sentences to text and changes nothing else. With it, all 29 fee
review cases pass. **Applied 2026-10-28 ~16:03 UTC on the owner's approval**
(`supabase/migrations/20261029120000_fix_fee_preview_warnings.sql`). This read
now returns `2a1468b9a62a9177b20193a345c77ce6`, and a rolled-back preview called
with the owner's identity on real data returned 0 eligible, 128 unchanged, 2
without a price basis and 3 warnings:

```sql
SELECT md5(pg_get_functiondef('public.admin_doc_fee_change_preview(uuid,boolean,numeric,boolean)'::regprocedure));
```

## 5. Dealer programs

- Server: a salesperson or inventory manager cannot add, edit or delete a
  program in the dealer library (refused, library unchanged); a sales
  manager can, with one audit row; a salesperson reads the approved
  programs and can withhold one on a vehicle.
- Sticker Studio: every role chooses which approved programs go on this
  addendum, starting from the vehicle's withheld programs, without writing
  the library. Only roles with add-on management see the library editors.
  The old "Remove from addendum" changed the library for every vehicle;
  for add-on roles it now reads "Stop offering on addenda".

## 6. Pricing permissions: proposal, not applied

The role matrix, the delegation rules and the decisions are in
`ADMIN_V2_SERVER_AUTHORITY.md` section 10. Summary: price columns to owner,
admin, GM, GSM; used-car or inventory managers only through a delegation
from the owner or GM, scoped to used, new or all, at most 90 days, with a
reason, audited, and void if the person's role changes. Production has four
members today, all owners, so nobody loses access. Decisions: whether
`manager` is delegable, whether GSM or dealer admin may grant, and the
unguarded price on new listings.

## 7. Lead escalation function

22 of 22 checks: refused without the service key or cron secret (nothing
sent); tier selection across six dealership setups; only a send the sender
accepts advances a lead and stamps `escalated_at`; a refused send is audited
as failed, retried on the next sweep and advances once accepted; answered,
contacted, unrouted and recent leads are left alone; audit rows carry the
dealership and no address, phone, name or VIN; the audit hash chain stays
intact.

Production today: one dealership has routing saved with escalation
effectively on, but no valid BDC or manager address, and there are no
leads, so the sweep (every 5 minutes, 288 runs in the last 24 hours) sends
nothing. Observed behaviours to know: a lead already past both windows gets
the BDC and the manager email in the same sweep; and the function does not
check that the lead update succeeded after an accepted send, so a failed
update would repeat the email on the next sweep.

## 8. MarketCheck protection

| Check | Result |
| --- | --- |
| Paid calls since the V2 release (ledger, 2026-10-28 11:00 UTC on) | 0 |
| Last 48 hours | one daily feed attempt at 03:07, refused 429 three times (retry with backoff); 40 refused enrichment calls at 22:57 on 2026-10-27, before the release |
| Enrichment sweep | job inactive; last run 2026-10-27 03:15 |
| Incentives job (daily 03:30) | 0 dealerships have incentives on, so it calls nothing |
| Factory sticker and specs jobs | reach MarketCheck only through `marketcheck-specs`, which writes the ledger; 0 calls in 48 hours |
| Opening Administration | all 33 views and 5 child pages mounted as a platform administrator: 0 edge function invocations, 0 outbound fetches (`noPaidCallsOnLoad.test.tsx`) |
| Paid actions in Administration | only behind explicit buttons: run feed now, re-pull inventory, re-enrich, recall refresh, regenerate factory sticker, test a website URL |

Not changed: the quota guards, the paused sweep and the feed's retry
policy. Recommendation for after Nov 1: stop retrying a 429 whose body
says the monthly quota is exhausted.

## 9. Scheduled monitoring

One-time check-in `trig_014DzAThibXmW3bXpjB8Mb75`, named "Verify first
feed and crawl runs under migration 2", fires 2026-10-29 07:40 UTC into
the session that built this release. It is read-only: feed runs, website
price crawl and whether it still writes prices under the guard, policy
audit rows and versions, the apply ledger, escalation audit rows (store set,
no address), MarketCheck ledger since the release, the sweep pause, the
incentives switch. Results are appended to this file under "Scheduled
check-in, 2026-10-29", pushed to `main`, and reported to the owner in the
session. It invokes nothing and changes nothing.

## 10. Visual acceptance

Status: the 97% target is **not met** on any screen, and no exception has
been approved. Everything under 10.3 and 10.6 is a proposal awaiting the
owner.

### 10.0 Comparison contract (as agreed in the handoff)

- References: the 13 mocks in `screens/annotated/` (2186x1048 with the
  annotation panel), cropped to the 1586x992 screen area in
  `scripts/admin-parity/reference/`.
- Primary viewport: 1600x1000 (`contracts/PARITY_TARGETS.csv`,
  `docs/05_VISUAL_PARITY_97_PROTOCOL.md`); the reference is resampled
  bilinearly to that frame. DPR 1, Playwright Chromium, light theme,
  development-only synthetic fixtures.
- Font: Inter v20 variable from Google Fonts (one latin woff2, weights 400,
  500, 600 and 700 loaded); `document.fonts.ready` awaited before capture.
- Threshold: a pixel differs when any channel moves more than 32/255; no
  anti-aliasing allowance. Structure: mean SSIM of 8x8 luminance blocks.
- Crop: the content region starts 3px right of each mock's navy rail edge
  and at y 70; the full frame is also reported. No alignment shift is
  applied to the protocol score.
- Masks: only the dynamic content the protocol permits (names, times,
  counts, ids, fixture values) plus mock-only annotation captions
  (Proposed design footer, DESIGN CONCEPT chip), disclosed per screen in
  `scripts/admin-parity/masks.json`. This round narrowed two: the 05 mask
  now covers only fixture vehicle names and prices (thumbnails, rows and
  the doc fee are scored) and the 13 evidence mask was removed.
- Target: 97% per screen, plus landmarks within 16px.

### 10.1 Results on implementation commit `7716842` (target 95%)

The owner's acceptance rule (2026-10-28):
- 95% per screen on the agreed protocol.
- 94.00-94.99% may be submitted for individual acceptance after visual
  inspection.
- No average stands in for a screen.
- Below 94% is outside the numeric range and is not passed.

This replaces the 97% goal. The comparison contract is unchanged, as
listed in 10.0.

| # | Screen | **Protocol content (agreed metric)** | Acceptance band | Full frame | Structure | Diagnostic: native 1586x992 | Diagnostic: body aligned | Landmarks | Responsive (5 sizes) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Overview | **89.83%** | below 94%: not in the numeric acceptance range | 90.26% | 67.05% | 92.99% | 92.81% | pass | pass |
| 02 | Dealership & Brand / Identity | **87.38%** | below 94%: not in the numeric acceptance range | 88.13% | 65.35% | 88.00% | 92.72% | pass | pass |
| 03 | People & Access / Team | **90.64%** | below 94%: not in the numeric acceptance range | 91.37% | 71.48% | 90.70% | 92.58% | pass | pass |
| 04 | Member role (child) | **88.96%** | below 94%: not in the numeric acceptance range | 89.39% | 65.24% | 89.87% | 88.78% | fail: capabilitiesCard, capabilityTable, enforcementCard, enforcementList, bottomNote, testAccess, primaryAction | pass |
| 05 | Pricing & Products / Price rules | **90.46%** | below 94%: not in the numeric acceptance range | 90.86% | 66.85% | 90.71% | 91.31% | pass | pass |
| 06 | Fee change review (child dialog) | **90.47%** | below 94%: not in the numeric acceptance range | 85.47% | 71.16% | 94.23% | 94.19% | pass | pass |
| 07 | Product applicability (child) | **87.58%** | below 94%: not in the numeric acceptance range | 88.45% | 62.93% | 87.83% | 91.92% | pass | pass |
| 08 | Customer Experience / Contact & Routing | **89.66%** | below 94%: not in the numeric acceptance range | 90.58% | 67.73% | 92.12% | 90.53% | pass | pass |
| 09 | Escalation rules (child) | **85.60%** | below 94%: not in the numeric acceptance range | 87.36% | 60.97% | 86.53% | 92.85% | pass | pass |
| 10 | Publishing / Effective policy | **86.76%** | below 94%: not in the numeric acceptance range | 87.76% | 60.58% | 89.53% | 88.84% | fail: childTabs, policyCard, draftStatus | pass |
| 11 | Documents & Service / Approval rules | **89.09%** | below 94%: not in the numeric acceptance range | 89.61% | 68.66% | 89.84% | 92.02% | fail: sectionNav | pass |
| 12 | Integrations / Inventory feed | **90.50%** | below 94%: not in the numeric acceptance range | 90.76% | 68.69% | 92.22% | 92.00% | fail: childTabs | pass |
| 13 | Sync run detail (child) | **87.26%** | below 94%: not in the numeric acceptance range | 88.11% | 61.85% | 87.80% | 93.38% | fail: badge, breadcrumb, title | pass |

**No screen is in the acceptance range.** All 13 are below 94% and are
not passed; each one carries an exception request below, pending the
owner.

Changes this round, all for visible quality and each re-verified:
- 08 draft bar: 75px with its controls 8px under the edge, as the source
  draws it (89.46% to 89.66%).
- 06 example vehicle: shows the supplied placeholder drawing instead of an
  empty box.
- 07: the generic section description under the child title is removed,
  since the mock omits it. Score 88.36% to 87.58%; I kept the visual fix
  over the score.

Visual inspection: every screen's overlay was reviewed, and these states
were captured on this commit:
- default;
- after a real edit, with the Review control's state;
- the review dialogs;
- the app's dark class.

Review changes:
- Disabled on open on 02, 05, 06, 07, 08 and 09.
- Enabled after a real edit on 07 and 08.
- Still disabled on 09 after an edit, while a required destination is
  missing.
- Enabled on 10 and 11, whose fixtures hold a pending draft.
- The 04 role dialog keeps "Review change" disabled until a different role
  is chosen.

Administration V2 uses its fixed light palette under the app's dark class.
It stays readable (dark-mode contrast check passes) but has no dedicated
dark theme.

Checks on `7716842`:
- Typecheck clean.
- Vitest (`src/pages/admin`, `src/components/admin`, `src/lib/admin`,
  `src/components/sticker`): 54 files, 524 tests, all passing.
- Harness tests (`scripts/admin-parity/harness.test.cjs`): 10 of 10, run
  separately and not part of the 524.
- Responsive audit at 1586x992, 1366x768, 1024x768, 768x1024 and 390x844,
  every screen:
  - no overflow, clipped text or overlaps;
  - one h1, no unnamed control, no small target;
  - every focus stop visible, no contrast failure in light or dark, no
    off-centre icon.
- 07 logs 6 console errors, all sandbox network failures.

#### Exception requests (pending; none approved)

| # | Score | Basis | Evidence |
| --- | --- | --- | --- |
| 01 | 89.83% | Text-size floor and glyph rendering; no layout defect found. | `screens/01/` in the review package |
| 02 | 87.38% | Owner-approved title block offsets the body 38px; remaining differences are preview artwork and glyphs. | `screens/02/` in the review package |
| 03 | 90.64% | Approved title block and tab placement; full addresses kept readable. | `screens/03/` in the review package |
| 04 | 88.96% | Owner-decided section-row placement; icon set has no matching assets. | `screens/04/` in the review package |
| 05 | 90.46% | Synthetic fixtures without photos; glyph rendering. | `screens/05/` in the review package |
| 06 | 90.47% | Native parity is above 94%; the protocol frame's 0.9% stretch accounts for the gap. | `screens/06/` in the review package |
| 07 | 87.58% | Owner-decided section row; removing the redundant subtitle was chosen over score. | `screens/07/` in the review package |
| 08 | 89.66% | Text rendering and truthful state labels; no layout defect remaining. | `screens/08/` in the review package |
| 09 | 85.60% | Approved one-h1 structure; truthful delivery-state copy. | `screens/09/` in the review package |
| 10 | 86.76% | Owner-decided tab placement and policy copy. | `screens/10/` in the review package |
| 11 | 89.09% | Approved title block and tab placement. | `screens/11/` in the review package |
| 12 | 90.50% | Owner-decided heading placement; truthful states. | `screens/12/` in the review package |
| 13 | 87.26% | Owner-decided section row; aligned-body diagnostic is 93.38%. | `screens/13/` in the review package |

The per-screen differences, with numbered hotspots and their share of
differing pixels, are in the review package and in
`scripts/admin-parity/evidence/overlay/NN.png`.

### 10.2 Diagnostics (not the agreed metric)

These isolate causes; none of them stands in for the protocol score. The
earlier version of this section reported the text-masked column as the
result, which was wrong.

| # | Content at 1586x992 | Body, aligned at the section row | Layout with text boxes masked |
| --- | --- | --- | --- |
| 01 | 92.78% | 92.57% | 97.42% |
| 02 | 87.74% | 94.31% | 98.15% |
| 03 | 91.26% | 92.31% | 95.63% |
| 04 | 88.89% | 93.20% | 97.99% |
| 05 | 89.65% | 92.34% | 97.80% |
| 06 | 94.11% | 94.14% | 98.30% |
| 07 | 91.87% | 92.12% | 96.99% |
| 08 | 88.08% | 93.27% | 98.07% |
| 09 | 83.85% | 91.89% | 97.07% |
| 10 | 88.00% | 91.19% | 96.99% |
| 11 | 91.08% | 92.49% | 97.62% |
| 12 | 79.44% | 94.46% | 98.66% |
| 13 | 89.21% | 93.58% | 98.98% |

The gap between the protocol and body columns is the vertical offset of
the title block (-24 to +80px); the gap between body and layout is text
rendering inside boxes that are in the right place.

### 10.3 Font substantiation

- Loaded: one Google Fonts Inter v20 woff2 (latin), weights 400/500/600/700
  loaded, 800 unused. `CSS.getPlatformFontsForNode` reports family Inter,
  `isCustomFont` true, for the h1, nav and body text: no fallback is used.
  Computed letter-spacing `normal`, optical sizing `auto`, line heights
  20px body, 40px title (36px on child pages).
- Fit against the references: for every candidate face (Inter webfont with
  optical sizing on and off, local Inter, Inter Display, Liberation Sans,
  FreeSans, DejaVu Sans, Carlito), each reference string was rendered over
  a sweep of sizes and its ink box compared with the reference's.
  - The screen 01 title "Administration" (254x29px ink) matches Inter Bold
    at 35.75px exactly (0.00% width, 0px height).
  - The subtitle (388x16) matches Inter Regular at 15.4px (0.26%).
  - The section labels match Inter Medium at 13.75px (2.0% RMS; Semibold
    2.9%).
  - The mocks use the same font. The differences are size and weight
    choices, not a font substitution.
- Our 01 capture: title 199x22 ink (28px token), subtitle 352x14 (14px),
  section labels 14px Semibold.
- Across the 13 references the "Administration" title is drawn at about
  28px on 05, 06, 08, 09 and 12 (ink 22-24px, as ours) and about 36px on
  01. Child titles are about 32-38px on all four child mocks against the
  28px `page` token. Section-label rows span 997-1225px across the
  references; ours spans 1126px, the median.
- Crops: `/tmp` scratch only; the per-screen overlays below show the same
  text unmasked at the protocol frame.

### 10.4 Reference / actual / overlay

`scripts/admin-parity/evidence/overlay/NN.png`, built by
`scripts/admin-parity/overlay.cjs`, has four panels at 1600x1000 for every
screen, with no text hidden:

- the reference;
- the capture;
- an overlay, cyan where only the reference has ink and red where only
  ours does;
- a difference map, with magenta at every pixel past 32/255, the scored
  region outlined and each permitted mask outlined with its content still
  visible.

What they show, by kind:

- Spacing: the title block is the main mover. Our breadcrumb and
  description push every section body down 37-80px on 02, 03, 05, 08 and
  12, where the mocks draw neither. The shell's 24px gutter sits against
  the mocks' 18-33px.
- Typography: page and child titles at 28px against 32-38px; section
  labels Semibold against Medium; glyph anti-aliasing everywhere.
- Icons: lucide glyphs where the mocks draw their own set. The supplied
  `assets/icons` set is used for the vehicle placeholder and the empty,
  restricted and paused states. The remaining lucide glyphs are listed per
  screen in `ADMIN_V2_PARITY_REPORT.md`.
- Backgrounds: the mock's workspace tint and banner gradients vary by more
  than the threshold in places. The fixture's rail and header stand-ins
  are flat.
- Control geometry: child-tab rows are 36px against the mocks' 40-54px.
  On 10 and 11 the mocks put the tabs inside the card.

### 10.5 Full review (not a screenshot score)

`scripts/admin-parity/audit.cjs`, every screen at 1586x992, 1366x768,
1024x768, 768x1024 and 390x844, on the final commit: no page overflow, no
clipped or truncated text, one h1 per screen, no unnamed control, no target
failing WCAG 2.5.8, every tab stop with a visible focus change, no contrast
failure in light or with the app's dark class, every boxed icon centred.
Two overlaps remain by design: the sticky save bar covers content while
scrolling on 02 (phone) and 08 (tablet portrait); at the page bottom nothing
is covered. Seven icons are under 16px: 06's 14x9 arrows and 09's 14px badge
glyphs match the reference geometry; 08's are 14px glyphs in the miniature
customer preview. 07 logs four console errors: the realtime socket the
sandbox blocks, not an application error.

Fixed by this review: truncated text on 01, 02, 03, 08, 11 and 13; the
Team table and Escalation tiers breaking at 1280-1535px; two contrast
failures; missing hover feedback on four controls; small badge glyphs;
the supplied vehicle drawing now fills Price rules' empty photo frame and
empty-state artwork is no longer dimmed; rule editor labels tied to inputs.

### 10.5a Interactions

Tests now drive every screen: open child pages, select rows, edit drafts,
Review changes only after a valid change, cancel, save, refused and thrown
saves, retry after a failed read, and paid calls only on explicit click.
They found eight defects, all fixed with regression tests: refused rule
writes reported as Applied (07 and the Applicability list), negative prices
accepted (07), three saves stuck on Applying when the writer throws (02,
08/09, 10), malformed escalation addresses shown as configured (09), and
Review change enabled before any change (04). Admin, Sticker and hook
suites: 72 files, 688 tests, all passing; typecheck clean.

### 10.5b Shared spacing (proposal)

The references disagree: left gutters 18-33px (median 27), right 15-27px
(median 25), navigation-to-content gaps 15-21px. No single value in
`AdminPageContainer` reproduces them; 26 or 28px would move 01, 03 and 04
further away. The shell keeps 24px and 16px, and no view compensates
locally. This is a proposal for the owner, not an accepted deviation.

### 10.5c Not tested

- Native iOS: this repository has no native code; nothing here changed a
  native screen or shared native asset. The Connect Card and Wallet
  implementations are not in this repository and were not touched.
- Real devices and Safari: the audit used Chromium at device scale 1.
- Live data in the browser: the sandbox cannot reach the hosted project,
  so screens were exercised through fixtures and component tests.

### 10.6 Exception proposal (pending; nothing approved)

Each item gives the screens it affects, the deviation, the evidence and its
practical impact. The owner can accept an item, reject it (the reference
then wins and the work is reopened) or change the written requirement.

1. **Title block** (owner approved the mock-matching change on 2026-10-28;
   applied in 10.1, and the conflicts that remain are listed there)
   - Screens: 02, 03, 05, 06, 08, 10, 11, 12.
   - Deviation: 02, 03, 10 and 11 title the page with the section name.
     02, 03, 05, 06, 08 and 12 draw no breadcrumb or description. Ours
     always shows the breadcrumb, "Administration" and a one-line
     description.
   - Evidence: IA `02_ADMIN_INFORMATION_ARCHITECTURE.md` ("one page title:
     Administration"), acceptance A01, annotation 01-1. The references
     contradict each other: 01 and 10 draw a breadcrumb or eyebrow.
   - Impact: bodies sit 24-80px off (the protocol vs body columns in 10.2).
     The section name is still the active tab.
   - Decision asked: keep the IA, or drop the breadcrumb and description on
     parent sections (the h1 would stay).
2. **Page and child title size** (applied within what the references
   support: child titles 32px from 1024px wide; parent title kept at 28px)
   - Screens: 01, 04, 07, 09, 13.
   - Deviation: 28px (`design/tokens.json` `page` 28/36/700) against about
     36px on 01 and 32-38px on the four child mocks.
   - Evidence: section 10.3.
   - Impact: the title and everything under it sit 8-19px higher (the 13
     badge and title landmarks).
   - Decision asked: keep the token, or adopt about 36px.
3. **Child tabs outside the card**
   - Screens: 10, 11.
   - Deviation: the mocks draw the tab row inside the policy card (11 at
     54px tall); 02, 03, 05, 08 and 12 draw it outside, as the shared
     component does.
   - Impact: the child-tab, policy-card, draft-status, rules-card and
     selected-rule landmarks fail.
   - Decision asked: one placement for all sections.
4. **Section heading above the tabs**
   - Screen: 12.
   - Deviation: the mock adds an "Integrations & Data" heading between the
     section row and the tabs; no other parent mock does.
   - Impact: the child-tab landmark is 50px off, and so is everything
     below it.
5. **Shell gutter 24px**
   - Screens: all.
   - Deviation: the mocks draw 18-33px (section 10.5b).
   - Impact: card edges move 4-9px.
6. **Behaviour over the mock's static state**
   - Screens: 03, 04, 07, 08, 09, 12.
   - Deviations:
     - Review changes stays disabled until there is a real change (04, 07).
     - Members are shown by address, which wraps (03).
     - The Escalation switch lives on its own page (08).
     - Labels read "Not supported" and "Previously validated" where the
       mocks say "Coming soon" and "Verified" (09, 12).
   - Evidence: the 10.5a interaction tests and the annotations' data-truth
     notes.
   - Impact: local differences under 1 point each.
7. **Notification tiles**
   - Screen: 09.
   - Deviation: the tile group is out of landmark tolerance. This is a real
     layout difference with no requirement behind it. It is open, not
     proposed as an exception.
8. **Product rail and header**
   - Screens: all (full frame only).
   - Deviation: the fixture draws flat stand-ins for the global shell.
   - Impact: full-frame scores only. Proposed to be scored outside this
     refresh.

Even if items 1-5 were accepted, the body diagnostic (91-95%) shows that
text rendering and lucide glyphs keep every screen below 97%. Closing that
gap needs the title-size decision plus icon replacement from the supplied
set, measured screen by screen.

## 11. Approvals requested

1. Done: the fee preview fix was applied and verified (section 4).
2. Decide the pricing matrix questions in `ADMIN_V2_SERVER_AUTHORITY.md`
   section 10.3; on approval the proposal is applied and the two screen
   changes are prepared.
