# Writes the annotation specs (specs/*.json) and the per-screen exception
# lists (EXCEPTIONS.md) for the release review package from one table, so the
# numbers on each image and in the list always agree.
import json, os
R = "scripts/admin-parity/evidence/release-review"
REV = "working tree on 6aeecfb (see RELEASE_PLAN.md for the commit)"
SCORES = {"02": "88.01% (1.34% masked)", "03": "90.70% (3.71% masked)", "04": "89.87% (0.95% masked)", "05": "89.87% (6.19% masked)", "07": "87.86% (3.13% masked)", "09": "86.53% (2.60% masked)", "10": "89.53% (0.92% masked)", "11": "89.84% (2.10% masked)", "13": "87.77% (3.58% masked)"}
OUT = "scripts/admin-parity/out"
OLD = "scripts/admin-parity/evidence/focused-review-03-04-07"
ST = f"{R}/states-six"
ST3 = f"{R}/states-030407"
PH = f"{R}/phone"

# (screen, view, image, [(n, kind, x, y, w, h, text)])
S = {}
S[("02", "desktop", f"{OUT}/02-1586x992.png")] = [
 (1, "approved", 268, 86, 222, 40, "28px \"Administration\" title in place of the mock's \"Dealership & Brand\" title (owner, title block, readiness 10.6 item 1)."),
 (2, "approved", 268, 130, 1300, 40, "Section row directly under the title (10.6 item 1; 10.7)."),
 (3, "geometry", 268, 186, 430, 40, "Child tab row: size and position differ from the mock's row."),
 (4, "geometry", 1388, 228, 178, 24, "\"Branding for this rooftop.\" sits under the tabs, right-aligned (the mock puts it in the title row, which the approved title block replaced)."),
 (5, "geometry", 276, 252, 742, 394, "Cards start about 38px higher than the mock's because the approved title block is shorter; every row below moves with them."),
 (6, "behaviour", 790, 520, 203, 40, "Upload new logo is disabled in this view (no upload path here); the format hint stays."),
 (7, "behaviour", 752, 780, 242, 62, "Workspace accent shows the saved accent read-only with an Edit link to Appearance (the mock draws a select)."),
 (8, "behaviour", 1188, 786, 160, 26, "Website shows the host; the full address is in the link title."),
 (9, "fixture", 303, 372, 442, 40, "Synthetic names (Example INFINITI, Example City) in place of the mock's dealership: scored, not masked."),
 (10, "geometry", 252, 866, 1334, 62, "Draft bar spans the page under the cards and stays at the bottom while scrolling (the mock draws a footer row)."),
 (11, "asset", 714, 433, 22, 22, "Standard icon set (lock, info) in place of the mock's icons."),
]
S[("02", "phone", f"{PH}/02-390x844-00.png")] = [
 (1, "responsive", 0, 128, 390, 92, "Section and child tab rows scroll sideways with a fade; the active tab is in view."),
 (2, "responsive", 200, 228, 190, 24, "\"Branding for this rooftop.\" right-aligned under the tabs."),
 (3, "responsive", 16, 360, 358, 380, "One column: each label above its field."),
 (4, "responsive", 0, 735, 390, 109, "Draft bar fixed at the bottom with a full-width Review changes button."),
]
S[("02", "child-review", f"{ST}/02-1586x992-name-review-panel.png")] = [
 (1, "corrected", 252, 780, 1334, 150, "Corrected in this round: in the design fixture an edit now opens the review list (before it, Review changes stayed disabled with no reason)."),
 (2, "simulated", 1397, 940, 163, 44, "Apply changes is disabled in the fixture and the panel says why (\"Design fixture: saving is disabled.\"). Live mode is unchanged and tested."),
 (3, "behaviour", 1053, 455, 480, 40, "The preview explains that documents print the saved name, so an unsaved edit is not shown as printed."),
]
S[("05", "desktop", f"{OUT}/05-1586x992.png")] = [
 (1, "approved", 244, 86, 222, 40, "28px \"Administration\" title block (10.6 item 1)."),
 (2, "approved", 244, 128, 1320, 42, "Section row under the title (10.6 item 1; 10.7)."),
 (3, "geometry", 244, 186, 440, 38, "Child tab row and page margin differ from the mock."),
 (4, "behaviour", 1283, 436, 256, 140, "\"Conveyance Fee\": Connecticut's name for the document fee, with an explanation under the total."),
 (5, "asset", 986, 367, 268, 151, "Drawn vehicle placeholder where the mock shows a photo (no listing photo in the fixture)."),
 (6, "masked", 1283, 333, 260, 40, "Preview vehicle name, stock and prices: fixture data, masked."),
 (7, "behaviour", 1316, 682, 230, 26, "\"3 mismatches\" chip and a Price audit link (the mock has \"How this works\")."),
 (8, "behaviour", 1340, 780, 210, 140, "All three rows read Mismatch with Review links, from the fixture's prices (the mock shows Consistent, Mismatch and Not checked)."),
 (9, "behaviour", 270, 938, 1280, 36, "Footnote explaining what each column is compared on."),
 (10, "geometry", 362, 536, 252, 34, "Scope is a native select (the mock draws a custom select)."),
 (11, "finding", 1283, 400, 256, 100, "Open finding (Policy B, not changed): for the same vehicle the preview reads Selling price $38,630 + $895 = $39,525 while the table and the phone breakdown read $39,525 before fee + $895 = $40,420."),
]
S[("05", "phone", f"{PH}/05-390x844-00.png")] = [
 (1, "corrected", 16, 330, 358, 120, "Corrected in this round: the policy list's label column is narrower on phones, so \"Advertised total includes document fee\" wraps to two lines instead of four."),
 (2, "corrected", 16, 610, 358, 56, "Corrected in this round: Scope sits under its label at full width; the value \"Active inventory (default)\" was clipped before."),
 (3, "responsive", 0, 128, 390, 92, "Tab rows scroll sideways with a fade."),
]
S[("05", "child-edit", f"{ST}/05-1586x992-edit-open.png")] = [
 (1, "behaviour", 273, 322, 668, 155, "Edit opens the fee settings in place: the charge switch, jurisdiction and fee, with Connecticut's term shown under the fee."),
 (2, "behaviour", 869, 256, 74, 30, "Edit becomes Discard while editing."),
 (3, "behaviour", 795, 646, 146, 56, "Review changes stays disabled until a value changes (\"No pending changes\"). The fee review dialog it opens is screen 06, accepted and unchanged."),
]
S[("09", "desktop", f"{OUT}/09-1586x992.png")] = [
 (1, "approved", 233, 88, 1135, 36, "Section row above the child page's title (child pages, 10.7)."),
 (2, "behaviour", 1226, 138, 340, 32, "Escalation switch on this page beside Back (accepted for 08 as \"Escalation switch on its own page\", 10.18)."),
 (3, "geometry", 233, 138, 430, 75, "Breadcrumb and title position and size differ from the mock."),
 (4, "behaviour", 659, 385, 230, 55, "First response sends to \"Target only\" and says no one is notified at that step (the mock shows BDC desk with an error)."),
 (5, "behaviour", 803, 537, 62, 18, "\"Add email\" links beside each missing destination."),
 (6, "behaviour", 258, 738, 232, 62, "Scope is shown read-only (\"All rooftops (2)\" with the rooftops listed): rules are stored once per account."),
 (7, "wording", 413, 855, 472, 50, "SMS, In-app and Push read \"Not supported\" (the mock says \"Coming soon\")."),
 (8, "wording", 1003, 480, 520, 40, "Delivered is described as never claimed, because the current sender does not report delivery."),
 (9, "behaviour", 258, 914, 600, 36, "Review changes is disabled until the required destinations are set, and says so."),
 (10, "fixture", 933, 792, 610, 80, "Synthetic delivery activity rows."),
 (11, "asset", 948, 365, 40, 215, "Standard icon set for the delivery states; marks sized from the mock (22px marks, 14px glyphs, measured)."),
]
S[("09", "phone", f"{PH}/09-390x844-00.png")] = [
 (1, "responsive", 0, 85, 390, 36, "Section row scrolls sideways."),
 (2, "responsive", 16, 138, 358, 44, "Breadcrumb wraps to two lines."),
 (3, "responsive", 230, 340, 135, 34, "The Escalation switch moves into the card header."),
 (4, "responsive", 30, 450, 330, 390, "Steps stack: each time and destination full width."),
]
S[("09", "child-review", f"{ST}/09-1586x992-target-review-dialog.png")] = [
 (1, "behaviour", 368, 303, 850, 197, "Review lists each setting before and after in words."),
 (2, "behaviour", 368, 521, 850, 66, "Warns about gaps that remain after the change."),
 (3, "behaviour", 368, 610, 850, 100, "Names what the change affects (passport contact, lead alerts, unanswered-lead escalation)."),
 (4, "simulated", 1087, 743, 131, 36, "In the design fixture Apply only reports \"Design fixture: nothing was written.\""),
]
S[("10", "desktop", f"{OUT}/10-1586x992.png")] = [
 (1, "approved", 273, 118, 215, 40, "28px \"Administration\" title block (10.6 item 1)."),
 (2, "approved", 273, 258, 480, 36, "Child tabs under the section row, outside the card (owner decision; landmark difference recorded)."),
 (3, "geometry", 273, 84, 330, 100, "Breadcrumb and subtitle position and wording differ from the mock."),
 (4, "behaviour", 485, 450, 560, 130, "Cells show the stored policy (\"Auto on intake + recall policy\", \"Manager approval\") rather than the mock's sample text."),
 (5, "behaviour", 605, 612, 150, 22, "Counts beside the class (\"Active 31 · Published 29\")."),
 (6, "wording", 330, 700, 880, 140, "Card explanations follow the stored policy."),
 (7, "corrected", 1250, 690, 280, 115, "Corrected in this round: the rule sentence read \"must complete a completed K-208 inspection, verified installs\"; it now reads \"needs a completed K-208 inspection and verified installs\"."),
 (8, "behaviour", 273, 960, 1290, 32, "Footnote naming who enforces each column."),
 (9, "fixture", 502, 355, 272, 20, "Synthetic rooftop name."),
 (10, "asset", 338, 672, 52, 52, "Standard icon set."),
]
S[("10", "phone", f"{PH}/10-390x844-00.png")] = [
 (1, "responsive", 0, 200, 390, 92, "Section and child tab rows scroll sideways with a fade."),
 (2, "responsive", 37, 405, 153, 48, "Draft proposal badge moves under the description."),
 (3, "responsive", 37, 484, 316, 260, "The policy table scrolls sideways with a fade; Vehicle type stays in view."),
]
S[("10", "child-review", f"{ST}/10-1586x992-policy-review-dialog.png")] = [
 (1, "behaviour", 368, 284, 850, 360, "Review has Edit, Review and Apply steps; the switches are shown as the policy stands."),
 (2, "simulated", 368, 757, 230, 20, "\"Fixture preview: apply is not available.\""),
 (3, "corrected", 1206, 203, 24, 24, "Corrected in this round: closing this dialog (Escape, Cancel or the close button) returns focus to the button that opened it; it fell to the page body before."),
]
S[("11", "desktop", f"{OUT}/11-1586x992.png")] = [
 (1, "approved", 280, 118, 215, 40, "28px \"Administration\" title block (10.6 item 1)."),
 (2, "geometry", 280, 220, 500, 40, "Child tabs without the mock's white tab strip."),
 (3, "geometry", 280, 262, 1282, 46, "Empty band between the tabs and the cards."),
 (4, "behaviour", 590, 470, 350, 240, "Approval and refresh cells name every condition, so rows wrap to two lines."),
 (5, "behaviour", 1088, 400, 455, 90, "\"Policy in effect\" with who changed it and when (the mock shows \"Published copy\")."),
 (6, "behaviour", 1088, 525, 455, 100, "The pending change is stated (\"Auto-unpublish stale public documents: Off to On\")."),
 (7, "behaviour", 1088, 700, 455, 120, "Readiness explains each status."),
 (8, "geometry", 290, 712, 765, 190, "The rules card runs down to the right card's height, leaving space under the table."),
 (9, "asset", 1093, 470, 18, 20, "Standard icon set."),
]
S[("11", "phone", f"{PH}/11-390x844-00.png")] = [
 (1, "responsive", 0, 160, 390, 95, "Section and child tab rows scroll sideways with a fade."),
 (2, "responsive", 40, 453, 313, 312, "The rules table scrolls sideways with a fade."),
 (3, "geometry", 16, 255, 358, 52, "Space between the tabs and the card."),
]
S[("11", "child-review", f"{ST}/11-1586x992-policy-review-dialog.png")] = [
 (1, "behaviour", 458, 233, 670, 200, "Review shows the setting before and after."),
 (2, "behaviour", 458, 555, 670, 62, "Warns that the change acts automatically, without a person confirming each document."),
 (3, "simulated", 1033, 706, 70, 36, "In the design fixture Apply reports \"Apply is disabled in the design fixture; nothing is written.\""),
 (4, "corrected", 1090, 248, 28, 24, "Corrected in this round: closing returns focus to Review policy changes."),
]
S[("13", "desktop", f"{OUT}/13-1586x992.png")] = [
 (1, "approved", 249, 90, 1135, 36, "Section row above the child page's title (child pages, 10.7)."),
 (2, "geometry", 257, 138, 520, 95, "Breadcrumb and title position differ from the mock."),
 (3, "behaviour", 257, 212, 310, 22, "Times are in the dealership's time zone when it is set; otherwise UTC, labelled (the fixture has no zone)."),
 (4, "masked", 612, 295, 250, 30, "Run id, source and dates: fixture data, masked."),
 (5, "behaviour", 898, 922, 64, 22, "Copy button for the technical evidence."),
 (6, "geometry", 258, 386, 720, 210, "Card heights and gutters differ from the mock."),
 (7, "asset", 281, 410, 32, 32, "Standard icon set."),
]
S[("13", "phone", f"{PH}/13-390x844-00.png")] = [
 (1, "responsive", 16, 138, 358, 20, "Breadcrumb on one line above the title."),
 (2, "responsive", 16, 304, 358, 452, "The four status tiles stack."),
]
S[("13", "child-retry", f"{ST}/13-1586x992-retry-options-open.png")] = [
 (1, "behaviour", 1028, 960, 512, 32, "Review retry options opens a panel under the actions (below the fold at 1586x992; scroll to read it)."),
 (2, "behaviour", 1025, 535, 230, 30, "Last successful run in the dealership's zone, or UTC labelled."),
]

def caption(screen, view):
    return f"Screen {screen} {view} · {REV} · protocol v2 masked reference-match score {SCORES[screen]} · pending owner review"

os.makedirs(f"{R}/specs", exist_ok=True)
os.makedirs(f"{R}/annotated", exist_ok=True)
lists = {}
for (screen, view, image), items in S.items():
    spec = {"image": image, "out": f"{R}/annotated/{screen}-{view}.png", "caption": caption(screen, view),
            "items": [{"n": n, "kind": k, "x": x, "y": y, "w": w, "h": h} for (n, k, x, y, w, h, _) in items]}
    json.dump(spec, open(f"{R}/specs/{screen}-{view}.json", "w"))
    lists.setdefault(screen, []).append((view, items))

LABEL = {"approved": "approved (cited owner decision)", "geometry": "proposed exception: geometry", "behaviour": "proposed exception: behaviour / truthful content", "asset": "asset substitution", "masked": "fixture data, masked", "fixture": "fixture data, scored", "responsive": "phone layout, no reference", "corrected": "defect corrected in this round", "wording": "proposed exception: truthful wording", "simulated": "fixture only: nothing written", "finding": "open finding (reported, not changed)", "rendering": "rendering difference (measured)"}
with open(f"{R}/EXCEPTIONS-02-05-09-10-11-13.md", "w") as f:
    f.write("# Exception lists: 02, 05, 09, 10, 11, 13\n\nNumbers match the annotated images in `annotated/`. All six are pending your review; nothing here is approved on your behalf.\n")
    for screen in ["02", "05", "09", "10", "11", "13"]:
        f.write(f"\n## Screen {screen} · protocol v2 masked reference-match score {SCORES[screen]}\n")
        for view, items in lists[screen]:
            f.write(f"\n**{view}** (`annotated/{screen}-{view}.png`)\n\n")
            for (n, k, *_r, text) in items:
                f.write(f"{n}. *{LABEL[k]}*: {text}\n")
print("specs:", len(S))
