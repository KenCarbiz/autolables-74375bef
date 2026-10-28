# Administration V2 visual parity report

Generated 2026-10-28T08:45:19.426Z by `bun run admin:parity` against the development fixture route. Every screen is a synthetic fixture rendered by the real Administration components; no production data appears in any capture.

## Method

- Reference frame: 1586x992, the native size of `screens/original`. The fixture is rendered at exactly that viewport and compared pixel for pixel, no resampling of the reference.
- Protocol frame: 1600x1000. The reference is resampled (bilinear) to that frame, which softens one-pixel lines, so the reference-frame row is the primary number.
- Pixel parity: a pixel differs when any channel moves by more than 32 of 255 after masks. Parity is 100 minus the differing share of compared pixels. No anti-aliasing allowance is applied.
- Structure: mean SSIM over 8x8 luminance blocks after masks.
- Masks: only dynamic data (counts, relative times, fixture names) listed in `scripts/admin-parity/masks.json`, read from the rendered DOM so the same boxes mask both images. Navigation, tabs, headings, card bounds, tables, buttons and chips are never masked.
- Content region: y >= 70 and x past the mock's rail (each screen's `_rail` in `scripts/admin-parity/landmarks.json`, 217 to 264px across the set; the fixture sizes its rail stand-in to the same number so the content origin lines up). The rail and the product header belong to the global application shell (`AppShell`, whose live rail is 256px), which this refresh does not restyle; the full-frame score includes them for completeness.
- Landmarks: hand-measured boxes from the reference (`scripts/admin-parity/landmarks.json`, tolerance 16px) compared with the rendered DOM boxes. A `yBody` landmark is measured from the section-row bottom on both sides.
- Body parity (aligned): the handoff's information architecture fixes one h1, "Administration", with a breadcrumb above it, while the mocks title their pages four different ways (section name as title, no breadcrumb, no description, a chip above the title). That title block is a documented exception: the body score shifts the reference so both section rows end on the same pixel row and scores everything below it in the content region, with the same masks. The offset is printed with the score and the raw content score stays the protocol number.
- Responsive: 1920x1080, 1366x768, 1024x768 and 390x844 captured; a breakpoint passes when the document has no horizontal overflow and no element extends past the viewport.

Registered fixtures: 10, 11, 12, 13, 01, 02, 03, 04, 05, 06, 07, 08, 09.

## Screen 01

Reference: `scripts/admin-parity/reference/01-admin-overview.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 90.36% is below 97%). With the title-block exception: FAIL (body parity 89.61%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/01-1586x992.png` | 90.91% | 70.82% | 90.36% | 67.97% | 89.61% (+0px) | 64.18% | 1.92% |
| 1600x1000 | `scripts/admin-parity/out/01-1600x1000.png` | 90.94% | 72.17% | 90.70% | 70.01% | n/a | n/a | 1.92% |

Rail stand-in: 229px (the mock's rail width); content region starts at x=232.
Section row bottom: reference y=238, capture y=238 (title block offset +0px).
Diff image: `scripts/admin-parity/out/01-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/01-1586x992.png` and `scripts/admin-parity/evidence/01-1586x992-diff.png`.

Masks (8): summary tile counts; recent activity relative times.

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| breadcrumb | within tolerance | x=249 y=86 | x=253 y=86 yBody=-152 w=1309 h=18 | x+4 y+0 |
| title | within tolerance | x=249 y=116 h=40 | x=253 y=116 yBody=-122 w=1309 h=40 | x+4 y+0 h+0 |
| sectionNav | within tolerance | x=249 y=200 w=1317 h=38 | x=253 y=200 yBody=-38 w=1309 h=38 | x+4 y+0 w-8 h+0 |
| banner | within tolerance | x=249 y=254 w=1317 h=58 | x=253 y=254 yBody=16 w=1309 h=58 | x+4 y+0 w-8 h+0 |
| tile1 | within tolerance | x=249 y=326 w=313 h=79 | x=253 y=326 yBody=88 w=315 h=80 | x+4 y+0 w+2 h+1 |
| tile4 | within tolerance | x=1235 y=326 w=331 h=79 | x=1247 y=326 yBody=88 w=315 h=80 | x+12 y+0 w-16 h+1 |
| attentionCard | within tolerance | x=249 y=420 w=889 | x=253 y=422 yBody=184 w=884 h=318 | x+4 y+2 w-5 |
| policyCard | within tolerance | x=1152 y=420 w=414 | x=1151 y=422 yBody=184 w=411 h=549 | x-1 y+2 w-3 |
| settingsCard | within tolerance | x=249 y=748 w=603 | x=253 y=756 yBody=518 w=599 h=215 | x+4 y+8 w-4 |
| activityCard | within tolerance | x=862 y=748 w=276 | x=862 y=756 yBody=518 w=275 h=215 | x+0 y+8 w-1 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1851 | none | `scripts/admin-parity/out/01-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/01-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/01-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div | `scripts/admin-parity/out/01-390x844.png` |

### Findings for screen 01

- Composition is the gate failure. The reference lays the body out as two columns: a left column (x 249 to 1138) holding What needs attention (y 420 to about 722) above Administration settings (x 249, width 603) and Recent activity (x 862, width 276) side by side at y 748, and a right column holding Effective policy (x 1152, width 414) from y 420 to the bottom of that row at about 955. OverviewView.tsx renders two stacked full-width grids instead: attention beside policy, then settings beside activity. That puts the second row at y 851 against 748 (delta +103), stretches Administration settings to 974px against 603, and moves Recent activity to x 1238 against 862. Owner: OverviewView.tsx (keystone, parent stream).
- Measured fix, not applied on this branch because the files are outside this stream's ownership: scripts/admin-parity/proposals/01-overview-composition.patch rebuilds the body as that two-column composition (outer grid 2.15fr to 1fr with a 14px gap, inner grid 2.18fr to 1fr with a 10px gap). With it applied every card landmark lands within 3px on x and width: attention x 248 w 887, policy x 1149 w 413, settings x 248 w 601, activity x 859 w 276. The remaining deltas are vertical: the cards start at y 440 against 420 (+20, from the header block) and the second row at y 811 against 748 (+63). The +63 is the attention card's height, 355px rendered against about 302px in the reference, whose four rows are about 53px tall under a 40px header row with no padding below the table.
- Header block (AdminShell.tsx, parent stream): the keystone places the section row at y 184 against 200 (delta -16, at the tolerance edge) and renders the title at a 36px line height against 40px. The same patch sets the h1 to margin-top 16px and line height 40px, the description to margin-top 6px and the section gap to 36px, which measured the title at y 122 (+6) and the section row at y 204 (+4) at the reference height. The banner and tiles then sit 10 to 12px low instead of 8 to 10px high; the tile row is 79px tall in the reference against 86px rendered.
- Stat tiles: the four tiles render at equal 317px widths; the reference measures 313px for the first three and 331px for the last, so tile 4 starts at x 1246 against 1235 (+11). Within tolerance.
- Pixel parity stayed at 88.66% with the composition patch applied (88.64% without) because the remaining difference is inside the cards, where the diff image is red: row heights and the status chip column in What needs attention, the row rhythm of Effective policy (about 88px per row in the reference), the 3 by 2 shortcut grid of Administration settings (tiles about 186 by 70px), Recent activity row spacing, and glyph-level rendering of Inter by Chromium against the reference renderer, which keeps even matching text from scoring as identical pixels. Structure (63.34%) will move before pixel parity does; re-measure after each internal fix.
- Responsive: 390x844 fails on page overflow (scrollWidth 442 against 390, widest fixed element at 416) because the fixture page draws its 224px rail stand-in at every width, while the product AppShell hides its rail below the lg breakpoint. With the stand-in hidden below lg (the one-line AdminDesignFixture.tsx hunk in the same patch) the keystone view and shell have no page overflow at 390: scrollWidth 390, widest fixed element 374, with the section row and the attention table scrolling inside their own containers by design. 1024x768 passes; its only scroll region is the section row. 1920x1080 and 1366x768 pass with no scroll regions. Every breakpoint renders exactly one h1.

## Screen 02

Reference: `scripts/admin-parity/reference/02-dealership-brand.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 87.51% is below 97%). With the title-block exception: FAIL (body parity 92.92%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/02-1586x992.png` | 88.44% | 68.26% | 87.51% | 64.04% | 92.92% (+33px) | 75.26% | 0.76% |
| 1600x1000 | `scripts/admin-parity/out/02-1600x1000.png` | 88.40% | 68.97% | 87.74% | 64.95% | n/a | n/a | 0.75% |

Rail stand-in: 252px (the mock's rail width); content region starts at x=255.
Section row bottom: reference y=205, capture y=238 (title block offset +33px).
Diff image: `scripts/admin-parity/out/02-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/02-1586x992.png` and `scripts/admin-parity/evidence/02-1586x992-diff.png`.

Masks (3): dealership name, location and website address (fixture dealer).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=278 yBody=-38 w=1282 h=38 | x=276 y=200 yBody=-38 w=1286 h=38 | x-2 w+4 h+0 yBody+0 |
| childTabs | within tolerance | x=278 yBody=24 w=1282 h=40 | x=276 y=254 yBody=16 w=1286 h=36 | x-2 w+4 h-4 yBody-8 |
| identityCard | within tolerance | x=277 yBody=82 w=742 h=392 | x=276 y=322 yBody=84 w=745 h=388 | x-1 w+3 h-4 yBody+2 |
| nameInput | within tolerance | x=303 yBody=202 w=445 h=37 | x=301 y=440 yBody=202 w=447 h=37 | x-2 w+2 h+0 yBody+0 |
| logoBox | within tolerance | x=792 yBody=206 w=203 h=131 | x=793 y=444 yBody=206 w=203 h=131 | x+1 w+0 h+0 yBody+0 |
| appearanceCard | within tolerance | x=277 yBody=490 w=742 h=202 | x=276 y=726 yBody=488 w=745 h=201 | x-1 w+3 h-1 yBody-2 |
| previewCard | within tolerance | x=1032 yBody=82 w=528 h=295 | x=1034 y=322 yBody=84 w=528 h=292 | x+2 w+0 h-3 yBody+2 |
| previewBlock | within tolerance | x=1055 yBody=176 w=483 h=100 | x=1057 y=414 yBody=176 w=482 h=100 | x+2 w-1 h+0 yBody+0 |
| readinessCard | within tolerance | x=1032 yBody=394 w=528 h=284 | x=1034 y=630 yBody=392 w=528 h=279 | x+2 w+0 h-5 yBody-2 |
| readinessTable | within tolerance | x=1056 yBody=482 w=482 h=170 | x=1058 y=715 yBody=477 w=480 h=160 | x+2 w-2 h-10 yBody-5 |
| primaryAction | within tolerance | x=1390 yBody=703 w=171 h=42 | x=1388 y=938 yBody=700 w=172 h=42 | x-2 w+1 h+0 yBody-3 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1886 | none | `scripts/admin-parity/out/02-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1366 | nav[Administration sections] | `scripts/admin-parity/out/02-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1024 | nav[Administration sections] | `scripts/admin-parity/out/02-1024x768.png` |
| 390x844 | none | 390 | 390 | 390 | nav[Administration sections], div | `scripts/admin-parity/out/02-390x844.png` |

### Findings for screen 02

- Parity moved from content 85.64% / body 89.34% (+33px) / structure 62.45% to content 87.33% / body 92.63% / structure 64.02% with 11 of 11 landmarks within tolerance (the largest deltas are h -10 on the readiness table and yBody -8 on the shell's child-tab row). The mock titles the page Dealership & Brand with a Design concept chip and no breadcrumb, so its section row ends at y 205 against 238 here; the body score is the number to read.
- Composition set from the reference (IdentityView.tsx, cards.tsx, fields.tsx, BrandSaveBar.tsx): the Branding for this rooftop note is pulled into the shell's gap under the child tabs (-8px top margin, 4px bottom) so the cards start 82px under the section row as the mock draws them (measured 84); a minmax(0,1fr)/528px grid with a 13px gutter (cards 745 and 528 wide against 742 and 528); 20px/28px card titles over 14px descriptions with a 16px header padding (title ink 23px under the card edge in the mock); the identity form on a 118px label column, 37px controls on a 52px pitch (name input at yBody 202 in both), beside a 226px logo column behind a 1px divider holding a 131px dashed box, a 41px upload button and the hint; the Store identity card measures 388px against 392. The right column: a 100px navy preview block 22px in from the card edge with a 21px wordmark, an 18px name and a 13px location, a note 13px under it (card 292 against 295); Contact readiness with a 36px header, 41px rows and 28px chips 20px from the box edge (table 160px against 170 because the mock's website row is 48px where ours is 41). Appearance: 50px swatches on a 124px pitch, a divider 45px from a 240px accent column with a 39px read-only control and a 24px colour dot. The save bar is a footer strip from the rail edge to the page edge with a 32px status mark and 42px buttons (Review changes 172x42 at x 1388 against 171x42 at 1390).
- Icons measured on the mock and set: note and label info marks 20px (mock ink 15-17), group lock 20px (mock 9x13), select chevrons 24px (mock ink 12x7, which a 20px lucide box draws at 10x5), upload 20px (mock 12), external link 20px (mock 13), accent dot 24px (mock 23x22), save-bar check circle 32px (mock ink 26). Chips 28px tall as drawn.
- Remaining difference, from a body-aligned diff (reference shifted +33): no 50px band holds more than 14% of its pixels as different; the differing pixels are the glyphs of every label, value and title, which Chromium's Inter renders about 7% wider than the mock renderer, plus the mock's Harte dealer strings where the fixture reads Example (masked where they are data). Row 3 of the readiness table is 48px in the mock against 41; the shell's child-tab row is 36px against the mock's 40 and sits 8px higher. Masks: the preview name and location and the website address, 0.21% of the frame.
- Type scale against the tokens: card titles 20/28 semibold (token 16/22; mock ink 20-21px), card descriptions 14/20 (token 13/18), field labels 14/20 semibold (token 13/18), table headers 12px ink-coloured (token muted), preview name 18/24. Responsive: no page overflow at any breakpoint; the logo column stacks under the form below md, the right column under the left below xl.

## Screen 03

Reference: `scripts/admin-parity/reference/03-people-access.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 91.66% is below 97%). With the title-block exception: FAIL (body parity 93.83%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/03-1586x992.png` | 92.40% | 73.59% | 91.66% | 70.79% | 93.83% (+21px) | 79.46% | 2.46% |
| 1600x1000 | `scripts/admin-parity/out/03-1600x1000.png` | 92.16% | 72.85% | 91.66% | 70.87% | n/a | n/a | 2.42% |

Rail stand-in: 238px (the mock's rail width); content region starts at x=241.
Section row bottom: reference y=217, capture y=238 (title block offset +21px).
Diff image: `scripts/admin-parity/out/03-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/03-1586x992.png` and `scripts/admin-parity/evidence/03-1586x992-diff.png`.

Masks (6): member names in the table and the rail (fixture addresses).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=254 yBody=-39 w=1315 h=39 | x=262 y=200 yBody=-38 w=1300 h=38 | x+8 w-15 h-1 yBody+1 |
| childTabs | within tolerance | x=254 yBody=21 w=1315 h=48 | x=262 y=254 yBody=16 w=1300 h=36 | x+8 w-15 h-12 yBody-5 |
| teamCard | within tolerance | x=254 yBody=70 w=1315 h=661 | x=262 y=306 yBody=68 w=1300 h=663 | x+8 w-15 h+2 yBody-2 |
| searchInput | within tolerance | x=272 yBody=94 w=308 h=43 | x=281 y=332 yBody=94 w=308 h=43 | x+9 w+0 h+0 yBody+0 |
| addEmployee | within tolerance | x=1043 yBody=95 w=151 h=42 | x=1032 y=333 yBody=95 w=155 h=42 | x-11 w+4 h+0 yBody+0 |
| teamTable | within tolerance | x=273 yBody=159 w=920 | x=282 y=397 yBody=159 w=904 h=381 | x+9 w-16 yBody+0 |
| rail | within tolerance | x=1213 yBody=70 w=357 | x=1205 y=307 yBody=69 w=356 h=661 | x-8 w-1 yBody-1 |
| viewPolicy | within tolerance | x=1231 yBody=595 w=325 h=44 | x=1224 y=834 yBody=596 w=323 h=44 | x-7 w-2 h+0 yBody+1 |
| railNote | within tolerance | x=1231 yBody=655 w=325 h=45 | x=1224 y=894 yBody=656 w=323 h=44 | x-7 w-2 h-1 yBody+1 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1855 | none | `scripts/admin-parity/out/03-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/03-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections], div | `scripts/admin-parity/out/03-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div | `scripts/admin-parity/out/03-390x844.png` |

### Findings for screen 03

- Parity moved from content 90.25% / body 89.84% (+21px) / structure 68.62% with page overflow at 1024 and 390 to content 91.66% / body 93.83% / structure 70.79% with no overflow and 9 of 9 landmarks within tolerance (the largest deltas are x +9 and w -16 on the table, from the shell's 24px gutter against the mock's 16-17px). The overflow was the table's screen-reader text: sr-only spans are absolutely positioned against the viewport, so inside a table wider than its scroll wrapper they widened the document to 793px at 390 and 1025px at 1024; the wrapper is now a positioned box, so they stay inside it.
- Composition set from the reference (TeamView.tsx, components.tsx): one card holds the toolbar and table beside the rail, as the mock draws it; the mock's 48px tab strip inside the card is the shell's tab row here, so the card starts where the strip ends (yBody 68 against 70). Toolbar: a 308x43 search with a 24px magnifier, a 14px Department label with a 176x43 select and a 151x42 Add employee button with a 20px glyph (measured 155x42), 25px under the card edge and 21px over the table. The table is an inset box 18px from the card edges with a 45px header in 14px ink, 67px rows around 52px avatars with 18px initials (mock 48px of ink; sized to the owner's 52), fixed 159/146/146/150/58 columns at xl so roles stay on one line, a 10px status dot, a 24px actions mark and a 554px minimum height matching the mock's panel; the fixture lists the mock's five accepted members in its order. The rail is a 356px column behind a divider: a 20px title with a 24px close mark, a 56px avatar with 20px initials beside an 18px name and the role with the status inline, then rules at 143, 221, 400 and 526px under the card edge (mock 142, 220, 399, 525), a 28px building mark, 24px check and ban marks on 30px item pitches, a 44px outlined View role policy button (yBody 596 against 595) and a 44px note (656 against 655).
- Icons measured on the mock and set: search 24px (mock ink 17-18), Add employee 20px (mock 16), actions ellipsis 24px (mock 16 wide), status dot 10px, team avatars 52px, rail avatar 56px (mock 55), close 24px (mock 11x13), building 28px (mock 22x23), checks and bans 24px (mock 17x13 and 19x19), note info 24px (mock 19x20).
- Decisions outside the mock: the Status filter select is not drawn (the mock's toolbar holds search, Department and Add employee; with the select the toolbar wrapped onto a second line and pushed the table 48px down), the status filter remains in the URL model; the rail shows the member's status beside the role instead of a second key-value row; the Member sub-line under each name stays. The mock's sort arrows in the header are not drawn because the columns do not sort.
- Remaining difference, from a body-aligned diff (reference shifted +21): the table column holds 65% of the differing pixels and the rail 35%, in the glyphs of names (masked), roles, departments and headers, where the fixture's addresses are longer than the mock's display names and the role labels differ (Service Writer, Title Clerk / Office Mgr); the avatars are 52px against 48 and tinted one colour where the mock tints per person; the mock's outlined button border is anti-aliased light blue where ours is a crisp 1px. Masks: the five names and the rail name, 0.42% of the frame. Type scale against the tokens: table headers 14/19 ink-coloured (token meta 12 muted), rail title 20/28 (token card title 16/22), rail name 18/24, note 12px. Responsive: no page overflow; the rail stacks under the table below xl, the section row and the table scroll inside their own containers at 390.

## Screen 04

Reference: `scripts/admin-parity/reference/04-salesperson-role-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 88.55% is below 97%). With the title-block exception: FAIL (body parity 92.14%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/04-1586x992.png` | 89.26% | 67.96% | 88.55% | 64.18% | 92.14% (-24px) | 72.23% | 0.32% |
| 1600x1000 | `scripts/admin-parity/out/04-1600x1000.png` | 88.38% | 67.85% | 87.69% | 65.04% | n/a | n/a | 0.32% |

Rail stand-in: 239px (the mock's rail width); content region starts at x=242.
Body anchor (pinned in landmarks.json): reference y=244, capture y=220 (title block offset -24px).
Diff image: `scripts/admin-parity/out/04-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/04-1586x992.png` and `scripts/admin-parity/evidence/04-1586x992-diff.png`.

Masks (1): member address in the capabilities description (fixture).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=258 yBody=-37 w=1308 h=37 | x=263 y=182 yBody=-38 w=1299 h=38 | x+5 w-9 h+1 yBody-1 |
| capabilitiesCard | within tolerance | x=258 yBody=20 w=768 h=623 | x=263 y=240 yBody=20 w=757 h=625 | x+5 w-11 h+2 yBody+0 |
| capabilityTable | within tolerance | x=279 yBody=108 w=726 h=518 | x=285 y=329 yBody=109 w=713 h=517 | x+6 w-13 h-1 yBody+1 |
| enforcementCard | within tolerance | x=1039 yBody=20 w=528 h=623 | x=1034 y=240 yBody=20 w=528 h=625 | x-5 w+0 h+2 yBody+0 |
| enforcementList | within tolerance | x=1058 yBody=107 w=494 h=408 | x=1054 y=328 yBody=108 w=492 h=405 | x-4 w-2 h-3 yBody+1 |
| bottomNote | within tolerance | x=262 yBody=654 w=879 h=50 | x=263 y=877 yBody=657 w=866 h=50 | x+1 w-13 h+0 yBody+3 |
| testAccess | within tolerance | x=1167 yBody=659 w=169 h=40 | x=1154 y=882 yBody=662 w=178 h=40 | x-13 w+9 h+0 yBody+3 |
| primaryAction | within tolerance | x=1349 yBody=659 w=218 h=40 | x=1345 y=882 yBody=662 w=217 h=40 | x-4 w-1 h+0 yBody+3 |

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

## Screen 05

Reference: `scripts/admin-parity/reference/05-pricing-products.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 88.77% is below 97%). With the title-block exception: FAIL (body parity 90.41%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/05-1586x992.png` | 89.83% | 69.78% | 88.77% | 65.34% | 90.41% (+80px) | 69.94% | 9.88% |
| 1600x1000 | `scripts/admin-parity/out/05-1600x1000.png` | 89.34% | 69.81% | 88.48% | 65.70% | n/a | n/a | 10.16% |

Rail stand-in: 228px (the mock's rail width); content region starts at x=231.
Section row bottom: reference y=158, capture y=238 (title block offset +80px).
Diff image: `scripts/admin-parity/out/05-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/05-1586x992.png` and `scripts/admin-parity/evidence/05-1586x992-diff.png`.

Masks (38): change impact counts (fixture inventory sizes); preview vehicle name, trim, stock and prices (fixture vehicle); vehicle names, stock numbers and prices (fixture vehicles); vehicles-shown count.

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=257 yBody=-38 w=1305 h=38 | x=252 y=200 yBody=-38 w=1310 h=38 | x-5 w+5 h+0 yBody+0 |
| childTabs | within tolerance | x=257 yBody=14 w=1305 h=36 | x=252 y=254 yBody=16 w=1310 h=36 | x-5 w+5 h+0 yBody+2 |
| policyCard | within tolerance | x=257 yBody=66 w=704 h=411 | x=252 y=306 yBody=68 w=707 h=411 | x-5 w+3 h+0 yBody+2 |
| previewCard | within tolerance | x=975 yBody=66 w=587 h=411 | x=973 y=306 yBody=68 w=589 h=411 | x-2 w+2 h+0 yBody+2 |
| scopeSelect | within tolerance | x=366 yBody=361 w=252 h=32 | x=363 y=602 yBody=364 w=252 h=32 | x-3 w+0 h+0 yBody+3 |
| reviewButton | within tolerance | x=795 yBody=405 w=146 h=33 | x=792 y=646 yBody=408 w=146 h=33 | x-3 w+0 h+0 yBody+3 |
| consistencyCard | within tolerance | x=257 yBody=492 w=1305 | x=252 y=733 yBody=495 w=1310 h=416 | x-5 w+5 yBody+3 |
| consistencyTable | within tolerance | x=276 yBody=560 w=1267 | x=274 y=803 yBody=565 w=1266 h=292 | x-2 w-1 yBody+5 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1850 | none | `scripts/admin-parity/out/05-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections], div | `scripts/admin-parity/out/05-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections], div | `scripts/admin-parity/out/05-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div | `scripts/admin-parity/out/05-390x844.png` |

### Findings for screen 05

- Title block: the mock has no breadcrumb and no description, so its section row ends at y 158 against 238 in the capture (offset +80). The body score is the number to read. Before this pass: content 90.05, body 89.66, no landmarks. After: content 88.75, body 90.40, every landmark within tolerance (both top cards 411px tall as in the mock; the consistency card and its table sit 3 and 5px low; x runs 4 to 9px left, the rail stand-in).
- Composition (PriceRulesView.tsx): the top row is a 1.2fr/1fr grid with a 14px gap (mock cards 704 and 587 wide, ours 709 and 591); both cards carry an 18px bold title with a 13px description over a header border at 66px, the policy list is a two-column 24px grid (labels at x 277, values at x 500 against the mock's 284 and 493), the info note is 34px tall with a 20px icon, Change impact is a 16px heading, a 13px description, a 90px Scope label with a 252x32 select, then two dot-number-label stats beside a 146x33 Review button with its state text centred under it (mock 795x563, ours 790x566 body-relative). The preview card places a 262x130 image beside a 253px price column with 32px rows and a bold total. Price consistency keeps its title row without a border, insets the table 20px (mock 19) with column lines, a 37px header, 51px rows (mock 50), 64x38 thumbnails, 20px header icons, 20px evidence marks and 30px status chips, and a 50px footer with an info icon.
- Fixture: the policy mode is website_sale_price so the Display basis row reads 'Advertised total includes document fee' and the review summary reads 'Includes fee', as the mock shows; consistency rows are assessed under the same mode. No test outcome changed.
- Remaining difference: Inter in Chromium renders about 15 percent wider than the mock renderer at the same size, so the tile hints, the preview footnotes and the table text differ pixel for pixel while matching in position; the mock's car photos (preview and row thumbnails) have no fixture counterpart and render as tinted placeholders; the mock's 'Not checked' website cells read as a dash here; the header action shows the mismatch chip and 'Price audit' where the mock shows a 'How this works' link; the whole page sits 9px left of the mock because the fixture rail stand-in is 224px against the mock's 229.
- Type scale against the tokens: card titles 18/20 bold (token card title 16/22, the mock measures 17px of ink), tile numbers 24/28 bold (token stat 28/34, mock ink 17px), preview vehicle name 18/24 semibold, preview rows 15/20, chips 13px (token meta 12), hints 12px. Icons measured from the mock and set: pencil, read-only info, note info, table header globe/tag/file, evidence check and triangle, and both info marks at 20px (mock ink 12-17px); the stat dots at 11px (mock 9-11).

## Screen 06

Reference: `scripts/admin-parity/reference/06-fee-change-review-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 92.51% is below 97%). With the title-block exception: FAIL (body parity 92.32%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/06-1586x992.png` | 87.21% | 77.22% | 92.51% | 75.37% | 92.32% (+0px) | 74.92% | 3.82% |
| 1600x1000 | `scripts/admin-parity/out/06-1600x1000.png` | 85.58% | 73.80% | 90.58% | 71.32% | n/a | n/a | 3.75% |

Rail stand-in: 243px (the mock's rail width); content region starts at x=246.
Body anchor (pinned in landmarks.json): reference y=187, capture y=187 (title block offset +0px).
Diff image: `scripts/admin-parity/out/06-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/06-1586x992.png` and `scripts/admin-parity/evidence/06-1586x992-diff.png`.

Masks (5): expected impact counts (fixture inventory sizes); example vehicle name, stock, VIN suffix, selling price and totals (fixture vehicle); the fee column is policy data and stays.

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| dialog | within tolerance | x=443 yBody=0 w=907 h=776 | x=443 y=187 yBody=0 w=907 h=778 | x+0 w+0 h+2 yBody+0 |
| title | within tolerance | x=471 yBody=24 h=28 | x=472 y=212 yBody=25 w=477 h=28 | x+1 h+0 yBody+1 |
| step1 | within tolerance | x=586 yBody=91 h=38 | x=577 y=279 yBody=92 w=109 h=38 | x-9 h+0 yBody+1 |
| step3 | within tolerance | x=1104 yBody=91 h=38 | x=1106 y=279 yBody=92 w=110 h=38 | x+2 h+0 yBody+1 |
| summaryTable | within tolerance | x=471 yBody=191 w=512 h=160 | x=473 y=381 yBody=194 w=507 h=163 | x+2 w-5 h+3 yBody+3 |
| impactTile1 | within tolerance | x=1011 yBody=192 w=312 h=112 | x=1009 y=380 yBody=193 w=312 h=112 | x-2 w+0 h+0 yBody+1 |
| impactTile2 | within tolerance | x=1011 yBody=312 w=312 h=112 | x=1009 y=500 yBody=313 w=312 h=112 | x-2 w+0 h+0 yBody+1 |
| exampleTable | within tolerance | x=471 yBody=456 w=852 h=99 | x=473 y=641 yBody=454 w=847 h=99 | x+2 w-5 h+0 yBody-2 |
| warningNote | within tolerance | x=471 yBody=574 w=852 h=41 | x=472 y=761 yBody=574 w=849 h=42 | x+1 w-3 h+1 yBody+0 |
| backButton | within tolerance | x=471 yBody=688 w=156 h=41 | x=472 y=877 yBody=690 w=165 h=41 | x+1 w+9 h+0 yBody+2 |
| applyButton | within tolerance | x=1092 yBody=688 w=231 h=41 | x=1091 y=877 yBody=690 w=230 h=41 | x-1 w-1 h+0 yBody+2 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1858 | none | `scripts/admin-parity/out/06-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections], div | `scripts/admin-parity/out/06-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections], div | `scripts/admin-parity/out/06-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], div | `scripts/admin-parity/out/06-390x844.png` |

### Findings for screen 06

- Decision: the fee review stays a child route (/admin/pricing/fee-review) and renders the mock's dialog over the Price rules page. The shared ReviewDialog centres its panel vertically inside a fixed, full-viewport scrim with a 900px cap and 24px body padding, so the mock's geometry (dialog x 443-1350, y 187-962, dimming only the workspace) cannot be reached through it; the frame is built in FeeReviewPage.tsx instead: a scrim limited to the content column, a 907px panel placed 123px under the product header (y 187 in the reference frame) and centred in the content column (x 452 against 443), 28px side padding, a 22/28 title, a three-step stepper with 38px circles, Change summary (512px table, 34px header, 42px rows, column lines) beside Expected impact (two 312x112 tiles with 48px tinted circles and 28px glyphs), one example vehicle row (35px header, 62px row), two 42px notes, and a footer with Back to edit and Apply (41px) over an 11px permission note. Every landmark is within tolerance; the dialog measures 778px tall against 776.
- Scrim: the mock dims the page to about #979DA6 over the workspace and #9A9FA8 over white, which a navy overlay cannot reproduce (the previous #0B1A33 at 55 percent gave #747D8D, 40 or more per channel off, so every dimmed background pixel scored as different). The scrim is #626A75 at 64 percent, which lands within 4 per channel on both; dimmed text differs where the layouts differ.
- Body anchor: the mock has no section row the detector can find (the underline is dimmed), so the body row is pinned to the dialog top. The view marks that row with a zero-height element (data-landmark='fee-review-top') whose bottom is the dialog top, giving an offset of 0; the body score is the content region from y 187 down. Before this pass: content 50.79, no body score, no landmarks. After: content 90.50, body 90.14 (offset 0), landmarks all within tolerance (the largest deltas are x +11 on the left column and h +3 on the summary table).
- Fixture and tests: the review fixture uses the fee-inclusive basis and a sample size of 1 (the mock shows one example vehicle; the live preview keeps the routine's default of three), and its listing rows carry no parser warnings (the extra warning note added 50px the mock does not draw). The 06 fixture test's row count moved from 4 to 2 accordingly; behaviour, Apply gating, the role check, the no-write-on-mount and the fallback-routine tests are unchanged. The summary table lists changed fields plus the price basis (the mock's three rows); an unchanged jurisdiction is not repeated.
- Remaining difference: the page behind the scrim is the mock's older Pricing & Products layout (a vertical sub-navigation, an 'Edit document fee' button and a policy-version card) against our Price rules page, so the dimmed text differs wherever the two layouts put text; the stepper lines are equal here (about 108px) where the mock draws 95 and 119; label widths differ with the renderer; the Apply button reads 48 against the mock's 128.
- Type scale against the tokens: dialog title 22/28 bold (the mock's ink is 22px), subtitle 13/18, step labels 13/18 semibold over 11/16, section headings 16/22 semibold (token section 18/26; the mock's ink is 15px), table headers 13px ink (token meta 12 muted), tile numbers 24/28 (token stat 28/34), tile labels 15/20 semibold, hints 13/18, example row name 14/20 semibold (mock 15; widened column 300px so the fixture's longer name does not wrap), buttons 15px, footnote 11px. Icons: close 20px (mock ink 13), step check 18px at stroke 3, step digits 16px, tile glyphs 28px (mock ink 22-23), price arrow 26px (mock 22x13), delta triangles 14x9, note icons 26px (mock 21), Back to edit arrow 20px (mock 14x12).
- Shared-file request (src/components/admin/v2/ReviewDialog.tsx): a placement prop (items-start with a configurable top offset, scrim limited to the content column) and a width prop would let this page use the primitive; the mock needs top 187, width 907 and 28px padding, none of which the primitive exposes.

## Screen 07

Reference: `scripts/admin-parity/reference/07-product-applicability-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 90.41% is below 97%). With the title-block exception: FAIL (body parity 90.13%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/07-1586x992.png` | 90.88% | 73.37% | 90.41% | 70.84% | 90.13% (-2px) | 67.31% | 2.60% |
| 1600x1000 | `scripts/admin-parity/out/07-1600x1000.png` | 90.84% | 73.85% | 90.64% | 71.56% | n/a | n/a | 2.56% |

Rail stand-in: 242px (the mock's rail width); content region starts at x=245.
Body anchor (pinned in landmarks.json): reference y=228, capture y=226 (title block offset -2px).
Diff image: `scripts/admin-parity/out/07-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/07-1586x992.png` and `scripts/admin-parity/evidence/07-1586x992-diff.png`.

Masks (4): sample vehicle names and mileage (fixture vehicles); product price (fixture value).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| childTabs | within tolerance | x=267 yBody=-44 w=1295 h=44 | x=266 y=182 yBody=-44 w=1296 h=44 | x-1 w+1 h+0 yBody+0 |
| rulesCard | within tolerance | x=267 yBody=19 w=701 h=668 | x=266 y=246 yBody=20 w=701 h=667 | x-1 w+0 h-1 yBody+1 |
| rulesBox | within tolerance | x=290 yBody=103 w=655 h=289 | x=291 y=331 yBody=105 w=651 h=292 | x+1 w-4 h+3 yBody+2 |
| priceBox | within tolerance | x=290 yBody=411 w=655 h=186 | x=291 y=643 yBody=417 w=651 h=187 | x+1 w-4 h+1 yBody+6 |
| evidenceCard | within tolerance | x=981 yBody=19 w=581 h=358 | x=980 y=246 yBody=20 w=582 h=359 | x-1 w+1 h+1 yBody+1 |
| evidenceList | within tolerance | x=999 yBody=103 w=544 h=259 | x=999 y=331 yBody=105 w=544 h=261 | x+0 w+0 h+2 yBody+2 |
| samplesCard | within tolerance | x=981 yBody=388 w=581 h=299 | x=980 y=617 yBody=391 w=582 h=299 | x-1 w+1 h+0 yBody+3 |
| samplesTable | within tolerance | x=999 yBody=472 w=544 h=197 | x=998 y=703 yBody=477 w=546 h=199 | x-1 w+2 h+2 yBody+5 |
| reviewButton | within tolerance | x=1408 yBody=706 w=155 h=42 | x=1406 y=936 yBody=710 w=156 h=42 | x-2 w+1 h+0 yBody+4 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1857 | none | `scripts/admin-parity/out/07-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | div | `scripts/admin-parity/out/07-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | none | `scripts/admin-parity/out/07-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Product views], div | `scripts/admin-parity/out/07-390x844.png` |

### Findings for screen 07

- Body anchor: a child page with no section row; the body row is pinned to the child tab row bottom, 228 in the mock (underline rows 226-227, border 227) against 226 in the capture (offset -2). Before this pass: content 89.27, no body score, no landmarks. After: content 89.48, body 89.19 (offset -2); the right-column and footer landmarks pass, the four left-column landmarks fail on x only.
- The x failure is the fixture rail: the 07 mock draws its rail 242px wide and starts content at x 267, the fixture page draws a 224px stand-in and the shell's 24px gutter puts content at 248 (-19); the right column, sized by the 1.206fr/1fr grid, lands at 972 against 981 (-9). Shared-file request (src/pages/admin/AdminDesignFixture.tsx): a 236px rail stand-in would put the left edge at 260, within 7px of both the 05 mock (257) and the 07 mock (267); the harness content region (x >= 232) would need no change.
- Composition (ProductApplicabilityPage.tsx): one 'Applicability rules' card (20px bold title, 13px description) holds a white rules box (Condition with 22px checkboxes inline, a divider, Mileage with 22px radios, a 173x44 input and 'miles', a divider, Model year range with 237 and 225px 44px selects), a Price treatment box (18px semibold title, 15px semibold radio labels with 13px details, a 195x44 price field with a dollar prefix beside the radios) and a circled-info note (36px icon, 14px semibold title, 12px body). The right column keeps Evidence checklist (64px rows with 32px outline icons, 14px semibold labels, 13px details and 30px pill chips) and Sample vehicle results (40px header, 52px rows, 22px marks with 13px text, columns 192/80/142/142 against the mock's 160/89/153/142 because our status text is wider). Child tabs are 44px tall with 14px labels and 14px padding; the footer buttons are 42px. Card heights: rules 667 against 668, evidence 359 against 358, samples 299 against 299.
- Fixture and tests: three sampled vehicles (one with proof, one without, one past the mileage limit), as the mock shows three rows; the Eligible column reads Yes or No under its header, as the mock does. The 07 fixture test's row count moved from 4 to 3 and its eligibility assertions to Yes/No; the write-after-review, audit and failed-proof-read tests are unchanged.
- Remaining difference: the mock titles the page at 36px bold with no description and a 'DESIGN CONCEPT' chip, while ChildPageFrame draws the 28/36 token title with the section description (the title block is the shell's); the CPO checkbox is checked and disabled here because the stored rule model derives CPO from Used, while the mock draws it unchecked; the fixture rule sets a mileage limit and a 2020 floor where the mock shows 'No limit' and 'Any year'; Review changes is disabled until the draft changes where the mock draws it enabled; Cancel measures 104px against 111; text renders wider than the mock at every size.
- Type scale against the tokens: card titles 20/26 bold (token card title 16/22; mock ink 19-20px), box title 18/24 semibold, field labels 14/20 semibold, controls 15px, chip text 13px (token meta 12), status text 13px (mock 14, reduced so the columns fit without overflow), vehicle names 14/20 semibold (mock 15), sub lines 12/18, tabs 14px (the shell's child tabs are 13px). Icons: badge dot 8px, checkboxes and radios 22px (mock 22-24), note icon 36px (its 30px circle matches the mock's), evidence icons 32px (mock ink 23-28), sample marks 22px (mock ink 14-18), chips 30px tall.

## Screen 08

Reference: `scripts/admin-parity/reference/08-customer-contact-routing.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 87.96% is below 97%). With the title-block exception: FAIL (body parity 91.76%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/08-1586x992.png` | 89.43% | 67.30% | 87.96% | 63.31% | 91.76% (+66px) | 72.01% | 0.00% |
| 1600x1000 | `scripts/admin-parity/out/08-1600x1000.png` | 88.56% | 67.09% | 87.10% | 63.41% | n/a | n/a | 0.00% |

Rail stand-in: 237px (the mock's rail width); content region starts at x=240.
Section row bottom: reference y=172, capture y=238 (title block offset +66px).
Diff image: `scripts/admin-parity/out/08-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/08-1586x992.png` and `scripts/admin-parity/evidence/08-1586x992-diff.png`.

Masks (0): none.

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=270 w=1291 h=38 | x=261 y=200 yBody=-38 w=1301 h=38 | x-9 w+10 h+0 |
| childTabs | within tolerance | x=270 yBody=13 w=1291 h=45 | x=261 y=254 yBody=16 w=1301 h=36 | x-9 w+10 h-9 yBody+3 |
| sectionTitle | within tolerance | x=270 yBody=71 h=32 | x=261 y=309 yBody=71 w=373 h=32 | x-9 h+0 yBody+0 |
| scope | within tolerance | x=1369 yBody=74 w=191 h=42 | x=1371 y=312 yBody=74 w=191 h=42 | x+2 w+0 h+0 yBody+0 |
| orderCard | within tolerance | x=269 yBody=147 w=623 h=584 | x=261 y=385 yBody=147 w=628 h=591 | x-8 w+5 h+7 yBody+0 |
| orderRow1 | within tolerance | x=282 yBody=201 w=598 h=68 | x=278 y=439 yBody=201 w=594 h=68 | x-4 w-4 h+0 yBody+0 |
| orderRow6 | within tolerance | x=282 yBody=578 w=598 h=68 | x=278 y=817 yBody=579 w=594 h=68 | x-4 w-4 h+0 yBody+1 |
| readinessCard | within tolerance | x=907 yBody=147 w=653 h=325 | x=904 y=385 yBody=147 w=658 h=327 | x-3 w+5 h+2 yBody+0 |
| readinessList | within tolerance | x=921 yBody=197 w=625 h=217 | x=921 y=435 yBody=197 w=624 h=217 | x+0 w-1 h+0 yBody+0 |
| escalationLink | within tolerance | x=921 yBody=421 w=230 h=36 | x=921 y=659 yBody=421 w=230 h=36 | x+0 w+0 h+0 yBody+0 |
| responseCard | within tolerance | x=907 yBody=487 w=653 h=244 | x=904 y=728 yBody=490 w=658 h=248 | x-3 w+5 h+4 yBody+3 |
| primaryAction | within tolerance | x=1409 y=925 w=149 h=36 | x=1413 y=940 yBody=702 w=149 h=36 | x+4 y+15 w+0 h+0 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1879 | none | `scripts/admin-parity/out/08-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1366 | nav[Administration sections] | `scripts/admin-parity/out/08-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1024 | nav[Administration sections] | `scripts/admin-parity/out/08-1024x768.png` |
| 390x844 | none | 390 | 390 | 390 | nav[Administration sections], nav[Customer Experience views] | `scripts/admin-parity/out/08-390x844.png` |

### Findings for screen 08

- Parity moved from content 88.00% / body 89.74% (+66px) / structure 64.60% to content 87.95% / body 91.76% / structure 63.29%, with 12 of 12 landmarks within tolerance (none were declared before). The view was re-set to the mock's rhythm as measured with edges.cjs and bbox.cjs: an h2 at 26/32 whose cap top sits at reference y 250, a 42px scope badge, cards at reference y 319 (left 269-891 and right 907-1559, a 623fr/653fr grid with a 15px gap) on the 16px card inset, order rows 68px tall at a 75.5px pitch (14px padding, a 34px number badge, a 232px owner column behind an inset divider carrying a chip or a 24px icon, a 20px chevron), the readiness rail as a bordered box of four 54px rows (7.5px padding, 24px icon, 146px chip column, 20px chevron) above a 230x36 Review escalation rules button, the Response card as three 51px timing rows (24px icon, 11px hint, the minutes as text, a 20px chevron) beside a 266px Notification methods column behind a left rule with 24px mail and bell icons, and the warning note at 36px.
- The readiness rail lists the four checks the mock pictures (Default contact, Sales rotation, Manager recipient, After-hours routing) with the mock's static descriptions and the state in the chip; the two escalation checks (BDC destination, escalation tier) are reported by the Response and escalation card's note, the card that owns those tiers (Add a valid fallback before enabling this route. Missing: ...). The timing rows show the configured minutes as text with a chevron to the Escalation child, where the selects live. The methods column shows Email and In-app, the two the mock draws; SMS and Push stay on the Escalation child's tiles.
- Hotspots left: the sticky Draft configuration bar is viewport-anchored, so under the +66px body alignment it covers the mock's warning note and card bottoms (the last 24px band alone holds about 4,800 differing pixels); the mock draws that bar 74px tall with a Proposed design caption under the button, the view draws a 68px bar that puts the button at y 940 against 925. Every other band is glyph rendering of matching text (Inter in Chromium against the mock's narrower face): order titles and descriptions, readiness descriptions, timing hints. The product rail, the mock's section-titled header and its DESIGN CONCEPT chip sit above the anchor and only touch the content number.
- Type: h2 26/32 bold (token section 18/26; the mock's cap height is 18-19px), owner detail and timing hints 11/16 (token meta 12/18; measured 10-11px), Notification methods heading 15/22 (measured cap 11px), card titles 16/22 and body 14/20 as the tokens. Icons: grip 20px, number badge 34px, row and rail glyphs 24px (the mock's users glyph measures 24x20, user 17x18, clock 21x22), chevrons 20px, the button's file icon 20px, mail and bell 24px, the scope building 24px, chip marks 16px (primitive) against the mock's 14px, the warning triangle 24px (primitive) against 18x16. The Smart routing and Escalation switches are the 44x24 primitive (mock 42x24 and 36x20).
- Responsive: no page overflow at 1920, 1366, 1024 or 390; the section row scrolls inside itself from 1366 down and the child tab row at 390. Masks: none; the fixture's count chip (2 salespeople) and its names match the mock, and the scope badge no longer prints the rooftop name.

## Screen 09

Reference: `scripts/admin-parity/reference/09-escalation-delivery-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 83.39% is below 97%). With the title-block exception: FAIL (body parity 91.55%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/09-1586x992.png` | 85.77% | 64.53% | 83.39% | 60.22% | 91.55% (-93px) | 72.36% | 1.96% |
| 1600x1000 | `scripts/admin-parity/out/09-1600x1000.png` | 85.40% | 65.76% | 83.15% | 61.71% | n/a | n/a | 1.94% |

Rail stand-in: 217px (the mock's rail width); content region starts at x=220.
Body anchor (pinned in landmarks.json): reference y=289, capture y=196 (title block offset -93px).
Diff image: `scripts/admin-parity/out/09-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/09-1586x992.png` and `scripts/admin-parity/evidence/09-1586x992-diff.png`.

Masks (8): request ids (fixture-generated activity text); rooftop names in the activity rows (the fixture's synthetic stores); notification timestamps; scope chips carry the fixture's synthetic rooftop names.

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| childTabs | within tolerance | x=244 w=1318 h=40 | x=241 y=160 yBody=-36 w=1321 h=36 | x-3 w+3 h-4 |
| rulesCard | within tolerance | x=244 yBody=20 w=660 h=677 | x=241 y=216 yBody=20 w=662 h=682 | x-3 w+2 h+5 yBody+0 |
| tier1 | within tolerance | x=262 yBody=75 w=627 h=117 | x=258 y=271 yBody=75 w=628 h=116 | x-4 w+1 h-1 yBody+0 |
| minutesSelect1 | within tolerance | x=318 yBody=124 w=264 h=33 | x=313 y=320 yBody=124 w=257 h=32 | x-5 w-7 h-1 yBody+0 |
| destination1 | within tolerance | x=660 yBody=124 w=230 h=33 | x=656 y=320 yBody=124 w=230 h=32 | x-4 w+0 h-1 yBody+0 |
| tiles | within tolerance | x=261 yBody=593 w=625 h=50 | x=258 y=792 yBody=596 w=628 h=50 | x-3 w+3 h+0 yBody+3 |
| reviewButton | within tolerance | x=263 yBody=653 w=285 h=34 | x=258 y=853 yBody=657 w=285 h=34 | x-5 w+0 h+0 yBody+4 |
| statesCard | within tolerance | x=917 yBody=20 w=645 h=403 | x=916 y=216 yBody=20 w=646 h=405 | x-1 w+1 h+2 yBody+0 |
| statesList | within tolerance | x=933 yBody=89 w=612 h=238 | x=933 y=285 yBody=89 w=612 h=237 | x+0 w+0 h-1 yBody+0 |
| retryNote | within tolerance | x=933 yBody=342 w=612 h=66 | x=933 y=538 yBody=342 w=612 h=66 | x+0 w+0 h+0 yBody+0 |
| activityCard | within tolerance | x=917 yBody=432 w=645 h=247 | x=916 y=630 yBody=434 w=646 h=254 | x-1 w+1 h+7 yBody+2 |
| activityTable | within tolerance | x=933 yBody=501 w=612 h=110 | x=934 y=701 yBody=505 w=610 h=112 | x+1 w-2 h+2 yBody+4 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1845 | none | `scripts/admin-parity/out/09-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | div | `scripts/admin-parity/out/09-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | none | `scripts/admin-parity/out/09-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | div | `scripts/admin-parity/out/09-390x844.png` |

### Findings for screen 09

- Parity moved from content 85.19% / structure 61.83% (no body score: the child page had no anchor) to content 83.37% / body 91.42% (-93px) / structure 60.15%, with the body pinned to the child tab row (the mock's Rules underline at y 287-288 by bluerows.cjs, row bottom 289; the capture's tablist bottom at 196) and 12 of 12 landmarks within tolerance. The content number falls because the mock stacks a section-titled header, the section row, a breadcrumb and a second h1 above the tabs (y 70-289) while the child frame draws one breadcrumb and one h1; the aligned body is the number that moved.
- Rules card re-set to the mock: 16px inset, an 18/26 title with the description in the header's right slot (230px wide, 12/18), tiers at a 116px pitch (34px numbered badge, 14/20 title, 12/18 hint, then a 264px minutes select, Send to and a 230px destination select, both 32px, with the destination's state on a 16px line beneath), a 1px rule, Scope as a 30px box with info chips for the rooftops, Notification methods as four 50px tiles with 5px gaps (a 22px filled circle for the chosen Email, 24px outline icons for the rest) and a 285x34 Review changes button with its helper. The Escalation switch moved to the page header's actions beside the back link, where the mock's header is empty; the mock draws no switch. The destination is a select of the tier's recipient (BDC desk, Sales manager, Target only on the first tier); when that recipient has no address the line beneath reads Destination required with an Add email disclosure that reveals the email field, so the layout matches the mock while the page can still complete itself.
- Right column: Delivery states as a bordered list of four 59px rows (36px circles: tinted with a 20px plane and a 24px truck for Attempted and Delivered, solid green and red with white marks for Accepted and Failed), the retry note at 66px, then the activity card 9px below with the table as an inset bordered box (30px header, 41px rows at 12/16, column lines, 22px solid result marks beside 14px labels, a two-line Date & time cell) and a 46px info note. The Result column is 28.4% against the mock's 22.2% (Request and Rooftop give up 20 and 18px) so Provider rejected stays on one line in Inter; the fixture keeps the two example rows the mock draws and the page test covers the legacy Attempted row with its own data.
- Hotspots left: glyph rendering of matching text in every row (tier hints, state details, table cells); the mock's Keep draft chip, which the view shows only once the draft differs from the saved rules; the mock's chip remove marks and the chevrons on its Scope select, which the view does not draw because rules apply to every rooftop; the mock's lighter red (#f4756c) on the missing destination select against the danger token. The disabled Review changes button is drawn as the mock's grey fill locally (disabled:bg-adm-border at full opacity) because the primitive fades the blue to 50%, which cost about 10,000 pixels in the previous run.
- Type: card titles 18/26 (token card title 16/22; measured cap 13px), the destination line 12/16 (mock 11px), tile labels 13/18 and 11/16, table cells 12/16 (token body 14/20; the mock's cells are 12px) with 14/20 result labels. Icons: tier badges 34px (measured 34 against the brief's 32), destination marks 24px filled triangles with white strokes (mock 19x14), state circles 36px with 20px and 24px glyphs, a 20px check at stroke 3 and a 22px bold mark, tile icons 24px outline and a 22px filled circle with a 12px glyph, result marks 22px, the retry note icon and the info icon 24px (primitives; the mock draws 25x23 and 20px), the back arrow 20px (shell).
- Responsive: no page overflow at any breakpoint; at 1366 and 390 the activity table scrolls inside its own box. Masks: request ids, rooftop names and timestamps in the activity rows, and the scope chips (the fixture's synthetic rooftops).

## Screen 10

Reference: `scripts/admin-parity/reference/10-publishing-policy.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; content parity 87.57% is below 97%). With the title-block exception: FAIL (body parity 89.59%, landmarks).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/10-1586x992.png` | 88.62% | 65.82% | 87.57% | 61.22% | 89.59% (-7px) | 67.95% | 0.55% |
| 1600x1000 | `scripts/admin-parity/out/10-1600x1000.png` | 87.01% | 65.92% | 85.80% | 60.95% | n/a | n/a | 0.54% |

Rail stand-in: 257px (the mock's rail width); content region starts at x=260.
Section row bottom: reference y=245, capture y=238 (title block offset -7px).
Diff image: `scripts/admin-parity/out/10-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/10-1586x992.png` and `scripts/admin-parity/evidence/10-1586x992-diff.png`.

Masks (2): rooftop name in the policy description (the fixture is synthetic); active and published listing counts.

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| sectionNav | within tolerance | x=287 y=207 w=1273 h=38 | x=281 y=200 yBody=-38 w=1281 h=38 | x-6 y-7 w+8 h+0 |
| childTabs | OUT of tolerance | x=308 yBody=105 w=1230 h=42 | x=281 y=254 yBody=16 w=1281 h=36 | x-27 w+51 h-6 yBody-89 |
| policyCard | OUT of tolerance | x=286 yBody=21 w=1274 h=681 | x=281 y=306 yBody=68 w=1281 h=633 | x-5 w+7 h-48 yBody+47 |
| draftStatus | OUT of tolerance | x=1397 yBody=39 w=142 h=46 | x=1392 y=321 yBody=83 w=153 h=48 | x-5 w+11 h+2 yBody+44 |
| policyTable | within tolerance | x=308 yBody=164 w=1230 h=178 | x=299 y=401 yBody=163 w=1245 h=179 | x-9 w+15 h+1 yBody-1 |
| detailSection | within tolerance | x=307 yBody=359 w=1232 h=261 | x=298 y=597 yBody=359 w=1247 h=258 | x-9 w+15 h-3 yBody+0 |
| classCard1 | within tolerance | x=328 yBody=418 w=279 h=185 | x=319 y=659 yBody=421 w=290 h=178 | x-9 w+11 h-7 yBody+3 |
| classCard3 | within tolerance | x=926 yBody=418 w=285 h=185 | x=927 y=659 yBody=421 w=290 h=178 | x+1 w+5 h-7 yBody+3 |
| effectiveRule | within tolerance | x=1232 yBody=418 w=285 | x=1239 y=659 yBody=421 w=285 h=178 | x+7 w+0 yBody+3 |
| recallNote | within tolerance | x=307 yBody=630 w=905 h=50 | x=298 y=866 yBody=628 w=900 h=50 | x-9 w-5 h+0 yBody-2 |
| primaryAction | within tolerance | x=1230 yBody=631 w=151 h=48 | x=1218 y=867 yBody=629 w=160 h=48 | x-12 w+9 h+0 yBody-2 |
| previewButton | within tolerance | x=1393 yBody=630 w=146 h=49 | x=1391 y=867 yBody=629 w=154 h=48 | x-2 w+8 h-1 yBody-1 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1865 | none | `scripts/admin-parity/out/10-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/10-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/10-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Publishing views], div | `scripts/admin-parity/out/10-390x844.png` |

### Findings for screen 10

- Parity moved from content 85.19% / body 83.75% (-7px) / structure 61.91% to content 87.56% / body 89.59% / structure 61.22%, with 9 of 12 landmarks within tolerance. The three that fail are one difference: the mock draws Effective policy / Approvals / Destinations / Change history inside the This rooftop card under its header (tabs at y 350-392, card top 266, draft box 284-329) while the fixed IA draws the child tab row above the card, so the card starts 47px lower in body terms, the draft box 44px lower and the tab row 89px higher and 27px further left. Everything from the matrix down lands on the mock: table at body 163 against 164, detail section 359, cards 421 against 418, the recall note 628 against 630 and the buttons 629 against 631.
- Card re-set to the mock: 16px inset, a 20/28 title with a 14/20 description, the draft box as a 48px amber tile (20px file icon, 13/18 and 11/16 text), the matrix as a bordered box with 14/20 dark headers on the workspace tint, 45px rows, 20px cell padding, column lines at the mock's 13.7 / 21 / 24.5 / 19.9 / 20.9% widths and a 3px bar on the selected row; the detail section with a 46px baseline-aligned header (20px class, 14px sub, the counts, a 24px chevron) and three 178px cards (52px circles with 28px glyphs, 14/22 titles with tight tracking, 12/20 summaries held to two lines, 12/20 explanation boxes) beside the rule column behind a left rule (14/20 title, 13/18 text, a 14px link with a 20px arrow); the recall note at 50px with a 28px filled triangle beside two 48px buttons, primary and outline.
- Hotspots left: the IA band where the card header and draft box sit against the mock's in-card tabs (y 290-400, about 15,000 differing pixels); the matrix copy, which the policy library words differently from the mock (Auto on intake + recall policy against Valid facts + recall policy, Manager approval against Manager review and Required documents + approval); the rule column's text, which the library writes longer than the mock's five lines (13/18 holds it to six); the view's enforcement paragraph under the card where the mock prints its caption; and glyph rendering of matching text elsewhere.
- Type: card title 20/28 (token card title 16/22; measured cap 15px), table headers 14/20 in ink (token 12/18 muted), detail title 20/26, card titles 14/22, summaries and boxes 12/20, rule text 13/18 (token body 14/20; the mock is 14px but its narrower face fits five lines where Inter needs seven), draft box 13/18 and 11/16, buttons 14/20 at 48px. Icons: draft file 20px, class card glyphs 28px in 52px circles (measured 27x18 eye, 20x23 file, 25x24 wrench), the Collapse chevron 24px (mock glyph 14x7), the recall triangle 28px filled with white strokes (mock 22x20), the approval rules arrow 20px (mock 13x9).
- The draft tile reads Draft proposal / Not yet applied as the mock does (it read Draft pending); the counts moved from the rule column into the detail header (Active 31 · Published 29, masked) so the column fits beside the cards. Responsive: no page overflow at any breakpoint; the section and child tab rows scroll inside themselves from 1366 down and the matrix at 390. Masks: the rooftop name in the description and the two counts.

## Screen 11

Reference: `scripts/admin-parity/reference/11-documents-service.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; content parity 91.17% is below 97%). With the title-block exception: FAIL (body parity 91.37%, landmarks).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/11-1586x992.png` | 91.43% | 74.21% | 91.17% | 71.92% | 91.37% (+4px) | 72.20% | 1.58% |
| 1600x1000 | `scripts/admin-parity/out/11-1600x1000.png` | 91.25% | 75.77% | 91.21% | 73.71% | n/a | n/a | 1.55% |

Rail stand-in: 264px (the mock's rail width); content region starts at x=267.
Section row bottom: reference y=234, capture y=238 (title block offset +4px).
Diff image: `scripts/admin-parity/out/11-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/11-1586x992.png` and `scripts/admin-parity/evidence/11-1586x992-diff.png`.

Masks (4): policy change provenance (relative time and fixture name); readiness detail values (relative times and counts).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| childTabs | OUT of tolerance | x=292 yBody=26 w=1268 h=54 | x=288 y=254 yBody=16 w=1274 h=36 | x-4 w+6 h-18 yBody-10 |
| editButton | OUT of tolerance | x=952 yBody=274 w=66 h=36 | x=952 y=532 yBody=294 w=68 h=36 | x+0 w+2 h+0 yBody+20 |
| previewButton | within tolerance | x=1090 yBody=624 w=221 h=48 | x=1095 y=863 yBody=625 w=217 h=48 | x+5 w-4 h+0 yBody+1 |
| primaryAction | within tolerance | x=1322 yBody=624 w=219 h=48 | x=1324 y=863 yBody=625 w=217 h=48 | x+2 w-2 h+0 yBody+1 |
| rulesCard | within tolerance | x=292 yBody=106 w=762 h=590 | x=288 y=344 yBody=106 w=769 h=590 | x-4 w+7 h+0 yBody+0 |
| rulesTable | OUT of tolerance | x=311 yBody=210 w=724 h=296 | x=309 y=447 yBody=209 w=727 h=317 | x-2 w+3 h+21 yBody-1 |
| sectionNav | within tolerance | x=292 y=196 w=1268 h=38 | x=288 y=200 yBody=-38 w=1274 h=38 | x-4 y+4 w+6 h+0 |
| selectedRuleCard | within tolerance | x=1070 yBody=106 w=489 h=590 | x=1073 y=344 yBody=106 w=489 h=590 | x+3 w+0 h+0 yBody+0 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1868 | none | `scripts/admin-parity/out/11-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/11-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/11-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Documents & Service views], div | `scripts/admin-parity/out/11-390x844.png` |

### Findings for screen 11

- Parity moved from content 87.25% / body 86.76% (+4px) / structure 65.81% to content 89.12% / body 89.64% / structure 70.49% (body structure 73.04%) after the view was re-set to the mock's rhythm: the body starts 106px under the section row (card tops at reference y 340, measured 344 against a 238 section-row bottom), the rules table is an inset box at x 311 with a 52px header and 60px rows (measured 297px tall against the mock's 296), the rail is a 489px column (measured 489, x 1073 against 1070) with its labels at 18/26, and the two 48px buttons land at y 858 (measured 863 with the +4 offset). 4 of 8 landmarks pass; the 3 that fail only on x and w (section row, rules card, rules table) read the mock's wider product rail: it draws the rail 264px wide with a 28px gutter (content x 292) while the fixture draws 224px with a 24px gutter (x 248), so every left-anchored box reads 44px left and every full-width box 45px wide. The content region (x >= 232) also contains 32 columns of the mock's dark rail that can never match, about 2.4% of the region.
- The child-tab row is the one landmark that fails on height: the mock draws Templates / Approval rules / Print & Calibration / Service policy inside a white card (x 292 to 1559, y 260 to 314, 54px tall, 15px text, a 144px underline at y 311 to 313) and AdminShell draws a bare 36px row with 13px text (measured y 254 to 290). The band y 262 to 334 holds about 7% of the remaining differing pixels. Owner: AdminShell.tsx (shared).
- The table body is the largest remaining hotspot (about a quarter of the differing pixels, y 504 to 748): documentPolicy.ts derives longer strings than the mock's sample copy (Manager before print, publish against Manager; New & Used against New; Price, MSRP, Sold or removed against Price or equipment), so every row wraps to two lines where the mock shows one. The row height still matches (60px) because the 36px outlined Edit button sets it.
- The fixture now depicts the mock's state: a change pending review (autoUnpublishStale on, seeded through useSettingsReview.initialDraft) with an enabled primary Review policy changes button, and canEdit true for the fixture viewer. The mock's chips carry no marks and its table no icons (bbox at threshold 500 finds text ink only); the readiness tile icons measure 18x18, 15x18 and 15x18 and render at w-5, the View change history document icon 15x18 at w-5, the Preview document eye 22x15 at w-6.
- Masks cover only the policy-change provenance line (relative time and fixture name) and the three readiness detail values (relative times and counts): 1.58% of the frame. Responsive: no page overflow at any breakpoint; the section row, the child-tab row and the inset table scroll inside their own containers at 390.

## Screen 12

Reference: `scripts/admin-parity/reference/12-integrations-feed-health.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; content parity 79.36% is below 97%). With the title-block exception: FAIL (body parity 92.49%, landmarks).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/12-1586x992.png` | 82.25% | 69.61% | 79.36% | 64.88% | 92.49% (+64px) | 75.81% | 2.40% |
| 1600x1000 | `scripts/admin-parity/out/12-1600x1000.png` | 82.23% | 69.77% | 79.59% | 65.54% | n/a | n/a | 2.38% |

Rail stand-in: 243px (the mock's rail width); content region starts at x=246.
Section row bottom: reference y=174, capture y=238 (title block offset +64px).
Diff image: `scripts/admin-parity/out/12-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/12-1586x992.png` and `scripts/admin-parity/evidence/12-1586x992-diff.png`.

Masks (8): run timestamps (tile values and attempt times); fixture provider domain; rooftop pin identifier; attempt count in the pager summary.

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| banner | within tolerance | x=274 yBody=124 w=1286 h=77 | x=267 y=362 yBody=124 w=1295 h=77 | x-7 w+9 h+0 yBody+0 |
| childTabs | OUT of tolerance | x=274 yBody=66 w=1286 h=40 | x=267 y=254 yBody=16 w=1295 h=36 | x-7 w+9 h-4 yBody-50 |
| coverageCard | within tolerance | x=274 yBody=662 w=631 h=115 | x=267 y=900 yBody=662 w=640 h=115 | x-7 w+9 h+0 yBody+0 |
| openRunButton | within tolerance | x=1395 yBody=141 w=146 h=43 | x=1390 y=375 yBody=137 w=153 h=43 | x-5 w+7 h+0 yBody-4 |
| recentCard | within tolerance | x=274 yBody=324 w=904 h=321 | x=267 y=561 yBody=323 w=914 h=323 | x-7 w+10 h+2 yBody-1 |
| recentTable | within tolerance | x=274 yBody=378 w=904 h=182 | x=268 y=614 yBody=376 w=912 h=184 | x-6 w+8 h+2 yBody-2 |
| refreshCard | within tolerance | x=920 yBody=662 w=640 h=115 | x=923 y=900 yBody=662 w=640 h=115 | x+3 w+0 h+0 yBody+0 |
| reviewSourceButton | within tolerance | x=1213 yBody=561 w=328 h=43 | x=1217 y=797 yBody=559 w=325 h=43 | x+4 w-3 h+0 yBody-2 |
| sectionNav | within tolerance | x=274 w=1286 h=38 | x=267 y=200 yBody=-38 w=1295 h=38 | x-7 w+9 h+0 |
| sourceCard | within tolerance | x=1195 yBody=324 w=365 h=321 | x=1197 y=561 yBody=323 w=365 h=321 | x+2 w+0 h+0 yBody-1 |
| tile1 | within tolerance | x=274 yBody=217 w=309 h=90 | x=267 y=455 yBody=217 w=312 h=90 | x-7 w+3 h+0 yBody+0 |
| tile4 | within tolerance | x=1251 yBody=217 w=309 h=90 | x=1250 y=455 yBody=217 w=312 h=90 | x-1 w+3 h+0 yBody+0 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1858 | none | `scripts/admin-parity/out/12-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | nav[Administration sections] | `scripts/admin-parity/out/12-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/12-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | nav[Administration sections], nav[Integrations views], div | `scripts/admin-parity/out/12-390x844.png` |

### Findings for screen 12

- Parity moved from content 88.00% / body 75.32% (+64px) / structure 64.43% to content 78.60% / body 91.41% / structure 64.03% (body structure 73.95%). The raw content number falls by design: the mock titles the page Administration, puts the section row at y 174 and an h2 Integrations & Data above the child tabs, while the handoff IA fixes the h1, description and section row (ours ends at 238) and the shell's tab order; the view now renders the h2 inside its body at y 306 to 348 and spaces the banner so everything from it down sits exactly 64px under the mock (banner, tiles, both cards of the main row, the review button and both bottom cards measure 0 to 2px from their reference rows). The mock draws no description under that h2, so none is rendered.
- 5 of 12 landmarks pass and 6 fail only on x and w: the mock's rail is 243px wide with a 31px gutter (content x 274 to 1560), the fixture's 224px with a 24px gutter (x 248 to 1561), so left-anchored boxes read 26px left and full-width boxes 27px wide. The child-tab row fails on yBody by 50px because the mock places it under the h2 (reference y 240 to 280) and the shell above it; both are IA decisions outside the view.
- Composition set from the reference: a two-line warning banner 77px tall with a 34px triangle (mock glyph 29x27) and an outlined 43px Open run details button at x 1395; four 90px tiles with 30px outline icons (mock glyphs 27x27 clock and check, 25x23 car, 23x26 database), a 14px label and a 22px bold text value and no hint line; a 904-wide Recent attempts card with an 18px title, 14px ink table headers (y 552 to 593), 46px rows whose outcome cell shows a filled 20px mark (mock 19 to 20px, drawn as a 26px box so the white stroke does not eat the fill) beside the label, and an 84px pager; a 365px Source card (globe 22px, host 16px, Rooftop pin label over a 20px bold pin, a 20px filled check, a note box, a 43px full-width disabled Review source button and its 12px reason); two equal bottom cards (Condition coverage as three divided 24px counts, Refresh status as three divided label/value columns). The Source card drops the Verified and Last good pull rows that the mock does not draw; the tile hints are dropped for the same reason.
- Remaining hotspots, from a body-aligned diff: the banner band (y 362 to 439) holds about 23% of the differing pixels because every glyph sits 26px right of ours and health.ts appends Last successful pull 2 days ago to the mock's shorter detail; the tiles about 12% and the table rows about 17% for the same 26px reason; the Source chip reads Previously validated (the identity state after a refusal) where the mock reads Verified, and its note wraps to two lines (feed.ts adds or errors). Masks cover timestamps, the fixture provider domain, the rooftop pin and the pager count: 2.42% of the frame.
- Responsive: no page overflow at any breakpoint after the Refresh status columns stack below the sm breakpoint and the banner action wraps under its text below sm; at 390 the section row, the child-tab row and the attempts table scroll inside their own containers.

## Screen 13

Reference: `scripts/admin-parity/reference/13-sync-run-detail-child.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; content parity 89.33% is below 97%). With the title-block exception: FAIL (body parity 90.23%, landmarks).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/13-1586x992.png` | 89.98% | 67.53% | 89.33% | 63.37% | 90.23% (-18px) | 68.31% | 6.50% |
| 1600x1000 | `scripts/admin-parity/out/13-1600x1000.png` | 89.00% | 68.23% | 88.36% | 64.22% | n/a | n/a | 7.18% |

Rail stand-in: 233px (the mock's rail width); content region starts at x=236.
Body anchor (pinned in landmarks.json): reference y=166, capture y=148 (title block offset -18px).
Diff image: `scripts/admin-parity/out/13-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/13-1586x992.png` and `scripts/admin-parity/evidence/13-1586x992-diff.png`.

Masks (9): run timestamp and run id under the title; event times and the last successful run time; fixture provider domain; technical evidence payload (run id, timestamps, domain).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| actionsCard | within tolerance | x=1008 yBody=619 w=549 h=137 | x=1006 y=776 yBody=628 w=556 h=139 | x-2 w+7 h+2 yBody+9 |
| backButton | within tolerance | x=1028 yBody=691 w=248 h=44 | x=1027 y=850 yBody=702 w=251 h=44 | x-1 w+3 h+0 yBody+11 |
| badge | OUT of tolerance | x=570 y=127 w=201 h=38 | x=581 y=109 yBody=-39 w=202 h=38 | x+11 y-18 w+1 h+0 |
| breadcrumb | within tolerance | x=266 y=86 h=18 | x=257 y=86 yBody=-62 w=526 h=18 | x-9 y+0 h+0 |
| diagnosis | OUT of tolerance | x=266 yBody=176 w=712 h=209 | x=257 y=323 yBody=175 w=733 h=213 | x-9 w+21 h+4 yBody-1 |
| evidenceCard | within tolerance | x=266 yBody=666 w=727 h=134 | x=257 y=827 yBody=679 w=733 h=136 | x-9 w+6 h+2 yBody+13 |
| impactCard | within tolerance | x=1008 yBody=405 w=549 h=195 | x=1006 y=556 yBody=408 w=556 h=200 | x-2 w+7 h+5 yBody+3 |
| nextStep | within tolerance | x=1001 yBody=176 w=556 h=213 | x=1006 y=323 yBody=175 w=556 h=213 | x+5 w+0 h+0 yBody-1 |
| primaryAction | within tolerance | x=1288 yBody=691 w=249 h=44 | x=1290 y=850 yBody=702 w=251 h=44 | x+2 w+2 h+0 yBody+11 |
| summaryStrip | within tolerance | x=266 yBody=42 w=1291 h=113 | x=257 y=190 yBody=42 w=1305 h=113 | x-9 w+14 h+0 yBody+0 |
| timelineCard | within tolerance | x=266 yBody=405 w=727 h=254 | x=257 y=556 yBody=408 w=733 h=263 | x-9 w+6 h+9 yBody+3 |
| timelineTable | within tolerance | x=266 yBody=446 w=727 h=203 | x=258 y=597 yBody=449 w=731 h=213 | x-8 w+4 h+10 yBody+3 |
| title | OUT of tolerance | x=266 y=126 h=40 | x=257 y=108 yBody=-40 w=312 h=40 | x-9 y-18 h+0 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1853 | none | `scripts/admin-parity/out/13-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | pre | `scripts/admin-parity/out/13-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | none | `scripts/admin-parity/out/13-1024x768.png` |
| 390x844 | none | 390 | 390 | 374 | div, pre | `scripts/admin-parity/out/13-390x844.png` |

### Findings for screen 13

- The child screen has no section row, so the body anchor is pinned to the h1 (reference 166, the mock's h1 line bottom; the capture's h1 bottom is 148, offset -18px). Parity moved from content 88.36% / structure 61.97% (no body score) to content 88.93% / body 90.18% / structure 61.80% (body structure 67.81%). 5 of 13 landmarks pass; 6 fail only on x and w (the mock's rail is 233px wide with a 33px gutter, content x 266 to 1556, against the fixture's 248 to 1561) and the title and badge fail on y by 18px because ChildPageFrame sets the h1 4px under the breadcrumb while the mock leaves 22px (breadcrumb line bottom 104, h1 cap top 132 at a 34px face; ours 108 and 119). The body score is unaffected by that shell gap; the raw content score pays for it on every row.
- Composition set from the reference: a 34/40 title (passed through the frame's title prop), a 38px outlined Provider rate limited chip with a 22px triangle (mock mark 19x18), no header back link (the mock has none; Back to feed lives in Actions), one four-cell summary strip 113px tall with 14px semibold labels, 28px values and 14px hints (y 208, measured 190 against the -18 anchor), a tinted diagnosis panel (34px triangle against the mock's 30x28, 22px title, 16/24 detail) stretched to the 213px Next step panel (32px wrench, 16px blue eyebrow, 18px title, 14/20 detail, a divider and two divided facts at 1.18fr/1fr), a 556px right column, an Event timeline card with a 22px document icon, 13px muted headers, time-only cells and 26px filled marks (mock 19 to 20px) in rows of 34/44/48/44 (mock 33/44/53/45, table 203px in both), an open Technical evidence card holding the four headline fields with the full redacted payload in a disclosure under it, an Impact card with three divided centred 32px counts (mock digits about 24px tall) and an Actions card with two 44px buttons (outlined Back to feed with a 22px arrow, primary Review retry options).
- Remaining hotspots, from a body-aligned diff: the diagnosis and Next step text (y 364 to 435, about 20%) where runs.ts phrases the detail differently from the mock so both lines wrap elsewhere, and the timeline rows (y 628 to 772, about 26%) where every left-column glyph sits 18px right of ours, the event details name the fixture domain and the second-row heights differ by up to 5px; the impact digits render 32px against the mock's roughly 33px. Masks cover the subtitle (run timestamp and id), the event times, the last successful run time, the summary strip's provider domain and the evidence block: 6.88% of the frame.
- Responsive: no page overflow at any breakpoint; the evidence pre scrolls inside itself at 1366 and 390, and the summary strip falls to two columns below xl.

## Findings across screens

- Only screen 01 has a registered fixture on this branch. The other twelve references are in place under scripts/admin-parity/reference and are measured as soon as a stream registers its fixture id in src/pages/admin/fixtures/index.ts; each new screen also needs its dynamic masks in masks.json and its hand-measured landmarks in landmarks.json.
- The full-frame score includes the product rail and product header. The fixture page draws them as a 224px navy block and a 64px white band; the references draw the product navigation inside them. That area belongs to the global AppShell, which this refresh does not restyle, so the content-region score is the one held to 97% and the shell difference is recorded as an owner exception rather than fixed.
- The reference originals are the owner-supplied handoff mocks (footer: Proposed design, Illustrative data, No changes applied). Their product header carries the mock's dealer-group name and a placeholder employee address at that domain; both sit in the shell area outside the content region. Masked copies can replace them without changing the harness, because masks and landmarks are read from the rendered DOM, not from the images.
- The harness never touches production data: the fixture route exists only in development builds, every fixture is synthetic, and the dev server is started on a local port for the run.

## Reading the numbers

- The 97% target in the parity protocol applies after approved dynamic masks. The content-region reference-frame parity is the number to hold to it; the full-frame number will stay lower while the product rail and header differ from the mock, which is a shell decision outside this refresh and is called out as an exception for the owner.
- A high structural score with a lower pixel parity means the composition matches and the remaining difference is typography rendering or sub-pixel offsets; a low structural score means a layout difference and needs a look at the diff image.
- A landmark out of tolerance is a hard-gate failure regardless of the computed score. A screen's gate passes only when every landmark is within tolerance, no breakpoint has page overflow, and content-region parity at the reference frame is at least 97%.
- Responsive: page overflow (document wider than the viewport) fails the breakpoint. A region that scrolls by design, such as the section row or a wide table inside its own scroll container, is listed under Scroll regions and does not fail it.

## Reproduce

```
bun run admin:parity
bun run admin:parity -- --screens 01
node --test scripts/admin-parity/harness.test.cjs
bunx vitest run src/pages/admin/fixtures
```
