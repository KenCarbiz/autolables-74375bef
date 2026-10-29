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
| 16 | Visual acceptance | 4 of 13 accepted individually (appearance only): 01, 06, 08, 12; 9 pending | Acceptance register in section 10.19 and `scripts/admin-parity/acceptance.json`, with baselines compared pixel by pixel (10.21): 06 at 94.11% (approved, `7f4fa1a`); 01 at 92.99%, 08 at 92.12%, 12 at 92.22% (accepted with listed exceptions, `2fe74e3`, evidence `4958ce9`); all four captures identical to their baselines at `2d7954d`. Masked scores; none meets 94% or 95% except 06 in the 94% review band. 03, 04 and 07 focused review delivered (10.20, 10.21; implementation `2d7954d`, evidence `ec43fe0`), pending | Owner review of 03, 04, 07 and the remaining 6; CPO rule and addendum condition/mileage finding are business decisions outside visual acceptance |

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

### 10.7 Mobile and readability pass and protocol v2, implementation commit `346ba3d`

Baseline: `7716842`. The evidence for `346ba3d` is committed separately and
names this SHA.

Comparison protocol v2 (owner-authorized 2026-10-28):
- The application is captured at the references' native 1586x992 and
  compared with neither image resized.
- v1 (1600x1000 against a resampled reference) is kept as a labelled
  historical column. Its contract and the `7716842` results are preserved
  under `scripts/admin-parity/protocol-v1/`.
- The change from v1 to v2 is a measurement change, not a code
  improvement.

| # | **Protocol v2 content (agreed)** | Band | v1 historical | Diagnostic: body aligned | Landmarks | Responsive |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | **92.99%** | below 94%: not passed | 89.83% | 92.81% | pass | pass |
| 02 | **88.01%** | below 94%: not passed | 87.40% | 92.71% | pass | pass |
| 03 | **90.70%** | below 94%: not passed | 90.64% | 92.58% | pass | pass |
| 04 | **89.87%** | below 94%: not passed | 88.96% | 88.78% | 7 fail (section row above title, owner decision) | pass |
| 05 | **89.94%** | below 94%: not passed | 89.69% | 90.46% | pass | pass |
| 06 | **94.16%** | 94.00-94.99%: individual review | 90.34% | 94.11% | pass | pass |
| 07 | **87.83%** | below 94%: not passed | 87.58% | 91.93% | pass | pass |
| 08 | **92.12%** | below 94%: not passed | 89.66% | 90.53% | pass | pass |
| 09 | **86.53%** | below 94%: not passed | 85.60% | 92.85% | pass | pass |
| 10 | **89.53%** | below 94%: not passed | 86.76% | 88.84% | 3 fail (tabs outside card, owner decision) | pass |
| 11 | **89.84%** | below 94%: not passed | 89.09% | 92.02% | 1 fail (approved title block) | pass |
| 12 | **92.22%** | below 94%: not passed | 90.50% | 92.00% | 1 fail (no heading above tabs, owner decision) | pass |
| 13 | **87.77%** | below 94%: not passed | 87.23% | 93.34% | 3 fail (section row above title, owner decision) | pass |

Fixes in this pass:

- Shared:
  - Tables and tab rows show edge fades where content is hidden, are
    labelled keyboard stops while they overflow, and keep the active tab in
    view.
  - Below 1024px, tables with a minimum width scroll instead of crushing
    columns.
  - The scroll region is positioned, so screen-reader text no longer widens
    the page. This was 03's 282px overflow.
- 02: logo and fields stack below 1024px, and the preview keeps dealership
  names whole. The website shows a readable label while the href, title and
  screen-reader text keep the full URL. The save bar stacks at 320px.
- 04: labelled capability cards with Read, Create or act and Manage values
  below 768px; the desktop matrix is unchanged.
- 05: the price-consistency logic stripped the document fee from website
  totals under the fee-inclusive basis, so $40,420 matched $39,525. Those
  rows now read Mismatch. A basis note explains each column, Passport is
  compared too, and "Conveyance Fee" is explained as Connecticut's term for
  the document fee. Phones get stacked labelled cards.
- 06: below 768px the fee review dialog has a fixed header and footer with
  an internal scroll, the background is held still, focus is trapped and
  returns to Review changes, and vehicles show as stacked labelled rows.
  `dialog-mobile.cjs` runs 12 checks at 390x844, 320x568 and 390x500; all
  pass, where 12 failed before.
- 07: evidence badges sit on their own line on narrow screens, and the
  tables scroll.
- 08: business-hours rows wrap (28px overflow at 320 fixed).
- 10: the actions wrap (27px overflow fixed), the badges and counts get
  their own lines, and the matrix scrolls.
- 11: Readiness items stack (2px overflow fixed), with no mid-word breaks.
- 13: the summary reflows, the timeline becomes event cards below 768px,
  and the technical evidence wraps and has a Copy control limited to what
  is displayed.
- 01, 09, 12: tables scroll on phones. 09 regressed briefly, scrolling on
  desktop, and was fixed by limiting minimum widths to below 1024px.

Checks on `346ba3d`:
- Typecheck clean.
- Application tests (vitest, Admin and Sticker): 54 files, 536 tests,
  all passing.
- Harness tests: 10 of 10, separate.
- Audit at 1586, 1366, 1024, 768 and 390 wide, all 13 screens: no
  overflow, clipping or overlaps; one h1; every focus stop visible; no
  contrast failures; no off-centre icons.
- Actual-viewport captures at 390x844, 320x568 and 768x1024: 0px page
  overflow on all 39, every scroll region labelled and focusable.
- Review changes behaviour unchanged.

Separated outcomes:
- Intentional design changes (owner decisions):
  - the one-Administration title block;
  - the section row above child titles;
  - tabs outside cards;
  - no heading above the 12 tabs.
- Unresolved:
  - Light-only: the Administration pages keep their light palette under
    the app's dark class. A dedicated dark theme is a separate piece of
    work.
  - The 05 customer preview adds the fee to the stored price, so the
    fixture vehicle previews at $40,420 against a $39,525 label and
    Passport. The locked price arithmetic was left unchanged, pending a
    decision.
  - 13 renders the timeline as both cards and table, with CSS choosing
    which shows.
- Rendering differences: glyph widths against the mocks' lettering,
  synthetic data and lucide icons.

Scores: 06 (94.16%) is in the individually reviewable band. The other 12
are below 94% and not passed. 05 fell 0.77 points because the honest
Mismatch rows and basis note now show.

### 10.8 Screen 05 preview pricing, implementation commit `1dd1d4b`

Owner-authorized, scoped correction (2026-10-28). Evidence:
`scripts/admin-parity/evidence/pricing/05-preview-before-after.png`.

Trace:
- Stored `price`: on the fee-inclusive basis (`price_display_mode =
  website_sale_price`) it is the advertised total including the document
  fee. `resolveDisplayPrice` anchors on it, and Label and Passport show it.
  On the `advertised_before_doc` basis the displayed price excludes the fee.
- Fee-inclusion policy: there is no per-listing column. The tenant's
  display mode decides; `advertised_excludes_doc_fee` is absent on
  listings, as `priceBasis.ts` documents.
- Saved fee change (`recalc_tenant_doc_fee`): sets `doc_fee` and
  `website_sale_price = advertised_price_before_doc + fee`, and never
  changes `price`.
- Passport (`buildPassportSaleCard`): selling = price - fee when the price
  includes the fee, otherwise price; total = selling + fee. The fee is
  counted once.
- The Admin preview before this fix: always total = before-fee price +
  fee, which counted the fee twice on the fee-inclusive basis.

Fix:
- `src/lib/admin/pricing/previewPricing.ts` applies the Passport rule to
  the stored fields, and applies a draft fee as the saved recalculation
  would.
- Price consistency also checks that, on the fee-inclusive basis, the
  stored breakdown (price before fee + fee) equals the total. A breakdown
  that does not add up is a Mismatch even without a website observation.
- No inventory prices, fees or other products' pricing were changed.

Examples (from the regression tests):

| Case | Stored | Basis | Customer price |
| --- | --- | --- | --- |
| Coherent fee-inclusive | price $40,420, before-fee $39,525, fee $895 | includes fee | $39,525 + $895 = $40,420 |
| Fee-exclusive | before-fee $39,525, fee $895 | before fee | $39,525 + $895 = $40,420 |
| Screen 05 fixture | price $39,525, before-fee $39,525, fee $895 | includes fee | $38,630 + $895 = $39,525 (was $40,420) |
| Zero or missing fee | price $30,000 | either | $30,000, no fee row |
| Draft fee $925 | before-fee $39,525 | before fee | $40,450 |
| Draft fee $925 | price $40,420 | includes fee | $40,420 (selling $39,495) |

Visible mismatches on the fixture:
- All three rows read Mismatch.
- The website shows $40,420 against a $39,525 label.
- Each stored breakdown ($X before fee + $895) does not add up to its
  fee-inclusive total.

Tests:
- Fee-inclusive and fee-exclusive prices.
- Zero, null and undefined fees.
- Draft fees on both bases.
- Parity with `buildPassportSaleCard` across bases and fees.
- Website, Passport and breakdown mismatches, including one where website
  and Passport agree but the breakdown does not.

Screen 13 timeline:
- The mobile cards and the desktop table map the same `timeline` array.
- The inactive copy is `display: none`.
- No duplicate IDs and no focus stops in either.
- At 390 the accessibility tree exposes only the list; at 1600 only the
  table.
- Accepted as is.

Light-only limitation: Administration keeps its light palette under the
app's dark class. Dark-theme support is not claimed.

Checks on `1dd1d4b`:
- Typecheck clean.
- Application tests: 55 files, 553 tests, all passing.
- Harness tests: 10 of 10, separate.
- Audit clean on all 13 screens.
- 39 of 39 phone and tablet viewports with 0px page overflow.
- Fee review dialog: 0 failing checks.

Protocol v2 (agreed) with v1 historical:

| # | **v2 content** | Band | v1 historical | Landmarks |
| --- | --- | --- | --- | --- |
| 01 | **92.99%** | below 94: not passed | 89.83% | pass |
| 02 | **88.01%** | below 94: not passed | 87.40% | pass |
| 03 | **90.70%** | below 94: not passed | 90.64% | pass |
| 04 | **89.87%** | below 94: not passed | 88.96% | 7 fail (owner decision) |
| 05 | **89.87%** | below 94: not passed | 89.64% | pass |
| 06 | **94.15%** | 94.00-94.99: individual review | 90.34% | pass |
| 07 | **87.83%** | below 94: not passed | 87.58% | pass |
| 08 | **92.12%** | below 94: not passed | 89.66% | pass |
| 09 | **86.53%** | below 94: not passed | 85.60% | pass |
| 10 | **89.53%** | below 94: not passed | 86.76% | 3 fail (owner decision) |
| 11 | **89.84%** | below 94: not passed | 89.09% | 1 fail (title block) |
| 12 | **92.22%** | below 94: not passed | 90.50% | 1 fail (owner decision) |
| 13 | **87.77%** | below 94: not passed | 87.23% | 3 fail (owner decision) |

No screen reaches 95%. Only 06 (94.15%) is in the individually reviewable
band; the other twelve are below 94% and not passed.

### 10.9 Pricing conflict: fee change on a fee-inclusive vehicle (traced on `1dd1d4b`, policy B prepared)

One coherent fee-inclusive vehicle, fee $895 to $925, traced through the
real paths:
- the deployed `admin_doc_fee_change_preview` and
  `admin_doc_fee_change_apply`, in the isolated local database
  (`scripts/db-verify`, transaction rolled back);
- the rendered screen 05 component;
- the actual `derivePassport` and `buildPassportSaleCard` code on the
  reloaded row.

No production data was read or changed. Evidence:
`scripts/admin-parity/evidence/pricing/fee-925-*`.

| Step | Source (field) | Selling portion | Fee | Advertised total |
| --- | --- | --- | --- | --- |
| Before | `vehicle_listings`: `price` 40,420; `advertised_price_before_doc` 39,525; `doc_fee` 895; `website_sale_price` 40,420; tenant `price_display_mode` = `website_sale_price` | 39,525 | 895 | 40,420 |
| 1. Screen 05 draft preview | `customerPrice()` reading `price` (inventory total) | 39,495 | 925 | **40,420** |
| 2. Screen 06 server dry-run | `admin_doc_fee_change_preview` sample: `selling_price` = `advertised_price_before_doc`; `total_after` = `advertised_price_before_doc + fee` | 39,525 | 925 | **40,450** |
| 3. Saved (reloaded) | `admin_doc_fee_change_apply` writes `doc_fee` = 925 and `website_sale_price` = 40,450; `price` stays 40,420 | n/a | 925 | `website_sale_price` **40,450**; `price` **40,420** |
| 4a. Label after reload | `vehicle_listings.price` | n/a | n/a | **40,420** |
| 4b. Passport after reload | `public-listing-view` copies `price_display_mode`; `derivePassport` uses `resolveDisplayPrice`, which anchors on `price`; `buildPassportSaleCard` gives selling = price - fee | 39,495 | 925 | **40,420** |

**Conflict:**
- The server dry-run and the saved `website_sale_price` say the advertised
  total becomes $40,450, with the before-fee price kept.
- The Label, the Passport and the screen 05 preview all read `price`, so
  for customers the total stays $40,420 and the selling portion drops to
  $39,495.
- After the save the same vehicle carries two different totals.

The consistency check reports this rather than hiding it: Mismatch,
breakdown +$30, "Stored breakdown ($39,525 before fee + $925 fee = $40,450)
differs from the advertised total by +$30".

On the `advertised_before_doc` basis the paths agree: the Passport shows
the before-fee $39,525 + $925 = $40,450.

**Decided: policy B** (owner, 2026-10-28). On a fee-inclusive tenant the
inventory total is authoritative.

The fix is prepared, not applied:
- `supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql`. It has not
  been applied to any hosted project. There was no backfill and no deploy.
- Client code that mirrors it: `src/lib/admin/pricing/feeBasis.ts`.

**Fee basis** (`doc_fee_basis` / `resolveFeeBasis`):
- `includes_fee` when `advertised_includes_doc_fee` is true (or the legacy
  `advertised_excludes_doc_fee` is false).
- If neither key is set, the basis follows the display mode: `includes_fee`
  when `price_display_mode` is `website_sale_price`, otherwise `before_fee`.
- `conflict` when the two keys contradict each other. Nothing is applied
  under a conflict.

**Source versus derived fields**, read from marketcheck-sync and
crawl-advertised-prices:

| Basis | Source (kept by a fee change) | Derived (rewritten by a fee change) |
| --- | --- | --- |
| includes_fee | `price` (advertised total); `website_sale_price` (observation, never rewritten, never used to reprice) | `advertised_price_before_doc` = `price` - fee |
| before_fee | `advertised_price_before_doc` | `website_sale_price` = before-fee + fee |

**Rows the fix skips.** A fee-inclusive row is skipped (`split_mismatch`)
when its stored before-fee price plus its current fee does not equal
`price`. The row is left exactly as stored and reported. Which value is
the newer observation cannot be known here, so neither is rewritten to
make them agree.

**The traced vehicle under policy B:**

| Step | Selling portion | Fee | Advertised total |
| --- | --- | --- | --- |
| Before | 39,525 | 895 | 40,420 |
| Screen 05 draft preview | 39,495 | 925 | 40,420 |
| Screen 06 dry-run sample | 39,525 -> 39,495 | 895 -> 925 | 40,420 -> 40,420 (No change) |
| Saved, reloaded row | `advertised_price_before_doc` 39,495 | 925 | `price` 40,420; `website_sale_price` 40,420 (kept) |
| Label | n/a | n/a | 40,420 |
| Passport | 39,495 | 925 | 40,420 |

The same vehicle on a fee-exclusive tenant: before-fee 39,525 is kept, and
39,525 + 925 = 40,450.

**Until the migration is applied:**
- For a fee-inclusive dealership, the review now holds Apply whenever the
  installed preview does not report a basis, that is, the deployed routine.
  The deployed routine would write 40,450.
- Fee-exclusive dealerships are unaffected.

**Read-only reconciliation of existing rows.**
`scripts/db-verify/fee-basis-reconciliation.sql` runs in a READ ONLY
transaction. A counts-only summary was read from the hosted database on
2026-10-28. No identifiers or prices are recorded here.
- Tenant 1 (`includes_fee` from the setting):
  - Active vehicles: 85 consistent, 43 whose before-fee price does not add
    up to the total, 2 without a price.
  - Archived vehicles: 185 consistent, 12 that do not add up, 3 without a
    price.
- Tenant 2: one active vehicle stored as before-fee = total; it also fails
  the fee check.
- In every row that disagrees, `website_sale_price` equals before-fee +
  fee. The disagreement is therefore between the stored before-fee price
  and `price`. These rows need review: none is repriced or backfilled, and
  policy B skips them.

**Verification** (isolated database, every case rolled back):
- 1,035 cases, run with `scripts/db-verify/run.sh --policy-b`.
- All fee-conflict (deployed), reconciliation and policy B cases pass.
- The deployed conflict is pinned in `31_fee_conflict_deployed.sql`.
- The only failures are the 6 known `live`-stage cases of the pre-fix
  preview (section 4).
- Results: `scripts/admin-parity/evidence/pricing/policy-b-db-verify*.csv`.

**Screen 06 parity re-measured** with the new example row:
- Content 94.11% (was 94.15%).
- Full 88.44% (was 88.47%).
- Landmarks ok.

### 10.10 Policy B hardened for deployment review (2026-10-29)

**Status.** The policy B design is approved. The production migration is
**not** approved, and nothing here was applied, deployed or backfilled. The
only production access was read-only SELECTs.

#### What changed since 10.9

1. **The legacy evidence writer is retired.**
   - `recalc_tenant_doc_fee` refused every call in the proposal (`0A000`).
     It used to restamp `price_last_verified_at`, reset parser warnings and
     reach archived vehicles.
   - The browser fallback no longer saves a dealership fee or recalculates.
     If `admin_doc_fee_change_apply` is missing, Apply is refused and nothing
     is written.
   - The delegation proposal (`20261030000000_pricing_authority_delegation.sql`)
     no longer redefines `recalc_tenant_doc_fee`. If it had, applying it would
     have brought the old writer back.
   - The reviewed apply never writes verification stamps, parse status or
     notes, and touches archived stock only on explicit request.
2. **Provenance is classified, never assumed.** `website_sale_price` is no
   longer called website evidence. Admin copy now says "stored sale price ...
   its source is not verified". The per-vehicle review classifies each price
   from its writer's stamp and the observation tables:
   - `verified_website_observation`: equals the latest `advertised_prices`
     row;
   - `dealer_feed`: equals `mc_raw.price`;
   - `derived_calculation`;
   - `legacy_recalculation`: stamped by `recalc_tenant_doc_fee`;
   - `uncertain_provenance`.
3. **Only an explicit setting decides the fee basis.**
   - `doc_fee_basis` reads only `advertised_includes_doc_fee` (or the legacy
     `advertised_excludes_doc_fee`). The display mode is no longer used to
     guess.
   - Missing or unreadable is `unconfigured`; contradictory is `conflict`.
     Both block a fee change.
   - A latest website observation that contradicts the basis also blocks
     (`doc_fee_evidence_contradicts`).
   - The basis keys moved into the pricing role class.
   - SQL and TypeScript use identical rules. The parity test runs the SQL
     functions' own answers through the TypeScript contract: 15 basis cases,
     288 row plans and 18 evidence cases, all identical.
4. **There are no partial dealership-wide fee changes.**
   - `doc_fee_change_review` blocks the entire change, writing nothing, while
     any vehicle in scope has one of these conflicts:
     - a before-fee price that does not add up to the total;
     - a fee that would leave no vehicle price;
     - on a fee-inclusive basis, a stored sale price that differs from the
       total;
     - a contradicting website observation.
   - The refusal is audited as `doc_fee_policy_blocked`.
   - `merge_dealer_settings` refuses a changed `doc_fee_enabled` or
     `doc_fee_amount` once a dealership has priced vehicles, so the fee only
     moves through the reviewed apply.
   - Vehicles are row-locked for the length of an apply.
   - Each apply's audit row keeps before and after for every vehicle it
     writes.
   - There is no exception path. Any exception needs separate owner approval.
5. **The fee-inclusive Apply block in the client stays.** Against the
   installed routine, Apply is held unless the dealership has explicitly
   stated a fee-exclusive basis.

#### Verification

**Isolated local Postgres** (`scripts/db-verify/run.sh --policy-b`): 1,389
cases. Results are in `scripts/admin-parity/evidence/pricing/policy-b-db-verify.csv`.

| Stage | Cases | Result |
| --- | --- | --- |
| Deployed behaviour (the traced conflict reproduced) and the reconciliation summary | 9 | pass |
| Policy B: hosted cases rerun (settings, products, prices, fee review, health) | 323 | pass |
| Policy B: basis authority, includes and before fee, values and rounding, dealership block, settings guard, retired recalculation, repeats | 39 | pass |
| Two real sessions: concurrent applies with different keys and with the same key | 5 | pass |
| Data revert from an apply's audit row (a later writer's values kept) | 5 | pass |
| Code rollback in a fresh database: four definitions and grants equal to hosted, nothing left behind; then the hosted cases | 3 + 335 | pass |
| `live` stage: the documented pre-fix preview defect (section 4) | 6 | fail, as before |

**Screens and reload.** `policyBReload.test.ts` reads the rows the isolated
database saved after the concurrent applies, and checks that the following
agree after reload:
- Screen 05 (`customerPrice`);
- Screen 06 (the database's own dry-run JSON, through `loadFeePreview`);
- Label (`price`);
- Passport (`buildPassportSaleCard`).

**Application tests.**
- Admin suites: 56 files and 588 tests, plus 6 reload tests and 17 parity
  tests. All pass.
- Harness: 10 of 10. Typecheck: clean.
- Screen 05 measures 89.87% content and screen 06 94.11%. Both are unchanged.

**Staging kit** (`scripts/db-verify/staging/policy-b/S00`–`S09`):
- Built from the same files by `build-policy-b-kit.sh`. It is paste-safe,
  with no psql meta-commands.
- Every step except the read-only S00 starts with a guard that refuses any
  database holding non-synthetic dealerships or vehicles.
- Run end to end on a fresh database: S00 PASS, 41 staging cases with 0
  failed, S09 rollback check PASS.
- Not yet run on a Lovable Cloud staging project. The two-session concurrency
  cases cannot run through a one-statement SQL tool; they ran locally only.

**RooftopOS / draft PR #36.**
- No file overlaps: 55 files against 30 here. No table or function overlaps
  either: its migration creates only new integration tables and functions and
  alters nothing existing.
- One naming hazard: PR #36's migration and the unapplied delegation proposal
  both use version `20261030000000`. Renumber the delegation proposal before
  it is ever promoted.
- The policy B kit's S00 refuses a project that holds the RooftopOS staging
  tables, so the two staging runs cannot mix.

#### Existing conflicts: read-only classification (counts only)

The per-vehicle report is restricted and is not in this repository. Counts:

| Tenant | Scope | Class | Vehicles | Recommended handling |
| --- | --- | --- | --- | --- |
| 1 | active | A: fee subtracted twice by an earlier crawl; the website observation (Oct 3) equals total - fee | 10 | Candidate correction prepared, not run: before-fee = total - $895; legacy-derived sale price = total. |
| 1 | active | B1: newer website observation (Oct 27-28, screenshot) below the feed total; the feed is paused until Nov 1 | 7 | Dealer confirms the current price. Changing the advertised total needs per-vehicle approval. |
| 1 | active | B2: newer website observation above the feed total (+$9,105 x14, +$3,105 x10, +$1,105, +$488) | 26 | No proposal. Check each screenshot: a figure above the feed may include add-ons, MSRP or a misread. It is never adopted automatically. |
| 1 | active | C: no usable price | 2 | None. These do not block a fee change. |
| 1 | archived | E: legacy-recalculated split mismatch | 12 | None. These are outside fee changes unless archived stock is explicitly included. |
| 1 | archived | C: no usable price | 3 | None. |
| 2 | active | D: fee ($895) exceeds the stored total ($171); legacy-recalculated | 1 | Confirm the real price or unpublish. No automatic change. |

A dealership-level block holds for tenant 1 while any of its 43 active
conflicts remain. The class A correction alone does not lift it: those 10
vehicles' latest website observations show total - fee, which contradicts the
fee-inclusive setting until a newer observation or a basis decision supersedes
them.

#### Remediation process (nothing runs without explicit approval)

1. **Review.** The owner reviews the restricted per-vehicle report:
   - generated by `scripts/db-verify/fee-basis-vehicle-review.sql`;
   - read-only;
   - lists provenance, dates, stored fields, the disagreement and a
     recommendation.
2. **Approve by class.** For each class, approve, reject or defer. Class A
   has a guarded correction ready:
   - each update applies only if the row still holds the reviewed values;
   - it writes before and after to `audit_log` as
     `pricing_reconciliation_applied`;
   - it never touches `price`, observations, stamps or parser warnings.
3. **Confirm B1 and B2 with the dealer.** Use the screenshots and the DMS,
   and repeat after the feed resumes on Nov 1. Any change to an advertised
   total is a per-vehicle approval.
4. **Apply through Lovable.** Run approved corrections through Lovable's SQL
   tool, one transaction each. Then rerun the read-only review.
5. **Repeat** until the review shows no active conflicts. Only then can a fee
   change pass the dealership block.

#### Staged deployment and rollback plan (each stage needs the owner's go)

| Stage | Action | Check | Stop and roll back if |
| --- | --- | --- | --- |
| 0 | Staging on a new, empty Lovable Cloud project: run S00-S09 (prompt below). | S00 PASS; S07 failed = 0; S09 PASS. | Any step errors or fails. |
| 1 | Production read-only pre-check: rerun the per-vehicle review and `SELECT public.doc_fee_basis(settings) FROM dealer_profiles`. Confirm both tenants state their basis. | Counts match the table above or are explained. | An unexplained change. |
| 2 | Apply the migration through Lovable, verbatim from `supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql`. | `SELECT public.doc_fee_change_review('<tenant 1>', 895, false)` returns `blocked: true` with the three reasons the review predicts: split mismatches, stored sale prices that differ from the total, and contradicting website observations. Preview and apply exist with the new definitions. | Any error, or the review is not blocked. |
| 3 | Watch for one business day. No fee change is possible while tenant 1 is blocked. | `audit_log` has no `doc_fee_policy_applied`; any refusal shows as `doc_fee_policy_blocked`. | Unexpected writes. |
| 4 | Remediation (above), class by class, each approved separately. | The review reruns clean. | Any guarded update affects other than the expected rows. |
| R | Rollback: run `supabase/proposed/20261031000000_doc_fee_basis_policy_b.rollback.sql` through Lovable. If an apply ran, run `scripts/db-verify/fee-change-revert-from-audit.sql` with its audit id. | S09-equivalent fingerprint check PASS. | Not applicable. |

The client changes in this commit only make Apply stricter. They work
against both the installed routines and the proposed ones, so they need no
rollback of their own. Reverting the commit is enough if wanted.

#### Lovable prompts (copy and paste)

**Staging (new project; never the AutoLabels project):**

> Create a NEW, empty Lovable Cloud project named "AutoLabels policy B
> staging". Do not connect it to the AutoLabels project or its database,
> and do not add edge functions, cron jobs or secrets. In that new project
> only, run each of the following SQL files with the database tool, one file
> per call, exactly as written and in this order:
> S00_isolation_check.sql, S01_hosted_prestate.sql,
> S02_applied_migrations.sql, S03_harness_and_fixtures.sql,
> S04_deployed_cases.sql, S00_isolation_check.sql (again),
> S05_policy_b.sql, S06_policy_b_cases.sql, S07_results.sql,
> S08_rollback.sql, S09_rollback_check.sql.
> The files are in the GitHub repository KenCarbiz/autolables-74375bef on
> main, under scripts/db-verify/staging/policy-b/. After each call, reply
> with the returned row verbatim. Stop at the first error and report it. Do
> not change any file, and do not create migrations in any other project.

**Production pre-check (read-only, AutoLabels project; only when stage 1 is
authorized):**

> In the AutoLabels project, run this read-only query with the database tool
> and return the rows verbatim. Do not create a migration and do not change
> any data:
> `SELECT tenant_id, (public.doc_fee_basis(settings)).* FROM public.dealer_profiles;`
> Note: this needs the stage 2 functions. Before stage 2, run
> scripts/db-verify/fee-basis-vehicle-review.sql instead, without its
> psql lines (`\set`, `\if`, `BEGIN`, `ROLLBACK`).

**Production migration (AutoLabels project; only when stage 2 is
authorized):**

> Create a database migration whose content is exactly the file
> supabase/proposed/20261031000000_doc_fee_basis_policy_b.sql from the
> GitHub repository KenCarbiz/autolables-74375bef on main, unchanged. Do not
> edit, reformat or split it, do not change any other file, and do not
> deploy edge functions. After it applies, run this read-only check and
> return the row verbatim:
> `SELECT public.doc_fee_change_review(tenant_id, 895, false) FROM public.dealer_profiles;`

### 10.11 Pricing root cause (2026-10-29), owner summary

**Scope.** This section covers the 43 active tenant-1 conflicts. The per-vehicle
evidence is in a restricted report kept outside this repository. Production
was only read, with SELECTs. No price, migration, job or deployment changed.
The tenant-wide fee Apply stays blocked.

#### What is happening

1. **The fee basis differs by page type, and the crawler assumes one basis.**
   - The MarketCheck feed marks its price fee-inclusive on 41 of the 43
     vehicles (`price_includes_fees: true`, `fees: 895`); the flag is null on
     2 CPO vehicles.
   - New-vehicle pages show a "Selling Price" before the fee. On all 9 new
     class A vehicles it equals MSRP and equals feed price minus $895.
   - Used and CPO pages showed the same figure as the fee-inclusive feed
     price on 9 September 2026.
   - `crawl-advertised-prices` applies one dealership flag
     (`advertised_includes_doc_fee`) to every page. On new-vehicle pages it
     therefore subtracts the fee from a price that never contained it.
2. **The feed has been frozen since 1-3 October.** MarketCheck refused 45 of
   46 October calls for quota. Meanwhile the crawler kept reading the
   dealer's pages: 27-28 October, with screenshots.

#### Classes (counts only)

| Class | Vehicles | Root cause | Confidence | Proposed field change |
| --- | --- | --- | --- | --- |
| A | 10 (9 new, 1 CPO) | The derived before-fee price lost the fee twice. Two sources agree to the dollar: page = feed - $895, and page = MSRP on the new ones. | High | `advertised_price_before_doc` = total - fee on all 10. Nothing else changes. The change is prepared, dry-run and reversible, and not run. |
| B2 | 25 (all new INFINITI) | The page's before-fee price is exactly $10,000 (14 vehicles), $4,000 (10) or $2,000 (1) above the feed's. That is consistent with an incentive or conditional offer included in the feed price but not in the page's Selling Price, or an offer that has since ended. Their stored before-fee price also carries the class A double subtraction. | Systematic: high. Cause: medium. Which price to advertise: unknown. | None until the incentive treatment is confirmed from the screenshots or OEM incentive data. |
| B1 | 8 used/CPO (7 lower by $721-$2,602, 1 higher by $488) | Dealer repricing after the feed froze. Page and feed agreed to the dollar on 9 Sep; the gaps are not fee- or incentive-shaped. | Medium-high | None now. The November feed refresh should catch up; any remaining gap needs dealer confirmation and a per-vehicle approval. |

The B2 count of 26 in 10.10 included one used vehicle. It behaves like B1,
so it has moved there.

**B2 compliance note (not legal advice).** If the feed price includes
conditional incentives not available to every buyer, the Label and Passport
currently show that lower figure, while the dealer's page shows $10,000 or
$4,000 more.

**Archived and no-price records** are untouched and quarantined. The
correction template refuses archived and unpriced vehicles outright.

**After A1, tenant 1 stays blocked.** The 10 class A vehicles' page
observations show total - fee, which contradicts a fee-inclusive basis. That
is a basis decision for new-vehicle pages, not a further price change.

#### Tools added (synthetic tests only; nothing ran against production)

- **Root-cause review.** `scripts/db-verify/fee-basis-vehicle-review.sql`
  gains `root_cause`, `website_minus_total` and
  `website_minus_feed_before_fee`. The root cause is one of:
  - `double_fee_subtraction`
  - `incentive_gap_suspected`
  - `repricing_after_feed_freeze`
  - `unexplained`

  It compares the latest page observation with the feed, so a B2-style gap is
  still reported after a feed write makes the stored fields agree with each
  other.
- **Guarded correction and its reverse.** `scripts/db-verify/pricing-correction.template.sql`
  and `pricing-correction-revert.template.sql` are paste-safe. Each run:
  - is all or nothing;
  - applies only if all four price fields still hold the reviewed values;
  - refuses archived or unpriced vehicles, non-price fields and repeated
    batches;
  - writes an audit row per vehicle with before, after and evidence;
  - never touches verification stamps, parse status or notes.

  A revert works only while each vehicle still holds the corrected values.
- **Isolated database:** a new `root cause` stage runs on synthetic
  look-alikes of each class (`05_root_cause_fixture.sql`,
  `43_root_cause_and_correction.sh`). 18 cases, all passing. Full run: 1,407
  cases; the only 6 failures are the documented pre-fix `live` cases.

#### Proposed code fix (not written to `supabase/functions`, not deployed)

- In `crawl-advertised-prices` `buildBreakdown`, decide each page's fee
  treatment instead of applying the dealership flag. When the feed says its
  price includes the fee and the page figure equals feed price minus fee,
  treat the page figure as the before-fee price. Otherwise keep today's rule.
- Record the decision in the observation notes.
- Apply it to new-vehicle pages first. Add a test with the class A shape.
- This changes the writer for every vehicle, so it needs its own approval.

#### MarketCheck: November refresh readiness (no calls made)

| Item | State |
| --- | --- |
| `marketcheck-sync` | Scheduled and active, hourly at :07. It is calling now and being refused for quota (last call 03:07 UTC on 29 Oct). |
| `marketcheck-incentives` | Scheduled and active, daily at 03:30. |
| `enrich-sweep-nightly` | Paused. |
| Call budget | `provider_call_budgets`: cap of 5,000 calls a month, 250 reserved for essential calls, enabled. `market_provider_budgets`: disabled. |
| October | 46 calls: 45 refused for quota, 1 with no result. |
| November quota | Not confirmed. This needs the MarketCheck account. |

**Consequence.** No restart is needed for paid calls to resume: the two
active jobs will start succeeding as soon as the quota resets. The first
successful sync rewrites `price`, `advertised_price_before_doc`,
`website_sale_price`, `doc_fee`, `price_parse_status` and
`price_last_verified_at` on every vehicle it returns. That probably resolves
class A and most of B1. B2 would then look consistent in the stored fields,
although the new review still reports it.

**Decision needed before the reset**, both owner-authorized:
- **(a)** let the jobs resume on their own; or
- **(b)** pause `marketcheck-sync` and `marketcheck-incentives` until quota
  and budget are confirmed.

Lovable prompt for (b), only if authorized:

> In the AutoLabels project, do not change any code, migration or data. Run
> exactly this through the database tool and return the result:
> `SELECT jobname, cron.alter_job(jobid, active := false) FROM cron.job WHERE jobname IN ('marketcheck-sync', 'marketcheck-incentives');`
> then `SELECT jobname, active FROM cron.job WHERE jobname IN ('marketcheck-sync', 'marketcheck-incentives');`.
> To resume later, run the first statement with `active := true`.

#### Decisions requested

1. Approve, reject or defer A1, the 10-vehicle before-fee correction. It is
   prepared, dry-run and reversible.
2. Decide the fee treatment of new-vehicle pages. A dealer or screenshot
   check confirms whether the page "Selling Price" excludes the fee. This
   decides whether the evidence block on those vehicles reflects a real
   basis conflict.
3. B2: check the screenshots for an offer line, or authorize an OEM incentive
   lookup (a paid MarketCheck call). Then decide which price the dealership
   advertises.
4. MarketCheck before the quota reset: choose (a) or (b).
5. Approve or defer the crawler fee-treatment fix.

### 10.12 Owner decisions of 2026-10-29: outcomes

Aggregate only. The per-vehicle detail is in the restricted report, outside
the repository.

| Decision | Outcome |
|---|---|
| 1. Pause `marketcheck-sync` and `marketcheck-incentives` | Done by Lovable 03:51 UTC. Verified read-only: both inactive, schedules and command hashes unchanged, every other job's state unchanged, no run and no MarketCheck call after the pause. Not resumed on November 1 without approval. |
| 2. Class A correction | Deferred. The guarded correction and reverse remain prepared, not run. |
| 3. New-vehicle disclosure | Not yet verified. The stored evidence is consistent with new-vehicle "Selling Price" before the fee and used/CPO with it, but the crawler keeps no page text and every page uses the same label. The dealer site is not reachable from the session and the screenshots are in a private bucket. |
| 4. B2 review | 25 vehicles. The gap is stable on every weekly crawl from mid-September to 27 October, so an offer that ended in October is unlikely. The feed price equals the page "Selling Price" minus $10,000 (QX80) or $4,000 (QX60), plus the fee, which explains the $9,105 and $3,105. The dealer's own pages label $4,000 as retail cash on other QX60s. Incentive-shaped, cause high confidence; whether the incentive is conditional is unknown. No paid call made. |
| 4. Compliance flag | The Passport shows the feed figure (`website_sale_price` display, fee-inclusive basis), so all 25 show a price $9,105 or $3,105 below the dealer's own page. Flagged for compliance review; nothing rewritten. |
| 5. Crawler fee treatment | Built and tested in isolation; not deployed (below). |

**Paid-call paths still open after the pause** (budget-guarded, no schedule
change requested):
- `specs-backfill` (daily) and `factory-sticker-sweep` call `marketcheck-specs`.
  These write decode data, not prices.
- A dealer's on-demand enrichment calls `vehicle-enrich`, which can write
  `price`.
- `enrich-sweep-nightly` is already paused.

#### Per-page fee treatment (decision 5), development only

- `supabase/proposed/crawl-fee-treatment/feeTreatment.ts` is a pure module that
  decides one page's fee treatment for new, used and CPO pages.
- The page condition comes from the page address and the listing; if they
  disagree, the page is unresolved.
- What counts as evidence:
  - **Decisive:** a fee line for the configured amount with a labelled total,
    or disclosure wording such as "plus conveyance fee" or "price includes the
    documentation fee".
  - **Declared:** a dealer setting for that condition
    (`advertised_includes_doc_fee_by_condition`, proposed, not added). It
    decides only when something corroborates it.
  - **Corroborating:** a price label, or the feed's own fee basis when the page
    shows the identical figure.
- A figure that merely differs from another price by the fee is not evidence.
- The tenant-wide setting never decides. Where the page contradicts it, the
  page stays unresolved until the dealer declares the condition-specific
  treatment.
- Missing or contradictory evidence leaves the page unresolved. An unresolved
  page writes no price split: stored values are kept, the website observation
  is still recorded, and the reason and evidence are audited.
- `crawl-advertised-prices.patch` beside the module wires it into the crawler.
  It applies cleanly to current `main` and is NOT applied. The module is under
  `supabase/proposed`, so no function deploy can pick it up.
- Tests: `src/lib/admin/pricing/proposedCrawlFeeTreatment.test.ts`, 23 cases,
  all passing. The module typechecks under strict mode and the patched crawler
  parses.
- With today's settings and stored evidence, this dealership's pages would be
  unresolved: no condition-specific setting exists and no page text is stored.
  The crawler would stop writing price splits, so the split it currently writes
  on new-vehicle pages from the tenant-wide setting would stop.

### 10.13 Revised root cause: the dealer price stack (2026-10-29)

Aggregate only. Per-VIN detail is in the restricted report.

The owner supplied two price stacks from the dealer's public site. The dealer's
new-vehicle widget is a sequence of stages:

> MSRP, dealer discount, dealer price (before incentives and fee),
> manufacturer incentives, conveyance fee, customer total ("Your Price",
> after incentives, with the fee)

What each source carries:

| Source | Figure it carries | Evidence |
|---|---|---|
| Feed `price` | The customer total | Both examples match to the dollar. |
| Crawler, on the B2 pages | The dealer-price stage | Stored as if it were the fee-inclusive total. |
| Stored discount and retail-cash fields | Unreliable | Read with page-wide patterns, not from the vehicle's widget. They contradict VIN-level arithmetic. |

The generic page disclaimer says the fee is excluded, but the itemised
customer total includes it. That contradiction is flagged, not resolved.

| Class | Revised finding |
|---|---|
| B2 (25) | A pre-incentive dealer price was compared with a post-incentive customer total, not an advertised-price discrepancy. The gap is exactly the incentive less the fee: 14 x $10,000, 10 x $4,000, 1 x $2,000. Confirmed for 1 vehicle by the owner's stack. Consistent for 24, but not confirmed: their page and feed observations are weeks apart and no incentive line was captured. Incentive eligibility unverified. Compliance flag reframed: the displayed customer total includes an incentive of unverified eligibility. |
| A (10) | The double fee subtraction stands. On the same day, the page figure plus the fee equalled the feed total, with no incentive. The correction (A1) stays deferred and is recommended to be superseded: regenerate it from each vehicle's reconciled stack through the same guarded template. 9 of the 10 have stored discount or retail-cash values the same-day arithmetic contradicts, so they hold for widget evidence. |

**Crawler design, revised (proposed, not deployed).**

`supabase/proposed/crawl-fee-treatment/priceStack.ts` reads the vehicle's own
pricing widget:
- **Scope.** The page region runs from the VIN to the next different VIN.
  Another vehicle's card is never read, and two stacks with totals in one
  region are ambiguous.
- **Line roles.** Each line is classified as MSRP, discount, dealer price,
  incentive, fee, customer total or unknown. The dealer's own labels for the
  dealer-price and total stages are configurable, via the proposed setting
  `price_stack_labels`.
- **Arithmetic.** The stack must close: MSRP minus discounts equals the dealer
  price, and the dealer price minus incentives plus the fee equals the customer
  total. The fee line must state the configured fee, and it must sit between
  the dealer price and the total.
- **Output.** The customer total and its label, the before-fee price after
  incentives, the dealer price before incentives, every discount and incentive
  with its eligibility (`stated_unconditional`, `conditional` or `unknown`), the
  fee and the figure it is included in, and the arithmetic proof.
- **Disclaimers.** Widget-scoped and page-scoped disclaimers are kept
  separately.
- **Unresolved.** An unknown line, a stack that does not close, a fee-amount
  mismatch, an ambiguous scope or a missing VIN leaves the vehicle unresolved.
- **Held for review.** A stack that reconciles is still held, writing nothing,
  when an incentive lacks eligibility evidence or a disclaimer contradicts the
  itemised fee.
- **Comparison with the feed.** `compareWithFeed` names the stage of a stored
  figure and compares the feed only with a page observation within 3 days. It
  returns one of: `agrees`, `pre_vs_post_incentive`, `genuine_difference`,
  `dates_not_comparable`, `unresolved`.
- **Single-figure pages.** Pages with no itemised stack fall back to the
  per-page fee logic of 10.12.

The condition-specific fee setting proposed in 10.12 is not sufficient. On
one new-vehicle page the dealer price excludes the fee and the customer total
includes it, so fee treatment belongs to the labelled figure, not to the
vehicle condition. The setting is kept only as corroboration on single-figure
pages.

The regenerated `crawl-advertised-prices.patch` does the following:
- It reads the stack first.
- It writes the split only from a reconciled, unflagged stack:
  - before-fee = total - fee;
  - sale price = the customer total;
  - discount and retail cash = sums of the widget lines.
- It audits every stack it reads (`advertised_price_components`, with lines,
  disclaimers, flags and proof).
- Otherwise it writes nothing but a warning.
- It applies cleanly to current `main` and is not applied.

Tests: 22 price-stack cases in `src/lib/admin/pricing/proposedPriceStack.test.ts`,
on synthetic look-alikes of both supplied stacks, including a conflicting
generic disclaimer, a conditional incentive, an incentive stated as available
to all buyers, a similar-vehicle card, an ambiguous region, split label and
amount blocks, a fee below the total, an unknown line, a fee-amount mismatch, a
missing total and the feed comparison. With the 23 cases of 10.12, 45 tests
pass.

### 10.14 Price-stack development round 2 (2026-10-29): audit, policy, gates

Aggregate only. Per-vehicle detail is in the restricted audit.

**Evidence sources this round.**
- The dealer site and ftc.gov are not reachable from the session: both are
  blocked by the environment's allowed-domains policy.
- **Verified:** the one stack the owner supplied.
- **Stored:** feed and crawl observations, by VIN and timestamp.
- **FTC guidance:** the 15 September 2026 staff FAQs, read through legal and
  trade summaries, not the primary page.
- **No dated page evidence** was obtained for the other 24 B2 vehicles or the
  nine held class A vehicles.

#### Customer-facing audit (25 flagged new vehicles, all published)

| Surface | Shown today | Issue |
|---|---|---|
| Passport headline, Total Advertised Price, Today's Price | Feed total `price` (fee included) | Nets an incentive of unverified eligibility (14 x $10,000, 10 x $4,000, 1 x $2,000), not disclosed |
| Passport "Dealer Discount" | MSRP - (`price` - fee) | Presents the incentive as dealer discount |
| Passport "You Save" | MSRP - `price` | Counts the incentive as savings |
| Passport market claims (24 with a market value) | "Great Price", "Best Value", "$X Below Market", score 82-91 | Built on the incentive-netted price. Without it, 16 of 24 would be at or above market |
| Payment estimates | Built on `price` | Same base |
| Addendum "Listed Price", Sticker Studio "Our Price" / "Offered At" | `price`, printed live | Same figure, no incentive disclosure |
| Window sheet in "Total MSRP" mode | `price` labelled "Base MSRP" | Separate labelling defect |
| Factory sticker, addendum label | MSRP only | Not affected |

The $895 fee is included in every total and itemised on the Passport. Fee
treatment is not the problem on these surfaces.

#### Proposed public price-display policy (for owner and dealer compliance review)

1. **Primary advertised price.** The generally available, all-in total: dealer
   price + mandatory fees, minus only offers verified as available to every
   buyer and unexpired. Government charges are the only exclusion.
2. **Verification.** An offer is verified generally available only through a
   program record from an authoritative source: OEM program data or a
   dealer-approved entry with dates. A website label, a generic statement or
   arithmetic that closes is never sufficient.
3. **Conditional or unverified offers.** Shown only separately, after dealer
   compliance approval. Each is named, with its amount, its qualification
   ("requires financing through the captive lender", "eligibility not
   verified") and its expiration date, and never folded into the headline or
   into "You Save" or "Dealer Discount".
4. **Savings and discount lines.** "Dealer Discount" shows only the dealer's
   own discount from the widget. "You Save" uses the primary price.
5. **Market comparison and scores.** Use the fee-exclusive comparison basis
   (dealer price minus verified offers). While any offer on the vehicle is
   unverified, price-fairness and confidence displays show limited confidence.
   They never derive a "Great Price" or "Below Market" claim from an
   unverified offer.
6. **Unknown or contradictory evidence.** No automatic price change. The
   vehicle is held for review.

#### Proposed remediation for the 25 vehicles (not applied; needs authorization)

- **R1, immediate, presentation only, 25 vehicles.**
  - Suppress the market-claim chips and badge ("Great Price", "Best Value",
    "Below Market") and the "You Save" line.
  - Relabel "Dealer Discount" as "Discounts and incentives", or hide it.
  - Add the line "Price includes manufacturer incentives; eligibility
    restrictions may apply. See dealer for details."
  - Reversible by flag. No price change.
- **R2, owner choice.** Show the generally available total as the headline,
  with the $10,000 / $4,000 / $2,000 offer listed separately, until each offer
  is verified. This changes customer-facing prices and needs the dealer's
  compliance sign-off.
- **R3.** Fix the window sheet "Total MSRP" mode labelling `price` as
  "Base MSRP".
- **R4, dealer disclosure (proposed wording for the dealer's review).**
  > "Your Price includes the dealer conveyance fee of $895 and all
  > manufacturer incentives shown above. Retail Cash and other manufacturer
  > incentives are subject to manufacturer eligibility requirements, may not
  > be available to all buyers, may not be combinable, and expire as stated.
  > Excludes tax, title and registration."

  This replaces the generic statement that the conveyance fee is excluded,
  which contradicts the itemised Your Price.

#### Parser revision (proposed, not deployed)

- **Ownership by page component.** A small HTML element tree (`htmlTree.ts`)
  decides which vehicle a widget belongs to: the nearest enclosing component
  that names the vehicle. VINs that already own their own widgets are set
  aside, and the page address names the vehicle on a detail page.
  - An inventory list that prints the VIN under the price is attributed
    correctly; text-distance scoping misattributed it.
  - Identical mobile and desktop copies count as one stack. Differing copies
    are ambiguous.
- **Each incentive on its own evidence.**
  - **Eligibility:** `verified_general` only from a program record;
    `stated_general_unverified`, `conditional` or `unknown` otherwise.
  - **Also recorded:** restrictions (financing, lease, purchase, credit,
    loyalty, conquest, military, college, first responder, trade-in,
    residency), combinability, and effective and expiration dates.
  - Footnotes bind to an offer by marker or by name. Page-wide text never
    binds.
  - **Held for review:** expired offers, exclusive offers applied together, and
    unverified offers. A held vehicle writes nothing.
- **Separate outputs:** the dealer's advertised total, the generally available
  total and the fee-exclusive market-comparison basis.
- **Immutable evidence.** `priceEvidence.ts` builds one hashed record per
  component, disclaimer and stack summary. The proposed table
  `20261101000000_price_component_evidence.sql` (with a rollback) is
  append-only:
  - update, delete and truncate are refused by trigger;
  - a reading is unique by its hash;
  - tenant-scoped read follows the canonical RLS shape;
  - only the service role writes.

  Verified in an isolated database with `scripts/db-verify/price-evidence-verify.sh`:
  13 of 13 checks pass. Not applied to production.
- **Fixtures.** `sanitizePage.ts` turns a captured page into a fixture: VINs
  mapped, names replaced, scripts and external references removed, and stage
  prices shifted by one offset so the arithmetic still closes. Tested. Real
  captures await domain access (gate G2).
- **Integration.** The crawler patch is regenerated:
  - It appends evidence and writes only the generally available split.
  - It never writes `price`.
  - It loads program records from an empty loader until an intake exists, so
    every offer reads as unverified.
  - It applies cleanly and is not applied.
- **Tests.** 54 price-stack, evidence and sanitiser cases, covering:
  - new, used and CPO pages;
  - multiple widgets and duplicate VINs;
  - conflicting disclaimers;
  - expired and mutually exclusive offers;
  - per-offer eligibility;
  - unavailable evidence.

  Pricing suite 167 of 167; app typecheck clean.

#### Readiness gates for a controlled rollout

| Gate | Condition | Status |
|---|---|---|
| G1 | Owner approves the public price-display policy and the dealer's compliance contact signs off on conditional-offer wording | Open |
| G2 | The dealer's public website domain allowed for read-only access; real pages captured, sanitised and added as fixtures for new, used and CPO pages, and the parser passes on them | Open (blocked by network policy) |
| G3 | Dated widget evidence for the 24 B2 and 9 class A vehicles; each classified by `compareWithFeed` with same-window observations | Open (depends on G2) |
| G4 | Program-record intake designed and approved (OEM program data or dealer-entered offers with dates and eligibility) | Open |
| G5 | Evidence table migration approved and applied, then verified in production read-only | Open |
| G6 | R1 presentation safeguards approved and shipped before any crawler write, so unverified offers stop driving savings and market claims | Open, recommended first |
| G7 | Crawler patch deployed in shadow mode: evidence and audit only, no listing writes, for at least one full crawl cycle; held and unresolved rates reviewed | Open |
| G8 | Listing writes enabled for one dealership with a rollback flag; class A correction regenerated from reconciled stacks through the guarded template | Open |
| G9 | MarketCheck resumption decided separately, after quota, cost and these safeguards | Open (paused) |

### 10.15 Screen 06 individual review package; all 13 screens on one revision (2026-10-29)

**Revision.** Every number below was measured in one harness run on
implementation commit `7f4fa1a`. `a46cfa7` and this commit add only review
tooling and evidence under `scripts/`, so the app code is the same. No
screen was tuned in this round. The acceptance rule is unchanged:
- 95% target;
- 94.00-94.99% eligible for individual approval;
- below 94% is below the numeric target unless a specific exception is
  approved.

| # | Screen | v2 content | Band | Landmarks |
| --- | --- | --- | --- | --- |
| 01 | Overview | 92.99% | below 94 | pass |
| 02 | Dealership & Brand | 88.01% | below 94 | pass |
| 03 | People & Access | 90.70% | below 94 | pass |
| 04 | Member role | 89.87% | below 94 | fail (owner layout decision) |
| 05 | Price rules | 89.87% | below 94 | pass |
| 06 | Fee change review | **94.11%** | 94.00-94.99: individual review | pass |
| 07 | Product applicability | 87.83% | below 94 | pass |
| 08 | Contact & Routing | 92.12% | below 94 | pass |
| 09 | Escalation rules | 86.53% | below 94 | pass |
| 10 | Effective policy | 89.53% | below 94 | fail (owner layout decision) |
| 11 | Approval rules | 89.84% | below 94 | fail (approved title block) |
| 12 | Inventory feed | 92.22% | below 94 | fail (owner layout decision) |
| 13 | Sync run detail | 87.77% | below 94 | fail (owner layout decision) |

Every value equals the earlier figure for that screen, so the mixed-revision
table in 10.8 and 10.9 is superseded by this one.

**Screen 06 package** (`scripts/admin-parity/evidence/`):
- **Reference, actual, overlay and differences:** `overlay/06.png`.
- **Side by side with diffs:** `side-by-side/06.png`.
- **Actual captures:**
  - `screen-06-review/actual-06-1586x992.png`;
  - `screen-06-review/06-1920x1080.png`;
  - `screen-06-review/06-1366x768.png`;
  - `screen-06-review/06-390x844.png`.
- **Desktop states** (`screen-06-review/states/`, with `states-06.json`):

  | State | Buttons and messages |
  | --- | --- |
  | Review as opened | Back to edit enabled; Apply to 48 active vehicles enabled |
  | Back to edit | Review changes enabled; draft kept |
  | Fee set back to $895 | Review changes disabled |
  | Amount -5 submitted | "The fee cannot be negative." |
  | Fee switched off | Amount field disabled |
  | 1366x768 | The review fits without scrolling |

- **Phone captures** (`screen-06-review/mobile/`): 390x844, 320x568 and
  390x500 (short, on-screen keyboard), captured as the dialog body scrolls.
  30 of 30 checks pass:
  - the dialog fits the viewport;
  - the page behind does not scroll;
  - Close, Back and Apply are reachable;
  - every fee and total is readable;
  - focus is trapped and returns to the trigger;
  - the inputs scroll into view.
- **States the fixture cannot reach:** Apply disabled while the review is
  held, Apply disabled without pricing authority, and impact not computable.
  These are covered by `FeeReviewPage.test.tsx`; with the pricing suites, 183
  of 183 tests pass. The fixture does not perform an apply.

**Pricing in screen 06 (verified).**
- The example row follows the corrected fee-inclusive rule: fee $895 to $925,
  selling price $18,525 to $18,495 (-$30), advertised total $19,420 to
  $19,420 (no change).
- The phone check had still expected the pre-correction total of $19,450.
  The check was updated to the corrected values; the screen was not changed.
- **Deviation from the mock: approved by the owner for policy B
  (2026-10-29).** The reference shows the pre-correction arithmetic: selling
  price unchanged, advertised total +$30. The screen keeps selling price
  $18,495 + fee $925 = unchanged advertised total $19,420. The mock's
  arithmetic is not to be restored, and the corrected phone check stays.
- **Proposed rule, not live.** The behaviour shown is the policy B rule. The
  policy B migration is not applied in production, so the live dialog shows
  whatever the deployed server preview returns.

**Approval status (owner, 2026-10-29).**
- Screen 06 is **individually approved for visual acceptance**, on review of
  package `a085c74`, measuring implementation `7f4fa1a`.
- The recorded score stays **94.11%**: below the 95% target and approved
  individually, not rounded or reclassified.
- The policy B pricing difference from the mock is accepted.
- The approved visual direction for screen 06 is **frozen**. No further
  pixel tuning.
- The approval covers appearance only. These remain separate release checks:
  - the policy B production migration;
  - actual Apply behaviour;
  - authorization in a browser;
  - keyboard behaviour on a real device.
- The other 12 screens remain pending. 01, 08 and 12 are next for focused
  visual review; there is no broad typography tuning.

**Evidence index correction** (after approval; images unchanged):
- `states-06.json` in `a085c74` listed two captures that were never
  delivered:
  - an "applied" capture: the fixture performs no apply, so that capture
    only repeated the review step;
  - a 1366x768 scroll-end capture: the review fits at that size.
- Both entries are removed. The 1366x768 capture is renamed
  `06-desktop-1366x768-fits.png` and labelled as fitting without scrolling.
- `states-06.cjs` no longer captures an Apply state, and takes scrolled
  captures only when the review overflows.
- Apply was not demonstrated in any capture.

**Revisions.**
- Measured implementation: `7f4fa1a`.
- Review and evidence package: `a085c74`.

**Verification limits.**
- The short-viewport runs (390x500) simulate reduced space. They are not
  proof of how a real phone keyboard behaves.
- The held-review, no-permission and impact-not-computable states are
  covered by unit tests. They have not been verified in a browser.
- The demo screen does not exercise Apply. The apply path is not
  browser-verified.
- The policy B production migration remains on hold.

**Current captures of 01, 08 and 12** for review before any tuning proposal:
- `overlay/01.png`, `overlay/08.png`, `overlay/12.png`;
- `side-by-side/01.png`, `side-by-side/08.png`, `side-by-side/12.png`;
- `screen-06-review/actual-{01,08,12}-1586x992.png`.

No tuning is proposed until you have reviewed them.

### 10.16 Focused visual review: 01, 08 and 12 (2026-10-29)

**Revision.** Implementation `b278995`. All 13 screens were measured in one
harness run at that revision, and every score equals its 10.15 value. The
screen 06 capture and score are unchanged, and its approval and frozen
direction stand.

| # | Screen | v2 content | Band | Landmarks |
| --- | --- | --- | --- | --- |
| 01 | Overview | 92.99% | below 94 | 10 of 10 |
| 02 | Dealership & Brand | 88.01% | below 94 | pass |
| 03 | People & Access | 90.70% | below 94 | pass |
| 04 | Member role | 89.87% | below 94 | fail (owner layout decision) |
| 05 | Price rules | 89.87% | below 94 | pass |
| 06 | Fee change review | 94.11% | approved individually (appearance) | pass |
| 07 | Product applicability | 87.83% | below 94 | pass |
| 08 | Contact & Routing | 92.12% | below 94 | 12 of 12 |
| 09 | Escalation rules | 86.53% | below 94 | pass |
| 10 | Effective policy | 89.53% | below 94 | fail (owner layout decision) |
| 11 | Approval rules | 89.84% | below 94 | fail (approved title block) |
| 12 | Inventory feed | 92.22% | below 94 | 11 of 12 (childTabs: owner decision) |
| 13 | Sync run detail | 87.77% | below 94 | fail (owner layout decision) |

01, 08 and 12 are below 94%. Each would need an explicit, screen-specific
exception; none is proposed or approved here. The other nine screens remain
pending.

**Usability defect corrected (12, commit `b278995`).**
- At 1366x768 the Recent attempts table's fixed reference columns left the
  Details column about 26px wide. Its text could be read only by scrolling
  the table 57px sideways.
- Refresh status's "On schedule" ran past the card's edge.
- At 768x1024 the table scrolled 2px sideways.
- Fix: the fixed column widths now apply from 1536px wide. Below that,
  columns size by content and wrap; the phone minimum table width is 700px.
- The 1586 layout and its score are unchanged.
- Checks: before and after captures; typecheck clean; Administration tests
  248 of 248; audit clean on 01, 08 and 12; 0px page overflow at 390x844,
  768x1024, 1366x768 and 1586x992 on all three screens.

**Package** (`scripts/admin-parity/evidence/focused-review-01-08-12/`; ZIP
delivered to the owner). For each screen:
- reference, actual at 1586x992, side-by-side, and overlay with differences;
- full-page captures at 1920, 1366, 1024 and 390;
- actual-viewport captures as the page scrolls at 1586x992, 1366x768,
  768x1024 and 390x844;
- `DIFFERENCES.txt`: numbered, in three groups (approved design changes,
  rendering differences, unresolved);
- `viewport-checks.json`: overflow and scroll regions;
- for 12, the pre-fix captures at 1366x768 and 768x1024 from `bf89227`.

**Unresolved items reported, not changed:**
- the open page-title-size decision (01);
- the 14px Call and Contact icons in 08's shopper-widget preview, which
  mirror the customer widget;
- the shared section-tab row, which scrolls 28px sideways with a fade at
  1366x768 on every screen.

No typography or pixel tuning was done.

### 10.17 Focused review, round 2: owner decisions on 01, 08 and the shared tabs (2026-10-29)

**Revisions.**
- Current implementation `2fe74e3`. All 13 screens were re-measured at it,
  and every score is unchanged from 10.16 (01 92.99%, 08 92.12%, 12 92.22%,
  06 94.11%).
- `b278995` and evidence `0536e10` remain the record of the screen 12 table
  fix.
- `b04a863` adds only annotation tooling.
- Annotated captures are in
  `scripts/admin-parity/evidence/focused-review-01-08-12/annotated-2fe74e3/`.
- Screen 12's pre-fix laptop captures there are labelled HISTORICAL
  (`bf89227`).

**Decisions recorded:**
- **01 title.** The shared parent "Administration" title at 28px is an
  approved design decision. Its difference from the mock's ~36px is
  recorded as approved, not reopened.
- **08 widget preview.** The Call and Contact items are an embedded
  customer-widget representation, not Administration controls.
  - They are non-interactive spans with aria-hidden 14x14 icons, the same
    size as the real widget.
  - Each item is 135x32. The real widget draws 36px buttons with 12px
    labels; the preview uses 32px and 11px.
  - Icon centre is within 0.25px of the label centre.
  - Text contrast is 5.0:1 on the button wash and 6.9:1 on the widget blue.
  - The 16px icon minimum still applies to Administration controls.
- **Shared section and child tabs.** Horizontal scrolling with the edge fade
  is kept. Two defects were fixed in `2fe74e3`:
  - Keyboard focus did not bring the focused tab into view: the last
    section tab stayed outside the row at 1366, and tabs sat under the fade
    at 1024 and 390. `ScrollRegion` now scrolls the focused item, and the
    active tab on load, clear of both fades.
  - The focus outline was clipped to one edge by the scrolling row. Tabs
    now draw the outline inset.

  Labels and touch targets are unchanged.
  `scripts/admin-parity/tabs-check.cjs` verifies every scrolling row on 01,
  08 and 12 at 1366, 1024 and 390, 10 of 10 passing:
  - the fade shows;
  - the active tab is fully visible;
  - every keyboard-focused tab is fully visible and clear of the fades,
    with an unclipped outline;
  - a horizontal wheel reaches the last tab;
  - there is no page overflow.
- **Checks at `2fe74e3`:** typecheck clean; Administration tests 248 of 248;
  audit clean on all 13 screens. The audit's existing notes are unchanged:
  small icons on 06 and 09, and sandbox network errors on 07. Screen 06's
  capture and score are unchanged, and its approval and freeze stand.

No exception is approved for 01, 08 or 12; each remains pending the owner's
screen-specific decision.

### 10.18 Focused review: classification corrected and scoring contract confirmed (2026-10-29)

Documentation only. No pixel tuning, no new capture, no protocol or mask
change, no rerun. Implementation `2fe74e3`; evidence `4958ce9`. The
annotated images in `focused-review-01-08-12/annotated-2fe74e3/` were
relabelled from the same captures, which are byte-identical to the `0536e10`
captures except 08's phone capture. That one is the `2fe74e3` capture,
committed in `annotated-2fe74e3/sources/`; it differs only in the section tab
row. This section supersedes the "approved design change" and "rendering
difference" groupings in 10.16, 10.17 and the earlier `DIFFERENCES.txt`.

**Classes.** "Approved" is used only where a prior owner decision can be
cited. Every other design choice is a proposed exception.

| Class | 01 | 08 | 12 |
| --- | --- | --- | --- |
| Approved, with citation | 28px "Administration" title (owner 2026-10-29; title block 2026-10-28, 10.6 item 1) | title block and section row (10.6 item 1; 10.7); 14px widget-preview icons (owner 2026-10-29: "Do not enlarge") | heading under the tabs (10.7: "no heading above the 12 tabs"); no sort arrow (owner 2026-10-29: "Do not add a sorting arrow") |
| Proposed exception: geometry / design choice | 24px page margin (mock 20px); 11px minimum text size (mock about 9-10px); section tab row dimensions | 24px page margin (mock 33px); tab rows: 14px labels in 38px and 40px rows (mock about 15px in about 45px) | 24px page margin (mock 31px); tab row dimensions |
| Proposed exception: behaviour / truthful content | none | Review changes disabled; "Not supported yet"; warning lists what is missing; draft bar copy; no scope chevron; Escalation switch on its own page; sticky draft bar | "Jobs & Pipelines" tab; "Previously validated", last successful pull, schedule time, rate-limit wording |
| Asset substitution | standard icon set (lucide) for the mock's icons | same | same |
| Rendering difference | font rasterization (and the wraps it adds); the mock's banner edge colour | font rasterization; native switch appearance; 1px edge anti-aliasing | font rasterization; the mock's resampled banner button edge |
| Fixture data, masked under v2 | tile counts; activity times; activity details | none | run times; provider domain; rooftop pin; pager count |
| Mock-only annotation | footer captions (masked); DESIGN CONCEPT chip in the header, outside the content region | footer caption (masked); DESIGN CONCEPT chip **not masked, scored** | footer caption (masked); DESIGN CONCEPT chip **not masked, scored** |
| Phone layout, no reference (not scored) | tabs scroll with a fade; banner action under the text | sticky draft bar; owner column collapsed; active tab in view | active tab in view; banner action wraps |

Corrections made while classifying:
- The 11px minimum text size was listed as approved under "preserve
  readable text". No owner approval of the size itself exists, so it is
  now a proposed exception. The 01 settings-tile wraps follow mainly from it
  (11px against the mock's about 9-10px), with font widths adding to them.
- Page margins and tab-row dimensions were listed as rendering differences.
  They are geometry, now proposed exceptions.
- Truthful copy, disabled actions and the missing chevron were listed as
  approved under "real data semantics". They are proposed exceptions; 10.6
  item 6 is still pending.
- 08's child-tab row was described as 13px text in a 36px row. Measured at
  `2fe74e3` it is 14px in a 40px row.
- The 12 laptop "after" captures are marked "defect corrected", not
  "approved".
- The owner accepted horizontal tab scrolling at 1366px on conditions. The
  phone rows use the same component and pass the same checks, but phone
  layout has no reference and is listed for review, not as approved.

**Scoring contract.**
- Protocol v2 was owner-authorized on 2026-10-28 and introduced in `8b8f981`
  (20:56 UTC).
- `masks.json` last changed in `6391e7a` (18:19 UTC the same day), before v2.
  `git diff 8b8f981 HEAD` shows no change to `masks.json`, `compare.cjs` or
  `capture.cjs`.
- The elements the 01 and 12 mask selectors match are unchanged since
  `8b8f981`: the Overview source has not changed, and the inventory feed's
  `data-parity` hooks are untouched (`b278995` changed only column widths).
  08 has no selector masks.
- Every v2 evidence run (`00075b6`, `fbd18a2`, `a085c74`, `0536e10` and
  `4958ce9`) reports the same masked share and score for these screens:

  | Screen | Masked share of the 1586x992 frame | Score |
  | --- | --- | --- |
  | 01 | 3.94% | 92.99% |
  | 08 | 0.27% | 92.12% |
  | 12 | 2.80% | 92.22% |

- The published scores are **masked**. Masked pixels are excluded from both
  images and from the denominator. No unmasked v2 figure is published, and
  none was computed for this note.
- One inconsistency was found and left unchanged. The DESIGN CONCEPT chip is
  masked as a mock-only annotation on 02, 03, 06, 07, 09 and 13, but not on
  08 or 12, so it counts against those two scores. 10.0 describes the chip
  as masked; that is not true for 08 and 12.

Kept unchanged: the `2fe74e3` keyboard-tab fixes and the `b278995`
responsive table fix. Screen 06 remains individually approved at 94.11% and
frozen. 01, 08 and 12 remain pending the owner's screen-specific decision,
and the other nine screens remain pending.

### 10.19 Acceptance register (2026-10-29)

**Owner decision, 2026-10-29.** Screens 01, 08 and 12 are individually
approved for visual acceptance:
- at implementation `2fe74e3`;
- using evidence `4958ce9`;
- with the corrected classifications in `f23762a`.

The screen-specific geometry, truthful-content, behaviour and
asset-substitution exceptions listed in 10.18 are accepted for these three
screens.

The register lives in `scripts/admin-parity/acceptance.json`, and the parity
report prints it:
- The report carries an acceptance forward only while a measurement matches
  the recorded score and mask share to two decimals.
- Otherwise it flags the acceptance "needs review".
- The gate itself is unchanged: an accepted screen still reports
  "below 95%".

| # | Screen | Status | Protocol v2 content (masked) | Masked share of the 1586x992 frame | Implementation | Evidence | Exceptions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Overview | individually accepted with listed exceptions | 92.99% | 3.94% | `2fe74e3` | `4958ce9` | 10.18: geometry, asset substitution |
| 06 | Fee change review | individually approved | 94.11% | 4.13% | `7f4fa1a` | `a085c74` | 10.15: policy B pricing difference |
| 08 | Contact & Routing | individually accepted with listed exceptions | 92.12% | 0.27% | `2fe74e3` | `4958ce9` | 10.18: geometry, truthful content, behaviour, asset substitution |
| 12 | Inventory feed | individually accepted with listed exceptions | 92.22% | 2.80% | `2fe74e3` | `4958ce9` | 10.18: geometry, truthful content, behaviour, asset substitution |

Pending (9): 02, 03, 04, 05, 07, 09, 10, 11, 13.

Terms of the acceptance:
- **Scores.** These are masked reference-match scores, kept at their exact
  values and mask coverage.
  - 01, 08 and 12 do not meet 94% or 95%.
  - 06 sits in the 94.00-94.99% band and does not meet 95%.
  - The comparison protocol is unchanged.
- **Phone layouts.** The 390x844 layouts of 01, 08 and 12 were visually
  reviewed separately. No reference-match score is claimed for them.
- **Kept.** The keyboard-tab fixes (`2fe74e3`) and the responsive table fix
  (`b278995`).
- **Frozen.** The accepted visual direction on 01, 06, 08 and 12, including
  the correct disabled actions, truthful wording and readable text sizes.
  Changes to the shared shell, tabs or tokens must leave these four screens'
  scores and captures unchanged, or come back for review.
- **Scope.** This covers appearance and the listed visual exceptions only.
  It does not authorize:
  - deployment;
  - the production pricing migration;
  - any claim that untested functionality works.

### 10.20 Focused visual review: 03, 04 and 07 (2026-10-29)

**Revisions.**
- Implementation `2d7954d`; evidence `ec43fe0`. The annotated, defect and
  state sheets were built from those captures in the following commit.
- All 13 screens were measured in one run at `2d7954d`. 01, 06, 08 and 12
  match their accepted scores and mask shares exactly, so the register still
  carries their acceptance. Every other score is unchanged except 07.
- Package: `scripts/admin-parity/evidence/focused-review-03-04-07/`
  (`MANIFEST.txt`, per-screen `DIFFERENCES.txt`).

| # | Screen | v2 content (masked) | Masked share | Landmarks | Status |
| --- | --- | --- | --- | --- | --- |
| 03 | People & Access: Team | 90.70% (unchanged) | 3.71% | 9 of 9 | pending |
| 04 | Member role | 89.87% (unchanged) | 0.95% | 1 of 8 (7 follow from the owner-decided section row) | pending |
| 07 | Product applicability | 87.86% (was 87.83%) | 3.13% (was 3.08%) | 9 of 9 | pending |

07's masks are unchanged. The masked vehicle-name cells grew 2px because a
status label now wraps (D4), and that moved both the score and the masked
share.

**Usability defects found and corrected in `2d7954d`.** Each was
identified, with before captures, before it was changed.

| # | Screen | Defect | Correction |
| --- | --- | --- | --- |
| D1 | 03 | At 1536px and wider, "Title Clerk / Office Mgr" ran 10px into the Department column | Long role labels wrap; other roles stay on one line; row heights unchanged |
| D2 | 04 | At 1280-1535px the capability matrix hid 57-217px, including Manage, behind sideways scrolling | The cards sit side by side from 1536px and stack below |
| D3 | 07 | Below 1536px Sample vehicle results hid the Publication column (102px at 1366) | The panels sit side by side from 1536px and stack below |
| D4 | 07 | At 1586, "Ready for review" was clipped under the fade | Status labels wrap inside their column |
| D5 | 07 | The Product views tabs' focus ring was clipped to two bars by the scrolling row | The shared tabs' inset outline |
| D6 | 03 | On a phone, the role-change review step was taller than the viewport: title and Apply / Cancel unreachable | The dialog is capped to the viewport and scrolls inside |
| D7 | 03, 04 | Closing a People & Access dialog left focus on the page body | Focus returns to the button or row menu that opened it (`useReturnFocus`) |

The fixes are local to these screens' components. The shared shell, tabs,
tokens and the app-wide dialog component are unchanged, which is why the
four accepted screens re-measure identically.

**Remaining differences** (per screen in `DIFFERENCES.txt`, numbered to
match `annotated-2d7954d/`). The classes follow 10.18, and nothing is
labelled approved without a citation.
- **Approved with citation:**
  - 03: the one-Administration title (10.6 item 1; 10.7) and tabs outside
    the card (10.7).
  - 04 and 07: the section row above the child title (10.7).
- **Proposed geometry exceptions:**
  - page margins: 03 +6px, 04 +5px, 07 -2px;
  - tab-row label sizes and row heights;
  - 04's 12px breadcrumb;
  - 03's column widths from 1536px.
- **Proposed behaviour / truthful-content exceptions:**
  - 03: members identified by address (10.6 item 6); server order with no
    default sort; real role labels.
  - 04: linked breadcrumb; descriptions naming the member and "enforced";
    the status-source disclosure.
  - 07: back link and linked breadcrumb; Review changes disabled until a
    change; CPO following Used (shown checked and disabled); truthful copy.
- **Asset substitution:** the standard icon set on all three.
- **Rendering:** font rasterization on all three; native select chevrons
  and the disabled checkbox on 07.
- **Fixture data:**
  - Masked: 03 member addresses; 04 the member address; 07 sample vehicles
    and the price.
  - Not masked, and therefore scored: 07's product name and rule values.
- **Mock-only annotations:** the DESIGN CONCEPT chip and footer captions
  are masked on 03 and 07. 04 has only a footer caption, which is masked.
- **Phone (no reference, not scored):**
  - 03: stacked toolbar; sideways-scrolling table; rail below the table.
  - 04: matrix as per-capability cards with "Allowed" and "Not allowed".
  - 07: wrapped title block; scrolling Product views tabs; stacked mileage
    choices; sideways-scrolling sample table.

**States reviewed** (`NN/states/`, `state-sheets/`, `states.json`):
- 03: row menu, Change role editing and review, Remove, rail closed, no
  match.
- 04: Test role access, Review policy changes, status sources expanded, the
  1366 matrix.
- 07: unchanged (Review disabled), edited (enabled), review step, reversed
  year range (validation, Review disabled), the 1366 layout.

Desktop and phone. Every dialog fits the viewport. Focus returns to the
trigger, and no state overflows the page. Nothing was applied, because the
design fixtures write nothing.

**Checks at `2d7954d`:**
- typecheck clean;
- Administration tests (`src/pages/admin`, `src/components/admin`,
  `src/lib/admin`): 60 files, 666 tests, all pass;
- audit clean on 03, 04 and 07 at five viewports (07 logs only sandbox
  network errors);
- tabs-check passes on every scrolling tab row.

03, 04 and 07 are pending the owner's screen-specific decision. Accepted
screens remain exactly 01, 06, 08 and 12, and the other six pending
screens (02, 05, 09, 10, 11, 13) await individual review.

### 10.21 Focused review of 03, 04 and 07: visual exceptions separated from business rules (2026-10-29)

**Owner decision, 2026-10-29.** The seven usability fixes in `2d7954d` are
kept. 03, 04 and 07 remain pending. Exactly 01, 06, 08 and 12 remain
accepted, and 02, 05, 09, 10, 11 and 13 remain pending.

**Identifiers.**
- Implementation `2d7954d`; evidence `ec43fe0`.
- Annotated images were relabelled from the same captures. New images:
  - 03 role change review (desktop and phone);
  - 04 laptop stacked layout;
  - 07 validation state.
- Each screen's `DIFFERENCES.txt` now has separate sections: visual
  exceptions, behaviour and business rules, data, approved, defects
  corrected, phone, open findings and verification scope.

**What visual acceptance can decide.** Only these are proposed for visual
acceptance on 03, 04 and 07:
- spacing, margins and tab-row sizes;
- icon substitution;
- truthful wording.

Rendering differences are listed for information.

Behaviour and business rules are recorded but are not decided by visual
acceptance:
- default sort order (03);
- navigation links (04, 07);
- Review changes disabled until a valid change exists (07; preserved);
- the browser-computed role-change impact (03, 04);
- "CPO follows Used" (07).

10.20 listed "CPO following Used" among the proposed exceptions; it is
withdrawn from them here.

**CPO follows Used (business rule; not changed).**
- `product_rules.condition` stores `new`, `used` or `all`; there is no CPO
  value. A CPO vehicle is treated as used, so CPO cannot be included or
  excluded separately from Used.
- This predates V2: the schema and `matchesRule` date from `e5c1a60`
  (2026-09-09). V2 (`587b2e3`) only made the derived CPO box visible.
- The dealer sees it only on the product applicability page, as a
  disabled CPO box with a tooltip and screen-reader text. The Applicability
  rule editor offers All, New only and Used only, and no setting separates
  CPO.

**Open finding (reported, not changed).**
- The addendum builder (`src/pages/Index.tsx`) never passes a vehicle's
  condition or mileage to `matchesRule`, so a product rule's condition and
  maximum mileage are not applied on addenda today.
- Screen 07's sample results do apply them, and the page says the samples
  run "through the same matcher the addendum uses".
- The two can disagree. For example, the fixture's CPO vehicle at 96,480 mi
  is shown as not eligible under an 80,000 mi limit, but the addendum would
  include it.
- This predates V2, and the fix (the addendum input, or the wording) is a
  separate decision.

**Screen 07 scoring.**
- The mask definitions are unchanged.
- The effective masked area increased from 3.08% to 3.13% because the
  masked Vehicle cells grew 2px where a status label wraps (D4).
- Because the excluded area changed, 87.83% to 87.86% is not a visual
  improvement and is not reported as one.
- No score tuning was done.

**Acceptance register strengthened (`f9ee8fe`).** Each accepted screen
keeps its baseline in `acceptance.json` and `scripts/admin-parity/acceptance/`.
Recorded from its evidence commit by `record-acceptance-baseline.cjs`:
- the accepted capture, byte for byte;
- the reference and its hash;
- the mask definitions as they stood;
- the rail, frame, threshold and capture settings.

The browser version is recorded from now on; earlier runs did not record
it.

Every report run checks each accepted screen three ways:
- score and mask share;
- contract: the reference, mask definitions and rail;
- the capture itself, pixel by pixel.

The results are reported as follows:
- A changed capture is flagged **inspect**, with its changed-pixel count
  and box, even when the scores match.
- A changed score, mask share or contract is flagged **review**.
- Nothing revokes an approval automatically.
- At `2d7954d` all four accepted captures are identical to their
  baselines.

**Verification scope.**

| Behaviour | Browser-exercised (design fixture, Chromium) | Unit-tested (vitest, mocked writers) | Production |
| --- | --- | --- | --- |
| 03 role change | dialog to the review step; Apply disabled by the fixture ("nothing is written") | applies only after review, re-reads the role, records the reason, reports refusals | not demonstrated; `set_tenant_member_role` was not run in this sign-off |
| 03 remove member | confirmation opened and cancelled | not covered | not demonstrated |
| 04 role permissions | matrix and cards displayed; Test role access is a preview computed in the browser that grants nothing | matrix values; review gating | enforcement not demonstrated; the page itself says "Policy draft" |
| 07 rule edit | edit, review, validation, Review gating; Apply enabled in the fixture and **not pressed** (the 07 fixture does not block Apply; dev-only route; a guard is proposed, not made) | review before apply; writes and refusals with a mocked client | no real rule write; the addendum's use of the rule not demonstrated |
| 07 sample results | computed in the browser from fixture vehicles and proof counts | matcher and checklist | do not match the addendum's behaviour (open finding) |
| Focus return, dialog fit, tab focus | exercised in Chromium | not covered | not checked on real devices or other browsers |

## 11. Approvals requested

1. Done: the fee preview fix was applied and verified (section 4).
2. Decide the pricing matrix questions in `ADMIN_V2_SERVER_AUTHORITY.md`
   section 10.3; on approval the proposal is applied and the two screen
   changes are prepared.
