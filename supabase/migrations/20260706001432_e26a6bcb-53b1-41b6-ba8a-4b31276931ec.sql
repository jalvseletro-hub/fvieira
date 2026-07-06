
CREATE OR REPLACE FUNCTION public.assign_quote_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = 0 THEN
    SELECT COALESCE(MAX(quote_number), 0) + 1 INTO NEW.quote_number
      FROM public.quotes WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_quote_number() FROM PUBLIC, anon, authenticated;
