-- Migrate existing fleet data from previous Google admin account to the new shared internal account
UPDATE public.vehicles SET user_id = 'b8ec2f80-4fb9-488c-8f2a-95dc6c5d4d27' WHERE user_id = 'ecc036c9-bad0-47a8-9f45-750a2511235e';
UPDATE public.month_records SET user_id = 'b8ec2f80-4fb9-488c-8f2a-95dc6c5d4d27' WHERE user_id = 'ecc036c9-bad0-47a8-9f45-750a2511235e';
-- Move company settings: delete any settings auto-created for the new account, then transfer the old admin's settings
DELETE FROM public.company_settings WHERE user_id = 'b8ec2f80-4fb9-488c-8f2a-95dc6c5d4d27';
UPDATE public.company_settings SET user_id = 'b8ec2f80-4fb9-488c-8f2a-95dc6c5d4d27' WHERE user_id = 'ecc036c9-bad0-47a8-9f45-750a2511235e';