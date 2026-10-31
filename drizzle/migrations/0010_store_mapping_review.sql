-- ── Server-checked store mapping review (owner handoff 2026-10-31) ────────
--
-- A DealerId -> store proposal now takes its evidence from a stored partition
-- dry run, never from the browser. The server compares the observed CSV
-- identity with the store's own identity field by field:
--   match        street, city, state, ZIP and name all agree (after
--                documented normalisation)
--   name_review  address agrees, the name differs (display/legal alias):
--                approvable only with an explicit acknowledgement
--   incomplete   a field is missing on either side: not approvable
--   mismatch     street, city, state or ZIP disagree: never approvable
-- Approval re-checks, atomically, that the store identity, the file version
-- and the dry run are the ones that were reviewed.

CREATE OR REPLACE FUNCTION public.inv_norm_text(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(trim(regexp_replace(regexp_replace(lower(COALESCE(t, '')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

-- Documented street aliases only; each token is replaced whole.
CREATE OR REPLACE FUNCTION public.inv_norm_street(t text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE w text; out text[] := '{}'; m jsonb := '{"st":"street","rd":"road","ave":"avenue","av":"avenue","tpke":"turnpike","tpk":"turnpike","blvd":"boulevard","dr":"drive","hwy":"highway","ln":"lane","ct":"court","pkwy":"parkway","s":"south","n":"north","e":"east","w":"west"}';
BEGIN
  IF inv_norm_text(t) IS NULL THEN RETURN NULL; END IF;
  FOREACH w IN ARRAY string_to_array(inv_norm_text(t), ' ') LOOP
    out := out || COALESCE(m->>w, w);
  END LOOP;
  RETURN array_to_string(out, ' ');
END $$;

CREATE OR REPLACE FUNCTION public.inv_identity_compare(p_observed jsonb, p_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.dealer_stores%ROWTYPE; f jsonb := '{}'::jsonb; v_verdict text;
  o_name text := p_observed->>'dealerName'; o_street text := p_observed->>'address'; o_city text := p_observed->>'city';
  o_zip text := substring(COALESCE(p_observed->>'postal', '') FROM '^\s*([0-9]{5})'); o_state text := upper(trim(COALESCE(p_observed->>'region', '')));
  cmp text;
BEGIN
  SELECT * INTO s FROM dealer_stores WHERE id = p_store_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('verdict', 'incomplete', 'fields', '{}'::jsonb, 'reason', 'store_not_found'); END IF;
  f := f || jsonb_build_object('street', CASE WHEN inv_norm_street(o_street) IS NULL OR inv_norm_street(s.street) IS NULL THEN 'unknown'
                                              WHEN inv_norm_street(o_street) = inv_norm_street(s.street) THEN 'match' ELSE 'mismatch' END);
  f := f || jsonb_build_object('city', CASE WHEN inv_norm_text(o_city) IS NULL OR inv_norm_text(s.city) IS NULL THEN 'unknown'
                                            WHEN inv_norm_text(o_city) = inv_norm_text(s.city) THEN 'match' ELSE 'mismatch' END);
  f := f || jsonb_build_object('state', CASE WHEN o_state = '' OR s.state IS NULL THEN 'unknown' WHEN o_state = s.state THEN 'match' ELSE 'mismatch' END);
  f := f || jsonb_build_object('zip', CASE WHEN o_zip IS NULL OR s.zip IS NULL THEN 'unknown' WHEN o_zip = left(s.zip, 5) THEN 'match' ELSE 'mismatch' END);
  f := f || jsonb_build_object('name', CASE WHEN inv_norm_text(o_name) IS NULL THEN 'unknown'
                                            WHEN inv_norm_text(o_name) IN (inv_norm_text(s.display_name), inv_norm_text(s.legal_name)) THEN 'match' ELSE 'differs' END);
  v_verdict := CASE
    WHEN EXISTS (SELECT 1 FROM jsonb_each_text(f) WHERE key <> 'name' AND value = 'mismatch') THEN 'mismatch'
    WHEN EXISTS (SELECT 1 FROM jsonb_each_text(f) WHERE value = 'unknown') THEN 'incomplete'
    WHEN f->>'name' = 'differs' THEN 'name_review'
    ELSE 'match' END;
  RETURN jsonb_build_object('verdict', v_verdict, 'fields', f,
    'observed', jsonb_build_object('name', o_name, 'street', o_street, 'city', o_city, 'state', NULLIF(o_state, ''), 'zip', p_observed->>'postal'),
    'store', jsonb_build_object('name', s.display_name, 'legal_name', s.legal_name, 'street', s.street, 'city', s.city, 'state', s.state, 'zip', s.zip),
    'store_updated_at', s.updated_at);
END $$;

-- The reviewed partition of a stored dry run, or an exception naming why it
-- cannot be used.
CREATE OR REPLACE FUNCTION public.inv_dry_run_partition(p_run_id uuid, p_source_dealer_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.inventory_feed_runs%ROWTYPE; p jsonb;
BEGIN
  SELECT * INTO r FROM inventory_feed_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'dry_run_not_found'; END IF;
  IF r.kind <> 'dry_run' OR COALESCE(r.report->>'kind', '') <> 'partition_dry_run' THEN RAISE EXCEPTION 'not_a_partition_dry_run'; END IF;
  IF r.status <> 'passed' THEN RAISE EXCEPTION 'dry_run_not_passed'; END IF;
  IF r.path ~* 'webhooktest' THEN RAISE EXCEPTION 'test_file_cannot_be_mapped'; END IF;
  SELECT x INTO p FROM jsonb_array_elements(r.report->'partitions') x WHERE x->>'sourceDealerId' = p_source_dealer_id;
  IF p IS NULL THEN RAISE EXCEPTION 'dealer_not_in_dry_run'; END IF;
  IF COALESCE((p->>'identityVariants')::int, 1) > 1 THEN RAISE EXCEPTION 'partition_identity_inconsistent'; END IF;
  RETURN jsonb_build_object('partition', p, 'run_id', r.id, 'path', r.path, 'content_sha256', r.content_sha256, 'remote_mtime', r.remote_mtime, 'finished_at', r.finished_at);
END $$;

-- Read-only preview for the review drawer: what the server would record.
CREATE OR REPLACE FUNCTION public.inv_admin_preview_mapping(p_source_dealer_id text, p_store_id uuid, p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d jsonb;
BEGIN
  PERFORM inv_require_platform_admin();
  d := inv_dry_run_partition(p_run_id, p_source_dealer_id);
  RETURN d || jsonb_build_object('comparison', inv_identity_compare(d->'partition'->'identity', p_store_id));
END $$;

-- Same signature as 0006, so existing callers keep working; p_observed_identity
-- and any verdict in p_evidence are ignored. p_evidence must name run_id.
CREATE OR REPLACE FUNCTION public.inv_admin_propose_mapping(p_source_dealer_id text, p_store_id uuid, p_observed_identity jsonb, p_evidence jsonb, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); v_id uuid; v_group uuid; v_tenant uuid; d jsonb; c jsonb; v_binding_tenant uuid;
BEGIN
  SELECT group_id, tenant_id INTO v_group, v_tenant FROM dealer_stores WHERE id = p_store_id;
  IF v_group IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF NULLIF(p_evidence->>'run_id', '') IS NULL THEN RAISE EXCEPTION 'dry_run_required'; END IF;
  d := inv_dry_run_partition((p_evidence->>'run_id')::uuid, p_source_dealer_id);
  -- The file must be admitted to this store's group, if it is admitted at all.
  SELECT tenant_id INTO v_binding_tenant FROM inventory_feed_bindings WHERE path = d->>'path' AND status = 'approved' ORDER BY approved_at DESC NULLS LAST LIMIT 1;
  IF v_binding_tenant IS NOT NULL AND v_binding_tenant <> v_tenant THEN RAISE EXCEPTION 'file_admitted_to_another_group'; END IF;
  c := inv_identity_compare(d->'partition'->'identity', p_store_id);
  IF EXISTS (SELECT 1 FROM inventory_source_mappings WHERE provider = 'vauto' AND source_dealer_id = p_source_dealer_id AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION 'mapping_already_open';
  END IF;
  INSERT INTO inventory_source_mappings (source_dealer_id, group_id, store_id, observed_identity, evidence, note, proposed_by)
  VALUES (p_source_dealer_id, v_group, p_store_id, d->'partition'->'identity',
    jsonb_build_object('verdict', c->>'verdict', 'comparison', c, 'run_id', d->>'run_id', 'path', d->>'path', 'content_sha256', d->>'content_sha256',
      'remote_mtime', d->>'remote_mtime', 'store_updated_at', c->>'store_updated_at', 'counts', d->'partition'->'counts', 'computed_by', 'server'),
    left(p_note, 300), v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.inv_admin_decide_mapping(p_mapping_id uuid, p_decision text, p_acknowledge_identity boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := inv_require_platform_admin(); m public.inventory_source_mappings%ROWTYPE; c jsonb; v_verdict text; v_file record;
BEGIN
  SELECT * INTO m FROM inventory_source_mappings WHERE id = p_mapping_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mapping_not_found'; END IF;
  IF p_decision = 'approve' THEN
    IF m.status <> 'pending' THEN RAISE EXCEPTION 'mapping_not_pending'; END IF;
    IF COALESCE(m.evidence->>'computed_by', '') <> 'server' THEN RAISE EXCEPTION 'proposal_predates_server_review'; END IF;
    PERFORM 1 FROM dealer_stores WHERE id = m.store_id FOR SHARE;
    -- Re-run the comparison now; the store may have been edited since.
    c := inv_identity_compare(m.observed_identity, m.store_id);
    IF (c->>'store_updated_at') IS DISTINCT FROM (m.evidence->>'store_updated_at') THEN RAISE EXCEPTION 'store_identity_changed_since_review'; END IF;
    v_verdict := c->>'verdict';
    IF v_verdict = 'mismatch' THEN RAISE EXCEPTION 'identity_mismatch'; END IF;
    IF v_verdict = 'incomplete' THEN RAISE EXCEPTION 'identity_incomplete'; END IF;
    IF v_verdict = 'name_review' AND NOT p_acknowledge_identity THEN RAISE EXCEPTION 'identity_not_confirmed'; END IF;
    -- The file must still be the version that was reviewed.
    SELECT last_content_sha256, remote_mtime INTO v_file FROM inventory_feed_files WHERE path = m.evidence->>'path';
    IF v_file.last_content_sha256 IS DISTINCT FROM (m.evidence->>'content_sha256') THEN RAISE EXCEPTION 'file_changed_since_review'; END IF;
    UPDATE inventory_source_mappings SET status = 'approved', approved_by = v_uid, approved_at = now(),
      identity_acknowledged = v_verdict = 'name_review', note = COALESCE(left(p_note, 300), note),
      evidence = evidence || jsonb_build_object('approved_comparison', c) WHERE id = m.id;
  ELSIF p_decision = 'reject' THEN
    IF m.status <> 'pending' THEN RAISE EXCEPTION 'mapping_not_pending'; END IF;
    UPDATE inventory_source_mappings SET status = 'rejected', revoked_by = v_uid, revoked_at = now(), note = COALESCE(left(p_note, 300), note) WHERE id = m.id;
  ELSIF p_decision = 'revoke' THEN
    IF m.status <> 'approved' THEN RAISE EXCEPTION 'mapping_not_approved'; END IF;
    UPDATE inventory_source_mappings SET status = 'revoked', revoked_by = v_uid, revoked_at = now(), note = COALESCE(left(p_note, 300), note) WHERE id = m.id;
    -- Later files for this DealerId quarantine again; vehicles stay with their store.
  ELSE
    RAISE EXCEPTION 'bad_decision';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.inv_identity_compare(jsonb, uuid), public.inv_dry_run_partition(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inv_identity_compare(jsonb, uuid), public.inv_dry_run_partition(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.inv_admin_preview_mapping(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inv_admin_preview_mapping(text, uuid, uuid) TO authenticated;
