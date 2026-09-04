-- Free Trial accounts. A 'paid' account (the existing default) follows the
-- exact flow that already exists, untouched. A 'trial' account gets a
-- duration (in minutes, set by the admin at creation time); the actual
-- countdown only starts at the account's first-ever login — see the
-- isFirstDeviceEver branch in lib/auth.ts — not at row-creation time, so
-- an admin can create the account today and the user's 15 minutes only
-- start ticking once they actually sign in.
alter table public.authorized_users
  add column if not exists account_type text not null default 'paid' check (account_type in ('paid', 'trial')),
  add column if not exists trial_duration_minutes integer,
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_expires_at timestamptz;
