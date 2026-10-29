-- Read-only. One row: totals per stage and area, and every failed case.
SELECT jsonb_build_object(
  'summary', (SELECT jsonb_agg(to_jsonb(s)) FROM t.summary() s),
  'cases', (SELECT count(*) FROM t.results),
  'failed', (SELECT count(*) FROM t.results WHERE NOT pass),
  'failures', (SELECT coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'area', area, 'label', label, 'principal', principal,
                 'expected', expected, 'actual', actual, 'probe_expected', probe_expected, 'probe_actual', probe_actual, 'message', left(message, 160)) ORDER BY seq), '[]')
               FROM t.results WHERE NOT pass)) AS result;
