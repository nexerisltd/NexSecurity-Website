# NexSecurity

A private learning platform. Nothing is visible to anyone who isn't on the
server-side allowlist — not a page, not an API response, not a video URL.

Stack: **Next.js 14 (App Router) + TypeScript, Supabase (Postgres + Auth +
Storage), deployed on Vercel.**

Why this stack for this brief: Supabase gives us Google OAuth, session
management, and — critically — **Postgres Row-Level Security**, so
authorization is enforced by the database itself, not just by application
code that a future bug could bypass. Next.js Server Components and Route
Handlers mean every protected read happens on the server, where the
service-role key and RLS-scoped queries live; the browser never holds
anything that decides access.

---

## 1. Setup

### 1.1 Supabase

1. Open your project → **SQL Editor** → paste and run `supabase/schema.sql`.
2. **Authentication → Providers → Google**: paste your Google Client ID and
   Client Secret **here**, in the Supabase dashboard — not in this repo's
   env vars. Supabase handles the OAuth exchange.
3. **Authentication → URL Configuration**: set the Site URL to
   `https://nexsecurity.vercel.app` and add
   `https://nexsecurity.vercel.app/auth/callback` (and your local dev URL,
   e.g. `http://localhost:3000/auth/callback`) to Redirect URLs.
4. **Storage — `thumbnails` bucket** (used by the admin panel's upload
   button for board/class thumbnails): create a bucket named
   `thumbnails` and toggle **Public bucket** on when creating it. This is
   deliberately public — thumbnails are preview images, not protected
   content.
5. Add yourself as the first admin:
   ```sql
   insert into public.authorized_users (email, role, status)
   values ('you@example.com', 'ADMIN', 'ACTIVE');
   ```

### 1.2 Bunny Stream (video/"class" playback)

Classes are added in `/admin/videos` by pasting a Bunny embed URL like
`https://iframe.mediadelivery.net/embed/503487/df2a65b4-…`. No extra Bunny
dashboard configuration is required — the app plays the embed directly.

**What this does and doesn't protect:** the video page itself is fully
gated by the app's normal login/authorization check — an unauthenticated
or non-allowlisted user can never reach `/learn/video/:id` or get a
playback URL from the API at all. What it does *not* do is stop an
already-authorized member from copying the embed URL out of DevTools and
sharing it — that copied link would keep working indefinitely, since
there's no expiry or domain restriction on it. If that matters later,
Bunny's Token Authentication + Allowed Referrers (in Stream Library →
Security) can be added back to `app/api/video/[id]/play/route.ts` to
close that gap — just say the word.

### 1.3 Google Cloud Console

In your OAuth client's **Authorized redirect URIs**, add your Supabase
callback URL (found on the Supabase Google provider settings page — it
looks like `https://<project-ref>.supabase.co/auth/v1/callback`), not your
app's own `/auth/callback` — Supabase sits in front of Google, then
forwards to your app.

**Rotate your client secret before using it** if it has ever been pasted
anywhere outside the Google Cloud Console / Supabase dashboard (chat, a
ticket, a doc, etc.) — treat any such exposure as a live leak.

### 1.4 Environment variables

Copy `.env.example` to `.env.local` for development, and set the same
keys in Vercel's Project Settings → Environment Variables for production.
`SUPABASE_SERVICE_ROLE_KEY` must **never** get a `NEXT_PUBLIC_` prefix.

### 1.5 Run

```bash
npm install
npm run dev
```

Deploy: push to GitHub, import into Vercel, set the env vars, deploy.

---

## 2. Architecture

### 2.0 Public vs. private surface

By request, `/` is now a **public marketing/landing page** (original copy,
no login required) — think of it as the "storefront." Everything that
matters is still fully private:

- `/learn`, `/learn/board/:id`, `/learn/video/:id`, `/admin`, and every
  `/api/*` route are unchanged — still gated by `getAuth()` /
  `requireAuthorized()` / `requireAdmin()` exactly as before.
- `middleware.ts` now treats `/` as public alongside `/login` and the
  auth callback routes — this is still just a UX redirect layer, not a
  security boundary; the real enforcement is server-side per route as
  described below.
- The landing page's copy, stats, and reviews are placeholders — swap
  `STATS`, `PATHS`, and `REVIEWS` in `app/page.tsx` for real numbers and
  real member reviews once you have them.

```
Google OAuth (via Supabase Auth)
        |
Supabase session cookie (HttpOnly, Secure, SameSite=Lax - set by @supabase/ssr)
        |
middleware.ts - refreshes the session cookie, UX-level redirect only
        |
Server Component / Route Handler calls lib/auth.ts -> getAuth()
        |
  1. Re-validates the session server-side (auth.getUser(), not just reading the cookie)
  2. Looks up the verified email in `authorized_users` (RLS-scoped: a user can only
     read their own row)
  3. Returns UNAUTHENTICATED / UNAUTHORIZED / AUTHORIZED{role}
        |
Only on AUTHORIZED does the route query protected data - and even then,
every query runs through Postgres RLS as a second, independent check.
```

**Every** protected page and API route calls `getAuth()` / `requireAuthorized()`
/ `requireAdmin()` itself. Nothing is inherited from a parent route or
cached client-side. Reaching `/learn` proves nothing about whether a
later request to `/admin` or `/api/video/:id/play` will succeed.

### 2.1 Session security

- Sessions are managed by Supabase Auth via `@supabase/ssr`, stored in
  **HttpOnly** cookies — never readable by JavaScript, never in
  localStorage/sessionStorage.
- `Secure` and `SameSite=Lax` are applied automatically by the Supabase
  cookie helper in production (HTTPS).
- `middleware.ts` refreshes the session token on every request and lets
  Supabase handle expiry/rotation.
- Logout (`supabase.auth.signOut()`) invalidates the session and clears
  the cookie — protected routes stop working immediately after.
- The OAuth callback route re-validates authorization **after** Supabase
  creates the authenticated session, and calls `signOut()` immediately if
  the email isn't on the allowlist — so an unauthorized Google account
  never ends up with a usable app session, even momentarily.
- CSRF: `SameSite=Lax` cookies plus the fact that all mutating routes
  require a valid session are the primary defense; there's no
  cookie-only authentication path that a cross-site form could exploit.

### 2.2 Why RLS, not just app-code checks

Every table in `supabase/schema.sql` has RLS **enabled with no default
access** — a table gets a policy or it's unreadable, full stop. This means
even if an application-layer bug skipped an authorization check somewhere,
the database itself would still refuse the query. `videos` in particular
has **no** SELECT policy for regular users at all — the only way to reach
video metadata or a playback URL is through the two server routes that
explicitly re-check authorization and use the service-role key, by design.

### 2.3 Protected video playback

```
User opens /learn/video/:id
        |
Server Component checks auth, fetches METADATA ONLY (title/description)
  via the service-role client (RLS blocks normal reads of `videos`),
  confirms the owning board is published
        |
Client <VideoPlayer> mounts, POSTs to /api/video/:id/play
        |
Route re-checks auth + rate limit + board-published, then builds the
plain Bunny embed URL from the stored library/video id
        |
<iframe> plays the embed URL
```

The raw `source_ref` is never sent to the client directly — not in the
board list, not in page source — it's only ever read server-side to
construct the embed URL, which is then returned in the `/play` response
right before the iframe mounts.

**By request, this is deliberately the simple version:** the embed URL
has no expiry and no domain restriction, so an authorized member could
copy it from DevTools and it would keep working elsewhere. What *is*
still fully enforced is who can reach this endpoint at all — you must be
authenticated, on the allowlist, and the board must be published, or the
route never returns a URL in the first place. If copy-paste sharing
between authorized members becomes a real problem later, Bunny's Token
Authentication + Allowed Referrers can be reintroduced in
`app/api/video/[id]/play/route.ts` — the code that did this was removed,
not deleted from institutional memory, so it's a small change to bring
back.

### 2.4 IDOR protection

`/learn/board/[id]` and `/api/boards/[id]`:
1. Validate the ID is a well-formed UUID before querying.
2. Query through RLS, which only returns the row if it's published (or the
   caller is an admin).
3. Treat "unpublished" and "doesn't exist" identically — both return a
   generic not-found — so the response can't be used to enumerate content
   ids or infer which boards exist.

Changing `/learn/board/123` to `/learn/board/124` gets you either that
board's actual published content (if you're authorized) or an identical
"not found," never a peek at something you shouldn't see.

### 2.5 Admin authorization

`requireAdmin()` checks the role from `authorized_users`, read
server-side — never from a client-supplied value. `/admin` is gated in
`app/admin/layout.tsx`, and independently, every `/api/admin/*` route
re-checks `requireAdmin()` itself, so there's no route reachable only
because the layout happened to render.

### 2.6 Rate limiting

`lib/rateLimit.ts` throttles auth callbacks, admin mutations, and video
playback-token issuance. It's an in-memory sliding window — fine for
moderate traffic and as defense-in-depth, but **not** shared across
serverless instances/regions. For real production load, swap in Upstash
Redis + `@upstash/ratelimit` (same function signature, different backing
store) — noted directly in that file.

### 2.7 Audit logging

`lib/audit.ts` records `LOGIN_SUCCESS`, `LOGIN_DENIED`, user and board
mutations, and video access grants/denials into `audit_logs`, readable
only by admins. No secrets or tokens are logged — just who did what to
which resource, when.

---

## 3. Threat model & mitigations

| Threat | Mitigation |
|---|---|
| Unauthorized user reaches protected pages | Server-side `getAuth()` on every page; RLS blocks data even if a check were missed |
| Direct URL access to boards/pages/videos/admin | Server re-validates on every route; middleware redirect is UX-only, not the real gate |
| IDOR (ID enumeration/tampering) | UUID validation + RLS-scoped queries + generic not-found responses |
| Session theft | HttpOnly/Secure/SameSite cookies, no tokens in localStorage, short-lived signed URLs limit blast radius |
| CSRF | SameSite=Lax cookies; state-changing routes require a valid session, not just a cookie replay |
| XSS | React's default escaping; strict CSP in `next.config.js`; no `dangerouslySetInnerHTML` anywhere |
| SQL/NoSQL injection | All queries go through the Supabase client (parameterized); all admin input validated with Zod before it reaches a query |
| Privilege escalation | Role read server-side from `authorized_users` only; admin routes can't be reached by a USER regardless of client claims; admins can't modify their own role/status via the API (self-lockout guard, not a bypass) |
| Fake admin requests / manipulated API calls | Every admin route independently calls `requireAdmin()`; RLS double-checks at the DB layer |
| Leaked/shared video URLs | Playback URL is only ever issued to an authenticated, allowlisted user via a rate-limited route — accepted trade-off: the issued URL itself has no expiry/domain lock (see §2.3), so a member could still copy-paste it onward |
| Brute-force / abuse | Rate limiting on auth callback, admin mutations, and playback-token issuance |
| Malicious query params / input | Zod validation on every admin-writable field (emails, URLs restricted to https, string length caps) |
| Exposed environment variables | Service-role key isolated to one file (`lib/supabase/admin.ts`), never `NEXT_PUBLIC_`-prefixed, never sent to the client |
| Insecure DB rules | RLS enabled on every table, deny-by-default, security-definer helper functions for role checks |

---

## 4. Security testing checklist

**Unauthorized (no session):**
- [ ] `/learn` → redirects to `/login`
- [ ] `/admin` → redirects to `/login`
- [ ] `/learn/board/<real-id>` → redirects to `/login`
- [ ] `/learn/video/<real-id>` → redirects to `/login`
- [ ] `curl /api/boards` → `401`
- [ ] `curl -X POST /api/video/<id>/play` → `401`
- [ ] Sign in with a Google account **not** on the allowlist → `login?error=access_denied`, no session persists afterward

**Authorized USER:**
- [ ] Sign in with an allowlisted email → lands on `/learn`
- [ ] Can open published boards/pages/videos
- [ ] Cannot open unpublished boards directly by ID (not-found, not an error revealing they exist)
- [ ] `/admin` → redirected to `/learn`
- [ ] `curl /api/admin/users` with their session → `403`

**ADMIN:**
- [ ] Can reach `/admin`, manage users and boards
- [ ] Can publish/unpublish, create/delete boards
- [ ] `curl -X POST /api/admin/users` with their session → `201`

**Removed/disabled user:**
- [ ] Admin disables the user
- [ ] Their existing browser session immediately fails `getAuth()` on the next request (verify by hitting `/learn` or `/api/boards` again without re-logging-in)
- [ ] Direct board/video URLs → denied
- [ ] `/api/video/:id/play` → `403`, no signed URL issued

**IDOR:**
- [ ] Take a valid board ID you can access, increment/mutate it → not-found, not the neighboring board's content
- [ ] Send a non-UUID string as an ID to any `[id]` route → `400`/`404`, no server error/stack trace

---

## 5. Known limitations / next steps

- **Rate limiting is in-memory** — replace with Upstash Redis for real
  multi-instance production traffic (see `lib/rateLimit.ts`).
- **Admin UI covers Users, Boards, and Classes** — create, edit,
  publish/unpublish, upload thumbnails, and attach/remove classes and
  their resources (Lecture Sheet, Exam Sheet, Practice Sheet, or any
  other named link — see `video_resources` in the schema). Editing an
  existing board or class is done via the **Edit** button on its row in
  `/admin/boards` or `/admin/videos`. The **Pages** editor (the
  "Board → Page → Board" intermediate layer) is fully defined and
  RLS-protected in `supabase/schema.sql` but doesn't yet have a
  dedicated admin UI — today, building a Page and its `page_boards`
  links is done via the Supabase table editor.
### 2.6 Video provider

- **Video provider**: Bunny Stream only — this is intentional, not a
  placeholder. One provider, one code path (`app/api/video/[id]/play/route.ts`),
  fewer ways for a mistake to slip through. If you ever need a second
  provider, add a new branch there rather than reintroducing a generic
  "provider" abstraction.
- **Browser playback cannot stop screen recording** — documented, not
  solvable, by design scoped to preventing account/link-level leakage.
