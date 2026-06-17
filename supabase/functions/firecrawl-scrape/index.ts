// firecrawl-scrape
//
// Renders a JS-walled dealer VDP (Team Velocity/Apollo, DealerOn, etc.) via
// Firecrawl and returns the fully-rendered HTML so the client parser can pull
// VIN / YMM / stock / price / photos that a plain fetch never sees.
//
//   POST /functions/v1/firecrawl-scrape   { url }
//   Returns: { html } on success, { error } otherwise.
//
// Requires the FIRECRAWL_API_KEY secret. Returns { error:"not_configured" }
// (HTTP 200) when unset so the client falls back gracefully.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Block private / metadata targets before handing the URL to Firecrawl.
const isPublicHttpUrl = (raw: string): boolean => {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (host === "169.254.169.254") return false;
  return true;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) return json(200, { error: "not_configured" });

  try {
    const { url } = await req.json().catch(() => ({ url: "" }));
    if (!url || typeof url !== "string" || !isPublicHttpUrl(url)) {
      return json(400, { error: "invalid_url" });
    }

    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["html"], onlyMainContent: false, waitFor: 3500, timeout: 30000 }),
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(200, { error: "firecrawl_failed", status: res.status, detail: text.slice(0, 300) });
    }

    const data = await res.json();
    const html: string = data?.data?.html || data?.html || "";
    if (!html) return json(200, { error: "no_content" });
    return json(200, { html });
  } catch (err) {
    return json(200, { error: err instanceof Error ? err.message : "unknown_error" });
  }
});
