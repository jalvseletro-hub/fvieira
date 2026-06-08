-- Allow owners to delete their own company_settings
CREATE POLICY "Users delete own settings"
ON public.company_settings
FOR DELETE
USING (auth.uid() = user_id);

-- Lock down Realtime channel subscriptions: a user can only join a channel
-- whose topic equals their own auth.uid(). The app should subscribe to
-- `supabase.channel(user.id)` for per-user broadcasts; default postgres_changes
-- subscriptions are still gated by table RLS.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read own topic"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (select auth.uid()::text) = realtime.topic()
);

CREATE POLICY "Authenticated users write own topic"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (select auth.uid()::text) = realtime.topic()
);
