-- Security Incident Lock & Review Screen — extends the existing
-- audit_logs table rather than creating a parallel one. New event types
-- 'DEVTOOLS_DETECTED' / 'SUSPICIOUS_SECURITY_EVENT' need no schema
-- change (event_type is already a plain text column, not an enum), but
-- an admin reviewing an incident needs to record a DECISION against it
-- (Pending -> Reviewed / False Positive / Confirmed Abuse / Action
-- Taken) — something the rest of audit_logs never needed, since it was
-- purely an append-only trail until now. These three columns are
-- nullable and stay null for every existing/other event type; only
-- security-incident rows ever populate them.
alter table public.audit_logs add column if not exists review_status text
  check (review_status is null or review_status in ('pending', 'reviewed', 'false_positive', 'confirmed_abuse', 'action_taken'));
alter table public.audit_logs add column if not exists reviewed_by text;
alter table public.audit_logs add column if not exists reviewed_at timestamptz;

-- Fast "this user's Nth security incident" count (used to compute the
-- attempt number shown on the lock screen) and fast "admin's pending
-- queue" listing.
create index if not exists idx_audit_logs_security_target
  on public.audit_logs (target, event_type, created_at desc)
  where event_type in ('DEVTOOLS_DETECTED', 'SUSPICIOUS_SECURITY_EVENT');

create index if not exists idx_audit_logs_security_review
  on public.audit_logs (review_status, created_at desc)
  where event_type in ('DEVTOOLS_DETECTED', 'SUSPICIOUS_SECURITY_EVENT');
