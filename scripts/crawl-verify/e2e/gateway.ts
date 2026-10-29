// Local stand-in for everything the advertised-price crawler talks to during
// the isolated run:
//   /rest/v1/*              a local PostgREST over the throwaway database;
//   /storage/v1/object/*    an evidence bucket held in memory, with a refusal
//                           for the VINs in FAIL_STORAGE_VINS;
//   /fc/v2/scrape           a renderer that serves the synthetic page for the
//                           VIN in the requested address (pages.json), with a
//                           screenshot link when one was asked for;
//   /fc/v2/team/credit-usage  a balance, so key selection succeeds;
//   /shots/*.png            screenshot bytes;
//   /functions/v1/*         recorded and answered, nothing runs;
//   FLIP_PROMOTION_AT_RENDER=n  switches promotion off (crawl_control) while
//                           the n-th render is being served.
// Nothing leaves the machine; the crawler runs with network access limited to
// 127.0.0.1.

const pgrst = Deno.env.get("PGRST_URL") ?? "";
const port = Number(Deno.env.get("GATEWAY_PORT") ?? "54421");
const self = `http://127.0.0.1:${port}`;
const fixture = JSON.parse(await Deno.readTextFile(Deno.env.get("PAGES_JSON") ?? "pages.json")) as {
  pages: Record<string, { html: string; finalUrl: string }>;
};
let failStorage = new Set((Deno.env.get("FAIL_STORAGE_VINS") ?? "").split(",").filter(Boolean));
const renders: Array<{ vin: string | null; formats: unknown; url: string }> = [];
const stored: Array<{ path: string; bytes: number; status: number }> = [];
const functions: string[] = [];
let shot = 0;
const flipAt = Number(Deno.env.get("FLIP_PROMOTION_AT_RENDER") ?? "0");
const flips: Array<{ atRender: number; ok: boolean }> = [];
let renderCount = 0;

const vinIn = (u: string) => Object.keys(fixture.pages).find((v) => u.toLowerCase().includes(v.toLowerCase())) ?? null;

Deno.serve({ hostname: "127.0.0.1", port, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/rest/v1/")) {
    const headers = new Headers(req.headers);
    headers.delete("host");
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const res = await fetch(pgrst + url.pathname.slice("/rest/v1".length) + url.search, {
      method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined,
    });
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    const empty = res.status === 204 || res.status === 304;
    return new Response(empty ? null : await res.arrayBuffer(), { status: res.status, headers: out });
  }
  if (url.pathname.startsWith("/storage/v1/object/")) {
    const path = url.pathname.slice("/storage/v1/object/".length);
    const bytes = (await req.arrayBuffer()).byteLength;
    const vin = vinIn(path);
    const status = vin && failStorage.has(vin) ? 500 : 200;
    stored.push({ path, bytes, status });
    return status === 200
      ? Response.json({ Key: path, Id: crypto.randomUUID() })
      : Response.json({ statusCode: "500", error: "injected", message: "injected storage failure" }, { status: 500 });
  }
  if (url.pathname === "/fc/v2/team/credit-usage") {
    return Response.json({ success: true, data: { remainingCredits: 1000, planCredits: 1000, billingPeriodEnd: "2026-11-30" } });
  }
  if (url.pathname === "/fc/v2/scrape" && req.method === "POST") {
    const body = await req.json() as { url: string; formats: unknown };
    const vin = vinIn(body.url);
    renders.push({ vin, formats: body.formats, url: body.url });
    renderCount++;
    // The in-flight stage: an admin hold lands while this render is out.
    if (flipAt > 0 && renderCount === flipAt) {
      const out = await new Deno.Command("psql", {
        args: ["-X", "-qtA", "-U", Deno.env.get("PGUSER") ?? "postgres", "-d", Deno.env.get("FLIP_DB") ?? "", "-c",
          "UPDATE public.crawl_control SET promotion_enabled = false, version = version + 1, reason = 'hold during run (test)'"],
      }).output();
      flips.push({ atRender: renderCount, ok: out.success });
    }
    const page = vin ? fixture.pages[vin] : null;
    if (!page) return Response.json({ success: true, data: { html: "<html><body>Not found</body></html>", metadata: { url: body.url, statusCode: 404 } } });
    const wantsShot = JSON.stringify(body.formats).includes("screenshot");
    return Response.json({
      success: true,
      data: {
        html: page.html,
        screenshot: wantsShot ? `${self}/shots/${vin}-${++shot}.png` : undefined,
        metadata: { url: page.finalUrl, sourceURL: body.url, statusCode: 200 },
      },
    });
  }
  if (url.pathname.startsWith("/shots/")) {
    const name = url.pathname.slice("/shots/".length);
    return new Response(new TextEncoder().encode(`\x89PNG synthetic ${name}`), { headers: { "content-type": "image/png" } });
  }
  if (url.pathname.startsWith("/functions/v1/")) {
    functions.push(url.pathname.slice("/functions/v1/".length));
    return Response.json({ ok: true, stub: true });
  }
  if (url.pathname === "/__renders") return Response.json(renders.splice(0));
  if (url.pathname === "/__stored") return Response.json(stored.splice(0));
  if (url.pathname === "/__functions") return Response.json(functions.splice(0));
  if (url.pathname === "/__flips") return Response.json(flips);
  if (url.pathname === "/__fail_storage") { failStorage = new Set((url.searchParams.get("vins") ?? "").split(",").filter(Boolean)); return new Response("ok"); }
  return new Response("not found", { status: 404 });
});
