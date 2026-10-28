# Comparison protocol v1 (historical, superseded 2026-10-28)

Preserved as evidence. Superseded by protocol v2 (native 1586x992, no resizing) on the owner's authorization; the change alters the measurement, not the implementation.

- Agreed metric: content-region pixel parity at a 1600x1000 capture against the reference resampled bilinearly from 1586x992 to 1600x1000.
- Capture: Playwright Chromium, DPR 1, light theme, development-only synthetic fixtures, after `document.fonts.ready`; Inter v20 webfont.
- Threshold: a pixel differs when any channel moves more than 32/255; parity = 100 - differing share of compared pixels.
- Content region: x from each mock's rail edge (scaled) + 3px, y >= 70.
- Masks: permitted dynamic content and mock-only annotation captions, read from the rendered DOM.
- Targets during v1: 97%, then 95% per screen (94.00-94.99% individually reviewable).
- Final v1 results: `results-7716842.json` (implementation commit 7716842; evidence commit 8db6ef7). Protocol content parity ranged 85.60-90.64%; no screen met the target.
