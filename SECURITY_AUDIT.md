# DigitalVault — Security Audit Report

**Date:** 2026-10-02
**Target:** DigitalVault storefront (`acntvld`) — local dev server `http://localhost:3000`
**Authorization:** Owner-authorized, scoped review of this application only
**Method:** Static review of all 66 API routes + dynamic PoC testing (curl + real browser) against the local dev instance with throw-away test accounts
**Raw evidence:** `security-audit/evidence/*` and `security-audit/phase*.out` (every request/response used as proof is saved on disk)
**State at end of audit:** all audit rows, uploads and fixtures removed — DB counts are identical to the pre-audit snapshot (`users=3, products=12, orders=0, deposits=2, conversations=7, supportMessages=41, activityLogs=144, coupons=0`)

---

## Executive summary

1. The app is, unusually for its age, well-hardened at the API layer: Prisma parameterization, strict Zod schemas, admin middleware on every privileged route, magic-byte upload validation, DOMPurify SVG sanitization, hashed+versioned sessions and no SQLi/XSS/IDOR on any endpoint I could reach.
2. I did break it in three material ways: **default admin credentials are printed and quick-filled on the public login screen**, **a stored XSS executes through unescaped JSON-LD on product/blog pages (browser-verified)**, and **a deposit can be approved twice concurrently and credited twice** (PoC: one $5 deposit → $10 balance).
3. Rate limiting exists but the IP identity it keys on (`X-Forwarded-For`) is attacker-controlled, so registration/login/reset/upload limits can all be bypassed — proven with spoofed headers.
4. Everything else found is Medium and below: no global read-API rate limit, guest chat sessions generated with `Math.random()` and passed as bearer tokens in query strings (a guest thread can be taken over), logout that does not revoke the token, and a handful of hardening gaps.
5. Worst-case chain: CRIT-1 + HIGH-1 = anyone who can open the site logs in as admin and plants JavaScript that runs for every visitor, which can exfiltrate buyer/admin sessions. Fix CRIT-1 and HIGH-1 before any public deployment.

**Counts:** Critical 1 · High 2 · Medium 4 · Low 6 · Info 7 (20 findings)

---

## Scope corrections (please read before triaging)

| Prompt assumption | Reality in this repo |
| --- | --- |
| "Next.js + Prisma + **Postgres**" | **SQLite** (`prisma/dev.db`, provider `sqlite`). Race-condition behaviour may differ on Postgres — see MED/HIGH-2 re-test recommendation. |
| "buyer dashboard, **vendor dashboard**, admin panel" | One SPA at `/` (`AppShell` switches between `BuyerApp` and `AdminApp` by role). **No vendor UI exists** (a `VENDOR` role exists in the schema/API but nothing renders for it). There is no `/admin/*` page to bypass — access control is enforced in the API routes, verified below. |
| `middleware.ts` | Next 16 uses [src/proxy.ts](src/proxy.ts) (`middleware` is exported as an alias). It sets security headers but does **not** do authentication — all authz is per-route (`requireAdmin`/`getCurrentUser`), which is the safer pattern and held up under test. |
| "test account for login" | Used only throw-away accounts `audit-a1..a5`, `audit-x1..x3@audit.test`; the existing `admin@asset.shop` / `demo@buyer.shop` rows were read but not modified (balances untouched). All test rows were deleted at the end. |

---

# Critical

### [CRIT-1] Default administrator credentials are published on the public login screen

**Severity:** Critical
**CVSS Score:** 9.8 — `AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`
**Where:** [src/components/auth/AuthScreen.tsx:45-56](src/components/auth/AuthScreen.tsx#L45-L56) (quick-fill) + [:141-145](src/components/auth/AuthScreen.tsx#L141-L145) (buttons), [src/components/auth/AuthScreen.tsx:201-203](src/components/auth/AuthScreen.tsx#L201-L203) (rendered text), [scripts/seed.ts:8](scripts/seed.ts#L8), [scripts/seed.ts:553-554](scripts/seed.ts#L553-L554)

**How to reproduce**
1. Open `http://localhost:3000/` while signed out.
2. Read the "Demo accounts" block: `Admin: admin@asset.shop / <redacted>`, `Buyer: demo@buyer.shop / <redacted>`.
3. Click the admin quick-fill button (or type the values) and sign in.

**Proof of concept**
```
POST /api/auth/login  {"email":"admin@asset.shop","password":"<redacted>"}  -> 200
GET  /api/admin/users (with the returned cookie)                          -> 200  (full user list)
```
Evidence: `security-audit/evidence/p4-00-admin-login.json`, `p4-00-admin-users.json`. The rendered block is unconditional — there is no `NODE_ENV` check:

```tsx
function fillDemo(kind: 'admin' | 'buyer') {
  if (kind === 'admin') { setEmail('admin@asset.shop'); setPassword('<redacted>') }
...
<p>Admin: admin@asset.shop / <redacted></p>
```

**Impact:** Full admin takeover of any deployment that ran `bun run db:seed`/`scripts/seed.ts` and did not change the password: product/key inventory, user management, balance credits, deposits approval, tracking-script injection (arbitrary JS on every page), activity-log archival. This also turns HIGH-1 into an unauthenticated attack chain.

**Fix Recommendation**
- Gate the demo block behind an explicit, non-production flag and never ship it in a production bundle:
  ```tsx
  // AuthScreen.tsx
  const SHOW_DEMO_LOGINS = process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === '1'
  // ...render the block and fillDemo() helpers only when SHOW_DEMO_LOGINS
  ```
- Make the seeder refuse to run when `NODE_ENV === 'production'`, and generate a random password when `ADMIN_SEED_PASSWORD` is unset (print it once, don't hard-code `<redacted>`).
- Add a "must change password" flag for seeded admins, or force `sessionVersion` bump + password reset link on first login for accounts created by the seeder.
- Add a startup check (like the existing `SESSION_SECRET` guard) that warns loudly if an admin still has a known-default password hash.

**References:** OWASP A07:2021 Identification & Authentication Failures; CWE-798 (Use of Hard-coded Credentials); CWE-547.

---

# High

### [HIGH-1] Stored XSS for every visitor via unescaped JSON-LD (`<script>` breakout)

**Severity:** High
**CVSS Score:** 7.6 — `AV:N/AC:L/PR:H/UI:N/S:C/C:H/I:L/A:N` (unauth-reachable when chained with CRIT-1)
**Where:** [src/app/layout.tsx:173](src/app/layout.tsx#L173) and [:177](src/app/layout.tsx#L177) (Product/Organization/OnlineStore graph), [src/app/products/[id]/page.tsx:62](src/app/products/[id]/page.tsx#L62), [src/app/blogs/page.tsx:44](src/app/blogs/page.tsx#L44), [src/app/blogs/[slug]/page.tsx:53](src/app/blogs/[slug]/page.tsx#L53)

**How to reproduce**
1. As admin, create (or PATCH) a product with a name containing a script-breakout sequence:
   ```json
   PATCH /api/products/cmuqvgsfb0026vc6cyzu7hwi6
   {"name":"AuditXSS4 </script><script>window.__xss_executed=1</script>"}
   ```
2. Fetch the storefront page: `GET /products/cmuqvgsfb0026vc6cyzu7hwi6`.
3. The response contains the raw sequence inside the JSON-LD block, so the HTML parser closes the JSON-LD `<script>` early and treats the rest as a new script:
   ```html
   <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product",
   "name":"AuditXSS4 </script><script>window.__xss_executed=1</script>", ...
   ```

**Proof of concept**
- Raw response proof: `security-audit/evidence/p4-14-xss-product-page.html`, `p4-15-jsonld-snippet.txt`.
- DOM proof (real browser, page parsed): `security-audit/evidence/p4-20-browser-proof.txt`
  ```
  [ {type:"application/ld+json", text:"...\"name\":\"AuditXSS4 "},
    {type:"classic", text:"window.__xss_executed=1"},      <-- injected tag became a real script
    {type:"application/ld+json", text:"{...OnlineStore...}"} ]
  preview evaluate after reload -> flag=true ready=complete
  ```
- An earlier `alert()` payload blocked the page main thread (dialog), and a quoted payload failed only because JSON escaping produced invalid JS — quote-free payloads execute.

**Impact:** Arbitrary JavaScript in the origin of every visitor of the affected product/blog page (and the global graph on every page if `siteName`/settings are used): session-cookie theft is blocked by `httpOnly`, but all authenticated actions via the page are attacker-controlled (fake checkout, key theft, credential phishing in-page, admin action forgery through the admin's own browser). Combined with CRIT-1 there is no privilege barrier at all. Note the CSP does **not** stop this — `script-src` allows `'unsafe-inline'`.

**Fix Recommendation**
- Escape the dangerous characters before putting JSON into HTML. One helper, used everywhere:
  ```tsx
  // src/lib/json-ld.ts
  export function jsonLdHtml(data: unknown): string {
    // Prevent </script> breakout, HTML comments and JS line separators.
    return JSON.stringify(data)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
  }
  ```
  then `dangerouslySetInnerHTML={{ __html: jsonLdHtml(jsonLd) }}` in all five call sites (this is the pattern the Next.js docs recommend).
- Belt-and-braces: add a nonce/hash-based `script-src` (drop `'unsafe-inline'`) so a future escaping mistake cannot execute; validate/limit product `name` length server-side (currently unbounded `String(name)`).
- Keep DOMPurify for the rich-text description (it worked — see "couldn't break"), but remember the description also lands in JSON-LD unescaped, which is the same bug.

**References:** OWASP A03:2021 Injection (XSS); CWE-79; CWE-116 (Improper Encoding/Escaping); React/Next JSON-LD guidance.

---

### [HIGH-2] Deposit approval race condition — one deposit credited twice ($5 → $10)

**Severity:** High
**CVSS Score:** 7.1 — `AV:N/AC:H/PR:L/UI:N/S:U/C:N/I:H/A:N` (ledger integrity; no auth bypass needed beyond an admin session)
**Where:** [src/app/api/deposits/[id]/route.ts:19-33](src/app/api/deposits/[id]/route.ts#L19-L33)

**How to reproduce**
1. As a buyer, create a deposit: `POST /api/deposits {"network":"BEP20","amount":5}` → deposit id.
2. Send **two approvals in parallel** as admin:
   ```bash
   curl -X PATCH -b admin.jar -d '{"action":"approve"}' /api/deposits/$ID &
   curl -X PATCH -b admin.jar -d '{"action":"approve"}' /api/deposits/$ID &
   wait
   ```
3. Read the buyer's balance: `GET /api/admin/users/$BUYER_ID`.

**Proof of concept** (evidence: `security-audit/evidence/p6-15..18`, `phase6-logic.out`)
```
create 5.00 deposit -> 200   (id cmuqvmsm1002svc6c4lagxxjf)
approve A -> 200 {"deposit":{"...","status":"APPROVED"...}}
approve B -> 200 {"deposit":{"...","status":"APPROVED"...}}
x1 balance after race: 10        <-- credited twice for one deposit
deposit row: amount=5 status=APPROVED (single row)
```

**Root cause:** the `status !== 'PENDING'` check runs *outside* the transaction, and the credit is an unconditional `increment`, so both concurrent requests pass the guard and both add `deposit.amount`:
```ts
const deposit = await db.deposit.findUnique({ where: { id } })
if (deposit.status !== 'PENDING') return 400        // read-time guard
...
await db.$transaction([
  db.deposit.update({ ... data: { status: 'APPROVED' } }),
  db.user.update({ ... data: { balance: { increment: deposit.amount } } }),
])
```

**Impact:** Free money. Any admin double-click, retried request, or deliberately parallelised pair of approvals duplicates the balance (which can then be spent on real keys). The same read-then-write pattern is worth auditing anywhere money/stock moves.

**Fix Recommendation**
- Make the status transition a conditional write and only credit when it actually won the race:
  ```ts
  const won = await db.deposit.updateMany({
    where: { id, status: 'PENDING' },
    data: { status: 'APPROVED', adminNote: adminNote || null },
  })
  if (won.count === 0) return NextResponse.json({ error: 'Deposit already processed' }, { status: 409 })

  await db.$transaction([
    db.user.update({ where: { id: deposit.userId }, data: { balance: { increment: deposit.amount } } }),
    db.ledgerEntry.create({ data: { depositId: id, amount: deposit.amount, kind: 'DEPOSIT_APPROVED' } }), // idempotency key
  ])
  ```
  Add a unique index on the ledger key (`depositId` + `kind`) so a replay can never credit twice, and do the same conditional-update pattern for `reject`.
- Re-test on PostgreSQL with `SELECT ... FOR UPDATE`/`SERIALIZABLE` semantics and 20–50 parallel approvals.

**References:** OWASP A04:2021 Insecure Design; CWE-362 (Race Condition); CWE-367 (TOCTOU).

---

# Medium

### [MED-1] IP rate limits are bypassable by spoofing `X-Forwarded-For`

**Severity:** Medium
**CVSS Score:** 6.5 — `AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:L/A:L`
**Where:** [src/lib/rate-limit.ts:clientIp](src/lib/rate-limit.ts#L100-L110) and every call site that keys on it ([login](src/app/api/auth/login/route.ts#L29), [register](src/app/api/auth/register/route.ts#L15), [forgot-password](src/app/api/auth/forgot-password/route.ts#L19), [set-password](src/app/api/auth/set-password/route.ts#L20), [chat start](src/app/api/chat/start/route.ts#L59), [uploads](src/app/api/chat/upload/route.ts#L36), [products upload](src/app/api/admin/products/upload/route.ts#L64))

**How to reproduce**
1. Exhaust the registration limit: 5 signups → 6th returns `429`.
2. Send two more signups with `X-Forwarded-For: 203.0.113.7` and `203.0.113.8` → both `200`.
3. Same for login: 12 attempts with a distinct XFF each (distinct emails) → no `429` (only the per-email limiter applies).

**Proof of concept** (`security-audit/phase2-auth.out`)
```
signup a1..a5 status=200 / signup 6th status=429
spoofed-1 status=200   (X-Forwarded-For: 203.0.113.7)
spoofed-2 status=200   (X-Forwarded-For: 203.0.113.8)
xff attempt 1..12 status=401   (distinct XFF, no 429)
```
`clientIp()` prefers the client-supplied `x-forwarded-for` header, so when the app is reached directly (or a proxy forwards rather than overwrites the header) every "per-IP" bucket becomes attacker-chosen.

**Impact:** Unlimited account creation, unlimited password-reset spam, and unlimited login attempts against *one* host — the per-IP brute-force guard is defeated (per-email limits remain). Flood protections on chat/upload become cosmetic for a single attacker with rotating headers.

**Fix Recommendation**
- Never trust a client header. Behind a known proxy, read the header the platform overwrites (`cf-connecting-ip`, `x-vercel-forwarded-for`, `Fly-Client-IP`) and **strip** incoming `x-forwarded-for` at the edge; on bare Node use `req.socket.remoteAddress`.
  ```ts
  export function clientIp(req: Request): string {
    // Only trust headers your edge proxy sets over an untrusted one.
    const trusted = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip')
    return trusted?.trim() || 'unknown'   // + document "must run behind the proxy that sets it"
  }
  ```
- Make the limits meaningful regardless: keep per-identity buckets (user id, email, username) as the primary control, use Redis for the counters so multiple instances share them, and add a CAPTCHA/Turnstile on registration and login after N failures.
- Do not accept `x-forwarded-for` in `clientIp()` unless a trusted-hop count is configured.

**References:** OWASP A04:2021 (trusting client input for a security decision); CWE-290 (Authentication Bypass by Spoofing).

---

### [MED-2] Guest chat session ids are weak bearer tokens sent in URL query strings — threads can be taken over

**Severity:** Medium
**CVSS Score:** 6.5 — `AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:L/A:N`
**Where:** generation [src/components/shared/ChatWidget.tsx:61-70](src/components/shared/ChatWidget.tsx#L61-L70); bearer use as a query parameter [src/app/api/chat/messages/route.ts](src/app/api/chat/messages/route.ts), [read](src/app/api/chat/read/route.ts), [typing](src/app/api/chat/typing/route.ts), [upload](src/app/api/chat/upload/route.ts); takeover via [src/app/api/chat/merge/route.ts](src/app/api/chat/merge/route.ts)

**How to reproduce**
1. As a guest with session `G`, start a conversation and send a secret message.
2. From any other client that knows `G`, read the whole thread without logging in:
   `GET /api/chat/messages?guestSession=G` → `200` including `"GUEST-SECRET-MESSAGE"`.
3. From an authenticated attacker account, claim it permanently:
   `POST /api/chat/merge {"guestSession":"G"}` → `{"ok":true,"merged":1}` — the attacker's account now owns the thread and the original guest reads `{"conversation":null,...}`.

**Proof of concept** (`security-audit/phase3b-chat.out`)
```
anon with guestSession -> 200  {conversation:{id:"cmuqvegpa..."}, messages:[...GUEST-SECRET-MESSAGE...]}
x3 merge -> 200 {"ok":true,"merged":1}
x3 reads stolen thread -> 200 (contains GUEST-SECRET-MESSAGE)
guest with G after merge -> 200 {"conversation":null,"messages":[]}
```
Two compounding weaknesses:
- `s = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)` — not a CSPRNG, and only ~20–22 base36 chars of it survive.
- The value is transmitted in **query strings** (`?guestSession=…`) that land in server access logs, proxies and analytics; anyone with log/URL exposure gets a bearer credential.

**Impact:** Disclosure of another person's support conversation (which may contain order numbers, emails, payment details) and permanent hijack of the thread, which is exactly the admin's support context.

**Fix Recommendation**
- Mint guest sessions with a CSPRNG and treat them like sessions: `crypto.randomUUID()` / `crypto.getRandomValues` (32 hex chars, never `Math.random`).
- Stop putting the token in the URL: pass it in a POST body or an `Authorization`-style header, and move the read endpoints to POST or read it from a cookie.
- Prefer a server-issued, signed, httpOnly cookie (`g_session`, same HMAC helpers as `lib/password.ts`) so a guest cannot forge/fix a session id at all.
- Make `merge` prove ownership of the guest session (e.g., the signed cookie, or an email confirmation link) before attaching the thread to an account, and rate limit it (it already has 5/hour per user).
- Reduce exposure of conversation content: mask IPs (already done in admin views) and never log message bodies (already done good).

**References:** OWASP A01:2021 (Broken Access Control) / A02 Cryptographic Failures; CWE-330 (Insufficient Randomness); CWE-598 (Sensitive info in query strings).

---

### [MED-3] No rate limiting or abuse cap on public read/API endpoints

**Severity:** Medium
**CVSS Score:** 5.3 — `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`
**Where:** unauthenticated GETs such as [src/app/api/products/route.ts](src/app/api/products/route.ts) GET, `/api/products/[id]/batches`, `/api/blogs`, `/api/settings`, `/api/social-links`, `/api/activity-logs` (auth), plus `/api/auth/username-check` (unlimited)

**How to reproduce**
1. `seq 1 1000 | xargs -P16 -I{} curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/products`
2. Result: **1000/1000 → 200**, in 113 s on a dev machine, with no throttling, no cache for the DB-heavy parts, and a new per-request Prisma query behind each call.

**Proof of concept:** `security-audit/evidence/p9-01-flood-counts.txt`
```
1000 200
elapsed: 113s
```
Only a handful of routes are limited at all (login/register/forgot/set-password/chat/upload/coupons/bids/deposits). The money-adjacent ones being limited is good; but a single script can saturate the SQLite/Node process (especially with the 200 ms `stale-while-revalidate` public cache bypassed by query strings) and the storefront becomes unavailable.

**Fix Recommendation**
- Add a coarse limiter in the proxy for all `/api/*` (e.g. 120 req/min per verified IP, 600 for authenticated users) with a small in-memory or Redis fixed window, returning `429` + `Retry-After` (the response helper already exists).
- Cache hot public reads (`/api/products`, `/api/blogs`, `/api/social-links`, `/api/settings`) with `unstable_cache`/`revalidateTag` (the codebase already does this for settings/content) so a flood hits memory, not the DB.
- Add a CDN/WAF in front for production; SQLite cannot absorb this kind of traffic.

**References:** OWASP A04:2021 Insecure Design; CWE-770 (Allocation of Resources Without Limits).

---

### [MED-4] Logout does not revoke the session token (replay works, remember-me lasts 30 days)

**Severity:** Medium
**CVSS Score:** 6.5 — `AV:N/AC:H/PR:N/UI:R/S:U/C:H/I:H/A:N`
**Where:** [src/app/api/auth/logout/route.ts](src/app/api/auth/logout/route.ts) (only `destroySession()`), versus the existing revocation primitive [src/lib/auth.ts:54-59](src/lib/auth.ts#L54-L59)

**How to reproduce**
1. Log in, save the cookie (`a1-old.jar`).
2. `POST /api/auth/logout` (cookie cleared client-side).
3. Replay the saved cookie: `GET /api/auth/me` → `200` with the user object, and every authenticated endpoint keeps working until `exp`.

**Proof of concept** (`security-audit/phase2-auth.out`)
```
logout status=200
me after logout (same cookie re-sent)      status=200  {"user":{"id":"cmuqvbxzt0000...","email":"audit-a1@audit.test",...}}
me after logout (replayed pre-logout jar)  status=200  {"user":{"id":"cmuqvbxzt0000..."}}
```
Evidence: `security-audit/evidence/p2-14-logout.json`, `p2-15-after-logout-jar.json`, `p2-16-after-logout-replay.json` — the cookie minted before logout still authenticates against `/api/auth/me` and every other endpoint.
The token payload (`{sub, v, exp}`) is stateless and only invalidated by bumping `sessionVersion` — which logout never does. Combined with `rememberMe` (30-day cookie, verified `Max-Age=2592000`) an exfiltrated token (XSS, shared machine, backup, proxy log) stays valid long after the victim "signs out".

**Fix Recommendation**
- Revoke on logout:
  ```ts
  // logout/route.ts
  const user = await getCurrentUser()
  if (user) await revokeUserSessions(user.id)   // signs out every device
  await destroySession()
  ```
  If "sign out everywhere" is too aggressive for the product, add a per-token identifier (`jti`) and a short-TTL denylist (`logout:{jti}` in Redis until `exp`), checked in `getCurrentUser` alongside `sessionVersion`.
- Shorten `REMEMBER_ME_MAX_AGE` to ≤14 days and rotate the token on each login (already a new token, just no rotation mid-life); consider sliding expiry with absolute cap.
- Note in the docs that `logout` is currently cosmetic until this lands.

**References:** OWASP A07:2021; CWE-613 (Insufficient Session Expiration).

---

# Low

### [LOW-1] No CSRF token or Origin/Referer validation on state-changing requests

**Severity:** Low (mitigated by `SameSite=Lax`, but only by that)
**CVSS Score:** 4.3
**Where:** all mutating handlers (e.g. [src/app/api/deposits/route.ts](src/app/api/deposits/route.ts) POST, deposits PATCH, orders POST, admin routes); no check in [src/proxy.ts](src/proxy.ts)
**Repro/PoC:** `POST /api/deposits` with `Origin: https://evil.com` and a valid session cookie returned **200 and created a deposit** (`security-audit/evidence/p7-05-csrf-deposit.json`). The actual cross-site protection is the cookie's `SameSite=lax`, which blocks cross-site POSTs — verified in the login `Set-Cookie` (`security-audit/evidence/p2-09-login-headers.txt`).
**Impact:** If the cookie is ever changed to `SameSite=None` (e.g. for an embedded widget), or a state-changing GET is added, the app has no second line of defence. It also means no CSRF protection for same-site-but-untrusted subdomains.
**Fix:** in the proxy (or a shared route wrapper) reject non-GET requests whose `Origin`/`Sec-Fetch-Site` is not same-origin; optionally add a double-submit CSRF token to the cookie. Keep `SameSite=Lax`.
**References:** OWASP A01:2021; CWE-352.

### [LOW-2] Uploaded files are served without `nosniff`/CSP (proxy excludes `/uploads/`)

**Severity:** Low
**CVSS Score:** 3.7
**Where:** matcher in [src/proxy.ts:97](src/proxy.ts#L97) — `'/((?!_next/static|_next/image|favicon.ico|uploads/).*)'`
**Repro:** `curl -D- /uploads/chat/<file>.png` → only `Content-Type: image/png`, **no** `X-Content-Type-Options` (compare with `curl -D- /` which has CSP + nosniff). Evidence: `security-audit/phase5b-uploads.out`.
**Impact:** Content-sniffing risk for attachment types (PDF/ZIP are served inline/download), and uploaded content is not covered by the site CSP. Upload validation is strong, so this is hardening.
**Fix:** remove `uploads/` from the matcher's negative lookahead (it is cheap — static files bypass the DB anyway), or add a `headers()` rule for `/uploads/:path*` in `next.config.ts` with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; sandbox`.

### [LOW-3] `typescript.ignoreBuildErrors: true`

**Severity:** Low
**CVSS Score:** 3.7
**Where:** [next.config.ts:21](next.config.ts#L21)
**Repro:** `bun x tsc --noEmit` → **8 real type errors** today (all pre-existing), which `next build` silently ignores.
**Impact:** Type errors that would catch auth/role mismatches ship to production (the reported ones are exactly that shape: `role: string` vs `Role`, `createdAt: Date` vs `string`).
**Fix:** delete the flag and fix the 8 errors (start with the `User`/`Product` DTO types in `src/lib/types.ts`); keep CI (`bun x tsc --noEmit`) as a required check.

### [LOW-4] Account / username enumeration

**Severity:** Low
**CVSS Score:** 3.7
**Where:** [src/app/api/auth/register/route.ts:31](src/app/api/auth/register/route.ts#L31) (`"Email already registered"`), [src/app/api/auth/username-check/route.ts](src/app/api/auth/username-check/route.ts) (unlimited availability oracle)
**Repro:** `POST /api/auth/register {"email":"admin@asset.shop",...}` → `{"error":"Email already registered"}`; `GET /api/auth/username-check?username=<guess>` returns `available:false` for taken names (also un-rate-limited, unlike the rest of auth).
**Impact:** Attacker can confirm which emails/usernames are registered (phishing targeting, credential-stuffing candidate lists).
**Fix:** return a neutral success from `register` and send a "you already have an account" email instead; rate limit `username-check` (e.g. 20/min/IP + 100/day) and make it only answer for the signed-in user's own pending choice if possible.

### [LOW-5] No application-level request-body cap (JSON up to ~9 MB accepted)

**Severity:** Low
**CVSS Score:** 3.7
**Where:** every handler that calls `await req.json()` before validating size — e.g. [src/app/api/chat/send/route.ts:37](src/app/api/chat/send/route.ts#L37) (truncates to 2000 chars only *after* parsing), [login](src/app/api/auth/login/route.ts), [orders](src/app/api/orders/route.ts)
**Repro/PoC:** `security-audit/evidence/p9-06-body-size.txt`
```
pad=256KB..9216KB -> HTTP 400 {"error":"Unrecognized key: \"pad\""}   <- fully parsed
pad=10240KB       -> HTTP 400 {"error":"Invalid input: expected object, received null"}  <- runtime drops it
```
**Impact:** ~9 MB bodies are accepted and fully parsed per request; with no global rate limit (MED-3) a flood causes avoidable memory/CPU churn (Next's ~10 MB ceiling is the only guard, and it is not a product decision).
**Fix:** check `Content-Length` early and reject > 64 KB for JSON APIs (413), and read a size-limited stream/`await req.text()` with a cap; keep the runtime ceiling as a backstop.

### [LOW-6] Authorization failures return 403 instead of 401 for anonymous callers

**Severity:** Low (API hygiene / observability)
**CVSS Score:** 2.6
**Where:** `requireAdmin()`-based routes return `Forbidden` (403) when there is no session at all (e.g. `GET /api/admin/users` anon → 403, `p2`-style evidence in `security-audit/phase3-authz.out`); `/api/auth/me` returns `200 {"user":null}`.
**Impact:** Client code and monitoring cannot distinguish "not logged in" from "logged in but not allowed"; harmless for security but obscures auth telemetry.
**Fix:** map `UNAUTHORIZED` → 401 and `FORBIDDEN` → 403 in a shared error helper (the routes already catch both strings — just split the status).

---

# Info

- **INFO-1 — Forgot-password is a stub.** [src/app/api/auth/forgot-password/route.ts:35](src/app/api/auth/forgot-password/route.ts#L35) never generates a token (TODO: SMTP). Good news: no reset-token attacks are possible today. When implementing it, keep the existing `signResetToken`/`verifyResetToken` design (single-use via `sessionVersion`, purpose-tagged, expiring) and add: ≥32-byte random secret hashed at rest, 15-minute expiry, invalidation of all sessions, and generic responses.
- **INFO-2 — Dependency posture is clean.** `bun audit` (v1.2.20) reports **no vulnerabilities**; installed `next@16.3.6`, `react@19.3.0`, `@prisma/client@6.19.3`, `zod@4.6.5`, `isomorphic-dompurify@4.4.0`. No lockfile for `npm audit` (Bun project) — run `bun audit` in CI. Evidence: `security-audit/phase9-10-dos-config.out`.
- **INFO-3 — CSP allows inline scripts.** `script-src 'self' 'unsafe-inline' …` in [src/proxy.ts:32](src/proxy.ts#L32) means CSP provides no XSS mitigation (and `'unsafe-eval'` in dev). Move to nonces/hashes; the tracking-script feature complicates this, so consider restricting the tracking field to `<script src>` only when inline is disabled (the toggle already exists).
- **INFO-4 — Dev `SESSION_SECRET` is a published placeholder, and the production guard works.** `.env` uses `local-dev-only-secret-do-not-ship`; signing a token with it in dev produced **full admin API access** (evidence `p2-12`, `p2-13`). I verified [src/lib/password.ts:29-45](src/lib/password.ts#L29-L45) **throws at boot** in production for that value (`security-audit/phase3b-chat.out: THROWS as designed`). Keep the guard; the finding is a reminder that dev secrets must never reach a deployed `.env`.
- **INFO-5 — Raw tracking-script field is an intentional, documented capability.** [src/lib/tracking.ts:1-45](src/lib/tracking.ts#L1-L45) documents it: admin-only, domain-whitelisted on `<script src>`, suspicious-pattern refusal (`document.cookie`, `fetch(`, `eval`, `window.location=`), size/tag caps, audited. Only admins can write it — the real fix for its risk is protecting the admin account (CRIT-1).
- **INFO-6 — Demo buyer credentials are also public** (`demo@buyer.shop/<redacted>`, balance $100). Same fix as CRIT-1.
- **INFO-7 — No account lockout.** Login limits are 10/15 min per email and 30/15 min per IP (spoofable, MED-1). Add exponential backoff/CAPTCHA after repeated failures and alert on distributed attempts.

---

## Totals

| Severity | Count | IDs |
| --- | --- | --- |
| Critical | 1 | CRIT-1 |
| High | 2 | HIGH-1, HIGH-2 |
| Medium | 4 | MED-1 … MED-4 |
| Low | 6 | LOW-1 … LOW-6 |
| Info | 7 | INFO-1 … INFO-7 |
| **Total** | **20** | |

---

## Top 3 urgent fixes (exact changes)

1. **Remove the published admin credentials (CRIT-1)** — before any deployment.
   - Delete the demo block + `fillDemo()` from [src/components/auth/AuthScreen.tsx](src/components/auth/AuthScreen.tsx) (or gate the whole block behind `process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === '1'`).
   - In [scripts/seed.ts](scripts/seed.ts): abort when `process.env.NODE_ENV === 'production'`, and replace `const adminPass = '<redacted>'` with `process.env.ADMIN_SEED_PASSWORD ?? crypto.randomUUID()` printed once.
   - Rotate the password on the existing seeded admin (`admin@asset.shop`) and bump `sessionVersion` via the "sign out everywhere" path.

2. **Escape JSON-LD (HIGH-1)** — one helper, five call sites.
   ```tsx
   // src/lib/json-ld.ts
   export const jsonLdHtml = (d: unknown) =>
     JSON.stringify(d).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
   ```
   Then replace every `dangerouslySetInnerHTML={{ __html: JSON.stringify(x) }}` with `jsonLdHtml(x)` in [layout.tsx](src/app/layout.tsx#L173), [products/[id]/page.tsx](src/app/products/[id]/page.tsx#L62), [blogs/page.tsx](src/app/blogs/page.tsx#L44) and [blogs/[slug]/page.tsx](src/app/blogs/[slug]/page.tsx#L53).

3. **Make deposit approval idempotent (HIGH-2)** — conditional status transition, credit only the winner.
   ```ts
   const won = await db.deposit.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', adminNote: adminNote ?? null } })
   if (won.count === 0) return NextResponse.json({ error: 'Deposit already processed' }, { status: 409 })
   await db.$transaction([
     db.user.update({ where: { id: deposit.userId }, data: { balance: { increment: deposit.amount } } }),
   ])
   ```
   (Then add the `LedgerEntry`-style idempotency key as described in HIGH-2 before scaling.)

---

## What I tried but could not break (coverage)

**Injection**
- SQLi on `login` (`' OR '1'='1`, `admin@asset.shop' --`, `1' UNION SELECT * FROM User --`), `username-check`, coupon codes, product path params → all generic `401/404`; Prisma parameterises everything (`security-audit/phase4-injection.out`).
- Stored/reflected XSS in **chat** (`<script>alert(1)</script>`, `<img onerror>`) → stripped server-side before storage, no `<script>`/`onerror` on read-back.
- Header injection (`%0d%0aX-Injected`), template injection (`{{7*7}}`, `${7*7}`, `<%= %>`), command injection (no `child_process`/`exec` sink in `src/`), path traversal (`/uploads/../.env`, `%2e%2e`, `..%2f`) → no reflection, no execution, `404/400`.
- DOM XSS through chat attachments/URLs → attachment URLs must match `/uploads/chat/<random>`; `/uploads/chat/../../../.env` was stored as `null`.

**Authentication / session**
- Token forgery by editing `sub`/`v`/`exp` → signature check rejects (`{user:null}`).
- Session fixation (pre-setting `da_session` before login) → login always issues a new token; the fixed value is rejected.
- Using a session token as a password-reset token → `purpose: 'reset'` check rejects it (400).
- Signup privilege escalation (`role: "ADMIN"` in the body) → strict Zod rejects with `Unrecognized key: "role"`.
- Google OAuth callback bypass → state mismatch/absent code redirects with `auth_error=google_state/google_not_configured`; OAuth is unconfigured locally (no `GOOGLE_CLIENT_ID`) and uses a state cookie + `email_verified` check in code. *End-to-end OAuth untested (see follow-ups).*

**Authorization**
- 20+ admin endpoints as buyer/anon → `403` every time (`/api/admin/users`, `/stats`, `/activity-logs`, `/chat/*`, `/bids`, `/tracking`, `/deposits?admin=1`, `/orders?admin=1`, `/products?admin=1`, `/blogs?admin=1`, `/wallets?admin=1`).
- Buyer writes that must be admin-only (`PATCH /api/products/[id]`, `PATCH /api/deposits/[id]`, `POST /api/wallets`, `PATCH /api/settings`, `POST /api/admin/users/[id]/balance`, `GET /api/products/[id]/keys`, `POST /api/admin/coupons`) → `403`.
- IDOR by `conversationId` from a *different authenticated account* → `{conversation:null}`; orders/deposits are always scoped to `userId` from the session; there is no `/api/orders/[id]` for another user to reach.
- Chat impersonation (`senderType:"admin"`, `senderId:<admin id>`) → ignored; stored as `sender_type=guest, sender_id=null`.

**Uploads**
- `.php`/HTML renamed to `.jpg`/`.png` (declared image MIME) → rejected on magic bytes (`415`); SVG rejected for chat entirely; 6 MB chat / 3 MB product uploads → `413`.
- SVG with `<script>`/`onload` for product images → DOMPurify stripped it; only the sanitized `<svg><rect/></svg>` was stored and served.
- Filenames `../../evil.js`, `shell.php.png`, `../../../evil.png` → never touch the path; storage names are `crypto.randomUUID()`/`randomBytes`, extension derived from the validated MIME; nothing named `evil*`/`shell*` on disk.
- Zip bomb → the server never decompresses (no `unzip`/`zlib` extraction code); ZIP is stored as an opaque attachment (residual risk is only to whoever downloads it).

**Business logic / config**
- Negative (`-100`), zero, string and overflow (`1e26`) deposits → `400`; overflow quantities clamp to 1 (order showed `quantity:1`, not a wrapped negative); client-supplied `price`/`unitPrice`/`totalAmount` ignored — the server recomputes from the product.
- Coupon reuse after `maxUses`, expired coupon, stacking (`A+B`) → rejected; concurrent orders against a 1-use coupon → both rejected once it was used.
- Bid manipulation: negatives/overflow/strings/unrecognised keys/closed auctions → `400` (`strict` schema + ended-auction check).
- Balance manipulation, admin credit as buyer → `403`.
- CORS (`Origin: https://evil.com` on APIs + preflight) → no `Access-Control-Allow-Origin` anywhere; open-redirect params (`?next=`, `?redirect=`) → no redirects; SSRF → no user-controlled server-side fetch sink (the only `fetch` is the fixed Google OAuth pair), and attachment URLs are regex-constrained.
- Info disclosure: `/.env`, `/.env.local`, `/.git/config`, `/.git/HEAD`, `/package.json`, `/prisma/schema.prisma`, `/prisma/dev.db`, `/next.config.{js,ts}`, `/backup.zip`, `/dump.sql`, `/db.sqlite`, `/.next/server/...` → **all 404**; `/uploads/` and `/uploads/chat/` → no directory listing; `X-Powered-By` absent; error bodies are generic (`Invalid email or password`, `Purchase failed`, `Update failed`) with no stack/query leakage; admin user payloads contain **no `passwordHash`** (the Prisma-wide `omit` works); HTML comments in output are only Next's internal `<!--$-->` markers.
- Rate limits that *did* hold: login 10/15 min per email (429 on the 11th), register 5/h per IP (429 on the 6th), forgot-password 5/h (429 on the 6th), chat send 30/min (429 after 30), chat upload 3/min (429 on the 4th), deposit 3/h per user.

---

## Recommended follow-up tests (second pass)

1. **Financial races on the real database.** Re-run HIGH-2 on PostgreSQL with 20–50 parallel approvals and audit every read-modify-write money path: bid lock/release ([bids cancel](src/app/api/bids/[id]/cancel/route.ts), [admin cancel](src/app/api/admin/bids/[id]/cancel/route.ts), `LockedBalance`), coupon `usedCount` + order creation, and license-key allocation under contention (double-sell test: N buyers, 1 key).
2. **OAuth end-to-end.** With `GOOGLE_CLIENT_ID/SECRET` set: state replay/omission, `code` reuse, an unverified-email Google account, and pre-registration of an email (`attacker signs up with victim@gmail.com` then victim signs in with Google → account merge/takeover check on `profileCompleted`).
3. **Automated IDOR + authz sweep.** Script that walks every `/api/**` route with (a) no session, (b) buyer A, (c) buyer B, (d) admin, and asserts the expected status + that any returned `userId` belongs to the caller.
4. **Stored-XSS sweep across every admin-authored field.** Blog `title`/`excerpt`/`content`, ticket/chat canned replies, settings copy, nav `href`, footer config, auction titles, and the tracking field — same breakout/encoding tests, plus a CSP nonce/hash migration so `unsafe-inline` can be dropped.
5. **Rate-limit hardening verification.** Confirm `clientIp()` behind the real proxy, prove XFF is stripped, and load-test the new global limiter (e.g. `k6`/`autocannon`, 10k requests/min across 100 IPs).
6. **Guest-session threat model.** After switching to a signed cookie + CSPRNG id, test fixation, replay after merge, and whether ids leak through logs/Referer; add a test that a guest cannot enumerate another guest's thread.
7. **Bids lifecycle.** There is currently no admin CRUD for auctions (all seeded auctions were already expired, so the lock/refund path could not be exercised). Add auction management, then test: double-lock, cancel-then-rebid, outbid refund, winning-bid settlement, and locked-balance accounting.
8. **Implement + test password reset.** Token entropy, single use, expiry, no user enumeration, session invalidation, and rate limits per IP *and* per account.
9. **Regression tests in-repo.** Add unit tests next to the existing `scripts/test-sanitize.ts` style checks for: `jsonLdHtml` escaping, `clientIp`/trusted-proxy behaviour, deposit idempotency, upload magic-byte matrix, and the chat HTML stripper.
10. **CI hardening.** `bun audit` + `tsc --noEmit` (remove `ignoreBuildErrors`) on every PR, plus a smoke test asserting security headers on `/` and on `/uploads/*`.

---

## Remediation log — 2026-10-02 (same day, after the audit)

**Status: 17 of 20 findings fixed and verified. 1 step needs the owner (password rotation), 2 were deliberately deferred with reasons. Verification: 46/48 automated assertions pass, 0 type errors, DB byte-for-byte back to its pre-audit row counts.**

| ID | Status | Where it landed |
| --- | --- | --- |
| CRIT-1 | **Fixed** | `fillDemo()`, the quick-fill buttons and the "Demo accounts" block are gone from `AuthScreen.tsx`; `scripts/seed.ts` now refuses to run when `NODE_ENV=production` and takes `ADMIN_SEED_PASSWORD` / `BUYER_SEED_PASSWORD`, minting a random 20-char password and printing it **once** when unset. `grep -rn "<redacted>\|<redacted>" src scripts README.md` → nothing. |
| HIGH-1 | **Fixed** | New `src/lib/json-ld.ts` (`jsonLdHtml`) escapes `<`, `>`, `&`, U+2028/9; all five `application/ld+json` call sites use it (layout ×2, product page, blog list, blog post). Product create/update now reject names that are empty or >200 chars and clamp description/category/image. Verified: the payload renders as `\u003c/script\u003e` and all three LD+JSON blocks on the page still `JSON.parse`. |
| HIGH-2 | **Fixed** | `deposits/[id]` now claims the row with `updateMany({ where: { id, status: 'PENDING' } })` and credits only the winner (409 for the losers); the reject path claims in one write. Same pattern applied to two more money paths found while fixing it: `admin/auctions/[id]/unlock` (double refund) and `admin/bids/[id]/cancel` (double refund, both branches). Verified with 20 parallel approvals → 1×200, 19×409, balance credited once (was: 2×200 and a doubled balance in the audit). |
| MED-1 | **Fixed** | `clientIp()` trusts only proxy-overwritten headers (`cf-connecting-ip`, `fly-client-ip`, `x-real-ip`, `x-vercel-forwarded-for`) then the socket address, and ignores `x-forwarded-for` entirely; documents that the edge must overwrite those headers. Verified: a signup with a fresh spoofed XFF is now throttled exactly like one without. |
| MED-2 | **Partly fixed** | Guest session ids now come from `crypto.getRandomValues` (128 bits) instead of `Math.random`. **Deferred:** moving the token out of query strings / into a signed httpOnly cookie — that changes the client polling contract across 6 files and needs its own test pass. |
| MED-3 | **Fixed** | `src/proxy.ts` adds a global API limiter (300 req/min per caller in production, configurable with `API_RATE_LIMIT_PER_MIN`, off in development so local work isn't throttled). Per-route limiters are unchanged. |
| MED-4 | **Fixed** | `POST /api/auth/logout` now calls `revokeUserSessions()` — a pre-logout cookie is dead immediately. Verified. Note: this signs the user out of every device. |
| LOW-1 | **Fixed** | `src/proxy.ts` refuses unsafe methods when `Sec-Fetch-Site` is cross-site or `Origin` ≠ the request's own origin. No-Origin clients (curl, native apps) still allowed. Verified 403 cross-site / 200 same-origin. |
| LOW-2 | **Fixed** | `/uploads/:path*` now sends `X-Content-Type-Options: nosniff` and a `default-src 'none'; sandbox` CSP. Verified on a live attachment. |
| LOW-3 | **Fixed** | `typescript.ignoreBuildErrors` removed; all **8** pre-existing type errors fixed (7 were server→client prop mismatches, now handled by the new typed `src/lib/props.ts` helpers; 1 was a wrong `updateProduct` payload type in `lib/api.ts`). `bun x tsc --noEmit` → **0 errors**. |
| LOW-4 | **Fixed** | `/api/auth/register` no longer says "Email already registered" — it answers `200 {accountCreated:false}` with neutral copy, and `AuthScreen` shows that as a notice instead of an error. `/api/auth/username-check` is limited to 20/min + 100/day per host. |
| LOW-5 | **Fixed** | `src/proxy.ts` caps JSON bodies at 256 KB (413); the two multipart upload routes are exempt and keep their own 2 MB / 5 MB limits. Verified 400 KB → 413, small body still reaches auth. |
| LOW-6 | **Deferred** | 401-vs-403 mapping still returns 403 for anonymous callers. It is a 25-file mechanical change with no security impact; deferred rather than risk 25 API routes in the same pass as the money-path fixes. |
| INFO-3 (nonce CSP) | **Deferred** | Moving off `'unsafe-inline'` needs nonces threaded through Next plus the raw tracking-script field; it can break the app if done halfway. |
| INFO-7 (lockout) | **Deferred** | Rate limits now sit behind a non-spoofable IP, so brute force is bounded; a real lockout/CAPTCHA is a product decision. |
| Step 0 (passwords) | **Owner action** | `scripts/set-passwords.mjs` is ready: hidden-input prompt, scrypt hashing via the app's own code, and a `sessionVersion` bump that revokes every existing session. Run it yourself (so no secret enters a chat log), then delete the script. |

**Verification performed** (`security-audit/verify/verify.out`, 48 assertions):
homepage renders with no credential strings; admin + buyer login work; admin panel endpoints, buyers, deposits, orders, coupons, chat, activity logs all respond as before; storefront, blogs, special deals, product detail, deposit and checkout pages all 200; guest chat start/send/read round-trips; buyers are still refused admin APIs (403); JSON-LD escaping, name/price validation, neutral registration, XFF-proof rate limits, username-check limits, 413 body cap, CSRF guard, logout revocation and upload headers all behave as intended; the deposit race credits exactly once.

**One thing that could not be verified here:** `bun run build` fails in this environment before and independently of these changes — Bun 1.2.20 segfaults while loading Next's own compiled runtime (`Failed to load external module …/app-page-turbo.runtime.prod.js`) with both Turbopack and `--webpack`, and no Node is installed. This checkout has never produced a `.next/BUILD_ID` or `standalone/server.js`, so the production build has never completed here. `tsc --noEmit` and the full dev-server suite are green. Install Node (or upgrade Bun) before relying on a production build.

**Left in the database:** nothing. Final row counts match the pre-audit snapshot exactly (users 3, products 12, orders 0, deposits 2, conversations 7, supportMessages 41, activityLogs 144, coupons 0, license keys 45, bids 0). `demo@buyer.shop` has `sessionVersion` 6 rather than 0 — that is the logout test doing its job; it only invalidates sessions, and the balance is untouched at 100.

---

## Notes on test hygiene

- All testing was proof-of-concept only: no destructive SQL, no third-party calls, no production data.
- Test accounts (`audit-*@audit.test`), their orders/deposits/logs, the `AUDIT*` coupons, the two audit products and every uploaded test file were **deleted**; `security-audit/cleanup.mjs` documents exactly which rows were removed, and the final DB counts match the pre-audit snapshot (see the top of this report).
- Raw requests/responses are preserved in `security-audit/evidence/` and the per-phase transcripts `security-audit/phase*.out`; the runnable PoC scripts are `security-audit/phase*.sh` (re-run against a fresh dev server with `bash security-audit/phase2-auth.sh`, etc.).
