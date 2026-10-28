"use strict";
// Image comparison for the parity harness. Two signals, as the protocol asks:
// a masked pixel-difference percentage (a pixel differs when any channel
// moves by more than PIXEL_TOLERANCE of 255) and a block structural score
// (SSIM on 8x8 luminance blocks). Both are reported for the full frame and
// for the content region to the right of the product rail and below the
// product header, which this refresh does not own.

const PIXEL_TOLERANCE = 32;
const BLOCK = 8;
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;

function buildMask(width, height, rects) {
  const mask = new Uint8Array(width * height);
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width, Math.ceil(r.x + r.w));
    const y1 = Math.min(height, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * width + x] = 1;
  }
  return mask;
}

const luminance = (d, o) => 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];

function toGray(img) {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0, o = 0; i < g.length; i++, o += 4) g[i] = luminance(img.data, o);
  return g;
}

function inRegion(region, x, y) {
  return !region || (x >= region.x && y >= region.y && x < region.x + region.w && y < region.y + region.h);
}

function pixelDifference(a, b, mask, region) {
  let compared = 0;
  let different = 0;
  const flags = new Uint8Array(a.width * a.height);
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = y * a.width + x;
      if (mask[i] || !inRegion(region, x, y)) continue;
      compared++;
      const o = i * 4;
      const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
      if (d > PIXEL_TOLERANCE) {
        different++;
        flags[i] = 1;
      }
    }
  }
  return { compared, different, percent: compared ? (different / compared) * 100 : 0, flags };
}

function structuralScore(ga, gb, width, height, mask, region) {
  let total = 0;
  let blocks = 0;
  for (let by = 0; by + BLOCK <= height; by += BLOCK) {
    for (let bx = 0; bx + BLOCK <= width; bx += BLOCK) {
      let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = by; y < by + BLOCK; y++) {
        for (let x = bx; x < bx + BLOCK; x++) {
          const i = y * width + x;
          if (mask[i] || !inRegion(region, x, y)) continue;
          const va = ga[i];
          const vb = gb[i];
          n++; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      if (n < BLOCK * BLOCK / 2) continue;
      const ma = sa / n;
      const mb = sb / n;
      const va = saa / n - ma * ma;
      const vb = sbb / n - mb * mb;
      const cov = sab / n - ma * mb;
      const ssim = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      total += Math.max(0, Math.min(1, ssim));
      blocks++;
    }
  }
  return { blocks, percent: blocks ? (total / blocks) * 100 : 0 };
}

function diffImage(capture, flags, mask) {
  const out = new Uint8Array(capture.data.length);
  for (let i = 0, o = 0; i < flags.length; i++, o += 4) {
    const lum = luminance(capture.data, o);
    const base = Math.round(96 + lum * 0.6);
    if (flags[i]) {
      out[o] = 220; out[o + 1] = 38; out[o + 2] = 38;
    } else if (mask[i]) {
      out[o] = Math.round(base * 0.6); out[o + 1] = Math.round(base * 0.7); out[o + 2] = Math.min(255, base + 60);
    } else {
      out[o] = out[o + 1] = out[o + 2] = base;
    }
    out[o + 3] = 255;
  }
  return { width: capture.width, height: capture.height, data: out };
}

/**
 * Compare a reference frame against a capture of the same size.
 * `masks` are rectangles in frame coordinates. `contentRegion` excludes the
 * product shell. Returns both scores and the diff image.
 */
function compareFrames({ reference, capture, masks = [], contentRegion }) {
  if (reference.width !== capture.width || reference.height !== capture.height) {
    throw new Error(`frame mismatch ${reference.width}x${reference.height} vs ${capture.width}x${capture.height}`);
  }
  const mask = buildMask(reference.width, reference.height, masks);
  const ga = toGray(reference);
  const gb = toGray(capture);
  const full = pixelDifference(reference, capture, mask, null);
  const content = pixelDifference(reference, capture, mask, contentRegion);
  const fullStructure = structuralScore(ga, gb, reference.width, reference.height, mask, null);
  const contentStructure = structuralScore(ga, gb, reference.width, reference.height, mask, contentRegion);
  let masked = 0;
  for (let i = 0; i < mask.length; i++) masked += mask[i];
  return {
    pixelTolerance: PIXEL_TOLERANCE,
    maskedPixels: masked,
    maskedPercent: (masked / mask.length) * 100,
    full: { pixelDiffPercent: full.percent, parityPercent: 100 - full.percent, compared: full.compared, structuralPercent: fullStructure.percent, blocks: fullStructure.blocks },
    content: { pixelDiffPercent: content.percent, parityPercent: 100 - content.percent, compared: content.compared, structuralPercent: contentStructure.percent, blocks: contentStructure.blocks },
    diff: diffImage(capture, full.flags, mask),
  };
}

/**
 * The reference mocks title their pages differently (some title the section,
 * some omit the breadcrumb and description), while the handoff's IA fixes one
 * h1 "Administration" with a breadcrumb above it. The body score aligns both
 * images at the bottom of the section row so that documented title-block
 * difference is measured once, as an offset, instead of shifting every pixel
 * below it. In the reference the row bottom is the first row after the active
 * tab's blue underline; in the capture it is read from the DOM.
 */
function findReferenceSectionRowBottom(img, region) {
  const { width, data } = img;
  const x0 = region ? region.x : 0;
  const x1 = region ? region.x + region.w : width;
  const y0 = region ? region.y : 0;
  const y1 = Math.min(img.height, y0 + 420);
  const isBlue = (o) => data[o] < 0x70 && data[o + 1] >= 0x30 && data[o + 1] <= 0x90 && data[o + 2] >= 0xa0;
  let underlineStart = null;
  for (let y = y0; y < y1; y++) {
    let run = 0;
    let longest = 0;
    for (let x = x0; x < x1; x++) {
      if (isBlue((y * width + x) * 4)) { run++; if (run > longest) longest = run; } else run = 0;
    }
    if (longest >= 40) {
      if (underlineStart === null) underlineStart = y;
    } else if (underlineStart !== null) {
      // The row after the underline carries the section row's border; the body starts under it.
      return y + 1;
    }
  }
  return null;
}

function shiftRows(img, dy) {
  const out = { width: img.width, height: img.height, data: new Uint8Array(img.data.length).fill(0xff) };
  const rowBytes = img.width * 4;
  for (let y = 0; y < img.height; y++) {
    const src = y - dy;
    if (src < 0 || src >= img.height) continue;
    out.data.set(img.data.subarray(src * rowBytes, src * rowBytes + rowBytes), y * rowBytes);
  }
  return out;
}

/** Content-region score below the section row with the reference shifted to the capture's row bottom. */
function compareBody({ reference, capture, masks = [], contentRegion, referenceTop, captureTop, textBoxes = null }) {
  if (referenceTop === null || referenceTop === undefined || captureTop === null || captureTop === undefined) return null;
  const dy = captureTop - referenceTop;
  const shifted = shiftRows(reference, dy);
  const bottomCut = Math.max(0, dy);
  const region = { x: contentRegion.x, y: captureTop, w: contentRegion.w, h: Math.max(0, reference.height - captureTop - bottomCut) };
  if (region.h <= 0) return null;
  const mask = buildMask(reference.width, reference.height, masks);
  const pixel = pixelDifference(shifted, capture, mask, region);
  const structure = structuralScore(toGray(shifted), toGray(capture), reference.width, reference.height, mask, region);
  const out = { referenceTop, captureTop, offset: dy, rows: region.h, pixelDiffPercent: pixel.percent, parityPercent: 100 - pixel.percent, compared: pixel.compared, structuralPercent: structure.percent, blocks: structure.blocks };
  if (textBoxes) {
    const split = splitByText({ reference: shifted, capture, dynamicMask: mask, textBoxes, region });
    out.nonText = split.nonText;
    out.text = split.text;
    out.structureDiff = split.diff;
  }
  return out;
}

/**
 * Separates glyph rendering from everything else. Pixels inside the capture's
 * text boxes (padded line boxes and form-control content boxes) form the text
 * region; every other compared pixel is structure: fills, borders, spacing,
 * component sizes and icons. Both use the same 32/255 threshold, so the two
 * shares add up to the body score.
 */
function splitByText({ reference, capture, dynamicMask, textBoxes, region }) {
  const textMask = buildMask(reference.width, reference.height, textBoxes);
  let ntCompared = 0, ntDiff = 0, tCompared = 0, tDiff = 0;
  const { width } = capture;
  const diff = { width, height: capture.height, data: new Uint8Array(capture.data.length) };
  for (let y = 0; y < capture.height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const o = i * 4;
      const g = Math.round(0.299 * capture.data[o] + 0.587 * capture.data[o + 1] + 0.114 * capture.data[o + 2]);
      const faded = 235 + Math.round((g / 255) * 20);
      diff.data[o] = faded; diff.data[o + 1] = faded; diff.data[o + 2] = faded; diff.data[o + 3] = 255;
      if (!inRegion(region, x, y)) continue;
      if (dynamicMask[i]) { diff.data[o] = 150; diff.data[o + 1] = 190; diff.data[o + 2] = 255; continue; }
      const d = Math.max(Math.abs(reference.data[o] - capture.data[o]), Math.abs(reference.data[o + 1] - capture.data[o + 1]), Math.abs(reference.data[o + 2] - capture.data[o + 2]));
      if (textMask[i]) {
        tCompared++;
        if (d > PIXEL_TOLERANCE) { tDiff++; diff.data[o] = 255; diff.data[o + 1] = 200; diff.data[o + 2] = 60; }
      } else {
        ntCompared++;
        if (d > PIXEL_TOLERANCE) { ntDiff++; diff.data[o] = 220; diff.data[o + 1] = 20; diff.data[o + 2] = 20; }
      }
    }
  }
  const pct = (a, b) => (b ? (a / b) * 100 : 0);
  const total = ntCompared + tCompared;
  return {
    nonText: { compared: ntCompared, different: ntDiff, parityPercent: 100 - pct(ntDiff, ntCompared), shareOfBodyDiffPercent: pct(ntDiff, total) },
    text: { compared: tCompared, different: tDiff, parityPercent: 100 - pct(tDiff, tCompared), shareOfBodyDiffPercent: pct(tDiff, total), areaPercent: pct(tCompared, total) },
    diff,
  };
}

/**
 * Landmark check: each expected box must be within tolerance on every edge it
 * declares. `yBody` declares a y measured from the reference section-row
 * bottom and is compared against the capture's box measured from its own row
 * bottom, so a landmark can be gated on y under the documented title-block
 * difference.
 */
function checkLandmarks(expected, measured, tolerance = 16, anchors = null) {
  const rows = [];
  for (const [name, exp] of Object.entries(expected)) {
    const got = measured[name];
    if (!got) {
      rows.push({ name, ok: false, note: "not found in the capture" });
      continue;
    }
    const deltas = {};
    let ok = true;
    for (const edge of ["x", "y", "w", "h"]) {
      if (exp[edge] === undefined) continue;
      const d = Math.round(got[edge] - exp[edge]);
      deltas[edge] = d;
      if (Math.abs(d) > tolerance) ok = false;
    }
    if (exp.yBody !== undefined) {
      if (!anchors || anchors.captureTop === null || anchors.captureTop === undefined) {
        ok = false;
        deltas.yBody = NaN;
      } else {
        const d = Math.round(got.y - anchors.captureTop - exp.yBody);
        deltas.yBody = d;
        if (Math.abs(d) > tolerance) ok = false;
      }
    }
    rows.push({ name, ok, expected: exp, measured: { x: Math.round(got.x), y: Math.round(got.y), w: Math.round(got.w), h: Math.round(got.h), yBody: anchors && typeof anchors.captureTop === "number" ? Math.round(got.y - anchors.captureTop) : undefined }, deltas });
  }
  return rows;
}

module.exports = { compareFrames, compareBody, splitByText, findReferenceSectionRowBottom, checkLandmarks, buildMask, PIXEL_TOLERANCE };
