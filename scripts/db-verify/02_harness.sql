-- Test harness. Each case runs its statements as one principal (an
-- authenticated user by id, anon, or service_role) inside a block that is
-- always rolled back, records the outcome, and optionally probes the state the
-- statements left behind before the rollback. Cases cannot affect each other.

CREATE SCHEMA t;

CREATE TABLE t.users (name text PRIMARY KEY, id uuid NOT NULL UNIQUE);

-- The stage names which schema state a case ran against: the hosted state,
-- or the hosted state plus a proposed migration.
CREATE TABLE t.config (stage text NOT NULL);
INSERT INTO t.config VALUES ('live');
CREATE FUNCTION t.stage() RETURNS text LANGUAGE sql STABLE AS $$ SELECT stage FROM t.config $$;

CREATE TABLE t.results (
  seq serial PRIMARY KEY,
  stage text NOT NULL DEFAULT t.stage(),
  area text NOT NULL,
  label text NOT NULL,
  principal text NOT NULL,
  expected text NOT NULL,
  actual text NOT NULL,
  probe_expected text,
  probe_actual text,
  message text,
  pass boolean NOT NULL
);

CREATE FUNCTION t.u(p_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM t.users WHERE name = p_name $$;

CREATE FUNCTION t.become(p_principal text) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_principal = 'anon' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SET LOCAL ROLE anon';
  ELSIF p_principal = 'service_role' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
    EXECUTE 'SET LOCAL ROLE service_role';
  ELSE
    IF t.u(p_principal) IS NULL THEN
      RAISE EXCEPTION 'unknown principal %', p_principal;
    END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', t.u(p_principal), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
  END IF;
END;
$$;

-- p_statements: one or more SQL statements separated by ';;' run in order as
-- the principal. p_expect: 'ok', 'ok rows=N' (row count of the last
-- statement), or 'error SQLSTATE'. p_probe: a query run as the superuser after
-- the statements and before the rollback, returning one text value compared
-- with p_probe_expect.
CREATE FUNCTION t.check(
  p_area text,
  p_label text,
  p_principal text,
  p_statements text,
  p_expect text,
  p_probe text DEFAULT NULL,
  p_probe_expect text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual text;
  v_msg text;
  v_state text;
  v_rows bigint := 0;
  v_probe text;
  v_stmt text;
  v_pass boolean;
BEGIN
  BEGIN
    BEGIN
      PERFORM t.become(p_principal);
      FOREACH v_stmt IN ARRAY string_to_array(p_statements, ';;') LOOP
        IF btrim(v_stmt) <> '' THEN
          EXECUTE v_stmt;
          GET DIAGNOSTICS v_rows = ROW_COUNT;
        END IF;
      END LOOP;
      v_actual := 'ok rows=' || v_rows;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      v_actual := 'error ' || v_state;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    IF p_probe IS NOT NULL THEN
      EXECUTE p_probe INTO v_probe;
    END IF;
    RAISE EXCEPTION 't_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 't_rollback' THEN
      RAISE;
    END IF;
  END;
  v_pass := CASE
    WHEN p_expect = 'ok' THEN v_actual LIKE 'ok%'
    ELSE v_actual = p_expect
  END AND (p_probe_expect IS NULL OR v_probe IS NOT DISTINCT FROM p_probe_expect);
  INSERT INTO t.results (area, label, principal, expected, actual, probe_expected, probe_actual, message, pass)
  VALUES (p_area, p_label, p_principal, p_expect, v_actual, p_probe_expect, v_probe, v_msg, v_pass);
END;
$$;

-- Runs one query as the principal and compares its single text value with
-- p_expect. An error is recorded as 'error SQLSTATE' with its message, so a
-- broken function shows up as a failed case rather than stopping the run.
CREATE FUNCTION t.expect(
  p_area text,
  p_label text,
  p_principal text,
  p_query text,
  p_expect text
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_actual text;
  v_msg text;
BEGIN
  BEGIN
    BEGIN
      PERFORM t.become(p_principal);
      EXECUTE p_query INTO v_actual;
    EXCEPTION WHEN OTHERS THEN
      v_actual := 'error ' || SQLSTATE;
      v_msg := SQLERRM;
    END;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 't_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 't_rollback' THEN
      RAISE;
    END IF;
  END;
  INSERT INTO t.results (area, label, principal, expected, actual, message, pass)
  VALUES (p_area, p_label, p_principal, p_expect, coalesce(v_actual, 'null'), v_msg, v_actual IS NOT DISTINCT FROM p_expect);
END;
$$;

CREATE FUNCTION t.summary() RETURNS TABLE (stage text, area text, cases bigint, passed bigint, failed bigint)
LANGUAGE sql AS $$
  SELECT stage, area, count(*), count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass)
  FROM t.results GROUP BY stage, area ORDER BY min(seq)
$$;

-- A case may switch principal partway with `SELECT t.become('name')`, and run
-- setup as the superuser after `RESET ROLE` (the session user is a superuser,
-- so both are allowed from any role). Used where one person acts and another
-- then relies on the result, all inside the same rolled-back case.
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;
GRANT SELECT ON t.users TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION t.become(text), t.u(text) TO anon, authenticated, service_role;
