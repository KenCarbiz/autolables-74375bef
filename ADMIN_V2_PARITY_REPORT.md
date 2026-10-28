# Administration V2 visual parity report

Generated 2026-10-28T19:37:02.767Z by `bun run admin:parity` against the development fixture route. Every screen is a synthetic fixture rendered by the real Administration components; no production data appears in any capture.

## Method

- Reference frame: 1586x992, the size the mocks were cropped to. Rendered and compared pixel for pixel as a diagnostic; it is not the agreed metric.
- Protocol frame: 1600x1000. This is the agreed comparison frame (`docs/05_VISUAL_PARITY_97_PROTOCOL.md`, `contracts/PARITY_TARGETS.csv`): the reference is resampled (bilinear) to it, captured at DPR 1 in Playwright Chromium, and its content-region parity is the number held to 97%.
- Pixel parity: a pixel differs when any channel moves by more than 32 of 255 after masks. Parity is 100 minus the differing share of compared pixels. No anti-aliasing allowance is applied.
- Structure: mean SSIM over 8x8 luminance blocks after masks.
- Masks: only dynamic data (counts, relative times, fixture names) listed in `scripts/admin-parity/masks.json`, read from the rendered DOM so the same boxes mask both images. Navigation, tabs, headings, card bounds, tables, buttons and chips are never masked.
- Content region: y >= 70 and x past the mock's rail (each screen's `_rail` in `scripts/admin-parity/landmarks.json`, 217 to 264px across the set; the fixture sizes its rail stand-in to the same number so the content origin lines up). The rail and the product header belong to the global application shell (`AppShell`, whose live rail is 256px), which this refresh does not restyle; the full-frame score includes them for completeness.
- Landmarks: hand-measured boxes from the reference (`scripts/admin-parity/landmarks.json`, tolerance 16px) compared with the rendered DOM boxes. A `yBody` landmark is measured from the section-row bottom on both sides.
- Layout parity (text masked) and text-box parity: the body region split by the implementation's text boxes (every rendered line of text, padded 2px, and the content box of every form control). Layout parity scores everything outside them: fills, borders, spacing, component sizes and icons. Text-box parity scores the glyphs inside them, where Chromium's Inter and the mock renderer differ even when the box sits exactly where the mock's text sits. Mock text that falls outside every implementation text box counts against layout, so misplaced or missing copy is not hidden by the split. The layout diff image (`*-structure.png`) marks layout differences red and text-box differences amber.
- Mock-only annotations: the handoff mocks print captions on the image itself (the Proposed design footer, the DESIGN CONCEPT label, a sample-policy caption, a recovery-flow caption). They are not product UI; `masks.json` covers them on both images with the reason recorded.
- Body parity (aligned): the handoff's information architecture fixes one h1, "Administration", with a breadcrumb above it, while the mocks title their pages four different ways (section name as title, no breadcrumb, no description, a chip above the title). That title block is a proposed exception awaiting the owner, not an approved one. As a diagnostic only, the body score shifts the reference so both section rows end on the same pixel row and scores everything below it in the content region, with the same masks. The offset is printed with the score and it never replaces the protocol number.
- Responsive: 1920x1080, 1366x768, 1024x768 and 390x844 captured; a breakpoint passes when the document has no horizontal overflow and no element extends past the viewport.

Registered fixtures: 10, 11, 12, 13, 01, 02, 03, 04, 05, 06, 07, 08, 09.

## Screen 01

Reference: `scripts/admin-parity/reference/01-admin-overview.png`. Fonts: Inter loaded (Inter). Gate: FAIL (protocol content parity 89.83% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/01-1586x992.png` | 92.98% | 79.20% | 92.99% | 78.59% | 92.81% (+0px) | 77.19% | 97.78% | 70.07% | 3.94% |
| 1600x1000 | `scripts/admin-parity/out/01-1600x1000.png` | 90.26% | 69.90% | 89.83% | 67.05% | n/a | n/a | n/a | n/a | 3.94% |

Rail stand-in: 229px (the mock's rail width); content region starts at x=232.
Section row bottom: reference y=238, capture y=238 (title block offset +0px).
Diff image: `scripts/admin-parity/out/01-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/01-1586x992.png` and `scripts/admin-parity/evidence/01-1586x992-diff.png`.

Masks (14): summary tile counts; recent activity relative times; recent activity detail lines (fixture names); mock-only annotation (handoff footer caption, not product UI).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| breadcrumb | within tolerance | x=249 y=86 | x=253 y=86 yBody=-152 w=1309 h=18 | x+4 y+0 |
| title | within tolerance | x=249 y=116 h=40 | x=253 y=116 yBody=-122 w=1309 h=40 | x+4 y+0 h+0 |
| sectionNav | within tolerance | x=249 y=200 w=1317 h=38 | x=253 y=200 yBody=-38 w=1309 h=38 | x+4 y+0 w-8 h+0 |
| banner | within tolerance | x=249 y=254 w=1317 h=58 | x=253 y=253 yBody=15 w=1309 h=60 | x+4 y-1 w-8 h+2 |
| tile1 | within tolerance | x=249 y=326 w=313 h=79 | x=253 y=326 yBody=88 w=311 h=81 | x+4 y+0 w-2 h+2 |
| tile4 | within tolerance | x=1235 y=326 w=331 h=79 | x=1235 y=326 yBody=88 w=327 h=81 | x+0 y+0 w-4 h+2 |
| attentionCard | within tolerance | x=249 y=420 w=889 | x=253 y=421 yBody=183 w=886 h=315 | x+4 y+1 w-3 |
| policyCard | within tolerance | x=1152 y=420 w=414 | x=1151 y=421 yBody=183 w=411 h=576 | x-1 y+1 w-3 |
| settingsCard | within tolerance | x=249 y=748 w=603 | x=253 y=750 yBody=512 w=598 h=247 | x+4 y+2 w-5 |
| activityCard | within tolerance | x=862 y=748 w=276 | x=862 y=750 yBody=512 w=277 h=247 | x+0 y+2 w+1 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1851 | none | `scripts/admin-parity/out/01-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/01-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/01-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div | `scripts/admin-parity/out/01-390x844.png` |

### Findings for screen 01

- Round 2 (layout parity, text boxes masked): 94.85% to 98.07%; body 89.68% to 93.21% (offset +0px); text-box parity 63.66% to 70.81%; content 90.43% to 93.29%; 10 of 10 landmarks within 16px; no overflow at 1920, 1366, 1024 or 390.
- Type re-derived by cap height (Inter cap 0.727 of the size): Effective policy label and value 15/20 (mock cap 11px; label semibold, value medium) with the detail 12.5/18 (cap 9); queue title 13/18 semibold, detail 12/18, owner and action 13/18, header 12.5/18 in ink, chips 12.5/18; banner title 16px (x-height 9), detail 12.5px; card titles 17/24 (What needs attention, Effective policy) and 15/20 (Administration settings, Recent activity); tile title 12.5/16 and detail 11/13; activity title 11/16 (mock cap 8); detail and time held at the 11px floor where the mock draws about 10px (cap 7).
- Structure set from the mock: Effective policy rows as a 36px icon box, a 24px status mark and a text column at x 1245 on an 87.5px pitch; the queue on 52/53/53/56px rows under a 35px header with 25px chips; tiles 81px tall with 52px circles and a 12px gutter; Administration settings as 74 and 76px tiles 6px apart with a 40px icon square; Recent activity on a 40px pitch with a rule under the header; the banner a 60px strip with a soft 2px amber edge, a filled 34px mark and a 35px button.
- Remaining layout difference (1.93% of compared pixels): the shell's 24px gutter against the mock's 20px moves every outer card edge 4px in on the left and 5 to 6px on the right (worth 0.19 points, measured with the shell at 20px); lucide glyphs against the mock's own drawings in the tiles, queue, settings, activity and policy rows; Inter text widths (chips, the banner title running past the mock's detail, two settings titles that wrap where the mock keeps one line); and the mock's banner edge, whose colour varies along its length by more than the 32/255 tolerance.

## Screen 02

Reference: `scripts/admin-parity/reference/02-dealership-brand.png`. Fonts: Inter loaded (Inter). Gate: FAIL (protocol content parity 87.38% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/02-1586x992.png` | 88.83% | 69.02% | 88.00% | 64.99% | 92.72% (-38px) | 73.38% | 96.90% | 71.83% | 1.45% |
| 1600x1000 | `scripts/admin-parity/out/02-1600x1000.png` | 88.13% | 69.30% | 87.38% | 65.35% | n/a | n/a | n/a | n/a | 1.42% |

Rail stand-in: 252px (the mock's rail width); content region starts at x=255.
Section row bottom: reference y=205, capture y=167 (title block offset -38px).
Diff image: `scripts/admin-parity/out/02-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/02-1586x992.png` and `scripts/admin-parity/evidence/02-1586x992-diff.png`.

Masks (5): dealership name, location and website address (fixture dealer); mock-only annotation (handoff footer caption, not product UI); mock-only annotation (DESIGN CONCEPT label, which the handoff forbids in production).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=278 yBody=-38 w=1282 h=38 | x=276 y=129 yBody=-38 w=1286 h=38 | x-2 w+4 h+0 yBody+0 |
| childTabs | within tolerance | x=278 yBody=24 w=1282 h=40 | x=276 y=183 yBody=16 w=1286 h=40 | x-2 w+4 h+0 yBody-8 |
| identityCard | within tolerance | x=277 yBody=82 w=742 h=392 | x=276 y=253 yBody=86 w=742 h=392 | x-1 w+0 h+0 yBody+4 |
| nameInput | within tolerance | x=303 yBody=202 w=445 h=37 | x=303 y=373 yBody=206 w=442 h=37 | x+0 w-3 h+0 yBody+4 |
| logoBox | within tolerance | x=792 yBody=206 w=203 h=131 | x=790 y=378 yBody=211 w=203 h=131 | x-2 w+0 h+0 yBody+5 |
| appearanceCard | within tolerance | x=277 yBody=490 w=742 h=202 | x=276 y=661 yBody=494 w=742 h=204 | x-1 w+0 h+2 yBody+4 |
| previewCard | within tolerance | x=1032 yBody=82 w=528 h=295 | x=1032 y=253 yBody=86 w=530 h=294 | x+0 w+2 h-1 yBody+4 |
| previewBlock | within tolerance | x=1055 yBody=176 w=483 h=100 | x=1055 y=347 yBody=180 w=484 h=98 | x+0 w+1 h-2 yBody+4 |
| readinessCard | within tolerance | x=1032 yBody=394 w=528 h=284 | x=1032 y=565 yBody=398 w=530 h=286 | x+0 w+2 h+2 yBody+4 |
| readinessTable | within tolerance | x=1056 yBody=482 w=482 h=170 | x=1056 y=654 yBody=487 w=482 h=170 | x+0 w+0 h+0 yBody+5 |
| primaryAction | within tolerance | x=1390 yBody=703 w=171 h=42 | x=1388 y=877 yBody=710 w=172 h=42 | x-2 w+1 h+0 yBody+7 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1886 | none | `scripts/admin-parity/out/02-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1366 | nav[Administration sections] | `scripts/admin-parity/out/02-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1024 | nav[Administration sections] | `scripts/admin-parity/out/02-1024x768.png` |
| 390x844 | none | 390 | 390 | 390 | nav[Administration sections], nav[Dealership & Brand views], div | `scripts/admin-parity/out/02-390x844.png` |

### Findings for screen 02

- Round 2 (layout parity, text boxes masked): 96.78% to 98.15%; body 92.92% to 94.31% (offset +33px); text-box parity 75.90% to 77.34%; content 87.69% to 87.74%; 11 of 11 landmarks within 16px; no overflow at 1920, 1366, 1024 or 390.
- Structure set from the mock: cards 2px higher (the note under the child tabs keeps 2px instead of 4) so Store identity and Dealer header preview start at yBody 82; a 530px right column on a 14px gutter so the interior card edges sit at x 1018 and 1032; Store identity inset 26px with labels 9px over 37px inputs on a 52.5px pitch and row labels 7px down; the logo box 13.5px under its label with a 40px upload button 11px under it; the preview block 98px tall 10px under the description with the note 15px under it on the workspace tint without a rule; 18px between the right cards; Contact readiness 87px from card edge to table with 42, 42 and 49px rows, the text 2px above centre and 27px pill chips left-aligned under Status; swatches 3px lower with 8px corners and the white one outlined in slate, the accent control 14px under its label; the save bar 63px with a 29px status mark top-aligned with the 42px button.
- The two-column composition now starts at 1540px: below that the left column cannot hold the 306px palette or the row fields (at 1366 the Group and City inputs shrank under 90px and the White swatch ran under Workspace accent), so the cards stack as they already did at 1024.
- Remaining layout difference (1.85% of compared pixels): the AutoLabels wordmark asset against the mock's own lettering in the logo box and the preview block (about 4,400 pixels, a third of the total); the shell's child-tab row (36px tall against 40, 8px higher, about 1,100 pixels); the dashed logo box's dash phase; anti-aliased block and card edges 1px off; lucide info, lock and chevron marks; the read-only Workspace accent control, which has no chevron because the accent is edited on the Appearance tab.

## Screen 03

Reference: `scripts/admin-parity/reference/03-people-access.png`. Fonts: Inter loaded (Inter). Gate: FAIL (protocol content parity 90.64% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/03-1586x992.png` | 91.66% | 74.11% | 90.70% | 71.42% | 92.58% (-50px) | 72.12% | 95.48% | 70.36% | 3.71% |
| 1600x1000 | `scripts/admin-parity/out/03-1600x1000.png` | 91.37% | 73.35% | 90.64% | 71.48% | n/a | n/a | n/a | n/a | 3.65% |

Rail stand-in: 238px (the mock's rail width); content region starts at x=241.
Section row bottom: reference y=217, capture y=167 (title block offset -50px).
Diff image: `scripts/admin-parity/out/03-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/03-1586x992.png` and `scripts/admin-parity/evidence/03-1586x992-diff.png`.

Masks (8): member names in the table and the rail (fixture addresses); mock-only annotation (handoff footer caption, not product UI); mock-only annotation (DESIGN CONCEPT label, which the handoff forbids in production).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=254 yBody=-39 w=1315 h=39 | x=262 y=129 yBody=-38 w=1300 h=38 | x+8 w-15 h-1 yBody+1 |
| childTabs | within tolerance | x=254 yBody=21 w=1315 h=48 | x=262 y=183 yBody=16 w=1300 h=40 | x+8 w-15 h-8 yBody-5 |
| teamCard | within tolerance | x=254 yBody=70 w=1315 h=661 | x=262 y=239 yBody=72 w=1300 h=671 | x+8 w-15 h+10 yBody+2 |
| searchInput | within tolerance | x=272 yBody=94 w=308 h=43 | x=281 y=265 yBody=98 w=308 h=43 | x+9 w+0 h+0 yBody+4 |
| addEmployee | within tolerance | x=1043 yBody=95 w=151 h=42 | x=1032 y=266 yBody=99 w=155 h=42 | x-11 w+4 h+0 yBody+4 |
| teamTable | within tolerance | x=273 yBody=159 w=920 | x=282 y=330 yBody=163 w=904 h=391 | x+9 w-16 yBody+4 |
| rail | within tolerance | x=1213 yBody=70 w=357 | x=1205 y=240 yBody=73 w=356 h=669 | x-8 w-1 yBody+3 |
| viewPolicy | within tolerance | x=1231 yBody=595 w=325 h=44 | x=1224 y=775 yBody=608 w=321 h=43 | x-7 w-4 h-1 yBody+13 |
| railNote | within tolerance | x=1231 yBody=655 w=325 h=45 | x=1224 y=835 yBody=668 w=321 h=44 | x-7 w-4 h-1 yBody+13 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1855 | none | `scripts/admin-parity/out/03-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/03-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/03-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div | `scripts/admin-parity/out/03-390x844.png` |

### Findings for screen 03

- Parity moved from content 90.25% / body 89.84% (+21px) / structure 68.62% with page overflow at 1024 and 390 to content 91.66% / body 93.83% / structure 70.79% with no overflow and 9 of 9 landmarks within tolerance (the largest deltas are x +9 and w -16 on the table, from the shell's 24px gutter against the mock's 16-17px). The overflow was the table's screen-reader text: sr-only spans are absolutely positioned against the viewport, so inside a table wider than its scroll wrapper they widened the document to 793px at 390 and 1025px at 1024; the wrapper is now a positioned box, so they stay inside it.
- Composition set from the reference (TeamView.tsx, components.tsx): one card holds the toolbar and table beside the rail, as the mock draws it; the mock's 48px tab strip inside the card is the shell's tab row here, so the card starts where the strip ends (yBody 68 against 70). Toolbar: a 308x43 search with a 24px magnifier, a 14px Department label with a 176x43 select and a 151x42 Add employee button with a 20px glyph (measured 155x42), 25px under the card edge and 21px over the table. The table is an inset box 18px from the card edges with a 45px header in 14px ink, 67px rows around 52px avatars with 18px initials (mock 48px of ink; sized to the owner's 52), fixed 159/146/146/150/58 columns at xl so roles stay on one line, a 10px status dot, a 24px actions mark and a 554px minimum height matching the mock's panel; the fixture lists the mock's five accepted members in its order. The rail is a 356px column behind a divider: a 20px title with a 24px close mark, a 56px avatar with 20px initials beside an 18px name and the role with the status inline, then rules at 143, 221, 400 and 526px under the card edge (mock 142, 220, 399, 525), a 28px building mark, 24px check and ban marks on 30px item pitches, a 44px outlined View role policy button (yBody 596 against 595) and a 44px note (656 against 655).
- Icons measured on the mock and set: search 24px (mock ink 17-18), Add employee 20px (mock 16), actions ellipsis 24px (mock 16 wide), status dot 10px, team avatars 52px, rail avatar 56px (mock 55), close 24px (mock 11x13), building 28px (mock 22x23), checks and bans 24px (mock 17x13 and 19x19), note info 24px (mock 19x20).
- Decisions outside the mock: the Status filter select is not drawn (the mock's toolbar holds search, Department and Add employee; with the select the toolbar wrapped onto a second line and pushed the table 48px down), the status filter remains in the URL model; the rail shows the member's status beside the role instead of a second key-value row; the Member sub-line under each name stays. The mock's sort arrows in the header are not drawn because the columns do not sort.
- Remaining difference, from a body-aligned diff (reference shifted +21): the table column holds 65% of the differing pixels and the rail 35%, in the glyphs of names (masked), roles, departments and headers, where the fixture's addresses are longer than the mock's display names and the role labels differ (Service Writer, Title Clerk / Office Mgr); the avatars are 52px against 48 and tinted one colour where the mock tints per person; the mock's outlined button border is anti-aliased light blue where ours is a crisp 1px. Masks: the five names and the rail name, 0.42% of the frame. Type scale against the tokens: table headers 14/19 ink-coloured (token meta 12 muted), rail title 20/28 (token card title 16/22), rail name 18/24, note 12px. Responsive: no page overflow; the rail stacks under the table below xl, the section row and the table scroll inside their own containers at 390.
- Round 2 (supersedes the round-1 notes above where they differ): layout parity with text masked moved from 96.86% to 97.63% (body 93.81% to 94.54%, text 72.27% to 74.01%), 9 of 9 landmarks, no overflow. Changes: avatars 48px (mock 47) tinted by department from fills sampled on the mock (Sales D3E7FB, Service CBECDA, Inventory E0D3FB, Business Office FCE8C4, Management F4D5D3), so the selected row's avatar no longer vanishes into the row tint; the Member sub-line is gone and the address truncates inside its column (it overran the Role column); the columns sort (ascending, descending, server order) with 18px marks after each label; a 44px header so the row borders land on the mock's 507/574/641/708/776; a semibold Department label and a drawn 18px chevron in the select; a 20px magnifier (mock ink 17); an ink 22px actions mark. Rail: rules inset 18px from the rail edge and 16px from the card edge (the mock does not run them full width), title, scope, list, button and note on the mock's y within 1px, 15px list and heading text (cap height 11px), a lucide Building in place of Building2, no status beside the role, a borderless note with a primary 22px info mark. The fixture's local parts now give the mock's initials (SA, IM, TC, GM). With the shell's content gutter at the mock's 16px (an experiment, not committed) layout parity reads 98.36%: the 8px gutter difference is the largest remaining layout difference.

## Screen 04

Reference: `scripts/admin-parity/reference/04-salesperson-role-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; protocol content parity 88.96% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/04-1586x992.png` | 90.30% | 69.38% | 89.87% | 65.96% | 88.78% (-120px) | 65.38% | 92.79% | 77.65% | 0.95% |
| 1600x1000 | `scripts/admin-parity/out/04-1600x1000.png` | 89.39% | 68.02% | 88.96% | 65.24% | n/a | n/a | n/a | n/a | 0.93% |

Rail stand-in: 239px (the mock's rail width); content region starts at x=242.
Body anchor (pinned in landmarks.json): reference y=244, capture y=124 (title block offset -120px).
Diff image: `scripts/admin-parity/out/04-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/04-1586x992.png` and `scripts/admin-parity/evidence/04-1586x992-diff.png`.

Masks (3): member address in the capabilities description (fixture); mock-only annotation (handoff footer caption, not product UI); mock-only annotation (the same footer caption where the body comparison draws it: the reference is shifted by the -24px body offset, so its ink at y 963-974 lands on 939-950).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=258 yBody=-37 w=1308 h=37 | x=263 y=86 yBody=-38 w=1299 h=38 | x+5 w-9 h+1 yBody-1 |
| capabilitiesCard | OUT of tolerance | x=258 yBody=20 w=768 h=623 | x=263 y=252 yBody=128 w=763 h=629 | x+5 w-5 h+6 yBody+108 |
| capabilityTable | OUT of tolerance | x=279 yBody=108 w=726 h=518 | x=285 y=341 yBody=217 w=719 h=523 | x+6 w-7 h+5 yBody+109 |
| enforcementCard | OUT of tolerance | x=1039 yBody=20 w=528 h=623 | x=1038 y=252 yBody=128 w=524 h=629 | x-1 w-4 h+6 yBody+108 |
| enforcementList | OUT of tolerance | x=1058 yBody=107 w=494 h=408 | x=1059 y=340 yBody=216 w=487 h=409 | x+1 w-7 h+1 yBody+109 |
| bottomNote | OUT of tolerance | x=262 yBody=654 w=879 h=50 | x=263 y=893 yBody=769 w=866 h=50 | x+1 w-13 h+0 yBody+115 |
| testAccess | OUT of tolerance | x=1167 yBody=659 w=169 h=40 | x=1155 y=897 yBody=773 w=180 h=43 | x-12 w+11 h+3 yBody+114 |
| primaryAction | OUT of tolerance | x=1349 yBody=659 w=218 h=40 | x=1347 y=897 yBody=773 w=215 h=43 | x-2 w-3 h+3 yBody+114 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1856 | none | `scripts/admin-parity/out/04-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections], div | `scripts/admin-parity/out/04-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/04-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div | `scripts/admin-parity/out/04-390x844.png` |

### Findings for screen 04

- Body anchor: the mock's Policy draft chip (y 122) is what the underline detector picked, so the body row is pinned to the section row: underline y 239-241 with an anti-aliased row at 242 and the border row at 243, so the first body row is 244 (the brief's 242 would misalign the body by 2px); the capture's section row ends at 220 (offset -24). Parity moved from content 88.58% / body 88.02% (+96px, wrong anchor) / structure 65.39% with page overflow at 390 to content 88.55% / body 92.14% / structure 64.18% with no overflow and 8 of 8 landmarks within tolerance (the largest delta is w -13 on the table, from the shell's gutters). The overflow was the bottom note's action slot: two buttons in a flex-shrink-0 slot ran the note to 421px at 390; the buttons now sit beside the note in a wrapping bar, as the mock draws them.
- Composition set from the reference (MemberRolePage.tsx, components.tsx): a minmax(0,1fr)/528px grid with a 14px gutter and stretched rows so both cards share the 623px height (measured 625); 20px/28px titles over 14px descriptions; the capability matrix as an inset box 20px from the card edges (yBody 109 against 108) with a 36px header in 13px ink, 32px group rows in 14px, 58px capability rows holding a 28px icon, a 14/21 label and a 13px detail, and 32px tinted squares with 20px checks and crosses in three 120px columns (row borders land within 1px to 5px of the mock's uneven 54-61px rows and the table bottom within 1px); the enforcement list as a box 19px from the card edge with 101px rows holding a 28px point icon, a 14px title, a 13px two-line description in a 260px column and a two-line amber chip (124x42 against 117x41) 18px from the box edge. The bottom bar: a 50px note with a 28px info mark beside a 40px outlined Test role access button with a 24px play mark and a 40px primary Review policy changes (217x40 against 218x40 at x 1345 against 1349). The title's Policy draft badge is a 35px blue outline chip with a 20px document icon.
- Icons measured on the mock and set: capability row icons 28px (mock ink 19-24), check and cross marks 20px in 32px squares (mock 13x10 in 33px), enforcement point icons 28px (mock 18-22), chip triangle 24px (mock 19), note info 28px (mock 22), play 24px (mock 15x18), badge document 20px (mock 13x16).
- Remaining difference, from a body-aligned diff (reference shifted -24): the two cards hold the differing pixels evenly, in the glyphs of every row (the mock's icon set draws the people, car, share and document glyphs differently from lucide), the chip text, and the capabilities description, which reads Applied to the member's address here (masked) where the mock reads a generic sentence; the Where each status comes from disclosure under the enforcement list has no counterpart in the mock. Masks: the member address in the description, 0.04% of the frame. Type scale against the tokens: card titles 20/28 (token 16/22), descriptions 14/20 (token 13/18), table header 13px ink-coloured (token meta 12 muted), group rows 14/18, capability details 13/18 (token meta 12), chip text 13/16 (token meta 12). Responsive: no page overflow; the cards stack below xl and the bar's buttons wrap under the note at 390.
- Round 2 (supersedes the round-1 notes above where they differ): layout parity with text masked moved from 96.65% to 97.99% (body 92.10% to 93.20%, text 79.48% to 80.54%), 8 of 8 landmarks, no overflow. Changes: a minmax(0,1fr)/524px grid with a 12px gutter, so the capabilities card's right edge (1025) and the enforcement card's left edge (1038) land on the mock; 20px card header insets; the matrix 15px above the card bottom (card bottom 862 against 862); 26px row and point icons at a 2px stroke (mock ink 18-23px); 18px checks and crosses (mock 13x10 and 10x11); enforcement rows with the mock's 14/19 two-line descriptions wrapping where the mock wraps; borderless 41px amber chips with a 22px triangle and 13px medium text, 7px below the row top; the bottom note borderless with a primary 24px info mark and 14px primary text, 43px buttons with a 20px play mark. The enforcement description now reads These controls must all match the role policy for it to be enforced (the mock's before the role can be published names a publish step the product does not have). A second footer-caption rect covers the caption where the body comparison draws it (reference y 963-974 shifted by -24). Remaining: the shell's 24px gutter against the mock's 20/19px (5px on each outer edge; 97.76% with a 20px gutter in an uncommitted experiment), the mock's uneven capability rows (54, 58, 59, 61, 59, 57px against a uniform 58px, the least-squares pitch; the borders from the Vehicles band to the Vehicle Passport row sit 3 to 4px low), lucide glyphs against the mock's icon drawings, and the chip text width.

## Screen 05

Reference: `scripts/admin-parity/reference/05-pricing-products.png`. Fonts: Inter loaded (Inter). Gate: FAIL (protocol content parity 90.46% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/05-1586x992.png` | 91.31% | 71.08% | 90.71% | 67.24% | 91.31% (+9px) | 67.95% | 96.69% | 63.34% | 6.28% |
| 1600x1000 | `scripts/admin-parity/out/05-1600x1000.png` | 90.86% | 70.54% | 90.46% | 66.85% | n/a | n/a | n/a | n/a | 6.31% |

Rail stand-in: 228px (the mock's rail width); content region starts at x=231.
Section row bottom: reference y=158, capture y=167 (title block offset +9px).
Diff image: `scripts/admin-parity/out/05-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/05-1586x992.png` and `scripts/admin-parity/evidence/05-1586x992-diff.png`.

Masks (27): change impact counts (fixture inventory sizes); preview vehicle name, trim, stock and prices (fixture vehicle); preview vehicle photo: a per-vehicle image, like the name and prices beside it; the synthetic fixture vehicle has no photo, so a neutral 268x151 placeholder holds the reference's image box (geometry gated by the previewPhoto landmark); vehicle names, trims, stock numbers and per-vehicle prices (fixture vehicles); text only, so thumbnails, row geometry and the document fee column (policy data) are scored; vehicles-shown count; mock-only annotation (handoff footer caption, not product UI).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=257 yBody=-38 w=1305 h=38 | x=252 y=129 yBody=-38 w=1310 h=38 | x-5 w+5 h+0 yBody+0 |
| childTabs | within tolerance | x=257 yBody=14 w=1305 h=36 | x=252 y=183 yBody=16 w=1310 h=40 | x-5 w+5 h+4 yBody+2 |
| policyCard | within tolerance | x=256 yBody=64 w=706 h=414 | x=252 y=239 yBody=72 w=710 h=414 | x-4 w+4 h+0 yBody+8 |
| previewCard | within tolerance | x=974 yBody=64 w=588 h=414 | x=974 y=239 yBody=72 w=588 h=414 | x+0 w+0 h+0 yBody+8 |
| previewPhoto | within tolerance | x=986 yBody=192 w=268 h=151 | x=986 y=367 yBody=200 w=268 h=151 | x+0 w+0 h+0 yBody+8 |
| editButton | within tolerance | x=869 yBody=80 w=74 h=33 | x=868 y=255 yBody=88 w=75 h=32 | x-1 w+1 h-1 yBody+8 |
| scopeSelect | within tolerance | x=366 yBody=361 w=252 h=32 | x=362 y=536 yBody=369 w=252 h=32 | x-4 w+0 h+0 yBody+8 |
| reviewButton | within tolerance | x=795 yBody=406 w=146 h=32 | x=795 y=581 yBody=414 w=146 h=32 | x+0 w+0 h+0 yBody+8 |
| consistencyCard | within tolerance | x=256 yBody=492 w=1306 | x=252 y=667 yBody=500 w=1310 h=312 | x-4 w+4 yBody+8 |
| consistencyTable | within tolerance | x=270 yBody=560 w=1278 | x=266 y=735 yBody=568 w=1282 h=190 | x-4 w+4 yBody+8 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1850 | none | `scripts/admin-parity/out/05-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/05-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections], div | `scripts/admin-parity/out/05-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Pricing & Products views], div | `scripts/admin-parity/out/05-390x844.png` |

### Findings for screen 05

- Title block: the mock has no breadcrumb and no description, so its section row ends at y 158 against 238 in the capture (offset +80). The body score is the number to read. Before this pass: content 90.05, body 89.66, no landmarks. After: content 88.75, body 90.40, every landmark within tolerance (both top cards 411px tall as in the mock; the consistency card and its table sit 3 and 5px low; x runs 4 to 9px left, the rail stand-in).
- Composition (PriceRulesView.tsx): the top row is a 1.2fr/1fr grid with a 14px gap (mock cards 704 and 587 wide, ours 709 and 591); both cards carry an 18px bold title with a 13px description over a header border at 66px, the policy list is a two-column 24px grid (labels at x 277, values at x 500 against the mock's 284 and 493), the info note is 34px tall with a 20px icon, Change impact is a 16px heading, a 13px description, a 90px Scope label with a 252x32 select, then two dot-number-label stats beside a 146x33 Review button with its state text centred under it (mock 795x563, ours 790x566 body-relative). The preview card places a 262x130 image beside a 253px price column with 32px rows and a bold total. Price consistency keeps its title row without a border, insets the table 20px (mock 19) with column lines, a 37px header, 51px rows (mock 50), 64x38 thumbnails, 20px header icons, 20px evidence marks and 30px status chips, and a 50px footer with an info icon.
- Fixture: the policy mode is website_sale_price so the Display basis row reads 'Advertised total includes document fee' and the review summary reads 'Includes fee', as the mock shows; consistency rows are assessed under the same mode. No test outcome changed.
- Remaining difference: Inter in Chromium renders about 15 percent wider than the mock renderer at the same size, so the tile hints, the preview footnotes and the table text differ pixel for pixel while matching in position; the mock's car photos (preview and row thumbnails) have no fixture counterpart and render as tinted placeholders; the mock's 'Not checked' website cells read as a dash here; the header action shows the mismatch chip and 'Price audit' where the mock shows a 'How this works' link; the whole page sits 9px left of the mock because the fixture rail stand-in is 224px against the mock's 229.
- Type scale against the tokens: card titles 18/20 bold (token card title 16/22, the mock measures 17px of ink), tile numbers 24/28 bold (token stat 28/34, mock ink 17px), preview vehicle name 18/24 semibold, preview rows 15/20, chips 13px (token meta 12), hints 12px. Icons measured from the mock and set: pencil, read-only info, note info, table header globe/tag/file, evidence check and triangle, and both info marks at 20px (mock ink 12-17px); the stat dots at 11px (mock 9-11).
- Round 2 (layout parity with text masked; supersedes the composition figures above): before body 90.41, layout 95.37, text 69.31; after body 92.42, layout 98.17, text 67.27; landmarks 10 of 10, no overflow. PriceRulesView.tsx: top grid 710fr/588fr with a 12px gap so the policy card ends at x 961 and the preview card spans 974-1561 as in the mock; card titles 17/20 (mock cap height 12px); per-card header padding (policy header border at +66, preview at +70, as measured); the policy list value column at +238 from the card edge; the info note is a 32px borderless workspace fill (the mock draws #F0F5FA with no border) with a 20px icon; a divider above Change impact (mock y 456); the Scope select 252x32 at +110; impact stats on the mock's grid (12px #10A523 dot, 24/27 count, 13px label on its baseline, 12px hint, divider at +271, Review changes 146x32 in the primitive's disabled fill, which the mock draws at #E1E5EB); the preview drops the 'Passport shows' line the mock lacks, places a 268x151 photo box over the mock's car (ink 986-1253 x 378-474) and sets rows 33/33/32 with the divider at +231; the consistency table insets 12px (mock 269-1548) with column lines at the mock's 540/654/788/918/1048/1166/1330/1456, 13px cell padding and text, 22px pill chips, an 18px check and a filled 20px triangle; the consistency description takes the mock's wording; 14px gaps between card rows (mock 14).
- Round 2 fixture and masks: the consistency rows follow the mock's states in order (consistent on the same version, a mismatch seen on an older version, a vehicle awaiting evidence); the counts the 05 test asserts are unchanged. Mask added for the preview photo box (a per-vehicle image, like the masked name and prices beside it; the synthetic vehicle has no photo), its geometry gated by the previewPhoto landmark (268x151 at x 986, yBody 192).
- Round 2 remaining (reference frame): the shell places this page's content 4px left and 4px low (AdminPageContainer's 24px gutter against the mock's 28; the child tab row ending at 209 against 207; the shell's 16px gap under it against the mock's 14). A local ml-4px/-mt-4px wrapper, used only as a measurement, lifts layout from 98.17 to 99.25, so 1.08 points are the shell's. Of the 0.75 points left in that simulation: the child tab row 0.15 (shell: 13px labels with no tab padding against the mock's 15px tabs with about 10px padding), the consistency headline chip 0.16 (functional: it is the Unknown headline on a failed read and is tested), the Price audit link 0.04 (functional label where the mock reads 'How this works'), table header icons 0.09 (icon set: lucide Globe, Tag and FileText against the mock's glyphs), status marks and chips 0.09 (font-rendering widths), the Edit button 0.06 (its 'Edit' label runs 4px wider), card bodies 0.15 (sub-pixel line positions in the mock).

## Screen 06

Reference: `scripts/admin-parity/reference/06-fee-change-review-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (protocol content parity 90.47% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/06-1586x992.png` | 88.53% | 82.52% | 94.23% | 82.23% | 94.19% (+0px) | 82.13% | 98.19% | 84.42% | 4.12% |
| 1600x1000 | `scripts/admin-parity/out/06-1600x1000.png` | 85.47% | 73.69% | 90.47% | 71.16% | n/a | n/a | n/a | n/a | 4.05% |

Rail stand-in: 243px (the mock's rail width); content region starts at x=246.
Body anchor (pinned in landmarks.json): reference y=187, capture y=187 (title block offset +0px).
Diff image: `scripts/admin-parity/out/06-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/06-1586x992.png` and `scripts/admin-parity/evidence/06-1586x992-diff.png`.

Masks (7): expected impact counts (fixture inventory sizes); example vehicle name, stock, VIN suffix, selling price and totals (fixture vehicle); the fee column is policy data and stays; mock-only annotation (handoff footer caption, not product UI); mock-only annotation (DESIGN CONCEPT label, which the handoff forbids in production).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| dialog | within tolerance | x=443 yBody=0 w=907 h=776 | x=443 y=187 yBody=0 w=907 h=776 | x+0 w+0 h+0 yBody+0 |
| title | within tolerance | x=471 yBody=24 h=28 | x=470 y=210 yBody=23 w=477 h=28 | x-1 h+0 yBody-1 |
| step1 | within tolerance | x=586 yBody=91 h=38 | x=586 y=278 yBody=91 w=127 h=37 | x+0 h-1 yBody+0 |
| step3 | within tolerance | x=1104 yBody=91 h=38 | x=1104 y=278 yBody=91 w=113 h=37 | x+0 h-1 yBody+0 |
| summaryTable | within tolerance | x=471 yBody=191 w=512 h=160 | x=471 y=378 yBody=191 w=511 h=157 | x+0 w-1 h-3 yBody+0 |
| impactTile1 | within tolerance | x=1011 yBody=192 w=312 h=112 | x=1011 y=379 yBody=192 w=312 h=112 | x+0 w+0 h+0 yBody+0 |
| impactTile2 | within tolerance | x=1011 yBody=312 w=312 h=112 | x=1011 y=499 yBody=312 w=312 h=112 | x+0 w+0 h+0 yBody+0 |
| exampleTable | within tolerance | x=471 yBody=456 w=852 h=99 | x=471 y=643 yBody=456 w=851 h=98 | x+0 w-1 h-1 yBody+0 |
| warningNote | within tolerance | x=471 yBody=574 w=852 h=41 | x=470 y=761 yBody=574 w=853 h=41 | x-1 w+1 h+0 yBody+0 |
| backButton | within tolerance | x=471 yBody=688 w=156 h=41 | x=470 y=875 yBody=688 w=161 h=41 | x-1 w+5 h+0 yBody+0 |
| applyButton | within tolerance | x=1092 yBody=688 w=231 h=41 | x=1093 y=875 yBody=688 w=230 h=41 | x+1 w-1 h+0 yBody+0 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1858 | none | `scripts/admin-parity/out/06-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/06-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections], div | `scripts/admin-parity/out/06-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Pricing & Products views], div | `scripts/admin-parity/out/06-390x844.png` |

### Findings for screen 06

- Decision: the fee review stays a child route (/admin/pricing/fee-review) and renders the mock's dialog over the Price rules page. The shared ReviewDialog centres its panel vertically inside a fixed, full-viewport scrim with a 900px cap and 24px body padding, so the mock's geometry (dialog x 443-1350, y 187-962, dimming only the workspace) cannot be reached through it; the frame is built in FeeReviewPage.tsx instead: a scrim limited to the content column, a 907px panel placed 123px under the product header (y 187 in the reference frame) and centred in the content column (x 452 against 443), 28px side padding, a 22/28 title, a three-step stepper with 38px circles, Change summary (512px table, 34px header, 42px rows, column lines) beside Expected impact (two 312x112 tiles with 48px tinted circles and 28px glyphs), one example vehicle row (35px header, 62px row), two 42px notes, and a footer with Back to edit and Apply (41px) over an 11px permission note. Every landmark is within tolerance; the dialog measures 778px tall against 776.
- Scrim: the mock dims the page to about #979DA6 over the workspace and #9A9FA8 over white, which a navy overlay cannot reproduce (the previous #0B1A33 at 55 percent gave #747D8D, 40 or more per channel off, so every dimmed background pixel scored as different). The scrim is #626A75 at 64 percent, which lands within 4 per channel on both; dimmed text differs where the layouts differ.
- Body anchor: the mock has no section row the detector can find (the underline is dimmed), so the body row is pinned to the dialog top. The view marks that row with a zero-height element (data-landmark='fee-review-top') whose bottom is the dialog top, giving an offset of 0; the body score is the content region from y 187 down. Before this pass: content 50.79, no body score, no landmarks. After: content 90.50, body 90.14 (offset 0), landmarks all within tolerance (the largest deltas are x +11 on the left column and h +3 on the summary table).
- Fixture and tests: the review fixture uses the fee-inclusive basis and a sample size of 1 (the mock shows one example vehicle; the live preview keeps the routine's default of three), and its listing rows carry no parser warnings (the extra warning note added 50px the mock does not draw). The 06 fixture test's row count moved from 4 to 2 accordingly; behaviour, Apply gating, the role check, the no-write-on-mount and the fallback-routine tests are unchanged. The summary table lists changed fields plus the price basis (the mock's three rows); an unchanged jurisdiction is not repeated.
- Remaining difference: the page behind the scrim is the mock's older Pricing & Products layout (a vertical sub-navigation, an 'Edit document fee' button and a policy-version card) against our Price rules page, so the dimmed text differs wherever the two layouts put text; the stepper lines are equal here (about 108px) where the mock draws 95 and 119; label widths differ with the renderer; the Apply button reads 48 against the mock's 128.
- Type scale against the tokens: dialog title 22/28 bold (the mock's ink is 22px), subtitle 13/18, step labels 13/18 semibold over 11/16, section headings 16/22 semibold (token section 18/26; the mock's ink is 15px), table headers 13px ink (token meta 12 muted), tile numbers 24/28 (token stat 28/34), tile labels 15/20 semibold, hints 13/18, example row name 14/20 semibold (mock 15; widened column 300px so the fixture's longer name does not wrap), buttons 15px, footnote 11px. Icons: close 20px (mock ink 13), step check 18px at stroke 3, step digits 16px, tile glyphs 28px (mock ink 22-23), price arrow 26px (mock 22x13), delta triangles 14x9, note icons 26px (mock 21), Back to edit arrow 20px (mock 14x12).
- Shared-file request (src/components/admin/v2/ReviewDialog.tsx): a placement prop (items-start with a configurable top offset, scrim limited to the content column) and a width prop would let this page use the primitive; the mock needs top 187, width 907 and 28px padding, none of which the primitive exposes.
- Round 2: before body 92.41, layout 96.92, text 82.10; after body 94.14, layout 98.30, text 83.25; landmarks 11 of 11, no overflow. FeeReviewPage.tsx: 26px side and 22px top dialog padding (mock content 470-1323); at xl widths the stepper puts its 37px circles at the mock's x 586, 832 and 1104 with the lines on the circles' centre line (y 296), a hanging step number, 14/18 labels over 12/17 status lines and a ringed not-started circle; headings at the mock's y; both tables use 16px cell padding (mock 15-17px); summary rows are 41px; the example table has the mock's 258/168/192px columns, a 36px header, a 62px row, 14px values and a 17px arrow (mock glyph 13x9); tiles carry a 26px filled car-front and archive glyph, a 24/25 count and a 14px label; the notes are 41px with 24px icons and the mock's lighter warning border (#FCE3B6 against the mock's #FDE6BC); the footer sits 23px under the notes and Back to edit has 20px padding. Fixture: the example vehicle has no trim and its second line shows the stock number (the VIN suffix moves to the title attribute, and shows when there is no stock), so the name stays on one line in the 258px column as the mock's does. Review behaviour (no write on mount, Apply gated on the review, the version and the role) and its tests are unchanged.
- Round 2 remaining: the dimmed page behind the dialog is the mock's older Pricing layout; outside the dialog box it accounts for 1.29 points of layout (left of the dialog 0.34, right 0.94 of which the mock's 'Edit document fee' button is 0.69, below 0.02), category information architecture. Inside the dialog 0.41 points remain: summary row lines 0.14 (the mock's rows are 40, 42 and 42px at sub-pixel positions against our 41), tile glyphs 0.08 (icon set), note icons 0.05 (icon set), the stepper 0.04, buttons and the footnote 0.05 (font widths), the example table 0.03.

## Screen 07

Reference: `scripts/admin-parity/reference/07-product-applicability-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (protocol content parity 88.36% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/07-1586x992.png` | 89.36% | 67.80% | 88.45% | 63.63% | 92.16% (+64px) | 74.90% | 97.19% | 73.90% | 3.08% |
| 1600x1000 | `scripts/admin-parity/out/07-1600x1000.png` | 89.06% | 69.18% | 88.36% | 65.53% | n/a | n/a | n/a | n/a | 3.04% |

Rail stand-in: 242px (the mock's rail width); content region starts at x=245.
Body anchor (pinned in landmarks.json): reference y=228, capture y=292 (title block offset +64px).
Diff image: `scripts/admin-parity/out/07-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/07-1586x992.png` and `scripts/admin-parity/evidence/07-1586x992-diff.png`.

Masks (6): sample vehicle names and mileage (fixture vehicles); product price (fixture value); mock-only annotation (handoff footer caption, not product UI); mock-only annotation (DESIGN CONCEPT label, which the handoff forbids in production).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| childTabs | within tolerance | x=267 yBody=-44 w=1295 h=44 | x=266 y=248 yBody=-44 w=1296 h=44 | x-1 w+1 h+0 yBody+0 |
| rulesCard | within tolerance | x=267 yBody=19 w=701 h=668 | x=266 y=312 yBody=20 w=698 h=670 | x-1 w-3 h+2 yBody+1 |
| rulesBox | within tolerance | x=290 yBody=103 w=655 h=289 | x=288 y=397 yBody=105 w=656 h=291 | x-2 w+1 h+2 yBody+2 |
| priceBox | within tolerance | x=290 yBody=411 w=655 h=260 | x=288 y=704 yBody=412 w=656 h=261 | x-2 w+1 h+1 yBody+1 |
| evidenceCard | within tolerance | x=981 yBody=19 w=581 h=358 | x=979 y=312 yBody=20 w=583 h=358 | x-2 w+2 h+0 yBody+1 |
| evidenceList | within tolerance | x=999 yBody=103 w=544 h=259 | x=997 y=397 yBody=105 w=547 h=257 | x-2 w+3 h-2 yBody+2 |
| samplesCard | within tolerance | x=981 yBody=388 w=581 h=299 | x=979 y=681 yBody=389 w=583 h=298 | x-2 w+2 h-1 yBody+1 |
| samplesTable | within tolerance | x=996 yBody=472 w=556 h=197 | x=996 y=765 yBody=473 w=558 h=197 | x+0 w+2 h+0 yBody+1 |
| reviewButton | within tolerance | x=1408 yBody=706 w=155 h=42 | x=1406 y=998 yBody=706 w=156 h=42 | x-2 w+1 h+0 yBody+0 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1857 | none | `scripts/admin-parity/out/07-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections], div | `scripts/admin-parity/out/07-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/07-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Product views], div | `scripts/admin-parity/out/07-390x844.png` |

### Findings for screen 07

- Body anchor: a child page with no section row; the body row is pinned to the child tab row bottom, 228 in the mock (underline rows 226-227, border 227) against 226 in the capture (offset -2). Before this pass: content 89.27, no body score, no landmarks. After: content 89.48, body 89.19 (offset -2); the right-column and footer landmarks pass, the four left-column landmarks fail on x only.
- The x failure is the fixture rail: the 07 mock draws its rail 242px wide and starts content at x 267, the fixture page draws a 224px stand-in and the shell's 24px gutter puts content at 248 (-19); the right column, sized by the 1.206fr/1fr grid, lands at 972 against 981 (-9). Shared-file request (src/pages/admin/AdminDesignFixture.tsx): a 236px rail stand-in would put the left edge at 260, within 7px of both the 05 mock (257) and the 07 mock (267); the harness content region (x >= 232) would need no change.
- Composition (ProductApplicabilityPage.tsx): one 'Applicability rules' card (20px bold title, 13px description) holds a white rules box (Condition with 22px checkboxes inline, a divider, Mileage with 22px radios, a 173x44 input and 'miles', a divider, Model year range with 237 and 225px 44px selects), a Price treatment box (18px semibold title, 15px semibold radio labels with 13px details, a 195x44 price field with a dollar prefix beside the radios) and a circled-info note (36px icon, 14px semibold title, 12px body). The right column keeps Evidence checklist (64px rows with 32px outline icons, 14px semibold labels, 13px details and 30px pill chips) and Sample vehicle results (40px header, 52px rows, 22px marks with 13px text, columns 192/80/142/142 against the mock's 160/89/153/142 because our status text is wider). Child tabs are 44px tall with 14px labels and 14px padding; the footer buttons are 42px. Card heights: rules 667 against 668, evidence 359 against 358, samples 299 against 299.
- Fixture and tests: three sampled vehicles (one with proof, one without, one past the mileage limit), as the mock shows three rows; the Eligible column reads Yes or No under its header, as the mock does. The 07 fixture test's row count moved from 4 to 3 and its eligibility assertions to Yes/No; the write-after-review, audit and failed-proof-read tests are unchanged.
- Remaining difference: the mock titles the page at 36px bold with no description and a 'DESIGN CONCEPT' chip, while ChildPageFrame draws the 28/36 token title with the section description (the title block is the shell's); the CPO checkbox is checked and disabled here because the stored rule model derives CPO from Used, while the mock draws it unchecked; the fixture rule sets a mileage limit and a 2020 floor where the mock shows 'No limit' and 'Any year'; Review changes is disabled until the draft changes where the mock draws it enabled; Cancel measures 104px against 111; text renders wider than the mock at every size.
- Type scale against the tokens: card titles 20/26 bold (token card title 16/22; mock ink 19-20px), box title 18/24 semibold, field labels 14/20 semibold, controls 15px, chip text 13px (token meta 12), status text 13px (mock 14, reduced so the columns fit without overflow), vehicle names 14/20 semibold (mock 15), sub lines 12/18, tabs 14px (the shell's child tabs are 13px). Icons: badge dot 8px, checkboxes and radios 22px (mock 22-24), note icon 36px (its 30px circle matches the mock's), evidence icons 32px (mock ink 23-28), sample marks 22px (mock ink 14-18), chips 30px tall.
- Round 2: before body 90.21, layout 95.92, text 67.25; after body 92.12, layout 96.99, text 72.75; landmarks 9 of 9, no overflow. ProductApplicabilityPage.tsx: grid 697fr/583fr with a 15px gap (mock cards 268-964 and 980-1562); the rules box rows are 81, 101 and 108px with dividers inset 16px (mock 307-927) and the section labels drawn inside the box (floated legends); checkbox items 104 and 102px wide with 8px label gaps, the No limit radio item 129px wide, a 175x46 mileage input and 46px selects; the price box carries the proof note as its bottom band (mock 834-897) and a 45px price field; evidence rows are 63px with 20px gaps and a car-front icon; the sample table insets 15 and 8px with 164/89/153px columns, 16px cell padding, a 38px header and 19px marks (mock glyphs 16-17px) in the tone colour beside ink text, neutral marks filled; the footer sits 18px under the cards and Cancel is 111px. Fixture: proofs swapped and model names shortened with no trim, so the rows read in the mock's order (Missing proof and Blocked, Proof attached and Ready for review, Excluded and Not published) and each name stays on one line; the 07 test's row expectations follow the new order with the same assertions. CheckRow (pricing/ui.tsx) gained controlClassName and labelClassName.
- Round 2 remaining: ChildPageFrame places content 2px left and 2px low (its 24px gutter against the mock's 26; 20px from the tab row to the cards against 18). A local ml-2px/-mt-2px wrapper, used only as a measurement, lifts layout from 96.99 to 97.45 (0.46 points, shell). In that simulation: Review changes 0.48 (functional: disabled until the draft differs, where the mock draws it enabled), the mileage radios 0.09 (fixture state: CPO follows Used in the rule model, so the mock's excluded CPO row is reproduced with the 80,000-mile limit rather than an unchecked CPO box; the CPO box itself 0.01, functional), sample marks 0.37 ('Ready for review' needs 164px in Inter against the mock's 152, so the columns sit 3-12px left of the mock's; the mark glyphs also differ), evidence icons 0.20 (icon set), evidence chips 0.14 and row lines 0.27 (the mock's rows are 62-65px at sub-pixel positions), rules and price box details 0.40 (sub-pixel lines, native radio and checkbox glyphs), Cancel 0.06 (label width).

## Screen 08

Reference: `scripts/admin-parity/reference/08-customer-contact-routing.png`. Fonts: Inter loaded (Inter). Gate: FAIL (protocol content parity 89.46% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/08-1586x992.png` | 92.52% | 74.69% | 91.88% | 72.70% | 90.35% (-5px) | 66.52% | 95.70% | 64.05% | 0.27% |
| 1600x1000 | `scripts/admin-parity/out/08-1600x1000.png` | 90.42% | 69.76% | 89.46% | 66.79% | n/a | n/a | n/a | n/a | 0.26% |

Rail stand-in: 237px (the mock's rail width); content region starts at x=240.
Section row bottom: reference y=172, capture y=167 (title block offset -5px).
Diff image: `scripts/admin-parity/out/08-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/08-1586x992.png` and `scripts/admin-parity/evidence/08-1586x992-diff.png`.

Masks (1): mock-only annotation (handoff footer caption, not product UI).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=270 w=1291 h=38 | x=261 y=129 yBody=-38 w=1301 h=38 | x-9 w+10 h+0 |
| childTabs | within tolerance | x=270 yBody=13 w=1291 h=45 | x=261 y=183 yBody=16 w=1301 h=40 | x-9 w+10 h-5 yBody+3 |
| sectionTitle | within tolerance | x=270 yBody=71 h=32 | x=261 y=244 yBody=77 w=400 h=32 | x-9 h+0 yBody+6 |
| scope | within tolerance | x=1369 yBody=74 w=191 h=42 | x=1371 y=245 yBody=78 w=191 h=42 | x+2 w+0 h+0 yBody+4 |
| orderCard | within tolerance | x=269 yBody=146 w=623 h=585 | x=261 y=317 yBody=150 w=626 h=585 | x-8 w+3 h+0 yBody+4 |
| orderRow1 | within tolerance | x=282 yBody=201 w=597 h=68 | x=274 y=372 yBody=205 w=600 h=68 | x-8 w+3 h+0 yBody+4 |
| orderRow6 | within tolerance | x=282 yBody=578 w=597 h=67 | x=274 y=750 yBody=583 w=600 h=68 | x-8 w+3 h+1 yBody+5 |
| readinessCard | within tolerance | x=906 yBody=146 w=654 h=326 | x=901 y=317 yBody=150 w=661 h=326 | x-5 w+7 h+0 yBody+4 |
| readinessList | within tolerance | x=919 yBody=197 w=628 h=213 | x=914 y=368 yBody=201 w=635 h=213 | x-5 w+7 h+0 yBody+4 |
| escalationLink | within tolerance | x=919 yBody=421 w=232 h=36 | x=914 y=592 yBody=425 w=232 h=36 | x-5 w+0 h+0 yBody+4 |
| responseCard | within tolerance | x=906 yBody=486 w=654 h=245 | x=901 y=657 yBody=490 w=661 h=245 | x-5 w+7 h+0 yBody+4 |
| primaryAction | within tolerance | x=1409 y=925 w=149 h=36 | x=1413 y=940 yBody=773 w=149 h=36 | x+4 y+15 w+0 h+0 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1879 | none | `scripts/admin-parity/out/08-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1366 | nav[Administration sections] | `scripts/admin-parity/out/08-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1024 | nav[Administration sections] | `scripts/admin-parity/out/08-1024x768.png` |
| 390x844 | none | 390 | 390 | 390 | nav[Administration sections], nav[Customer Experience views] | `scripts/admin-parity/out/08-390x844.png` |

### Findings for screen 08

- Round 2 (layout parity, text masked): body 91.76 -> 93.79 (+66px), layout 96.92 -> 98.49, text 67.35 -> 70.54, 12 of 12 landmarks, no page overflow at 1920, 1366, 1024 or 390. _rail is 246, the mock's content origin (237px navy rail + 33px gutter = x 270) rather than its navy edge, because the shell's gutter is 24px; with the navy-edge rail (237) the same build measures layout 98.07, 12 of 12 landmarks.
- Fixed from pixel scans: card borders to the mock's y 318 and the 622/656 split with a 14px gap (left 270-891, right 906-1562 against 269-891 and 906-1559); card bodies on a 12px inset so rows land at 282 (were 287); order rows on the mock's 75.5px pitch at 67.5px with the owner column 230px behind an inset rule (8px top, 7px bottom), the grip in ink 3px further left, the owner name 14px (cap 10px), the owner group 2px above centre; state chips as the mock's 29px pills with a 16px circle-alert or circle-check mark 12px in (were 28px, 6px radius, x-circle); readiness rows 53px (were 54) with 13px bold titles and 11px descriptions (mock caps 9px and 7-8px); Review escalation rules 232x36 with its icon 25px in; the Response card without the Escalation switch the mock does not draw (the switch stays on the Escalation child, which owns the tiers; the rows read Off when escalation is off), 22px timing icons, rows on a 51px pitch with the rule running from the title to the value, Notification methods at 14px with 21px mail and bell icons and 36x20 switches (mock 36x20), the Smart routing switch 42x24 (mock 41x24); the warning note as a 36px one-line note at y 854 with a 20px triangle (it wrapped to 48px); h2 description 15px (mock cap 11px); scope box 191x42 with a 22px building glyph.
- Remaining layout difference by region (share of compared body pixels): the sticky Draft configuration bar's top three rows at capture y 923-925 sit over the mock's card bottoms and warning note because the bar is viewport-anchored while the body is aligned +66px, 0.37%; the shell's child-tab row (13px text in a 36px row against the mock's 15px in 45px), 0.14%; icon-set differences (lucide grip, user, users, shield, clock, mail, bell, chevrons and the chip marks against the mock's drawings, all at or above the mock's size), 0.67%; switch knob and track rendering, 0.08%; 1px edge anti-aliasing where the mock draws soft two-pixel borders, plus the left card's 1px offset (shell origin 270 against the mock's 269), 0.19%; the scope box's building glyph and the chevron the view does not draw because routing is stored once per account (no scope choice exists), 0.05%.
- Type against the tokens: h2 26/32, description 15/22, order titles 14/20, owner name 14/20, owner detail and timing hints 11/16, readiness titles 13/18 bold, readiness descriptions 11/16, timing titles 13/18 bold, method hints 11/14, chips 12/18. Masks: none (the mock caption rect is outside the +66 body).

## Screen 09

Reference: `scripts/admin-parity/reference/09-escalation-delivery-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (protocol content parity 85.60% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/09-1586x992.png` | 88.28% | 64.78% | 86.53% | 60.51% | 92.85% (-27px) | 78.32% | 98.71% | 74.19% | 2.60% |
| 1600x1000 | `scripts/admin-parity/out/09-1600x1000.png` | 87.36% | 65.19% | 85.60% | 60.97% | n/a | n/a | n/a | n/a | 2.57% |

Rail stand-in: 217px (the mock's rail width); content region starts at x=220.
Body anchor (pinned in landmarks.json): reference y=289, capture y=262 (title block offset -27px).
Diff image: `scripts/admin-parity/out/09-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/09-1586x992.png` and `scripts/admin-parity/evidence/09-1586x992-diff.png`.

Masks (10): request ids (fixture-generated activity text); rooftop names in the activity rows (the fixture's synthetic stores); notification timestamps; scope chips carry the fixture's synthetic rooftop names; mock-only annotation (handoff footer caption, not product UI); mock-only annotation (DESIGN CONCEPT label, which the handoff forbids in production).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| childTabs | within tolerance | x=244 w=1318 h=40 | x=241 y=226 yBody=-36 w=1321 h=36 | x-3 w+3 h-4 |
| rulesCard | within tolerance | x=244 yBody=19 w=660 h=680 | x=241 y=282 yBody=20 w=662 h=679 | x-3 w+2 h-1 yBody+1 |
| tier1 | within tolerance | x=262 yBody=75 w=627 h=117 | x=258 y=339 yBody=77 w=631 h=115 | x-4 w+4 h-2 yBody+2 |
| minutesSelect1 | within tolerance | x=318 yBody=123 w=264 h=34 | x=315 y=385 yBody=123 w=264 h=34 | x-3 w+0 h+0 yBody+0 |
| destination1 | within tolerance | x=660 yBody=123 w=230 h=34 | x=659 y=385 yBody=123 w=230 h=34 | x-1 w+0 h+0 yBody+0 |
| tiles | within tolerance | x=261 yBody=593 w=625 h=49 | x=258 y=856 yBody=594 w=627 h=49 | x-3 w+2 h+0 yBody+1 |
| reviewButton | within tolerance | x=262 yBody=653 w=286 h=33 | x=258 y=915 yBody=653 w=286 h=33 | x-4 w+0 h+0 yBody+0 |
| statesCard | within tolerance | x=917 yBody=19 w=645 h=403 | x=916 y=282 yBody=20 w=646 h=403 | x-1 w+1 h+0 yBody+1 |
| statesList | within tolerance | x=933 yBody=90 w=612 h=236 | x=933 y=352 yBody=90 w=612 h=236 | x+0 w+0 h+0 yBody+0 |
| retryNote | within tolerance | x=933 yBody=342 w=612 h=65 | x=933 y=604 yBody=342 w=612 h=65 | x+0 w+0 h+0 yBody+0 |
| activityCard | within tolerance | x=917 yBody=432 w=645 h=247 | x=916 y=694 yBody=432 w=646 h=247 | x-1 w+1 h+0 yBody+0 |
| activityTable | within tolerance | x=933 yBody=500 w=612 h=112 | x=934 y=763 yBody=501 w=610 h=110 | x+1 w-2 h-2 yBody+1 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1845 | none | `scripts/admin-parity/out/09-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/09-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/09-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div | `scripts/admin-parity/out/09-390x844.png` |

### Findings for screen 09

- Round 2 (layout parity, text masked): body 91.52 -> 93.51 (-93px), layout 97.34 -> 98.96, text 71.22 -> 74.03, 12 of 12 landmarks, no page overflow. _rail is 220, the mock's content origin (217px navy rail + 27px gutter = x 244); with the navy-edge rail (217) layout measures 98.78.
- Fixed from pixel scans: selects 264x34 and 230x34 at the mock's x 318 and 660 with the native arrow replaced by a 20px chevron 14px and 10px in, Send to at x 602 aligned to the select's top third, invalid destination border #F04438 (the mock's red; the danger token B42318 differed by 68), tier pitch 115 and 117px with tier 3's controls 2px lower as drawn; scope box 29px, chips 7px under it; tiles 49px on 148/149/152/154 fractions with 8px gaps, content top-aligned, the selected tile with a 1px border and an inner white rule (was a 2px solid ring), SMS as message-circle-more; Review changes 286x33; Delivery states rows at the mock's 57/59/59/56px (rules at 437, 497, 557), state marks as tinted 36px circles with a solid 22px mark for Accepted and Failed (were solid 36px), the retry note at 631-695 on its peach border (#FDE1BB) with a 28px mark beside the title line, the card ending at 711; the activity card at 721 with the table at 789 on the mock's 110/99/87/76/136/103 columns (lines at 1044/1143/1229/1305/1441 against 1043/1142/1229/1305/1441) in 11px ink headers and cells, the delivery note at 910-954 with a 20px info mark.
- Remaining layout difference by region: the Keep draft chip, which the view shows only when the draft differs from the saved rules (the fixture's draft is clean), 0.16%; destination semantics (the resolver's first tier is Target only and the BDC tier is the one missing a destination, where the mock marks tiers 1-3 BDC desk, Sales manager, Sales manager), 0.22%; icon-set differences (state glyphs, tile icons and borders, select chevrons), 0.35%; the mock's Proposed design caption, which masks.json masks in the reference frame but the body comparison shifts by -93px so it lands unmasked at capture y 877, 0.12% (harness); retry note, delivery note and table edges drawn soft over two pixels, 0.14%; other edges, 0.07%.
- Type against the tokens: card titles 18/26 (activity 18/22), table headers and cells 11/16 in ink (mock caps 7-8px; 11px is the floor), result labels 11/16, tile titles 12/18, state titles 14/18. Masks unchanged (request ids, rooftop names, timestamps, scope chips).

## Screen 10

Reference: `scripts/admin-parity/reference/10-publishing-policy.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; protocol content parity 86.76% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/10-1586x992.png` | 90.15% | 69.00% | 89.53% | 65.29% | 88.84% (-7px) | 63.11% | 95.04% | 66.03% | 0.92% |
| 1600x1000 | `scripts/admin-parity/out/10-1600x1000.png` | 87.76% | 65.65% | 86.76% | 60.58% | n/a | n/a | n/a | n/a | 0.90% |

Rail stand-in: 257px (the mock's rail width); content region starts at x=260.
Section row bottom: reference y=245, capture y=238 (title block offset -7px).
Diff image: `scripts/admin-parity/out/10-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/10-1586x992.png` and `scripts/admin-parity/evidence/10-1586x992-diff.png`.

Masks (3): rooftop name in the policy description (the fixture is synthetic); active and published listing counts; mock-only annotation (handoff footer caption, not product UI).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=287 y=207 w=1273 h=38 | x=281 y=200 yBody=-38 w=1281 h=38 | x-6 y-7 w+8 h+0 |
| childTabs | OUT of tolerance | x=308 yBody=105 w=1230 h=42 | x=281 y=254 yBody=16 w=1281 h=40 | x-27 w+51 h-2 yBody-89 |
| policyCard | OUT of tolerance | x=286 yBody=21 w=1274 h=681 | x=281 y=310 yBody=72 w=1281 h=634 | x-5 w+7 h-47 yBody+51 |
| draftStatus | OUT of tolerance | x=1397 yBody=39 w=142 h=46 | x=1388 y=325 yBody=87 w=153 h=48 | x-9 w+11 h+2 yBody+48 |
| policyTable | within tolerance | x=308 yBody=163 w=1230 h=180 | x=303 y=406 yBody=168 w=1237 h=178 | x-5 w+7 h-2 yBody+5 |
| detailSection | within tolerance | x=308 yBody=359 w=1230 h=260 | x=302 y=601 yBody=363 w=1239 h=260 | x-6 w+9 h+0 yBody+4 |
| classCard1 | within tolerance | x=328 yBody=419 w=279 h=185 | x=322 y=661 yBody=423 w=281 h=185 | x-6 w+2 h+0 yBody+4 |
| classCard3 | within tolerance | x=926 yBody=419 w=285 h=185 | x=924 y=661 yBody=423 w=287 h=185 | x-2 w+2 h+0 yBody+4 |
| effectiveRule | within tolerance | x=1232 yBody=419 w=286 | x=1232 y=661 yBody=423 w=288 h=185 | x+0 w+2 yBody+4 |
| recallNote | within tolerance | x=307 yBody=631 w=905 h=48 | x=302 y=873 yBody=635 w=910 h=49 | x-5 w+5 h+1 yBody+4 |
| primaryAction | within tolerance | x=1230 yBody=631 w=151 h=48 | x=1231 y=873 yBody=635 w=151 h=48 | x+1 w+0 h+0 yBody+4 |
| previewButton | within tolerance | x=1393 yBody=631 w=146 h=48 | x=1395 y=873 yBody=635 w=146 h=48 | x+2 w+0 h+0 yBody+4 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1865 | none | `scripts/admin-parity/out/10-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/10-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/10-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Publishing views], div | `scripts/admin-parity/out/10-390x844.png` |

### Findings for screen 10

- Round 2 (layout parity, text masked): body 89.70 -> 91.34 (-7px), layout 95.37 -> 97.20, text 67.89 -> 69.85, 9 of 12 landmarks (the three that fail are the child tabs the mock draws inside the card), no page overflow. _rail is 263, the mock's content origin (257px navy rail + 30px gutter = x 287); with the navy-edge rail (257) layout measures 96.99.
- Fixed from pixel scans: card body and header on a 20px inset so the matrix and detail section land at x 308 (were 304); matrix rows on the mock's 44.67px pitch (rules at 453, 498, 542, 587) and the selected-row bar as an inset shadow so it no longer widens the first column (lines at 477/736/1037/1282 against 476/734/1035/1280); detail header 44px with an 18px class name (rule at 648, was 651); class cards 185px on 279/293/285 fractions with 13px gaps, 11/14/14px padding, 78px explanation boxes and the document glyph as lucide file; the rule column divider at 1232 with text at 1259; recall note 49px at 876 on the mock's peach border with its mark 13px in; buttons 151x48 and 146x48.
- Remaining layout difference by region: the band from the section row to the matrix (capture y 238-400), where the shell draws Effective policy / Approvals / Destinations / Change history above the card and the mock draws them inside it, so the card header and the draft tile sit 47px lower than the mock's, 1.60% (information architecture); copy from publishingPolicy.ts, which words the matrix cells, card summaries and the rule text differently from the mock (Auto on intake + recall policy, Manager approval, Meets the recall policy), so the mock's longer lines fall outside the capture's text boxes: matrix 0.20%, rule column 0.12%, class cards other than their icons 0.47% (with the cards' soft edges); icon-set and circle-gradient differences on the three class cards, 0.31%; the recall note's soft two-pixel edges and triangle glyph, 0.18%; the buttons and table end 3px right of the mock because the shell's right gutter is 24px against the mock's 27px, 0.17%; detail header, 0.03%.
- Type against the tokens: card title 20/28, matrix headers 14/20 in ink, class name 18/26, card titles 14/22, summaries and boxes 12/20, rule text 13/18, recall note 13/18 semibold. The enforcement paragraph under the card stays: it names the enforcer behind each matrix column and sits in text boxes only (0.00% layout). Masks unchanged (rooftop name, class counts).

## Screen 11

Reference: `scripts/admin-parity/reference/11-documents-service.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; protocol content parity 89.09% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/11-1586x992.png` | 90.41% | 72.35% | 89.84% | 69.50% | 92.02% (-33px) | 74.79% | 97.60% | 65.98% | 2.10% |
| 1600x1000 | `scripts/admin-parity/out/11-1600x1000.png` | 89.61% | 71.89% | 89.09% | 68.66% | n/a | n/a | n/a | n/a | 2.06% |

Rail stand-in: 264px (the mock's rail width); content region starts at x=267.
Section row bottom: reference y=234, capture y=201 (title block offset -33px).
Diff image: `scripts/admin-parity/out/11-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/11-1586x992.png` and `scripts/admin-parity/evidence/11-1586x992-diff.png`.

Masks (6): policy change provenance (relative time and fixture name); readiness detail values (relative times and counts); mock-only annotation (handoff footer caption, not product UI).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| childTabs | within tolerance | x=292 yBody=26 w=1268 h=54 | x=288 y=217 yBody=16 w=1274 h=40 | x-4 w+6 h-14 yBody-10 |
| editButton | within tolerance | x=952 yBody=274 w=66 h=36 | x=952 y=479 yBody=278 w=67 h=37 | x+0 w+1 h+1 yBody+4 |
| previewButton | within tolerance | x=1090 yBody=624 w=221 h=48 | x=1090 y=829 yBody=628 w=221 h=48 | x+0 w+0 h+0 yBody+4 |
| primaryAction | within tolerance | x=1322 yBody=624 w=219 h=48 | x=1321 y=829 yBody=628 w=221 h=48 | x-1 w+2 h+0 yBody+4 |
| rulesCard | within tolerance | x=292 yBody=106 w=762 h=590 | x=288 y=310 yBody=109 w=767 h=593 | x-4 w+5 h+3 yBody+3 |
| rulesTable | within tolerance | x=311 yBody=210 w=724 h=296 | x=312 y=416 yBody=215 w=721 h=293 | x+1 w-3 h-3 yBody+5 |
| sectionNav | OUT of tolerance | x=292 y=196 w=1268 h=38 | x=288 y=163 yBody=-38 w=1274 h=38 | x-4 y-33 w+6 h+0 |
| selectedRuleCard | within tolerance | x=1070 yBody=106 w=489 h=590 | x=1068 y=310 yBody=109 w=494 h=593 | x-2 w+5 h+3 yBody+3 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1868 | none | `scripts/admin-parity/out/11-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections], div | `scripts/admin-parity/out/11-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/11-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Documents & Service views], div | `scripts/admin-parity/out/11-390x844.png` |

### Findings for screen 11

- Round 2 (layout with text masked): 96.60% to 98.78%; body 91.75% to 93.79% (+4px); text-box 69.04% to 70.50%; 7 of 8 landmarks (only the child-tab row fails, information architecture); no overflow at 1920, 1366, 1024 or 390.
- Fixes: the rules table header is one line (15px semibold on a 50px row; it was a wrapped 73px row that pushed every row 22px low), so the row rules now land on the reference's 499/560/621/682/742; the table is an inset box at x 311 to 1034 with the action column on 934 and 67x37 Edit buttons in 15px medium with the reference's light primary border; the rail card starts at x 1068 (494px column, 13px gap) so its left edge, content (x 1090) and both 221x48 buttons sit on the mock; both cards are 593px tall (y 343 to 935); rail type follows cap height (13px eyebrow, 22px bold heading, 17px section labels, 13px medium chips 26 to 28px tall); readiness tiles use 148/144/rest columns with 12px medium labels, chips indented under the label, ink icons and dividers from y 732.
- Remaining layout red (9,585 px): the child-tab row the mock draws inside a white card (39%, information architecture, AdminShell); the rail buttons' and Edit buttons' 1px edges and corners (27%, the mock's edges are resampled across two pixels and its corner radius is about 6px against the primitives' 10px); the Pending review chip, which follows the 17px label that Inter sets 16px wider (13%); readiness chips and icons (11%); table cells whose policy copy is longer than the mock's sample (8%, live data from documentPolicy.ts).
- Masks: the policy-change provenance line and the three readiness detail values (dynamic), plus the two mock-only footer captions.

## Screen 12

Reference: `scripts/admin-parity/reference/12-integrations-feed-health.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; protocol content parity 90.50% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/12-1586x992.png` | 92.29% | 75.60% | 92.22% | 72.57% | 92.00% (-7px) | 70.97% | 96.42% | 65.32% | 2.80% |
| 1600x1000 | `scripts/admin-parity/out/12-1600x1000.png` | 90.76% | 72.23% | 90.50% | 68.69% | n/a | n/a | n/a | n/a | 2.77% |

Rail stand-in: 243px (the mock's rail width); content region starts at x=246.
Section row bottom: reference y=174, capture y=167 (title block offset -7px).
Diff image: `scripts/admin-parity/out/12-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/12-1586x992.png` and `scripts/admin-parity/evidence/12-1586x992-diff.png`.

Masks (9): run timestamps (tile values and attempt times); fixture provider domain; rooftop pin identifier; attempt count in the pager summary; mock-only annotation (handoff footer caption, not product UI).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| banner | within tolerance | x=274 yBody=124 w=1286 h=77 | x=267 y=295 yBody=128 w=1295 h=77 | x-7 w+9 h+0 yBody+4 |
| childTabs | OUT of tolerance | x=274 yBody=66 w=1286 h=40 | x=267 y=183 yBody=16 w=1295 h=40 | x-7 w+9 h+0 yBody-50 |
| coverageCard | within tolerance | x=274 yBody=662 w=631 h=115 | x=267 y=833 yBody=666 w=638 h=118 | x-7 w+7 h+3 yBody+4 |
| openRunButton | within tolerance | x=1395 yBody=141 w=146 h=43 | x=1395 y=312 yBody=145 w=147 h=43 | x+0 w+1 h+0 yBody+4 |
| recentCard | within tolerance | x=274 yBody=324 w=904 h=321 | x=267 y=495 yBody=328 w=911 h=322 | x-7 w+7 h+1 yBody+4 |
| recentTable | within tolerance | x=274 yBody=378 w=904 h=182 | x=268 y=549 yBody=382 w=909 h=180 | x-6 w+5 h-2 yBody+4 |
| refreshCard | within tolerance | x=920 yBody=662 w=640 h=115 | x=920 y=833 yBody=666 w=642 h=118 | x+0 w+2 h+3 yBody+4 |
| reviewSourceButton | within tolerance | x=1213 yBody=561 w=328 h=43 | x=1212 y=732 yBody=565 w=330 h=43 | x-1 w+2 h+0 yBody+4 |
| sectionNav | within tolerance | x=274 w=1286 h=38 | x=267 y=129 yBody=-38 w=1295 h=38 | x-7 w+9 h+0 |
| sourceCard | within tolerance | x=1195 yBody=324 w=365 h=321 | x=1193 y=495 yBody=328 w=369 h=322 | x-2 w+4 h+1 yBody+4 |
| tile1 | within tolerance | x=274 yBody=217 w=309 h=90 | x=267 y=388 yBody=221 w=317 h=91 | x-7 w+8 h+1 yBody+4 |
| tile4 | within tolerance | x=1251 yBody=217 w=309 h=90 | x=1250 y=388 yBody=221 w=312 h=91 | x-1 w+3 h+1 yBody+4 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1858 | none | `scripts/admin-parity/out/12-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections], div | `scripts/admin-parity/out/12-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/12-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Integrations views], div | `scripts/admin-parity/out/12-390x844.png` |

### Findings for screen 12

- Round 2 (layout with text masked): 96.98% to 98.66%; body 92.49% to 94.46% (+64px); text-box 66.26% to 69.64%; 11 of 12 landmarks (only the child-tab row fails, information architecture); no overflow at any breakpoint.
- Fixes: tiles are 91px tall (their bottom rule sat on the mock's white), top-aligned with a 30px icon slot, 15px labels and 20px bold values, on 317/310/311/312 columns with 15px gaps so tiles 2 to 4 land on the mock's x; the main row is 911 + 15 + 369 (Source card from x 1193, stretched to the 322px Recent card); the attempts table is fixed-layout on the mock's columns (Outcome 445, HTTP 641, Inventory 747, Details 946) with a 41px header and rules on 657/703/750/796; the pager gains the mock's divider, 31px current page on the selected tint and 39px foot so the card ends at 883; the banner is 77px with a 2px amber frame, an orange 32px mark, an 18px headline and a translucent Open run details button at x 1395; bottom cards split at 904/920 with the mock's divider positions.
- Remaining layout red (10,138 px): the h2 and child tabs swapped against the mock (20%, information architecture: the shell's tab row sits above the view); the shell's 24px gutter against the mock's 31px, which offsets every left-anchored edge and icon by 6 to 7px (banner edge and mark 11%, tile 1 5%); the Source card (22%: the identity chip reads Previously validated, not Verified, and the note carries 'or errors', both live data); banner text and action edges (23%: longer live detail copy, a two-pixel resampled button edge, one banner rule row); the car, database and globe glyphs (icon set).
- Masks: run timestamps, the fixture provider domain, the rooftop pin and the pager count (dynamic), plus the mock-only footer caption.

## Screen 13

Reference: `scripts/admin-parity/reference/13-sync-run-detail-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; protocol content parity 87.26% is below 97%). Acceptance pending; no exception has been approved.

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |
|---|---|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/13-1586x992.png` | 88.77% | 67.22% | 87.80% | 63.13% | 93.38% (+44px) | 81.93% | 98.96% | 69.19% | 3.58% |
| 1600x1000 | `scripts/admin-parity/out/13-1600x1000.png` | 88.11% | 66.23% | 87.26% | 61.85% | n/a | n/a | n/a | n/a | 3.53% |

Rail stand-in: 233px (the mock's rail width); content region starts at x=236.
Body anchor (pinned in landmarks.json): reference y=166, capture y=210 (title block offset +44px).
Diff image: `scripts/admin-parity/out/13-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/13-1586x992.png` and `scripts/admin-parity/evidence/13-1586x992-diff.png`.

Masks (11): run timestamp and run id under the title; event times and the last successful run time; fixture provider domain; mock-only annotation (handoff footer caption, not product UI); mock-only annotation (the same footer caption where the body comparison places it, reference shifted -18px); the capture has only empty workspace here; mock-only annotation (DESIGN CONCEPT label, which the handoff forbids in production).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| actionsCard | within tolerance | x=1008 yBody=619 w=549 h=137 | x=1008 y=829 yBody=619 w=554 h=136 | x+0 w+5 h-1 yBody+0 |
| backButton | within tolerance | x=1028 yBody=691 w=248 h=44 | x=1027 y=901 yBody=691 w=250 h=44 | x-1 w+2 h+0 yBody+0 |
| badge | OUT of tolerance | x=570 y=127 w=201 h=38 | x=563 y=171 yBody=-39 w=202 h=38 | x-7 y+44 w+1 h+0 |
| breadcrumb | OUT of tolerance | x=266 y=86 h=18 | x=257 y=140 yBody=-70 w=508 h=18 | x-9 y+54 h+0 |
| diagnosis | within tolerance | x=266 yBody=176 w=712 h=209 | x=257 y=386 yBody=176 w=721 h=209 | x-9 w+9 h+0 yBody+0 |
| evidenceCard | within tolerance | x=266 yBody=666 w=727 h=134 | x=257 y=876 yBody=666 w=736 h=134 | x-9 w+9 h+0 yBody+0 |
| impactCard | within tolerance | x=1008 yBody=405 w=549 h=195 | x=1008 y=614 yBody=404 w=554 h=196 | x+0 w+5 h+1 yBody-1 |
| nextStep | within tolerance | x=1001 yBody=176 w=556 h=213 | x=1001 y=386 yBody=176 w=561 h=213 | x+0 w+5 h+0 yBody+0 |
| primaryAction | within tolerance | x=1288 yBody=691 w=249 h=44 | x=1289 y=901 yBody=691 w=250 h=44 | x+1 w+1 h+0 yBody+0 |
| summaryStrip | within tolerance | x=266 yBody=42 w=1291 h=113 | x=257 y=252 yBody=42 w=1305 h=114 | x-9 w+14 h+1 yBody+0 |
| timelineCard | within tolerance | x=266 yBody=405 w=727 h=254 | x=257 y=615 yBody=405 w=736 h=254 | x-9 w+9 h+0 yBody+0 |
| timelineTable | within tolerance | x=285 yBody=446 w=689 h=212 | x=278 y=656 yBody=446 w=694 h=212 | x-7 w+5 h+0 yBody+0 |
| title | OUT of tolerance | x=266 y=126 h=40 | x=257 y=170 yBody=-40 w=294 h=40 | x-9 y+44 h+0 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1853 | none | `scripts/admin-parity/out/13-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections], pre | `scripts/admin-parity/out/13-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/13-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div, pre | `scripts/admin-parity/out/13-390x844.png` |

### Findings for screen 13

- Round 2 (layout with text masked): 95.77% to 98.95%; body 90.19% to 93.66% (h1 anchor, -18px); text-box 64.17% to 68.87%; 11 of 13 landmarks (title and badge fail on y, the one-h1 child frame); no overflow at any breakpoint.
- Fixes: every card edge now lands on the reference (summary 190 to 303, diagnosis 324 to 532, next step 324 to 536, timeline 553 to 806, evidence 814 to 947, impact 552 to 747, actions 767 to 902): the summary strip is 114px with inset dividers on the mock's x (582, 899, 1222); the top row splits 721/561 with a 23px gap and the lower rows 736/554 with a 15px gap, as the mock staggers them; the diagnosis panel carries the reference's rose frame, a 23px title and 15/23 detail; the timeline uses 12px headers, 13/17 cells, inset rules and the mock's 32/45/51/55px row rhythm; impact and actions headers use inset rules, 13px icon gaps and the mock's 179/187px stat columns.
- Remaining layout red (8,792 px): left-anchored glyphs and edges offset 9px by the shell gutter (diagnosis mark and edge 12%, timeline and evidence icons 5%); the timeline marks (14%: the mock's info mark is a rounded square and its glyphs are drawn differently, icon set); diagnosis and timeline copy that wraps differently from the mock's sample (24%, live data from runs.ts and the fixture domain); the action buttons' resampled two-pixel edges and 6px corners (19%); the Full redacted payload disclosure under the evidence card (8%, the redaction requirement, overlapped by the mock-only caption).
- Masks: the subtitle, event times, the last successful run time, the summary provider domain and the evidence block (dynamic), plus the mock-only captions; the right caption is also masked where the body comparison places it (y 948), where the capture shows only empty workspace.

## Findings across screens

- Agreed metric: content-region pixel parity at the 1600x1000 protocol frame (DPR 1, Playwright Chromium, Inter v20 webfont, 32/255 per-channel threshold, permitted dynamic masks only). No screen reaches the 97% target; acceptance is pending and no exception has been approved.
- The reference-frame (1586x992), body-aligned and text-masked layout scores in the per-screen notes below are diagnostics recorded during tuning. They are not the agreed metric and do not stand in for it.
- The full-frame score includes the product rail and product header, which belong to the global AppShell. Scoring them separately is a proposal awaiting the owner, not an approved exception.
- Font: the references and the implementation use the same face. Fitting the reference glyph boxes against candidate faces (Inter webfont, local Inter, Inter Display, Liberation Sans, FreeSans, DejaVu Sans, Carlito) matches Inter Bold within 0.0% width and 0px height for the screen 01 title. The implementation loads Inter v20 from Google Fonts with no fallback used; remaining glyph differences are size, weight and anti-aliasing, not a different font.
- The harness never touches production data: the fixture route exists only in development builds, every fixture is synthetic, and the dev server runs on a local port.

## Reading the numbers

- The 97% target in the parity protocol applies to content-region parity at the 1600x1000 protocol frame after permitted dynamic masks. No screen meets it. The full-frame number also includes the product rail and header, which belong to the global shell; treating them separately is a proposal for the owner, not an approved exception.
- A high structural score with a lower pixel parity means the composition matches and the remaining difference is typography rendering or sub-pixel offsets; a low structural score means a layout difference and needs a look at the diff image.
- A landmark out of tolerance is a hard-gate failure regardless of the computed score. A screen's gate passes only when every landmark is within tolerance, no breakpoint has page overflow, and content-region parity at the protocol frame is at least 97%.
- Responsive: page overflow (document wider than the viewport) fails the breakpoint. A region that scrolls by design, such as the section row or a wide table inside its own scroll container, is listed under Scroll regions and does not fail it.

## Reproduce

```
bun run admin:parity
bun run admin:parity -- --screens 01
node --test scripts/admin-parity/harness.test.cjs
bunx vitest run src/pages/admin/fixtures
```
