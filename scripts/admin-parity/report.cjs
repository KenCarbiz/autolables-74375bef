"use strict";
const fs = require("node:fs");
const path = require("node:path");

const pct = (n) => (typeof n === "number" ? `${n.toFixed(2)}%` : "n/a");

function frameRow(label, f) {
  if (!f || !f.full) return `| ${label} | ${f ? f.file : "n/a"} | ${f && f.note ? f.note : "no comparison"} | | | | |`;
  return `| ${label} | \`${f.file}\` | ${pct(f.full.parityPercent)} | ${pct(f.full.structuralPercent)} | ${pct(f.content.parityPercent)} | ${pct(f.content.structuralPercent)} | ${pct(f.maskedPercent)} |`;
}

function readNotes() {
  const notesPath = path.join(__dirname, "notes.json");
  if (!fs.existsSync(notesPath)) return {};
  return JSON.parse(fs.readFileSync(notesPath, "utf8"));
}

function gateLine(s) {
  if (!s.gate) return "Gate: not evaluated.";
  const reasons = [];
  if (s.gate.landmarks === false) reasons.push("landmarks out of tolerance");
  if (!s.gate.responsive) reasons.push("page overflow at a breakpoint");
  if (typeof s.gate.contentParity === "number" && s.gate.contentParity < 97) reasons.push(`content parity ${s.gate.contentParity.toFixed(2)}% is below 97%`);
  return s.gate.pass ? "Gate: PASS." : `Gate: FAIL (${reasons.join("; ")}).`;
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
  lines.push(`- Reference frame: ${results.referenceFrame.width}x${results.referenceFrame.height}, the native size of \`screens/original\`. The fixture is rendered at exactly that viewport and compared pixel for pixel, no resampling of the reference.`);
  lines.push(`- Protocol frame: ${results.protocolFrame.width}x${results.protocolFrame.height}. The reference is resampled (bilinear) to that frame, which softens one-pixel lines, so the reference-frame row is the primary number.`);
  lines.push("- Pixel parity: a pixel differs when any channel moves by more than 32 of 255 after masks. Parity is 100 minus the differing share of compared pixels. No anti-aliasing allowance is applied.");
  lines.push("- Structure: mean SSIM over 8x8 luminance blocks after masks.");
  lines.push("- Masks: only dynamic data (counts, relative times, fixture names) listed in `scripts/admin-parity/masks.json`, read from the rendered DOM so the same boxes mask both images. Navigation, tabs, headings, card bounds, tables, buttons and chips are never masked.");
  lines.push("- Content region: x >= 232 and y >= 70, which excludes the product rail and product header. Those belong to the global application shell (`AppShell`), which this refresh does not restyle; the full-frame score includes them for completeness.");
  lines.push("- Landmarks: hand-measured boxes from the reference (`scripts/admin-parity/landmarks.json`, tolerance 16px) compared with the rendered DOM boxes.");
  lines.push("- Responsive: 1920x1080, 1366x768, 1024x768 and 390x844 captured; a breakpoint passes when the document has no horizontal overflow and no element extends past the viewport.");
  lines.push("");
  lines.push(`Registered fixtures: ${results.registered && results.registered.length ? results.registered.join(", ") : "none"}.${results.skipped && results.skipped.length ? ` Requested but not registered: ${results.skipped.join(", ")}.` : ""}`);
  lines.push("");
  for (const s of results.screens) {
    lines.push(`## Screen ${s.screen}`);
    lines.push("");
    lines.push(`Reference: ${s.reference ? `\`${s.reference}\`` : "not present"}. Fonts: Inter ${s.fonts && s.fonts.inter ? "loaded" : "not loaded"}${s.fonts && s.fonts.loaded.length ? ` (${s.fonts.loaded.join(", ")})` : ""}. ${gateLine(s)}`);
    lines.push("");
    lines.push("| Frame | Capture | Full parity | Full structure | Content parity | Content structure | Masked |");
    lines.push("|---|---|---|---|---|---|---|");
    lines.push(frameRow(`${results.referenceFrame.width}x${results.referenceFrame.height}`, s.frames.reference));
    lines.push(frameRow(`${results.protocolFrame.width}x${results.protocolFrame.height}`, s.frames.protocol));
    lines.push("");
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
        const fmt = (b) => (b ? ["x", "y", "w", "h"].filter((k) => typeof b[k] === "number").map((k) => `${k}=${Math.round(b[k])}`).join(" ") : "");
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
  lines.push("- The 97% target in the parity protocol applies after approved dynamic masks. The content-region reference-frame parity is the number to hold to it; the full-frame number will stay lower while the product rail and header differ from the mock, which is a shell decision outside this refresh and is called out as an exception for the owner.");
  lines.push("- A high structural score with a lower pixel parity means the composition matches and the remaining difference is typography rendering or sub-pixel offsets; a low structural score means a layout difference and needs a look at the diff image.");
  lines.push("- A landmark out of tolerance is a hard-gate failure regardless of the computed score. A screen's gate passes only when every landmark is within tolerance, no breakpoint has page overflow, and content-region parity at the reference frame is at least 97%.");
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
