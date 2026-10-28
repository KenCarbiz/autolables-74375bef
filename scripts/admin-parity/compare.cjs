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

/** Landmark check: each expected box must be within tolerance on every edge it declares. */
function checkLandmarks(expected, measured, tolerance = 16) {
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
    rows.push({ name, ok, expected: exp, measured: { x: Math.round(got.x), y: Math.round(got.y), w: Math.round(got.w), h: Math.round(got.h) }, deltas });
  }
  return rows;
}

module.exports = { compareFrames, checkLandmarks, buildMask, PIXEL_TOLERANCE };
