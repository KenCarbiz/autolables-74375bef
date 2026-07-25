-- Notify the sales manager when a K-208 is EXECUTED (signed AND result is not
-- 'fail') — INTAKE_SPEC S9. Fires from the inspection row itself so every sign
-- path is covered (QR RPC, desktop RLS write, Service Desk). Delivery uses
-- pg_net's async queue (net.http_post) to the notify-k208-executed edge
-- function with the same Vault-backed credentials the cron schedules use, and
-- the whole hand-off is exception-wrapped: a notification failure can never
-- block or roll back a signing.

CREATE OR REPLACE FUNCTION public.notify_on_k208_execution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_url text; v_key text; v_secret text; v_hdrs jsonb;
BEGIN
  IF NEW.status = 'signed'
     AND NEW.result IS DISTINCT FROM 'fail'
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM 'signed'
          OR OLD.result IS NOT DISTINCT FROM 'fail') THEN
    BEGIN
      SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
      SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
      SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'marketcheck_cron_secret' LIMIT 1;
      IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
        v_hdrs := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key);
        IF v_secret IS NOT NULL AND v_secret <> '' THEN
          v_hdrs := v_hdrs || jsonb_build_object('x-cron-secret', v_secret);
        END IF;
        PERFORM net.http_post(
          url := v_url || '/functions/v1/notify-k208-executed',
          headers := v_hdrs,
          body := jsonb_build_object('tenant_id', NEW.tenant_id, 'vin', NEW.vin, 'inspection_id', NEW.id),
          timeout_milliseconds := 15000
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_k208_execution ON public.safety_inspections;
CREATE TRIGGER trg_notify_on_k208_execution
  AFTER INSERT OR UPDATE OF status, result ON public.safety_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_k208_execution();
