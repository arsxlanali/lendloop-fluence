# LendLoop

Borrow what you need. Lend what you don't.

A neighborhood tool-lending board: neighbors list tools, request them for dates, approve or
decline requests and close loans, while n8n sends notifications and overdue reminders.

**Stack:** Next.js 16 (App Router) · TypeScript · Clerk · Convex · n8n 2.46

Notifications use the brief's "logged mock" option: n8n writes each message (with the address
masked) to its log instead of sending it. Replacing the mock with an email node is a one-node change.

## Contents

- [Run it locally](#run-it-locally)
- [Environment variables](#environment-variables)
- [Architecture](#architecture)
- [Roles and rules](#roles-and-rules)
- [n8n integration](#n8n-integration)
- [Security and data minimization](#security-and-data-minimization)
- [Testing](#testing)
- [Before production](#before-production)

## Run it locally

Requires Node.js 22+, Docker, a Clerk account and a Convex account.

1. **Install:** `npm ci`, then `cp .env.example .env.local`.
2. **Clerk:** create a development application and activate its Convex integration
   ([Convex docs](https://docs.convex.dev/auth/clerk)). That creates a JWT template named `convex`;
   make sure it includes the `name`, `email` and `email_verified` claims. Put the publishable and
   secret keys in `.env.local`.
3. **Convex:** run `npx convex dev` and pick a project. It writes `NEXT_PUBLIC_CONVEX_URL` and
   keeps running. In a second terminal, set the server-side variables:
   ```sh
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
   npx convex env set AUTOMATION_SECRET "$(openssl rand -hex 32)"
   npx convex env set N8N_WEBHOOK_URL https://<public n8n URL>/webhook/lendloop-events
   npx convex env set ADMIN_SUBJECTS user_xxx        # after your first sign-in, from the Clerk dashboard
   ```
4. **n8n:**
   ```sh
   mkdir -p .secrets && openssl rand -hex 32 > .secrets/n8n_encryption_key
   # Add CONVEX_SITE_URL (https://<deployment>.convex.site) to .env.local, then:
   docker compose --env-file .env.local up -d
   ```
   Open http://localhost:5678 and create the owner account. Then:
   - **Credentials → New → JWT Auth**, named exactly `LendLoop automation JWT`: key type
     *Passphrase*, algorithm *HS256*, secret = the `AUTOMATION_SECRET` value
     (`npx convex env get AUTOMATION_SECRET`).
   - **Import** the three files in `n8n/`. In each JWT/Webhook node, select the credential if
     n8n did not match it by name. In the settings of *Request notifications* and *Overdue
     reminders*, set the error workflow to *LendLoop - Report automation failures*.
   - **Publish** all three workflows.

   Convex runs in the cloud and cannot reach `localhost`. Never tunnel n8n's port 5678: that
   would publish the editor. `npm run relay` starts a small relay on `127.0.0.1:5679` that
   forwards only `POST /webhook/lendloop-events` and answers 404 to everything else; tunnel that:
   ```sh
   npm run relay                                     # terminal 1
   cloudflared tunnel --url http://127.0.0.1:5679    # terminal 2 (brew install cloudflared)
   npx convex env set N8N_WEBHOOK_URL https://<name>.trycloudflare.com/webhook/lendloop-events
   ```
5. **App:** `npm run dev`, open http://localhost:3000, and sign in with two accounts in two
   browsers: one lists a tool, the other requests it, the first approves.

## Environment variables

| Where | Name | Secret | Purpose |
|---|---|---|---|
| Next.js | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | no | Clerk in the browser |
| Next.js | `CLERK_SECRET_KEY` | **yes** | Clerk middleware (route protection) |
| Next.js | `NEXT_PUBLIC_CONVEX_URL` | no | Convex client |
| Convex | `CLERK_JWT_ISSUER_DOMAIN` | no | Which Clerk tokens Convex accepts |
| Convex | `ADMIN_SUBJECTS` | no | Comma-separated Clerk user IDs that are admins |
| Convex | `AUTOMATION_SECRET` | **yes** | HS256 key shared with the n8n credential |
| Convex | `N8N_WEBHOOK_URL` | no | Where request notifications go |
| Compose | `CONVEX_SITE_URL` | no | Where n8n calls Convex |
| File | `.secrets/n8n_encryption_key` | **yes** | Encrypts n8n's stored credentials |

`.env*` (except `.env.example`) and `.secrets/` are git-ignored. The shared key exists in two
places only: the Convex deployment and the encrypted n8n credential.

## Architecture

```text
Browser ── Clerk session ──► Next.js (pages; /board/* protected by Clerk middleware)
   │
   └── Clerk JWT ──► Convex queries & mutations
                     every rule and permission checked here, in one transaction
                     │
                     ├─ outbox row (events) written with the change
                     │      └─► action: sign (JWT) ─► n8n webhook ─► verify ─► notify (mock) ─► 200
                     │          retries with backoff · lease · admin replay
                     │
                     └─ HTTP routes /automation/*  ◄── signed calls from n8n
                            ▲
n8n schedule (daily 09:00 UTC): claim 100 overdue ─► send (mock) ─► report ─► repeat while more
n8n error workflow: any failed run ─► POST /automation/failures ─► admin page
```

**Code layout**

| Path | What |
|---|---|
| `convex/schema.ts` | Tables and indexes |
| `convex/tools.ts`, `convex/loans.ts` | Public API: queries and mutations with their rules |
| `convex/notify.ts` | Outbox delivery to n8n, retries, admin failure view and replay |
| `convex/automation.ts`, `convex/http.ts` | Endpoints n8n calls: reminder claim/report, failure reports |
| `convex/model.ts`, `convex/access.ts` | Shared helpers: identity, roles, availability, loan views |
| `lib/policy.ts`, `lib/signing.ts` | Validation rules and limits; JWT signing shared with n8n (`jose`) |
| `app/`, `components/` | Pages (`/`, `/board`, `/board/listings`, `/requests`, `/incoming`, `/admin`) |
| `scripts/build-workflows.mjs` | Source of the n8n workflows; `npm run workflows` regenerates `n8n/*.json` |

**Decisions**

- **Convex is the only authority.** The UI hides buttons for convenience; every permission
  and state change is checked again in the mutation, inside a serializable transaction. Two
  owners' tabs approving overlapping requests at once cannot both succeed.
- **Everything that grows is paginated or bounded by an index:** the board, every loan list and
  the admin view use `paginate()`; the public page fills each page with tools free today by
  walking an index range, so tools on loan never leave it showing an empty page; availability,
  reminder and expiry lookups are index ranges.
  Queries read only what they show, so a write elsewhere doesn't re-run every open dashboard.
- **Dates are calendar days in the user's time zone.** The client sends its local date; the
  server accepts it only within a day of UTC, which every real time zone is. This keeps
  availability correct at midnight without time-dependent cached queries.
- **Loan lifecycle:** `pending → approved | declined | cancelled | expired`, then
  `approved → returned`. Approving declines overlapping requests. Requests whose dates have
  passed expire hourly. The borrower *reports* a return; only the owner *confirms* it, or says
  it isn't back yet, which reopens the loan for reminders.

## Roles and rules

| Action | Signed out | User | Admin |
|---|---|---|---|
| See available tools (name and category only) | ✓ | ✓ | ✓ |
| Browse with descriptions, condition, availability, category filter | | ✓ | ✓ |
| Create / edit / remove own listings | | ✓ (max 50 active) | ✓ |
| Request a tool (not their own; ≤ 90 days; ≤ 10 open requests) | | ✓ | ✓ |
| Add a message to a request · cancel it · report own return | | ✓ | ✓ |
| Approve (with optional hand-over details) / decline · confirm or dispute a return (once the loan has started) | | owner of the tool | owner of the tool |
| Cancel an approved booking before it starts (the other side is told) | | owner or borrower | owner or borrower |
| Remove any listing (audited, owner notified) | | | ✓ |
| Mark a lender Trusted (not themselves; audited) | | | ✓ |
| View all loans · automation failures · retry a failed notification | | | ✓ |

Admins are listed in a Convex deployment variable, so nothing a browser sends can grant the
role, and removing an ID takes effect on the next request. A larger product would move this to
Clerk roles or organizations with a permission table; the check stays in one function
(`convex/access.ts`).

## n8n integration

**Signing, both directions.** Convex and n8n share one HS256 key. On the n8n side it lives in a
*JWT Auth* credential (encrypted by n8n), never in workflow JSON, Code nodes or the environment.
Convex signs and verifies with the `jose` library; n8n's nodes use `jsonwebtoken`. HS256 is
HMAC-SHA256, the brief's suggested scheme, packaged so n8n can verify it with a stored credential.

- *Convex → n8n:* the body is `{"payload": "<json>"}`. The `Authorization: Bearer` token carries
  `iss`, `aud`, a 5-minute `exp`, `jti` = event ID and the SHA-256 of the payload. n8n's Webhook
  node verifies the token with the credential and rejects bad or missing tokens (401/403)
  before any workflow runs, so junk requests don't even create executions. The next nodes check
  the claims and that the payload hash matches.
- *n8n → Convex:* the Crypto node hashes the exact body, and the JWT node signs `method`, `path`,
  the body hash and a 5-minute expiry. Convex verifies all of them, so a captured token can't be
  replayed against another route or with another body.

**Only the fields each message needs:** the recipient's name and email, the event, the tool
name and the dates. No descriptions, no IDs of other people, nothing about the other party.

**Idempotency and retries**

- *Notifications:* the outbox row is written in the same transaction as the change, then
  delivered by a scheduled action with a lease, attempt numbers (a late answer from an old
  attempt is ignored), exponential backoff and 6 attempts. A cron restarts expired leases.
  n8n remembers delivered event IDs for two days, so a retry after a lost response doesn't
  notify twice; a real provider gets the event ID as its idempotency key.
- *Overdue reminders (daily, 09:00 UTC):* n8n **claims** a batch of up to 100: Convex leases each
  loan for 30 minutes and returns the message fields. n8n sends and **reports** sent/failed per
  loan; the answer says whether more are waiting, and the workflow loops until none are (at most
  50 batches per run). A sent reminder is never claimed again that day, and repeating a report
  changes nothing. A failed one waits 15 minutes before it can be claimed again, so a run doesn't
  hammer a failing provider; re-running the workflow later retries it, up to 3 attempts a day,
  and tomorrow's run sends a fresh reminder anyway. The idempotency key is
  `reminder:<loanId>:<day>`.
- A borrower who reported the return isn't reminded while the owner checks. If the owner says
  it isn't back, reminders resume, so a false report can't silence them.

**Failures are visible, not silent**

- If any reminder failed today, the run itself fails. Both workflows name an error workflow that posts
  a signed failure report to Convex, and admins see it on `/board/admin`.
- Notifications that exhaust their retries appear there too, with a **Retry** button.
- Each loan shows its latest automation activity ("Overdue reminder sent 2 days ago",
  "Notification failed") and a full recent timeline.

## Security and data minimization

- **Authentication** is Clerk. Convex verifies the Clerk JWT on every call. `/board/*` is
  protected by Clerk middleware, and the middleware fails closed (503) in production when not
  configured.
- **Authorization** is server-side in every function (see the table). Errors meant for users are
  `ConvexError`s; anything else reaches the client as a generic message.
- **Public data:** signed-out visitors get tool names and categories only, with no IDs, owners,
  descriptions or dates.
- **Personal data:** `users` holds only a name and an email, copied from the verified token
  (never from client arguments). The email is used only to send notifications: no user, admin
  or page ever sees another person's email. Participants see each other's name and the short
  messages they chose to write (a note with the request, hand-over details with the approval),
  so sharing contact details is each person's decision. Admins see names, not messages. The
  listing form asks people not to put addresses or phone numbers in public descriptions.
- **Logs:** Convex logs event IDs and error codes, never names or emails. n8n logs mock messages
  with the address masked and keeps no data from successful executions.
- **Audit:** admin actions (removals, trust changes, notification replays) are written to
  `audit`. Loan timelines record who did what, including the automations.
- **Abuse limits:** 50 active listings and 10 open requests per user, 90-day loans, requests at
  most a year ahead, and length limits on every field.
- **Transport and headers:** `X-Frame-Options`/`frame-ancestors` deny framing, plus nosniff,
  strict referrer, Permissions-Policy and HSTS (`next.config.ts`). Fonts are self-hosted at build
  time, so browsers don't contact Google.
- **Soft deletion:** removed listings are hidden but kept, with their loans and timelines, so
  approved loans can still be closed and their history audited.

## UX, accessibility and performance

- **Flows:** forms open as dialogs where you are (native `<dialog>`: focus moves in and stays in,
  Escape closes, focus returns to the button that opened it). Irreversible actions ask first.
  Every action confirms itself in a short message read out by screen readers. Explore has
  search (a Convex search index, so it works beyond the first page) and category chips. Loans
  are grouped into what needs an answer, what's current and the past, with statuses that say
  what a loan means today (Upcoming, On loan, Overdue, Return reported). Return actions appear
  only once a loan has started; the borrow dialog shows dates already booked.
- **Accessibility:** skip link, landmarks, one `h1` and a distinct title per page, status
  pills that never rely on colour alone, 44 px targets, visible focus, reduced motion respected.
  axe-core reports no violations on any page or dialog, for both an owner and a borrower.
  Lighthouse accessibility: 100.
- **Performance:** the public homepage is static and served without the auth middleware;
  skeletons with real card sizes keep layout shift near zero; one shared timer rolls the date
  over at midnight; long loan lists skip rendering off-screen cards (`content-visibility`);
  search is debounced. Lighthouse on the production build: performance 100 desktop and 92
  on emulated mobile (LCP 2.4 s, CLS 0.03). The remaining best-practice warnings come from Clerk's
  development domain cookies, which a production Clerk instance on your own domain removes.

## Testing

```sh
npm test            # 28 tests: Convex functions (convex-test) and the n8n Code nodes
npm run typecheck
npm run build
```

- **Authorization:** every mutation tried by a stranger and by the wrong party; admin-only
  queries; self-trust; disputing a return; no email in any view; messages hidden from admins.
- **Rules:** overlapping approvals, auto-decline, cancel, expiry, quotas, date validation, and
  that users get readable errors.
- **Scale regressions:** a new listing stays visible past 500 older ones; a free tool behind 250
  newer tools on loan still reaches the public page; an overdue loan is found behind more than
  1,000 older loans; 130 overdue loans are handled in two batches.
- **Automation:** reminder claim/lease/report idempotency, retry delay and limits; outbox lease, stale
  answers, exhaustion and replay; the exact webhook payload; signed HTTP routes rejecting
  missing, tampered, mis-routed, wrong-method, expired, over-long, iat-less and wrongly keyed
  tokens.
- **n8n Code nodes** run in a sandbox: claim checks, payload-hash check, duplicate suppression,
  address masking, per-reminder results and failure reports. A test regenerates the workflow
  JSON and fails if it differs from what's committed or contains anything secret.

The workflows were also run in n8n 2.46.5 against a local Convex backend, with real signing on
both sides (the reminder schedule set to every minute for the test). Two notifications were
delivered and recorded on their loans. One reminder run looped over two batches: 130 reminders
sent, one recorded as failed for a user without an email, and the loan with a reported return
skipped. The run then failed on purpose, and the error workflow posted the failure to Convex.

CI (`.github/workflows/check.yml`) runs tests, typecheck and build on every push.

## Before production

- **Real notifications:** replace the mock Code nodes with an email or Slack node using the
  provided idempotency keys, and record consent for the channel.
- **n8n hardening:** queue mode with Postgres, external task runners, SSO for the editor, the
  webhook behind a reverse proxy with rate limits, and the credential rotated on a schedule
  (accepting two keys in Convex during rotation).
- **Roles:** Clerk organizations or roles with a permission table instead of an ID list.
- **CSP:** a full `script-src`/`connect-src` policy for the deployed Clerk and Convex hosts,
  rolled out in report-only mode first.
- **Observability:** Sentry for the app, Convex log streaming to Datadog, alerts on failed
  deliveries and failed runs (today they appear in the admin page).
- **Data lifecycle:** a retention policy for loans, timelines and automation records, and a
  defined path for account deletion (anonymize the user's side of past loans).
- **Abuse:** rate limits per user on top of the quotas, and reporting of bad listings.
- **Tests:** browser end-to-end tests (Playwright with Clerk test users) in CI.
