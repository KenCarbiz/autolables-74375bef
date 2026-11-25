import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { assertSafePublicUrl, isPrivateOrReservedIp, normalizeDomainHost } from '../_shared/security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const MAX_HTML_BYTES = 2 * 1024 * 1024
const MANAGER_ROLES = new Set(['owner', 'admin', 'general_manager', 'gsm', 'manager'])

const assertSafeAdminUrl = async (raw: string): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> => {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, reason: 'invalid URL' } }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: 'unsupported protocol' }
  if (u.username || u.password) return { ok: false, reason: 'credentials not allowed' }
  if (u.port && u.port !== '80' && u.port !== '443') return { ok: false, reason: 'non-standard port not allowed' }
  const host = u.hostname.toLowerCase()
  if (!host || !host.includes('.') || isPrivateOrReservedIp(host)) return { ok: false, reason: 'blocked host' }
  let resolvedAny = false
  for (const recordType of ['A', 'AAAA'] as const) {
    try {
      const addrs = await Deno.resolveDns(host, recordType)
      for (const ip of addrs) {
        resolvedAny = true
        if (isPrivateOrReservedIp(ip)) return { ok: false, reason: 'host resolves to private or reserved IP' }
      }
    } catch { /* record type absent */ }
  }
  if (!resolvedAny) return { ok: false, reason: 'host could not be resolved' }
  return { ok: true, url: u }
}

const safeFetch = async (
  url: string,
  init: RequestInit,
  allowedDomains: Set<string> | null,
  maxRedirects = 5,
): Promise<Response> => {
  let current = url
  for (let i = 0; i <= maxRedirects; i++) {
    const safety = allowedDomains
      ? await assertSafePublicUrl(current, allowedDomains)
      : await assertSafeAdminUrl(current)
    if (!safety.ok) throw new Error(`redirect blocked: ${safety.reason}`)
    const res = await fetch(current, { ...init, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return res
      current = new URL(loc, current).toString()
      continue
    }
    return res
  }
  throw new Error('too many redirects')
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
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const isServiceCaller = !!serviceKey && jwt === serviceKey
    let allowedDomains: Set<string> | null = null
    if (!isServiceCaller) {
      const { data: userRes, error: userErr } = await admin.auth.getUser(jwt)
      if (userErr || !userRes?.user) {
        return new Response(JSON.stringify({ success: false, error: 'invalid token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const user = userRes.user
      if (!user.email_confirmed_at) {
        return new Response(JSON.stringify({ success: false, error: 'email confirmation required' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const { data: pa } = await admin.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle()
      if (!pa) {
        const { data: mems } = await admin
          .from('tenant_members')
          .select('tenant_id, role')
          .eq('user_id', user.id)
          .not('accepted_at', 'is', null)
        const managerTenantIds = (mems || [])
          .filter((m: { role?: string }) => MANAGER_ROLES.has(String(m.role || '').toLowerCase()))
          .map((m: { tenant_id: string }) => m.tenant_id)
        if (managerTenantIds.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'manager authority required' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
        const [tRes, obRes, profRes, stRes] = await Promise.all([
          admin.from('tenants').select('domain').in('id', managerTenantIds),
          admin.from('onboarding_profiles').select('website').in('tenant_id', managerTenantIds),
          admin.from('dealer_profiles').select('settings').in('tenant_id', managerTenantIds),
          admin.from('dealer_stores').select('website').in('tenant_id', managerTenantIds),
        ])
        allowedDomains = new Set<string>()
        const addDomain = (val: unknown) => {
          const host = normalizeDomainHost(val)
          if (host) allowedDomains!.add(host)
        }
        for (const t of tRes.data || []) addDomain((t as { domain?: string }).domain)
        for (const o of obRes.data || []) addDomain((o as { website?: string }).website)
        for (const p of profRes.data || []) {
          const s = (p as { settings?: Record<string, unknown> }).settings
          addDomain(s?.website)
          addDomain(s?.dealer_website)
        }
        for (const st of stRes.data || []) addDomain((st as { website?: string }).website)
        if (allowedDomains.size === 0) {
          return new Response(JSON.stringify({ success: false, error: 'no authorized dealership domain configured' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }
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

    const safety = allowedDomains
      ? await assertSafePublicUrl(formattedUrl, allowedDomains)
      : await assertSafeAdminUrl(formattedUrl)
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
        const res = await safeFetch(tryUrl, {
          signal: controller.signal,
          headers: browserHeaders,
        }, allowedDomains)
        clearTimeout(timeout)

        if (res.ok) {
          const text = (await res.text()).slice(0, MAX_HTML_BYTES)
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
