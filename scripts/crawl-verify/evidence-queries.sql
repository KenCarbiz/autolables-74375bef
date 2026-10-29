-- Read-only queries that rebuild the restricted per-vehicle record of one
-- crawl window: what was written, which render produced the price, which
-- render produced the screenshot and whether the screenshot object exists.
-- Holds no hosted data; run with the tenant and window as variables and keep
-- the output outside the repository.
--
--   psql -v tenant="'<uuid>'" -v from="'2026-10-29 07:15'" -v to="'2026-10-29 07:35'" -f evidence-queries.sql

-- 1. Observations, with the listing fields the crawl wrote.
SELECT p.vin, p.captured_at, p.advertised_price, p.source_url, p.captured_method,
       p.screenshot_url IS NOT NULL AS has_screenshot, p.screenshot_sha256, p.notes,
       v.condition, v.price AS feed_price, v.advertised_price_before_doc, v.doc_fee, v.website_sale_price,
       v.website_price_term, v.price_parse_status, v.price_parse_notes, v.mc_raw->>'msrp' AS feed_msrp
FROM public.advertised_prices p
JOIN public.vehicle_listings v ON v.tenant_id = p.tenant_id AND v.vin = p.vin
WHERE p.tenant_id = :tenant AND p.captured_at BETWEEN :from AND :to
ORDER BY p.captured_at;

-- 2. The render that produced each price (formats, page verdict, title).
SELECT c.vin, c.outcome, c.http_status, c.render_status, c.last_attempt_at, c.detail
FROM public.advertised_price_crawl_attempts c
WHERE c.tenant_id = :tenant AND c.last_attempt_at BETWEEN :from AND :to
ORDER BY c.last_attempt_at;

-- 3. Second-stage evidence renders and skips, as the run logged them.
SELECT a.created_at, a.action, a.entity_id AS vin, a.details->>'trigger' AS trigger,
       a.details->>'render_status' AS render_status, a.details->>'gave_up' AS gave_up,
       a.details->>'screenshot_path' AS screenshot_path, a.details->>'reason' AS reason
FROM public.audit_log a
WHERE a.store_id = :tenant::text AND a.created_at BETWEEN :from AND :to AND a.action LIKE 'advertised_price%'
ORDER BY a.created_at;

-- 4. The screenshot objects themselves (metadata only).
SELECT split_part(name, '/', 2) AS vin, name, created_at, (metadata->>'size')::bigint AS bytes, metadata->>'mimetype' AS mime
FROM storage.objects
WHERE bucket_id = 'price-evidence' AND name LIKE :tenant || '/%' AND created_at BETWEEN :from AND :to
ORDER BY created_at;
