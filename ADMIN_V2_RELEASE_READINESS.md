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
| 16 | Visual acceptance | Verified with exceptions | 10 of 13 screens at or above 97% layout parity; 03, 07 and 10 below by documented choice; full review clean (section 10) | 03, 07, 10 differences are intentional |

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

Measured on `main` at `bebbf0d` (code), the same harness, Chromium build,
1586x992 reference frame, device scale 1, light theme and deterministic
dev-only design fixtures as every earlier run. "Before" is `ff785c1`, the
commit before this polish round; re-running it reproduced its original
numbers exactly. Layout parity masks text boxes; it is reported separately
from the full review below and is not the acceptance test on its own.

| # | Screen | Route | Layout parity before | After | Landmarks | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | Overview | `/admin?tab=overview` | 94.85% | 97.42% | pass | activity and settings text no longer truncated (costs 0.65 against the mock's clamped lines) |
| 02 | Dealership & Brand, Identity | `/admin?tab=identity` | 96.78% | 98.15% | pass | |
| 03 | People & Access, Team | `/admin?tab=team` | 96.86% | 95.63% | pass | below 97 by choice: addresses are the member's only identifier and now wrap instead of truncating; the mock shows one-line names our data does not have |
| 04 | Member role (child) | `/admin/people/:memberId` | 96.65% | 97.99% | pass | |
| 05 | Pricing & Products, Price rules | `/admin?tab=price-rules` | 95.37% | 98.17% | pass | |
| 06 | Fee change review (child) | `/admin/pricing/fee-review` | 96.92% | 98.30% | pass | |
| 07 | Product applicability (child) | `/admin/products/:productId/applicability` | 95.92% | 96.99% | pass | below 97 by choice: Review changes stays disabled until the draft changes (0.48); shell gutter 26 vs 24px (0.46) |
| 08 | Customer Experience, Contact & Routing | `/admin?tab=routing` | 96.92% | 98.07% | pass | |
| 09 | Escalation rules (child) | `/admin/customer-experience/escalation` | 97.34% | 97.07% | 3px shift | measured against the navy rail edge; the stream's content-origin rail was reverted |
| 10 | Publishing, Effective policy | `/admin?tab=effective-policy` | 95.37% | 96.99% | fail (in-card tabs) | below 97: the approved IA draws tabs above the card, the mock inside it (1.60); gutter 30 vs 24px |
| 11 | Documents & Service, Approval rules | `/admin?tab=approval-rules` | 96.60% | 97.62% | fail (in-card tabs) | readiness labels wrap instead of truncating |
| 12 | Integrations, Inventory feed | `/admin?tab=inventory-feed` | 96.98% | 98.66% | fail (heading order) | |
| 13 | Sync run detail (child) | `/admin/integrations/runs/:runId` | 95.77% | 98.95% | fail (title spacing) | |

Evidence: `scripts/admin-parity/evidence/before-after/NN.png` (Before |
Reference | After at 1586x992), `evidence/responsive/NN.png` (1366, 1024,
390), `evidence/NN-1586x992-structure.png` (red layout, amber text, blue
masks), `ADMIN_V2_PARITY_REPORT.md` (every score and remaining difference),
`evidence/audit-final.json` (the full review below).

### 10.1 Full review (not a screenshot score)

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

### 10.2 Interactions

Tests now drive every screen: open child pages, select rows, edit drafts,
Review changes only after a valid change, cancel, save, refused and thrown
saves, retry after a failed read, and paid calls only on explicit click.
They found eight defects, all fixed with regression tests: refused rule
writes reported as Applied (07 and the Applicability list), negative prices
accepted (07), three saves stuck on Applying when the writer throws (02,
08/09, 10), malformed escalation addresses shown as configured (09), and
Review change enabled before any change (04). Admin, Sticker and hook
suites: 72 files, 688 tests, all passing; typecheck clean.

### 10.3 Intentional differences from the references

- 07: Review changes is disabled until the draft differs from the saved
  policy; the mock draws it enabled. Compared against the same state, the
  enabled style matches the primary button.
- 08: the Escalation on/off switch lives on the Escalation page that owns
  it; Contact & Routing reports the state and links there.
- 03: members are shown by address (our data has no names); addresses wrap.
- 09 and 12: "Not supported" and "Previously validated" where the mock
  says "Coming soon" and "Verified"; we do not claim what the data does not
  support.
- 10, 11, 12, 13: tab rows and title blocks follow the approved shell, not
  each mock's local variation.
- Page margins: the mocks draw 18-33px; the shell keeps one 24px value
  (section 10.4).

### 10.4 Shared spacing decision

The references disagree: left gutters 18-33px (median 27), right 15-27px
(median 25), navigation-to-content gaps 15-21px. No single value in
`AdminPageContainer` reproduces them; 26 or 28px would move 01, 03 and 04
further away. The shell keeps 24px and 16px, and no view compensates
locally.

### 10.5 Not tested

- Native iOS: this repository has no native code; nothing here changed a
  native screen or shared native asset. The Connect Card and Wallet
  implementations are not in this repository and were not touched.
- Real devices and Safari: the audit used Chromium at device scale 1.
- Live data in the browser: the sandbox cannot reach the hosted project,
  so screens were exercised through fixtures and component tests.

## 11. Approvals requested

1. Done: the fee preview fix was applied and verified (section 4).
2. Decide the pricing matrix questions in `ADMIN_V2_SERVER_AUTHORITY.md`
   section 10.3; on approval the proposal is applied and the two screen
   changes are prepared.
