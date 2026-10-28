# Administration V2 visual parity report

Generated 2026-10-28T08:40:52.778Z by `bun run admin:parity` against the development fixture route. Every screen is a synthetic fixture rendered by the real Administration components; no production data appears in any capture.

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

## Screen 02

Reference: `scripts/admin-parity/reference/02-dealership-brand.png`. Fonts: Inter loaded (Inter). Gate: FAIL (content parity 87.33% is below 97%). With the title-block exception: FAIL (body parity 92.63%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Masked |
|---|---|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/02-1586x992.png` | 88.30% | 68.24% | 87.33% | 64.02% | 92.63% (+33px) | 75.22% | 0.76% |
| 1600x1000 | `scripts/admin-parity/out/02-1600x1000.png` | 88.21% | 68.98% | 87.50% | 64.96% | n/a | n/a | 0.75% |

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
