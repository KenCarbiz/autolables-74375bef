#!/usr/bin/env node
"use strict";
// Records the baseline of an owner-accepted screen from the commit that holds
// its accepted evidence: the accepted capture (copied byte for byte into
// scripts/admin-parity/acceptance/<NN>/), the reference and its hash, the
// screen's mask definitions as they stood, and the capture settings. The
// parity report compares every later run against this baseline. It does not
// accept anything itself; the decision fields in acceptance.json are written
// by hand from the owner's instruction.
//
//   node scripts/admin-parity/record-acceptance-baseline.cjs <NN> <evidence-commit> <capture-path-in-that-commit> [--browser "<name version>"]

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const gitShow = (commit, file) => execFileSync("git", ["show", `${commit}:${file}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });

function main() {
  const [screen, commit, capturePath] = process.argv.slice(2);
  if (!screen || !commit || !capturePath) throw new Error("usage: <NN> <evidence-commit> <capture-path-in-that-commit>");
  const bi = process.argv.indexOf("--browser");
  const browser = bi > 0 ? process.argv[bi + 1] : null;
  const registerPath = path.join(__dirname, "acceptance.json");
  const register = JSON.parse(fs.readFileSync(registerPath, "utf8"));
  if (!register[screen]) throw new Error(`screen ${screen} is not in acceptance.json; record the owner's decision first`);

  const capture = gitShow(commit, capturePath);
  const outDir = path.join(__dirname, "acceptance", screen);
  fs.mkdirSync(outDir, { recursive: true });
  const captureFile = path.join(outDir, "accepted-1586x992.png");
  fs.writeFileSync(captureFile, capture);

  const masks = JSON.parse(gitShow(commit, "scripts/admin-parity/masks.json").toString("utf8"))[screen] ?? { selectors: [], rects: [] };
  const landmarks = JSON.parse(gitShow(commit, "scripts/admin-parity/landmarks.json").toString("utf8"))[screen] ?? {};
  const referenceDir = "scripts/admin-parity/reference";
  const referenceName = execFileSync("git", ["ls-tree", "--name-only", `${commit}:${referenceDir}`], { cwd: ROOT }).toString("utf8").split("\n").find((n) => n.startsWith(`${screen}-`) && n.endsWith(".png"));
  if (!referenceName) throw new Error(`no reference for ${screen} in ${commit}`);
  const reference = `${referenceDir}/${referenceName}`;
  const rail = typeof landmarks._rail === "number" ? landmarks._rail : 256;

  register[screen].baseline = {
    recordedFrom: commit,
    capture: path.relative(ROOT, captureFile),
    captureSha256: sha256(capture),
    capturedAt: capturePath,
    reference,
    referenceSha256: sha256(gitShow(commit, reference)),
    masks,
    masksSha256: sha256(Buffer.from(JSON.stringify(masks))),
    settings: {
      protocol: "v2",
      frame: { width: 1586, height: 992 },
      deviceScaleFactor: 1,
      route: `/admin/design-fixture/${screen}?rail=${rail}`,
      rail,
      contentRegion: { x: rail + 3, y: 70, w: 1586 - rail - 3, h: 992 - 70 },
      threshold: "a pixel differs when any channel moves more than 32/255",
      font: "Inter v20, document.fonts.ready awaited",
      browser: browser ?? "not recorded at acceptance",
    },
  };
  // Screen keys like "12" are integer-like, so JSON.stringify would list them first; keep the comment, then screen order.
  const keys = ["_comment", ...Object.keys(register).filter((k) => !k.startsWith("_")).sort()].filter((k) => k in register);
  const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(register[k], null, 2).replace(/\n/g, "\n  ")}`).join(",\n");
  fs.writeFileSync(registerPath, `{\n${body}\n}\n`);
  console.log(`${screen}: baseline from ${commit} (${capturePath}) -> ${path.relative(ROOT, captureFile)}`);
}

main();
