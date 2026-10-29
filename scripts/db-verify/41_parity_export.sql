-- The same case grid through the SQL contract, exported for
-- src/lib/admin/pricing/feeBasisParity.test.ts, which runs it through the
-- TypeScript contract and requires identical answers. Read-only.
\pset tuples_only on
\pset format unaligned
WITH settings(n, s) AS (VALUES
  (1, '{"advertised_includes_doc_fee": true}'::jsonb), (2, '{"advertised_includes_doc_fee": "false"}'), (3, '{"advertised_includes_doc_fee": " TRUE "}'),
  (4, '{"advertised_excludes_doc_fee": false}'), (5, '{"advertised_excludes_doc_fee": "true"}'), (6, '{"price_display_mode": "website_sale_price"}'),
  (7, '{}'), (8, '{"advertised_includes_doc_fee": true, "advertised_excludes_doc_fee": true}'), (9, '{"advertised_includes_doc_fee": false, "advertised_excludes_doc_fee": false}'),
  (10, '{"advertised_includes_doc_fee": "yes"}'), (11, '{"advertised_includes_doc_fee": 1}'), (12, '{"advertised_includes_doc_fee": null, "advertised_excludes_doc_fee": true}'),
  (13, '{"advertised_includes_doc_fee": true, "advertised_excludes_doc_fee": "maybe"}'), (14, 'null'), (15, '[]')
), rows(n, price, adv, wsp, fee) AS (VALUES
  (1, 40420::numeric, 39525::numeric, 40420::numeric, 895::numeric), (2, 39525, 39525, 40420, 895), (3, 30000, 29105, 30500, 895),
  (4, 20000, 20000, 20000, 895), (5, 900, 5, 900, 895), (6, NULL, NULL, NULL, NULL), (7, 40420, NULL, NULL, NULL),
  (8, 26876, 24481, 25376, 895), (9, 57740, 55950, 56845, 895), (10, 171, 171, 1066, 895), (11, 0.1, 0.1, NULL, NULL), (12, 25000, 24105, 25000, 925)
), fees(f) AS (VALUES (0::numeric), (895), (925), (925.555), (925.554), (50000))
SELECT jsonb_pretty(jsonb_build_object(
  'basis', (SELECT jsonb_agg(jsonb_build_object('settings', s.s, 'basis', b.basis, 'source', b.basis_source) ORDER BY s.n) FROM settings s, LATERAL public.doc_fee_basis(s.s) b),
  'plans', (SELECT jsonb_agg(jsonb_build_object('basis', bs, 'row', jsonb_build_object('price', r.price, 'adv', r.adv, 'wsp', r.wsp, 'fee', r.fee), 'new_fee', f.f,
              'status', p.status, 'selling_before', p.selling_before, 'selling_after', p.selling_after, 'total_before', p.total_before, 'total_after', p.total_after,
              'adv_after', p.advertised_before_doc_after, 'wsp_after', p.website_sale_price_after, 'sale_price_differs', p.sale_price_differs) ORDER BY bs, r.n, f.f)
            FROM unnest(ARRAY['includes_fee', 'before_fee', 'unconfigured', 'conflict']) bs, rows r, fees f,
                 LATERAL public.doc_fee_row_plan(bs, r.price, r.adv, r.wsp, r.fee, f.f) p),
  'evidence', (SELECT jsonb_agg(jsonb_build_object('basis', bs, 'price', e.price, 'fee', e.fee, 'observed', e.obs,
                 'contradicts', public.doc_fee_evidence_contradicts(bs, e.price, e.fee, e.obs)) ORDER BY bs, e.n)
               FROM unnest(ARRAY['includes_fee', 'before_fee']) bs,
                    (VALUES (1, 40420::numeric, 895::numeric, 40420::numeric), (2, 40420, 895, 39525), (3, 40420, 895, 41315), (4, 40420, 895, 38000),
                            (5, 39525, 895, 38630), (6, 39525, 895, 40420), (7, 40420, 0, 39525), (8, 40420, 895, NULL), (9, 40420, 895, 39525.5)) e(n, price, fee, obs))));
