-- RooftopOS staging step p1_11 (phase 1, after the kill-switch requests). Read-only.
-- Save the row as <out>/steps/p1_11_postcheck.json.
SELECT jsonb_build_object(
  'step', 'p1_11_postcheck',
  'generated_at', now(),
  'inbox_count', (SELECT count(*) FROM public.integration_inbox
                   WHERE tenant_id IN ('5ea90000-0000-4000-8000-00000000000a', '5ea90000-0000-4000-8000-00000000000b'))
) AS result;
