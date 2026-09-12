-- 0013 only allowed type in ('class', 'ebook', 'routine'). Device
-- sign-in requests (see notifyNewDeviceRequest in lib/webPush.ts) are
-- their own notification type — not board-scoped like the other
-- three, every admin gets these regardless of board access — so the
-- check constraint needs to allow it too.
alter table public.user_notifications drop constraint if exists user_notifications_type_check;
alter table public.user_notifications add constraint user_notifications_type_check
  check (type in ('class', 'ebook', 'routine', 'device_request'));
