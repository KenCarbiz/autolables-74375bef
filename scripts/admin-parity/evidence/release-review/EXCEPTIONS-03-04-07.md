# Exception lists: 03, 04, 07 (refreshed)

Numbers match `annotated/03-*.png`, `04-*.png` and `07-*.png`. The full
descriptions are in `focused-review-03-04-07/NN/DIFFERENCES.txt`; this list
is the concise version with one correction. All three were accepted by the
owner on 2026-10-29 with these exceptions, to be refined after release.

**What changed since the 2d7954d package**
- The desktop and phone captures of 03, 04 and 07 are byte-identical to the
  current working tree, and so are 03's and 04's state captures, so their
  boxes still apply.
- 07's state captures moved by about 34px after b211121 made the 07 fixture
  unable to write. `annotated/07-validation.png` is re-annotated from the
  current capture and adds item 22.
- **Correction: the "rendering difference" labels.** The earlier lists put
  03 #9, 04 #7 and 07 #9 under font rasterization. The cause maps
  (`causes/NN.png`, `itemcheck.cjs`) measured what is inside those boxes:

  | Item | Font share (raster + type size) | What it is |
  |---|---|---|
  | 03 #9 | 23% | Mostly text position (54%), the rest geometry and icons |
  | 04 #7 | 0% | Text position (94%): enforcement descriptions wrap at different points |
  | 07 #9 | 0% | Native control drawing (select chevrons, disabled checkbox) |

  They are now labelled as geometry. Glyph rasterization measures 0.00
  points on 03 and 04 and 0.03 on 07.

## Screen 03 Team · masked reference-match score 90.70% (3.71% of the frame masked)

1. *approved*: one "Administration" title; the mock titles the page "People & Access".
2. *approved*: child tabs outside the card.
3. *geometry*: section tab row dimensions (14px labels in a 38px row).
4. *geometry*: page margin (card at x 262 against the mock's 256).
5. *wording*: members identified by address, which wraps to two or three lines.
6. *behaviour*: no column sorted by default; neutral sort marks.
7. *wording*: role labels come from the role catalogue.
8. *asset*: standard icon set.
9. *geometry* (was "rendering"): text position and type size in the rail; 23% font, measured.
10. *masked*: fixture member addresses.
11. *mockonly*: DESIGN CONCEPT chip and footer caption, masked.
12. *geometry*: table column widths from 1536px.
13. *corrected*: D1 role label overflow (2d7954d).
14–16. *responsive*: toolbar stacks; table scrolls in a labelled region; rail below the table.
17–19. *behaviour / simulated*: review dialog with before and after; names the server writer; Apply disabled in the fixture.
D6, D7 *corrected*: phone review step fits; focus returns to the trigger. Rechecked in this round: focus returned in all four 03 closes.

## Screen 04 Member role · masked reference-match score 89.87% (0.95% of the frame masked)

1. *approved*: the parent section row above the breadcrumb and child title.
2. *behaviour*: linked breadcrumb.
3. *wording*: "Applied to <member address> on this…".
4. *wording*: "for it to be enforced".
5. *behaviour*: "Where each status comes from" disclosure.
6. *asset*: standard icon set.
7. *geometry* (was "rendering"): enforcement descriptions wrap at different points; 0% font, measured.
8. *geometry*: page margin.
9. *geometry*: title block sizes.
10. *masked*: the member address.
11. *mockonly*: footer caption, masked.
14–16. *responsive*: Back to Roles under the title on phones; one card per capability below 768px; cards stack on laptops.
D2, D7 *corrected*: the matrix shows Manage at 1280–1535px; focus returns. Rechecked in this round: focus returned.

## Screen 07 Product applicability · masked reference-match score 87.86% (3.13% of the frame masked)

1. *approved*: the parent section row above the breadcrumb and child title.
2. *behaviour*: Back to applicability and a linked breadcrumb.
3. *behaviour*: Review changes disabled until a valid change exists.
5. *fixture*: "Example Protection Package" and other scored fixture text.
6. *masked*: sample vehicle names, mileage and the product price.
7. *wording*: price-treatment and evidence wording.
8. *asset*: standard icon set.
9. *geometry* (was "rendering"): native select chevrons and the native disabled checkbox; 0% font, measured.
10. *geometry*: Product views tab row.
11. *geometry*: page margin.
12. *mockonly*: DESIGN CONCEPT chip and footer caption, masked.
14–17. *responsive*: the title wraps; tabs scroll; mileage choices stack; sample results scroll in a labelled region.
18. *rule*: a reversed model year range is refused with a message, and Review stays disabled.
19. *rule*: CPO eligibility rule, a business decision outside visual acceptance.
20. *finding*: the sample-results description wording.
21. *simulated*: sample results are computed in the browser; nothing is written.
22. *simulated* (new): "Preview only — changes are not saved."
D3–D5 *corrected* (2d7954d).
