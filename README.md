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
4. **Storage**: create a **private** bucket named `videos`. Do not make it
   public. Upload video files here; each video's `source_ref` in the
   `videos` table is the object path inside this bucket.
5. Add yourself as the first admin:
   ```sql
   insert into public.authorized_users (email, role, status)
   values ('you@example.com', 'ADMIN', 'ACTIVE');
   ```

### 1.2 Google Cloud Console

In your OAuth client's **Authorized redirect URIs**, add your Supabase
callback URL (found on the Supabase Google provider settings page — it
looks like `https://<project-ref>.supabase.co/auth/v1/callback`), not your
app's own `/auth/callback` — Supabase sits in front of Google, then
forwards to your app.

**Rotate your client secret before using it** if it has ever been pasted
anywhere outside the Google Cloud Console / Supabase dashboard (chat, a
ticket, a doc, etc.) — treat any such exposure as a live leak.

### 1.3 Environment variables

Copy `.env.example` to `.env.local` for development, and set the same
keys in Vercel's Project Settings → Environment Variables for production.
`SUPABASE_SERVICE_ROLE_KEY` must **never** get a `NEXT_PUBLIC_` prefix.

### 1.4 Run

```bash
npm install
npm run dev
```

Deploy: push to GitHub, import into Vercel, set the env vars, deploy.

---

## 2. Architecture

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
Route re-checks auth + rate limit + board-published, then asks Supabase
Storage for a signed URL (20 min expiry) to the private `videos` bucket
        |
<video> element plays the signed URL
```

The raw storage path (`source_ref`) is never sent to the client — not in
the board list, not in page source, not in any API response except as an
already-consumed input to `createSignedUrl()`. A copied signed URL stops
working after 20 minutes and was only ever issued to one authorized,
rate-limited user, so it doesn't function as a durable "share this link"
credential the way a permanent public URL would.

**Documented limitation:** this prevents *unauthorized account access*
and *casual permanent-link sharing*. It cannot prevent an authorized user
from screen-recording, screenshotting, or using devtools to capture a
frame while legitimately watching — no browser-based system can do that.
That's a deliberate, stated scope boundary, not an oversight.

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
| Leaked/shared video URLs | No permanent URL ever leaves the server; 20-minute signed URLs issued per authorized, rate-limited request |
| Replayed playback tokens | Signed URLs expire; `video_playback_tokens` gives an audit trail of who was issued what, when |
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
- **Admin UI covers Users and Boards CRUD** (create/publish/delete). The
  Pages and Videos data model is fully defined and RLS-protected in
  `supabase/schema.sql`, but the dedicated Pages editor and Video
  add/replace UI in `/admin` are the natural next slice to build — today,
  attaching a video to a leaf board or building a Page is done via direct
  SQL/table editor in Supabase. Say the word and these forms can be built
  next.
- **Video provider**: wired for Supabase Storage private buckets with
  signed URLs. If you later move to Mux/Cloudflare Stream for adaptive
  bitrate, swap the branch in `/api/video/[id]/play/route.ts` — the
  schema already has a `provider` column for this.
- **Browser playback cannot stop screen recording** — documented, not
  solvable, by design scoped to preventing account/link-level leakage.
