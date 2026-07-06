
-- Quotes (orçamentos)
CREATE TABLE public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_number INTEGER NOT NULL,
  quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  customer_name TEXT,
  customer_phone TEXT,
  customer_address TEXT,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','aprovado','cancelado')),
  total_value NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  converted_sale_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, quote_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO authenticated;
GRANT ALL ON public.quotes TO service_role;

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quotes_select_own" ON public.quotes FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "quotes_insert_own" ON public.quotes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "quotes_update_own" ON public.quotes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "quotes_delete_own" ON public.quotes FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER quotes_set_updated_at BEFORE UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Quote items
CREATE TABLE public.quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_items TO authenticated;
GRANT ALL ON public.quote_items TO service_role;

ALTER TABLE public.quote_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quote_items_all_own" ON public.quote_items FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX quote_items_quote_id_idx ON public.quote_items(quote_id);

-- Auto-numeração de orçamentos por usuário
CREATE OR REPLACE FUNCTION public.assign_quote_number()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.quote_number IS NULL OR NEW.quote_number = 0 THEN
    SELECT COALESCE(MAX(quote_number), 0) + 1 INTO NEW.quote_number
      FROM public.quotes WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quotes_assign_number BEFORE INSERT ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.assign_quote_number();
