import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// SSRF guard: reject hosts that resolve to private / link-local /
// loopback ranges, plus obvious metadata hostnames. Cheap textual
// check first — anything that looks like a private IP literal is
// blocked without DNS. A real DNS-pinning resolver would be ideal
// but isn't available in the Deno edge runtime, so this is a
// best-effort layer in front of an authenticated endpoint.
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./, /^0\./, /^10\./,
  /^169\.254\./,            // AWS / link-local
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/, /^fe80:/i, /^fc[0-9a-f]{2}:/i, /^fd[0-9a-f]{2}:/i,
  /metadata\.google\.internal$/i,
  /metadata\.azure\.com$/i,
]

const isUrlSafe = (raw: string): { ok: true; url: URL } | { ok: false; reason: string } => {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, reason: 'invalid URL' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'unsupported protocol' }
  const host = u.hostname
  if (!host) return { ok: false, reason: 'missing host' }
  for (const pat of BLOCKED_HOST_PATTERNS) {
    if (pat.test(host)) return { ok: false, reason: `blocked host (${host})` }
  }
  return { ok: true, url: u }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Auth gate ────────────────────────────────────────────────
    // Block anonymous callers. Accept either a valid user JWT or
    // the service-role key (cron jobs invoke this from the DB).
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) {
      return new Response(JSON.stringify({ success: false, error: 'missing bearer token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    if (jwt !== serviceKey) {
      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: userRes, error: userErr } = await admin.auth.getUser(jwt)
      if (userErr || !userRes?.user) {
        return new Response(JSON.stringify({ success: false, error: 'invalid token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let formattedUrl = url.trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`
    }

    const safety = isUrlSafe(formattedUrl)
    if (!safety.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `URL rejected: ${safety.reason}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Scraping dealer URL:', formattedUrl)

    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    }

    // Try the URL as-is, then with/without www
    const urlsToTry = [formattedUrl]
    try {
      const parsed = new URL(formattedUrl)
      if (parsed.hostname.startsWith('www.')) {
        urlsToTry.push(formattedUrl.replace('://www.', '://'))
      } else {
        urlsToTry.push(formattedUrl.replace('://', '://www.'))
      }
    } catch { /* ignore */ }

    let html = ''
    let finalUrl = formattedUrl
    let lastError = ''

    for (const tryUrl of urlsToTry) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)

      try {
        const res = await fetch(tryUrl, {
          signal: controller.signal,
          headers: browserHeaders,
          redirect: 'follow',
        })
        clearTimeout(timeout)

        if (res.ok) {
          const text = await res.text()
          if (text.length > 500) {
            html = text
            finalUrl = tryUrl
            break
          } else {
            lastError = 'Page returned very little content'
          }
        } else {
          lastError = `Site returned ${res.status}`
          // Consume body to avoid leak
          await res.text()
        }
      } catch (fetchErr) {
        clearTimeout(timeout)
        lastError = fetchErr instanceof Error ? fetchErr.message : 'Fetch failed'
      }
    }

    if (!html) {
      return new Response(
        JSON.stringify({ success: false, error: lastError || 'Could not fetch dealer website' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Fetched ${html.length} chars from ${finalUrl}`)

    return new Response(
      JSON.stringify({ success: true, html, sourceUrl: finalUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('Edge function error:', err)
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
