// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import freeze from "../rtgip2/rtgip2-contract-freeze.v1.json";

const parked = join(__dirname, "..");
const repo = join(parked, "..", "..", "..");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const groups: [string, Record<string, string>, string][] = [
  ["core", freeze.core, join(parked, "rtgip2")],
  ["fixtures", freeze.fixtures, join(parked, "rtgip2")],
  ["gateway_candidate", freeze.gateway_candidate, parked],
  ["delivery_sql", freeze.delivery_sql, repo],
];
it.each(groups.flatMap(([g, files, base]) => Object.entries(files).map(([f, h]) => [`${g}/${f}`, join(base, f), h])))(
  "%s is frozen (rtgip/2-contract-freeze/1)",
  (_name, path, expected) => {
    expect(sha(path), "a frozen contract file changed; this needs owner approval and a new freeze version").toBe(expected);
  },
);
