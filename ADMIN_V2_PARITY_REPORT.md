# Administration V2 visual parity report

Generated 2026-10-28T05:49:25.111Z by `bun run admin:parity` against the development fixture route. Every screen is a synthetic fixture rendered by the real Administration components; no production data appears in any capture.

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
