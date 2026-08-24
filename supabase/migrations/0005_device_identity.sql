-- Moves device authorization from an (ip_address, device_label) compound
-- key to a persistent device_id (a cookie planted per browser install by
-- middleware.ts — see lib/deviceId.ts). This is what makes "1 account =
-- unlimited devices, but every new device needs admin approval" actually
-- hold up: the old key broke authorization every time a phone's IP
-- changed (wifi -> mobile data), and could conflate two different
-- people's browsers on the same network. IP is now stored per-device as
-- history only (ip_history), never used to decide identity.
--
-- Also adds 'pending' and 'blocked' to user_devices.status. 'pending' is
-- what device_sightings used to represent — a device seen but not yet
-- decided — now folded directly into user_devices so there is exactly
-- one table and one row per (user, device) to look up, decide on, and
-- audit. device_sightings is left in place (unused by app code from this
-- migration on) rather than dropped, so no historical data is lost.
--
-- Run this once against any existing project. Safe to run multiple times.

alter table public.user_devices
  add column if not exists device_id uuid;

alter table public.user_devices
  add column if not exists ip_history jsonb not null default '[]'::jsonb;

alter table public.user_devices
  add column if not exists first_seen timestamptz not null default now();

alter table public.user_devices
  add column if not exists last_seen timestamptz not null default now();

-- Existing rows predate device_id and have no real cookie to match
-- against — backfill a synthetic one so the new unique constraint below
-- can apply uniformly. In practice these rows won't be matched by any
-- future request (the visitor's browser will plant its own device_id and
-- land a fresh 'pending' row), so admins should expect to re-approve
-- previously-authorized devices once after this migration. This is
-- called out because it's the one manual step this migration can't do
-- for you.
update public.user_devices
set device_id = gen_random_uuid()
where device_id is null;

update public.user_devices
set
  ip_history = jsonb_build_array(jsonb_build_object('ip', ip_address, 'at', created_at)),
  first_seen = created_at,
  last_seen = created_at
where ip_history = '[]'::jsonb;

alter table public.user_devices
  alter column device_id set not null;

-- Drop the old compound key, add the new device-identity key.
alter table public.user_devices
  drop constraint if exists user_devices_user_id_ip_address_device_label_key;

create unique index if not exists user_devices_user_device_key
  on public.user_devices (user_id, device_id);

-- 'restricted' (existing value) is what the admin panel now labels
-- "Rejected" — kept as-is rather than renamed to avoid rewriting every
-- existing row. 'blocked' is new: an admin's stronger "permanently deny
-- this device" action, shown in its own section, distinct from a
-- reject that's open to reconsideration.
alter table public.user_devices
  drop constraint if exists user_devices_status_check;

alter table public.user_devices
  add constraint user_devices_status_check
  check (status in ('pending', 'authorized', 'restricted', 'blocked'));

alter table public.user_devices
  alter column status set default 'pending';

create index if not exists idx_user_devices_device_id on public.user_devices (device_id);
create index if not exists idx_user_devices_last_seen on public.user_devices (user_id, last_seen desc);
