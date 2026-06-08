CREATE TABLE public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sale_date date NOT NULL,
  total_value numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own sales" ON public.sales FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own sales" ON public.sales FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own sales" ON public.sales FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own sales" ON public.sales FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_sales_user_date ON public.sales(user_id, sale_date DESC);

CREATE TRIGGER set_sales_updated_at BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();