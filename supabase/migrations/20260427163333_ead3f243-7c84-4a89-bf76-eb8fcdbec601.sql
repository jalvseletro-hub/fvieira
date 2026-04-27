-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email));
  insert into public.company_settings (user_id, name) values (new.id, 'F.VIEIRA');
  return new;
end; $$;

-- Vehicles
create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  plate text,
  photo_url text,
  pin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.vehicles enable row level security;
create policy "Users CRUD own vehicles select" on public.vehicles for select using (auth.uid() = user_id);
create policy "Users CRUD own vehicles insert" on public.vehicles for insert with check (auth.uid() = user_id);
create policy "Users CRUD own vehicles update" on public.vehicles for update using (auth.uid() = user_id);
create policy "Users CRUD own vehicles delete" on public.vehicles for delete using (auth.uid() = user_id);
create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();
create index vehicles_user_id_idx on public.vehicles(user_id);

-- Month records
create table public.month_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  month int not null check (month between 0 and 11),
  year int not null,
  services jsonb not null default '[]'::jsonb,
  costs jsonb not null default '{}'::jsonb,
  client jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id, year, month)
);
alter table public.month_records enable row level security;
create policy "Users select own records" on public.month_records for select using (auth.uid() = user_id);
create policy "Users insert own records" on public.month_records for insert with check (auth.uid() = user_id);
create policy "Users update own records" on public.month_records for update using (auth.uid() = user_id);
create policy "Users delete own records" on public.month_records for delete using (auth.uid() = user_id);
create trigger month_records_set_updated_at before update on public.month_records
  for each row execute function public.set_updated_at();
create index month_records_user_vehicle_idx on public.month_records(user_id, vehicle_id, year, month);

-- Company settings
create table public.company_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'F.VIEIRA',
  cnpj text,
  address text,
  phone text,
  email text,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.company_settings enable row level security;
create policy "Users select own settings" on public.company_settings for select using (auth.uid() = user_id);
create policy "Users insert own settings" on public.company_settings for insert with check (auth.uid() = user_id);
create policy "Users update own settings" on public.company_settings for update using (auth.uid() = user_id);
create trigger company_settings_set_updated_at before update on public.company_settings
  for each row execute function public.set_updated_at();

-- Trigger for new users (created last so it can reference company_settings)
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();