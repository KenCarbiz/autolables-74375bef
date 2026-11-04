// Test-only: serves an app's generated rtgip2-key-import bundle under Deno exactly as the Edge Function
// entry runs it (createEntryKeyImport), except that compiledEnabled is passed as true. Loopback only.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface KeyImportServer {
  url: string;
  stop(): Promise<void>;
  log(): string;
}

const freePort = () =>
  new Promise<number>((ok) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => ok(p));
    });
  });

export async function serveKeyImport(o: {
  bundleFile: string;
  stagingRef: string;
  dbUrl: string;
  keyEnv: Record<string, string>;
  deno?: string;
}): Promise<KeyImportServer> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rtgip2-ki-"));
  const entry = path.join(dir, "entry.ts");
  writeFileSync(
    entry,
    `import * as B from ${JSON.stringify(pathToFileURL(o.bundleFile).href)};
const ki = B.createEntryKeyImport({ compiledEnabled: true });
Deno.serve({ hostname: "127.0.0.1", port: Number(Deno.env.get("TEST_PORT")), onListen() {} }, (req) =>
  new URL(req.url).pathname === "/ping" ? new Response("{}") : ki.handle(req));
`,
  );
  const port = await freePort();
  const out: string[] = [];
  const child: ChildProcess = spawn(
    o.deno ?? process.env["RTGIP_DENO"] ?? "/tmp/denobin/node_modules/.bin/deno",
    ["run", "--allow-net", "--allow-env", "--allow-read", entry],
    {
      env: {
        ...process.env,
        DENO_DIR: process.env["DENO_DIR"] ?? path.join(os.tmpdir(), "rtgip2-deno-cache"),
        DENO_CERT: process.env["DENO_CERT"] ?? "/root/.ccr/ca-bundle.crt",
        NO_COLOR: "1",
        TEST_PORT: String(port),
        SUPABASE_URL: `https://${o.stagingRef}.supabase.co`,
        SUPABASE_DB_URL: o.dbUrl,
        ...o.keyEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (d) => out.push(String(d)));
  child.stderr?.on("data", (d) => out.push(String(d)));
  const url = `http://127.0.0.1:${port}`;
  const stop = () =>
    new Promise<void>((ok) => {
      if (child.exitCode !== null) return ok();
      child.once("exit", () => ok());
      child.kill("SIGKILL");
    });
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`deno exited early: ${out.join("")}`);
    try {
      await fetch(`${url}/ping`);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error(`deno did not start: ${out.join("")}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return { url, stop, log: () => out.join("") };
}
