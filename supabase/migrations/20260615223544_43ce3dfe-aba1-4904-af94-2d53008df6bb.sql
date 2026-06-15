
CREATE OR REPLACE FUNCTION public.block_signed_addendum_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;
  IF (OLD.status = 'signed' OR OLD.customer_signed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Signed addendum is immutable (id %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_signed_addendum ON public.addendums;
CREATE TRIGGER trg_block_signed_addendum
BEFORE UPDATE ON public.addendums
FOR EACH ROW EXECUTE FUNCTION public.block_signed_addendum_update();
