-- ---------------------------------------------------------------------------
-- 0017 — Auto/manual temporary account blocking.
--
-- Adds the enforcement half of the Security Incident system
-- (0015_security_incidents.sql already recorded incidents for human
-- review, but nothing actually gated access on them). This migration adds:
--
--   auto_block_on_incident — per-account switch (default true) an admin
--     can flip off from the user detail page. When true, the account is
--     temp-blocked the moment app/api/security/incident/route.ts records
--     a DEVTOOLS_DETECTED/SUSPICIOUS_SECURITY_EVENT for it.
--
--   blocked_until — when set and in the future, lib/auth.ts's getAuth()
--     returns TEMP_BLOCKED instead of AUTHORIZED, regardless of `status`.
--     Set either automatically (above) or manually by an admin via
--     app/api/admin/users/[id]/block/route.ts, which is also what an
--     admin uses to unblock early (sets this back to null).
--
--   block_reason — short human-readable reason shown on the lock screen /
--     login page ("Developer Tools detected", "Blocked by admin", etc).
--
-- Deliberately NOT a third value on the existing `status` column: status
-- ACTIVE/DISABLED is a permanent admin decision, whereas a temp block is
-- expected to expire on its own (blocked_until in the past behaves
-- exactly like no block at all — see getAuth()), and keeping it separate
-- means a temp block never has to be "remembered" and manually undone by
-- toggling status back to ACTIVE.
-- ---------------------------------------------------------------------------

alter table public.authorized_users
  add column if not exists auto_block_on_incident boolean not null default true,
  add column if not exists blocked_until timestamptz,
  add column if not exists block_reason text;

create index if not exists idx_authorized_users_blocked_until
  on public.authorized_users (blocked_until)
  where blocked_until is not null;
