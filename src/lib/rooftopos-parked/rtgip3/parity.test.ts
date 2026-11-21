import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const bytes = (rel: string) => readFileSync(path.resolve(root, rel));
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const gitBlob = (b: Buffer) =>
  createHash("sha1")
    .update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b]))
    .digest("hex");

type Entry = { source: string; commit: string; mirror: string; git_blob: string; sha256: string; bytes: number };
const prov = JSON.parse(readFileSync(path.join(here, "PROVENANCE.json"), "utf8")) as {
  schema: string;
  modules_commit: string;
  contract_commit: string;
  files: Entry[];
  binding: { file: string; sha256: string; resolves_to: string };
};
const freeze = JSON.parse(readFileSync(path.join(here, "rtgip3-contract-freeze.v1.json"), "utf8")) as {
  freeze: string;
  gateway_commit: string;
  gateway_pins: Record<string, string>;
  app_files: Record<string, string>;
  versions: Record<string, string>;
};
const gatewayRepo = process.env.RTGIP3_GATEWAY_REPO ?? "";

describe("rtgip/3 Gateway mirrors", () => {
  it("every mirror is byte-identical to the Gateway copy named in PROVENANCE.json", () => {
    expect(prov.schema).toBe("rtgip3-mirror-provenance/1");
    for (const f of prov.files) {
      const b = bytes(f.mirror);
      expect(sha256(b), f.mirror).toBe(f.sha256);
      expect(gitBlob(b), f.mirror).toBe(f.git_blob);
      expect(b.length, f.mirror).toBe(f.bytes);
      expect(path.basename(f.mirror), f.mirror).toBe(path.basename(f.source));
    }
  });

  it("the manifest covers every file in rtgip3/ except its own bookkeeping", () => {
    const own = new Set(["PROVENANCE.json", "parity.test.ts", "rtgip3-contract-freeze.v1.json"]);
    const listed = prov.files.map((f) => path.basename(f.mirror)).sort();
    expect(readdirSync(here).filter((f) => !own.has(f)).sort()).toEqual(listed);
  });

  it("the modules come from one Gateway commit and the contract files from the frozen one", () => {
    expect(prov.contract_commit).toBe(freeze.gateway_commit);
    for (const f of prov.files)
      expect([prov.modules_commit, prov.contract_commit], f.mirror).toContain(f.commit);
  });

  it("the rtgip2/core binding re-exports the app's frozen core and nothing else", () => {
    const b = bytes(prov.binding.file);
    expect(sha256(b)).toBe(prov.binding.sha256);
    expect(b.toString("utf8")).toBe('export * from "./protocol.ts";\n');
    expect(prov.binding.resolves_to).toBe("src/lib/rooftopos-parked/rtgip2/protocol.ts");
  });

  it.skipIf(!gatewayRepo)("matches the live Gateway repository (RTGIP3_GATEWAY_REPO)", () => {
    for (const f of prov.files) {
      const b = execFileSync("git", ["-C", gatewayRepo, "show", `${f.commit}:${f.source}`]);
      expect(sha256(b), f.source).toBe(f.sha256);
    }
    const fz = execFileSync("git", ["-C", gatewayRepo, "show", `${freeze.gateway_commit}:docs/contracts/rtgip3/contract-freeze.v1.json`]);
    const pins = (JSON.parse(fz.toString("utf8")) as { rtgip3_files: Record<string, string> }).rtgip3_files;
    expect(pins).toEqual(freeze.gateway_pins);
  });
});

describe("rtgip/3 contract freeze pin", () => {
  it("pins the Gateway freeze and its version names", () => {
    expect(freeze.freeze).toBe("rtgip/3-contract-freeze/1");
    expect(freeze.versions).toEqual({
      transport: "rtgip/3",
      envelope_body: "rtgip/2",
      receipt: "rtgip/3-receipt/3",
      forward: "rtgip/3-forward/1",
      receipt_query: "rtgip/3-receipt-query/2",
      refusal_policy: "rtgip/3-refusal-policy/1",
      attest: "rtgip/3-attest/1",
      keyset: "rtgip/3-keyset/1",
    });
  });

  it("the app's KAT vectors, KAT runner and refusal policy carry the frozen Gateway hashes", () => {
    for (const [rel, want] of Object.entries(freeze.app_files)) expect(sha256(bytes(rel)), rel).toBe(want);
    expect(freeze.app_files["src/test/fixtures/rtgip3-kat.v1.json"]).toBe(
      freeze.gateway_pins["src/test/fixtures/rtgip3-kat.v1.json"],
    );
    expect(freeze.app_files["src/lib/rooftopos-parked/rtgip3/kat.ts"]).toBe(
      freeze.gateway_pins["src/lib/gateway/rtgip3/kat.ts"],
    );
    expect(freeze.app_files["src/lib/rooftopos-parked/rtgip3/refusal-policy.v1.json"]).toBe(
      freeze.gateway_pins["docs/contracts/rtgip3/refusal-policy.v1.json"],
    );
  });
});
