# Administration V2 visual parity report

Generated 2026-10-28T03:41:30.459Z by `bun run admin:parity` against the development fixture route. Every screen is a synthetic fixture rendered by the real Administration components; no production data appears in any capture.

## Method

- Reference frame: 1586x992, the native size of `screens/original`. The fixture is rendered at exactly that viewport and compared pixel for pixel, no resampling of the reference.
- Protocol frame: 1600x1000. The reference is resampled (bilinear) to that frame, which softens one-pixel lines, so the reference-frame row is the primary number.
- Pixel parity: a pixel differs when any channel moves by more than 32 of 255 after masks. Parity is 100 minus the differing share of compared pixels. No anti-aliasing allowance is applied.
- Structure: mean SSIM over 8x8 luminance blocks after masks.
- Masks: only dynamic data (counts, relative times, fixture names) listed in `scripts/admin-parity/masks.json`, read from the rendered DOM so the same boxes mask both images. Navigation, tabs, headings, card bounds, tables, buttons and chips are never masked.
- Content region: x >= 232 and y >= 70, which excludes the product rail and product header. Those belong to the global application shell (`AppShell`), which this refresh does not restyle; the full-frame score includes them for completeness.
- Landmarks: hand-measured boxes from the reference (`scripts/admin-parity/landmarks.json`, tolerance 16px) compared with the rendered DOM boxes.
- Responsive: 1920x1080, 1366x768, 1024x768 and 390x844 captured; a breakpoint passes when the document has no horizontal overflow and no element extends past the viewport.

Registered fixtures: 01.

## Screen 01

Reference: `scripts/admin-parity/reference/01-admin-overview.png`. Fonts: Inter loaded (Inter). Gate: FAIL (landmarks out of tolerance; page overflow at a breakpoint; content parity 88.64% is below 97%).

| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Masked |
|---|---|---|---|---|---|---|
| 1586x992 | `scripts/admin-parity/out/01-1586x992.png` | 89.23% | 66.71% | 88.64% | 63.34% | 2.31% |
| 1600x1000 | `scripts/admin-parity/out/01-1600x1000.png` | 88.50% | 67.40% | 88.01% | 64.08% | 2.40% |

Diff image: `scripts/admin-parity/out/01-1586x992-diff.png` (red differs, blue masked).
Committed copies of that capture and diff: `scripts/admin-parity/evidence/01-1586x992.png` and `scripts/admin-parity/evidence/01-1586x992-diff.png`.

Masks (12): summary tile counts; recent activity relative times; recent activity detail lines (fixture names).

| Landmark | Result | Expected | Measured | Delta |
|---|---|---|---|---|
| breadcrumb | within tolerance | x=249 y=86 | x=248 y=88 w=1314 h=18 | x-1 y+2 |
| title | within tolerance | x=249 y=116 h=40 | x=248 y=110 w=1314 h=36 | x-1 y-6 h-4 |
| sectionNav | within tolerance | x=249 y=200 w=1317 h=38 | x=248 y=184 w=1314 h=40 | x-1 y-16 w-3 h+2 |
| banner | within tolerance | x=249 y=254 w=1317 h=58 | x=248 y=244 w=1314 h=58 | x-1 y-10 w-3 h+0 |
| tile1 | within tolerance | x=249 y=326 w=313 h=79 | x=248 y=318 w=317 h=86 | x-1 y-8 w+4 h+7 |
| tile4 | within tolerance | x=1235 y=326 w=331 h=79 | x=1246 y=318 w=317 h=86 | x+11 y-8 w-14 h+7 |
| attentionCard | OUT of tolerance | x=249 y=420 w=889 | x=248 y=420 w=865 h=355 | x-1 y+0 w-24 |
| policyCard | OUT of tolerance | x=1152 y=420 w=414 | x=1129 y=420 w=433 h=415 | x-23 y+0 w+19 |
| settingsCard | OUT of tolerance | x=249 y=748 w=603 | x=248 y=851 w=974 h=220 | x-1 y+103 w+371 |
| activityCard | OUT of tolerance | x=862 y=748 w=276 | x=1238 y=851 w=325 h=301 | x+376 y+103 w+49 |

| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |
|---|---|---|---|---|---|---|
| 1920x1080 | none | 1920 | 1920 | 1848 | none | `scripts/admin-parity/out/01-1920x1080.png` |
| 1366x768 | none | 1366 | 1366 | 1342 | none | `scripts/admin-parity/out/01-1366x768.png` |
| 1024x768 | none | 1024 | 1024 | 1000 | nav[Administration sections] | `scripts/admin-parity/out/01-1024x768.png` |
| 390x844 | OVERFLOW | 442 | 390 | 416 | nav[Administration sections], div | `scripts/admin-parity/out/01-390x844.png` |

### Findings for screen 01

- Composition is the gate failure. The reference lays the body out as two columns: a left column (x 249 to 1138) holding What needs attention (y 420 to about 722) above Administration settings (x 249, width 603) and Recent activity (x 862, width 276) side by side at y 748, and a right column holding Effective policy (x 1152, width 414) from y 420 to the bottom of that row at about 955. OverviewView.tsx renders two stacked full-width grids instead: attention beside policy, then settings beside activity. That puts the second row at y 851 against 748 (delta +103), stretches Administration settings to 974px against 603, and moves Recent activity to x 1238 against 862. Owner: OverviewView.tsx (keystone, parent stream).
- Measured fix, not applied on this branch because the files are outside this stream's ownership: scripts/admin-parity/proposals/01-overview-composition.patch rebuilds the body as that two-column composition (outer grid 2.15fr to 1fr with a 14px gap, inner grid 2.18fr to 1fr with a 10px gap). With it applied every card landmark lands within 3px on x and width: attention x 248 w 887, policy x 1149 w 413, settings x 248 w 601, activity x 859 w 276. The remaining deltas are vertical: the cards start at y 440 against 420 (+20, from the header block) and the second row at y 811 against 748 (+63). The +63 is the attention card's height, 355px rendered against about 302px in the reference, whose four rows are about 53px tall under a 40px header row with no padding below the table.
- Header block (AdminShell.tsx, parent stream): the keystone places the section row at y 184 against 200 (delta -16, at the tolerance edge) and renders the title at a 36px line height against 40px. The same patch sets the h1 to margin-top 16px and line height 40px, the description to margin-top 6px and the section gap to 36px, which measured the title at y 122 (+6) and the section row at y 204 (+4) at the reference height. The banner and tiles then sit 10 to 12px low instead of 8 to 10px high; the tile row is 79px tall in the reference against 86px rendered.
- Stat tiles: the four tiles render at equal 317px widths; the reference measures 313px for the first three and 331px for the last, so tile 4 starts at x 1246 against 1235 (+11). Within tolerance.
- Pixel parity stayed at 88.66% with the composition patch applied (88.64% without) because the remaining difference is inside the cards, where the diff image is red: row heights and the status chip column in What needs attention, the row rhythm of Effective policy (about 88px per row in the reference), the 3 by 2 shortcut grid of Administration settings (tiles about 186 by 70px), Recent activity row spacing, and glyph-level rendering of Inter by Chromium against the reference renderer, which keeps even matching text from scoring as identical pixels. Structure (63.34%) will move before pixel parity does; re-measure after each internal fix.
- Responsive: 390x844 fails on page overflow (scrollWidth 442 against 390, widest fixed element at 416) because the fixture page draws its 224px rail stand-in at every width, while the product AppShell hides its rail below the lg breakpoint. With the stand-in hidden below lg (the one-line AdminDesignFixture.tsx hunk in the same patch) the keystone view and shell have no page overflow at 390: scrollWidth 390, widest fixed element 374, with the section row and the attention table scrolling inside their own containers by design. 1024x768 passes; its only scroll region is the section row. 1920x1080 and 1366x768 pass with no scroll regions. Every breakpoint renders exactly one h1.

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
