# Re-labels the 03/04/07 annotations for the release review. The desktop and
# phone captures are byte-identical to the current ones, so the boxes are
# reused; only the items labelled "rendering" change, to what the cause maps
# measured inside them (itemcheck.cjs). 07's validation state moved, so it is
# annotated again from the current capture. 03's and 04's child images are
# copied unchanged (their captures are byte-identical and they carry no
# rendering label).
import json, shutil, os
R = "scripts/admin-parity/evidence/release-review"
E = "scripts/admin-parity/evidence/focused-review-03-04-07"
SCORES = {"03": "90.70% (3.71% masked)", "04": "89.87% (0.95% masked)", "07": "87.86% (3.13% masked)"}
RELABEL = {("03", 9): "geometry", ("04", 7): "geometry", ("07", 9): "geometry"}
os.makedirs(f"{R}/annotated", exist_ok=True)
for s in ["03", "04", "07"]:
    for view in ["desktop", "phone"]:
        spec = json.load(open(f"{E}/specs/{s}-{view}.json"))
        for it in spec["items"]:
            if (s, it["n"]) in RELABEL and it["kind"] == "rendering":
                it["kind"] = RELABEL[(s, it["n"])]
        spec["out"] = f"{R}/annotated/{s}-{view}.png"
        spec["caption"] = f"Screen {s} {view} · capture byte-identical to the current working tree · protocol v2 masked reference-match score {SCORES[s]} · pending owner review · rendering labels replaced by measured causes"
        json.dump(spec, open(f"{R}/specs/{s}-{view}.json", "w"))
for f in ["03-role-change-review-desktop.png", "03-role-change-review-phone.png", "04-laptop-stacked.png"]:
    shutil.copyfile(f"{E}/annotated-2d7954d/{f}", f"{R}/annotated/{f}")
d = 34
spec = {"image": f"{R}/states-030407/07-1586x992-year-range-invalid.png", "out": f"{R}/annotated/07-validation.png",
        "caption": f"Screen 07 reversed model year range · desktop 1586x992 · current working tree · design fixture, nothing written · pending owner review",
        "items": [
          {"n": 10, "kind": "geometry", "x": 263, "y": 112 - d, "w": 518, "h": 50},
          {"n": 19, "kind": "rule", "x": 405, "y": 302 - d, "w": 172, "h": 30},
          {"n": 18, "kind": "rule", "x": 301, "y": 548 - d, "w": 630, "h": 56},
          {"n": 18, "kind": "rule", "x": 1403, "y": 924 - d, "w": 162, "h": 48},
          {"n": 20, "kind": "finding", "x": 1001, "y": 593 - d, "w": 540, "h": 24},
          {"n": 21, "kind": "simulated", "x": 991, "y": 628 - d, "w": 566, "h": 206},
          {"n": 22, "kind": "simulated", "x": 1316, "y": 950, "w": 248, "h": 22}]}
json.dump(spec, open(f"{R}/specs/07-validation.json", "w"))
print("ok")
