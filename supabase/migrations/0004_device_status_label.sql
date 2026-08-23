-- Adds status ('authorized' | 'restricted') and an admin-given label to
-- user_devices, splitting the admin device panel into three sections:
-- Authorized IP's, Unauthorized IP request (pending sightings with no
-- row here yet), and Restricted IP's.
--
-- Run this once against any existing project. Safe to run multiple times.

alter table public.user_devices
  add column if not exists status text not null default 'authorized'
  check (status in ('authorized', 'restricted'));

alter table public.user_devices
  add column if not exists label text;

create index if not exists idx_user_devices_user_status on public.user_devices (user_id, status);
