CREATE TABLE public.inventory_feed_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'filescom' CHECK (provider = 'filescom'),
  path text NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','disabled')),
  identity_acknowledged jsonb,
  note text,
  proposed_by uuid, proposed_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  disabled_by uuid, disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, path),
  CHECK (status <> 'approved' OR tenant_id IS NOT NULL)
);

CREATE TABLE public.inventory_feed_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'filescom' CHECK (provider = 'filescom'),
  path text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','quarantined','validating','validated','rejected','failed')),
  quarantine_reason text,
  latest_action text,
  latest_event_at timestamptz,
  latest_event_size bigint,
  latest_notified_at timestamptz,
  remote_mtime timestamptz,
  remote_size bigint,
  remote_checksum text,
  discovered_at timestamptz,
  last_content_sha256 text,
  last_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, path)
);

CREATE TABLE public.inventory_feed_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'filescom' CHECK (provider = 'filescom'),
  digest text NOT NULL UNIQUE CHECK (digest ~ '^[0-9a-f]{64}$'),
  action text NOT NULL,
  path text NOT NULL,
  destination text,
  event_at timestamptz,
  size bigint,
  file_id uuid REFERENCES public.inventory_feed_files(id) ON DELETE SET NULL,
  applied_as_latest boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_feed_events_path_idx ON public.inventory_feed_events (path, received_at DESC);

CREATE TABLE public.inventory_feed_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'filescom' CHECK (provider = 'filescom'),
  kind text NOT NULL DEFAULT 'dry_run' CHECK (kind = 'dry_run'),
  file_id uuid REFERENCES public.inventory_feed_files(id) ON DELETE SET NULL,
  path text NOT NULL,
  binding_id uuid REFERENCES public.inventory_feed_bindings(id) ON DELETE SET NULL,
  binding_status text,
  tenant_id uuid,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','passed','rejected','failed')),
  failure_reason text,
  triggered_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  content_sha256 text,
  remote_mtime timestamptz,
  remote_size bigint,
  report jsonb
);
CREATE INDEX inventory_feed_runs_path_idx ON public.inventory_feed_runs (path, started_at DESC);

GRANT SELECT ON public.inventory_feed_bindings, public.inventory_feed_files, public.inventory_feed_events, public.inventory_feed_runs TO authenticated;
GRANT ALL ON public.inventory_feed_bindings, public.inventory_feed_files, public.inventory_feed_events, public.inventory_feed_runs TO service_role;

ALTER TABLE public.inventory_feed_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_feed_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_feed_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_feed_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read feed bindings" ON public.inventory_feed_bindings FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read feed files" ON public.inventory_feed_files FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read feed events" ON public.inventory_feed_events FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));
CREATE POLICY "Platform admins read feed runs" ON public.inventory_feed_runs FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.filescom_record_event(
  p_digest text, p_action text, p_path text, p_destination text, p_event_at timestamptz, p_size bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event_id uuid;
  v_binding record;
  v_status text;
  v_reason text;
  v_file record;
  v_latest boolean;
BEGIN
  INSERT INTO inventory_feed_events (digest, action, path, destination, event_at, size)
  VALUES (p_digest, p_action, p_path, p_destination, p_event_at, p_size)
  ON CONFLICT (digest) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  SELECT status INTO v_binding FROM inventory_feed_bindings WHERE provider = 'filescom' AND path = p_path;
  IF NOT FOUND THEN v_status := 'quarantined'; v_reason := 'unmapped';
  ELSIF v_binding.status = 'approved' THEN v_status := 'pending'; v_reason := NULL;
  ELSE v_status := 'quarantined'; v_reason := 'binding_' || v_binding.status;
  END IF;

  INSERT INTO inventory_feed_files (path, status, quarantine_reason, latest_action, latest_event_at, latest_event_size, latest_notified_at)
  VALUES (p_path, v_status, v_reason, p_action, p_event_at, p_size, now())
  ON CONFLICT (provider, path) DO NOTHING;

  SELECT * INTO v_file FROM inventory_feed_files WHERE provider = 'filescom' AND path = p_path FOR UPDATE;
  v_latest := v_file.latest_event_at IS NULL OR p_event_at IS NULL OR p_event_at >= v_file.latest_event_at;

  UPDATE inventory_feed_files SET
    latest_action = CASE WHEN v_latest THEN p_action ELSE latest_action END,
    latest_event_at = CASE WHEN v_latest THEN COALESCE(p_event_at, latest_event_at) ELSE latest_event_at END,
    latest_event_size = CASE WHEN v_latest THEN p_size ELSE latest_event_size END,
    latest_notified_at = now(),
    status = CASE WHEN status = 'validating' THEN status ELSE v_status END,
    quarantine_reason = CASE WHEN status = 'validating' THEN quarantine_reason ELSE v_reason END,
    updated_at = now()
  WHERE id = v_file.id;

  UPDATE inventory_feed_events SET file_id = v_file.id, applied_as_latest = v_latest WHERE id = v_event_id;
  RETURN jsonb_build_object('duplicate', false, 'status', v_status, 'latest', v_latest);
END $$;

REVOKE ALL ON FUNCTION public.filescom_record_event(text, text, text, text, timestamptz, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.filescom_record_event(text, text, text, text, timestamptz, bigint) TO service_role;