"use strict";
const fs = require("node:fs");
const path = require("node:path");

const pct = (n) => (typeof n === "number" ? `${n.toFixed(2)}%` : "n/a");

function frameRow(label, f) {
  if (!f || !f.full) return `| ${label} | ${f ? f.file : "n/a"} | ${f && f.note ? f.note : "no comparison"} | | | | | | | | |`;
  const body = f.body ? `${pct(f.body.parityPercent)} (${f.body.offset >= 0 ? "+" : ""}${f.body.offset}px)` : "n/a";
  const bodyStructure = f.body ? pct(f.body.structuralPercent) : "n/a";
  const layout = f.body && f.body.nonText ? pct(f.body.nonText.parityPercent) : "n/a";
  const text = f.body && f.body.text ? pct(f.body.text.parityPercent) : "n/a";
  return `| ${label} | \`${f.file}\` | ${pct(f.full.parityPercent)} | ${pct(f.full.structuralPercent)} | ${pct(f.content.parityPercent)} | ${pct(f.content.structuralPercent)} | ${body} | ${bodyStructure} | ${layout} | ${text} | ${pct(f.maskedPercent)} |`;
}

function readNotes() {
  const notesPath = path.join(__dirname, "notes.json");
  if (!fs.existsSync(notesPath)) return {};
  return JSON.parse(fs.readFileSync(notesPath, "utf8"));
}

function gateLine(s) {
  if (!s.gate) return "Gate: not evaluated.";
  if (s.gate.error) return `Gate: FAIL (the screen did not render: ${s.gate.error}).`;
  const protocol = s.frames && s.frames.protocol && s.frames.protocol.content ? s.frames.protocol.content.parityPercent : s.gate.contentParity;
  const reasons = [];
  if (s.gate.landmarks === false) reasons.push("landmarks out of tolerance");
  if (!s.gate.responsive) reasons.push("page overflow at a breakpoint");
  if (typeof protocol !== "number") reasons.push("no protocol-frame score");
  else if (protocol < 97) reasons.push(`protocol content parity ${protocol.toFixed(2)}% is below 97%`);
  return reasons.length ? `Gate: FAIL (${reasons.join("; ")}). Acceptance pending; no exception has been approved.` : "Gate: PASS.";
}

function writeReport(results, outPath) {
  const notes = readNotes();
  const lines = [];
  lines.push("# Administration V2 visual parity report");
  lines.push("");
  lines.push(`Generated ${results.generatedAt} by \`bun run admin:parity\` against the development fixture route. Every screen is a synthetic fixture rendered by the real Administration components; no production data appears in any capture.`);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push(`- Reference frame: ${results.referenceFrame.width}x${results.referenceFrame.height}, the size the mocks were cropped to. Rendered and compared pixel for pixel as a diagnostic; it is not the agreed metric.`);
  lines.push(`- Protocol frame: ${results.protocolFrame.width}x${results.protocolFrame.height}. This is the agreed comparison frame (\`docs/05_VISUAL_PARITY_97_PROTOCOL.md\`, \`contracts/PARITY_TARGETS.csv\`): the reference is resampled (bilinear) to it, captured at DPR 1 in Playwright Chromium, and its content-region parity is the number held to 97%.`);
  lines.push("- Pixel parity: a pixel differs when any channel moves by more than 32 of 255 after masks. Parity is 100 minus the differing share of compared pixels. No anti-aliasing allowance is applied.");
  lines.push("- Structure: mean SSIM over 8x8 luminance blocks after masks.");
  lines.push("- Masks: only dynamic data (counts, relative times, fixture names) listed in `scripts/admin-parity/masks.json`, read from the rendered DOM so the same boxes mask both images. Navigation, tabs, headings, card bounds, tables, buttons and chips are never masked.");
  lines.push("- Content region: y >= 70 and x past the mock's rail (each screen's `_rail` in `scripts/admin-parity/landmarks.json`, 217 to 264px across the set; the fixture sizes its rail stand-in to the same number so the content origin lines up). The rail and the product header belong to the global application shell (`AppShell`, whose live rail is 256px), which this refresh does not restyle; the full-frame score includes them for completeness.");
  lines.push("- Landmarks: hand-measured boxes from the reference (`scripts/admin-parity/landmarks.json`, tolerance 16px) compared with the rendered DOM boxes. A `yBody` landmark is measured from the section-row bottom on both sides.");
  lines.push("- Layout parity (text masked) and text-box parity: the body region split by the implementation's text boxes (every rendered line of text, padded 2px, and the content box of every form control). Layout parity scores everything outside them: fills, borders, spacing, component sizes and icons. Text-box parity scores the glyphs inside them, where Chromium's Inter and the mock renderer differ even when the box sits exactly where the mock's text sits. Mock text that falls outside every implementation text box counts against layout, so misplaced or missing copy is not hidden by the split. The layout diff image (`*-structure.png`) marks layout differences red and text-box differences amber.");
  lines.push("- Mock-only annotations: the handoff mocks print captions on the image itself (the Proposed design footer, the DESIGN CONCEPT label, a sample-policy caption, a recovery-flow caption). They are not product UI; `masks.json` covers them on both images with the reason recorded.");
  lines.push("- Body parity (aligned): the handoff's information architecture fixes one h1, \"Administration\", with a breadcrumb above it, while the mocks title their pages four different ways (section name as title, no breadcrumb, no description, a chip above the title). That title block is a proposed exception awaiting the owner, not an approved one. As a diagnostic only, the body score shifts the reference so both section rows end on the same pixel row and scores everything below it in the content region, with the same masks. The offset is printed with the score and it never replaces the protocol number.");
  lines.push("- Responsive: 1920x1080, 1366x768, 1024x768 and 390x844 captured; a breakpoint passes when the document has no horizontal overflow and no element extends past the viewport.");
  lines.push("");
  lines.push(`Registered fixtures: ${results.registered && results.registered.length ? results.registered.join(", ") : "none"}.${results.skipped && results.skipped.length ? ` Requested but not registered: ${results.skipped.join(", ")}.` : ""}`);
  lines.push("");
  for (const s of results.screens) {
    lines.push(`## Screen ${s.screen}`);
    lines.push("");
    lines.push(`Reference: ${s.reference ? `\`${s.reference}\`` : "not present"}. Fonts: Inter ${s.fonts && s.fonts.inter ? "loaded" : "not loaded"}${s.fonts && s.fonts.loaded.length ? ` (${s.fonts.loaded.join(", ")})` : ""}. ${gateLine(s)}`);
    lines.push("");
    lines.push("| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Body parity (aligned) | Body structure | Layout parity (text masked) | Text-box parity | Masked |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
    lines.push(frameRow(`${results.referenceFrame.width}x${results.referenceFrame.height}`, s.frames.reference));
    lines.push(frameRow(`${results.protocolFrame.width}x${results.protocolFrame.height}`, s.frames.protocol));
    lines.push("");
    if (typeof s.rail === "number") lines.push(`Rail stand-in: ${s.rail}px (the mock's rail width); content region starts at x=${s.rail + 3}.`);
    if (s.anchors) {
      const a = s.anchors;
      lines.push(`${a.pinned ? "Body anchor (pinned in landmarks.json)" : "Section row bottom"}: reference y=${a.referenceTop === null ? "not found" : a.referenceTop}, capture y=${a.captureTop === null ? "not found" : a.captureTop}${typeof a.referenceTop === "number" && typeof a.captureTop === "number" ? ` (title block offset ${a.captureTop - a.referenceTop >= 0 ? "+" : ""}${a.captureTop - a.referenceTop}px)` : ""}.`);
    }
    if (s.frames.reference && s.frames.reference.diff) lines.push(`Diff image: \`${s.frames.reference.diff}\` (red differs, blue masked).`);
    const evidenceName = `${s.screen}-${results.referenceFrame.width}x${results.referenceFrame.height}`;
    if (fs.existsSync(path.join(__dirname, "evidence", `${evidenceName}.png`))) {
      lines.push(`Committed copies of that capture and diff: \`scripts/admin-parity/evidence/${evidenceName}.png\` and \`scripts/admin-parity/evidence/${evidenceName}-diff.png\`.`);
    }
    lines.push("");
    lines.push(`Masks (${s.masks.length}): ${s.masks.length ? Array.from(new Set(s.masks.map((m) => m.reason))).join("; ") : "none"}.`);
    lines.push("");
    if (s.landmarks) {
      lines.push("| Landmark | Result | Expected | Measured | Delta |");
      lines.push("|---|---|---|---|---|");
      for (const l of s.landmarks) {
        const fmt = (b) => (b ? ["x", "y", "yBody", "w", "h"].filter((k) => typeof b[k] === "number").map((k) => `${k}=${Math.round(b[k])}`).join(" ") : "");
        lines.push(`| ${l.name} | ${l.ok ? "within tolerance" : l.note ? l.note : "OUT of tolerance"} | ${fmt(l.expected)} | ${fmt(l.measured)} | ${l.deltas ? Object.entries(l.deltas).map(([k, v]) => `${k}${v >= 0 ? "+" : ""}${v}`).join(" ") : ""} |`);
      }
      lines.push("");
    }
    lines.push("| Viewport | Page overflow | scrollWidth | innerWidth | Widest fixed element | Scroll regions | Capture |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of s.responsive) {
      lines.push(`| ${r.viewport} | ${r.ok ? "none" : "OVERFLOW"} | ${r.scrollWidth} | ${r.innerWidth} | ${Math.round(r.maxRight)} | ${r.scrollRegions && r.scrollRegions.length ? r.scrollRegions.join(", ") : "none"} | \`${r.file}\` |`);
    }
    lines.push("");
    if (Array.isArray(notes[s.screen]) && notes[s.screen].length) {
      lines.push(`### Findings for screen ${s.screen}`);
      lines.push("");
      for (const n of notes[s.screen]) lines.push(`- ${n}`);
      lines.push("");
    }
  }
  if (Array.isArray(notes._general) && notes._general.length) {
    lines.push("## Findings across screens");
    lines.push("");
    for (const n of notes._general) lines.push(`- ${n}`);
    lines.push("");
  }
  lines.push("## Reading the numbers");
  lines.push("");
  lines.push("- The 97% target in the parity protocol applies to content-region parity at the 1600x1000 protocol frame after permitted dynamic masks. No screen meets it. The full-frame number also includes the product rail and header, which belong to the global shell; treating them separately is a proposal for the owner, not an approved exception.");
  lines.push("- A high structural score with a lower pixel parity means the composition matches and the remaining difference is typography rendering or sub-pixel offsets; a low structural score means a layout difference and needs a look at the diff image.");
  lines.push("- A landmark out of tolerance is a hard-gate failure regardless of the computed score. A screen's gate passes only when every landmark is within tolerance, no breakpoint has page overflow, and content-region parity at the protocol frame is at least 97%.");
  lines.push("- Responsive: page overflow (document wider than the viewport) fails the breakpoint. A region that scrolls by design, such as the section row or a wide table inside its own scroll container, is listed under Scroll regions and does not fail it.");
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```");
  lines.push("bun run admin:parity");
  lines.push("bun run admin:parity -- --screens 01");
  lines.push("node --test scripts/admin-parity/harness.test.cjs");
  lines.push("bunx vitest run src/pages/admin/fixtures");
  lines.push("```");
  lines.push("");
  fs.writeFileSync(outPath, lines.join("\n"));
}

module.exports = { writeReport };
