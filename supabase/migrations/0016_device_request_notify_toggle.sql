-- Per-account control over whether a NEW device sign-in request for
-- THAT account pages every admin (see notifyNewDeviceRequest in
-- lib/webPush.ts). Defaults true for everyone so existing behavior is
-- unchanged for regular users; new ADMIN accounts get false at creation
-- time (see app/api/admin/users/route.ts) — admins bypass device
-- restriction entirely already (isRestricted in lib/auth.ts is always
-- false for role='ADMIN'), so their own 2nd+ device just silently
-- works, and there is no real approval decision for anyone to make —
-- only noise every other admin used to get paged for regardless.
alter table public.authorized_users
  add column if not exists notify_on_device_request boolean not null default true;

-- Existing admin accounts, created before this column existed, should
-- start OFF too — same reasoning as the create-time default above, just
-- applied retroactively so this migration itself fixes the noise for
-- accounts that already exist, not only ones created after it runs.
update public.authorized_users set notify_on_device_request = false where role = 'ADMIN';
