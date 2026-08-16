-- THE 3D PRINTER — COMPTES CLIENTS ET COMMANDES
-- À exécuter UNE FOIS dans Supabase > SQL Editor.

create table if not exists public.orders (
  id uuid primary key,
  order_number text unique not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,

  status text not null default 'payment_pending'
    check (
      status in (
        'payment_pending',
        'payment_failed',
        'paid',
        'preparing',
        'ready',
        'shipped',
        'delivered',
        'cancelled'
      )
    ),

  payment_status text not null default 'unpaid'
    check (
      payment_status in (
        'unpaid',
        'paid',
        'failed',
        'no_payment_required'
      )
    ),

  amount_subtotal integer not null default 0 check (amount_subtotal >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  amount_total integer not null default 0 check (amount_total >= 0),
  currency text not null default 'eur',

  items jsonb not null default '[]'::jsonb,

  stripe_session_id text unique,
  stripe_payment_intent text,

  tracking_number text,
  tracking_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_user_id_created_at_idx
  on public.orders (user_id, created_at desc);

alter table public.orders enable row level security;

-- Le navigateur anonyme ne peut rien lire.
revoke all on table public.orders from anon;

-- Un client connecté peut seulement LIRE ses propres commandes.
revoke insert, update, delete on table public.orders from authenticated;
grant select on table public.orders to authenticated;

drop policy if exists "Clients lisent leurs commandes" on public.orders;

create policy "Clients lisent leurs commandes"
on public.orders
for select
to authenticated
using ((select auth.uid()) = user_id);
