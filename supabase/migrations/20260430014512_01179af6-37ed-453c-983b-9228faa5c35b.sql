ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.month_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.company_settings;
ALTER TABLE public.vehicles REPLICA IDENTITY FULL;
ALTER TABLE public.month_records REPLICA IDENTITY FULL;
ALTER TABLE public.company_settings REPLICA IDENTITY FULL;