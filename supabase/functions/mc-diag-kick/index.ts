// Kick crawl-advertised-prices using service-role from env (server-only).
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const URL_BASE = Deno.env.get("SUPABASE_URL") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const body = await req.json().catch(()=>({limit:500}));
  const r = await fetch(`${URL_BASE}/functions/v1/crawl-advertised-prices`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${SR}`, "Content-Type": "application/json", "apikey": SR },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return new Response(JSON.stringify({ status: r.status, body: (()=>{ try{return JSON.parse(text)}catch{return text.slice(0,2000)} })() }, null, 2), { headers: { ...cors, "Content-Type": "application/json" }});
});
