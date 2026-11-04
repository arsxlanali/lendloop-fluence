# LendLoop

Borrow what you need. Lend what you don’t.

A neighborhood lending app built for Fluence’s Full-Stack Developer take-home: Next.js App Router, TypeScript, Clerk, Convex, and n8n. Notifications deliberately use the logged-mock option permitted by the brief. No real emails or messages are sent.

## Verification status

- `npm test`: 14 passing automated tests. Convex functions execute against the `convex-test` mock database; these are not cloud integration tests.
- `npm run typecheck`: passes.
- `npm run build`: passes (Next.js 16.4.5).
- n8n Code-node logic is executed in tests with mocked n8n inputs. Those tests verify HMAC compatibility, tamper rejection, empty batches, and signed reminder callbacks.
- Live Clerk authentication, a deployed Convex backend, and imported workflows inside n8n have **not** been exercised yet. Development accounts must be connected. Docker is not installed on the preparation machine.
- There is no hosted demo yet. A build without service keys shows a clear setup screen, not a fake signed-in experience.

## Run locally

Requires Node.js 22+, npm, and Docker Compose for n8n. Package versions are pinned and `package-lock.json` is included.

1. Run `npm ci`.
2. Copy `.env.example` to `.env.local`. Never commit populated environment files.
3. Create a Clerk development application. Enable its Convex integration / `convex` JWT template following https://docs.convex.dev/auth/clerk. Set `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `CLERK_JWT_ISSUER_DOMAIN` from that application.
4. Run `npx convex dev`. Select a development project. This creates the local deployment configuration and refreshes the bootstrap files in `convex/_generated/`. Set `NEXT_PUBLIC_CONVEX_URL` to the deployment URL if the CLI has not already written it.
5. In the Convex environment, configure `CLERK_JWT_ISSUER_DOMAIN`, `ADMIN_SUBJECTS` (comma-separated Clerk user IDs), `AUTOMATION_SECRET` (at least 32 random characters), and `N8N_WEBHOOK_URL`.
6. For n8n, set `AUTOMATION_SECRET` to the same shared secret, `CONVEX_SITE_URL` to the HTTP action URL ending in `.convex.site`, and a separate random `N8N_ENCRYPTION_KEY` in `.env.local`. Generate secrets locally using `openssl rand -hex 32`; do not paste secrets into chat, source files, screenshots, or exported workflow JSON.
7. Run `docker compose --env-file .env.local up -d`. Open http://localhost:5678 and finish the owner-account setup yourself. Import all three files in `n8n/`. Select **LendLoop - Automation failure visibility** as the Error Workflow in the settings of the other two workflows. Publish/activate them. Workflow timezone is UTC; overdue checks run daily at 09:00 UTC.
8. Run `npm run dev` and visit http://localhost:3000. Sign in as two different test users. One lists a tool, the other requests dates, and the owner approves it.

### Cloud-to-local connectivity

A cloud Convex action cannot reach `localhost` on your laptop. Point `N8N_WEBHOOK_URL` at an authenticated-owner n8n instance with an HTTPS-reachable production webhook, or use a properly secured temporary development tunnel. No tunnel is opened or service published automatically. Keep the n8n editor private; expose only the signed webhook. Docker binds its UI to loopback by default.

The local n8n container allows only the built-in `crypto` module in Code nodes and allows those trusted workflows to read runtime environment configuration. If using external task runners, set the module allowlist and required environment access on the runner as documented by n8n. This configuration is for trusted, single-owner development; a production installation should use isolated runners and scoped credentials / a dedicated signing service.

## Product behavior

- Public visitors see only available tool names and categories; the unauthenticated query explicitly projects those two fields.
- Authenticated users browse descriptions and conditions, filter categories, and use My listings, My requests, and Incoming requests.
- Owners can create, edit and retire their listings. Borrowers request inclusive date ranges (at most 90 days). Self-borrowing, duplicate overlapping requests, invalid dates and conflicting approved loans are rejected on the server.
- Owners approve/decline requests. Either participant can mark an approved loan returned. A retired listing is hidden; pending requests are declined while approved-loan history remains intact.
- Admins can remove any listing, view loans and mark another listing’s lender trusted. Admin status is derived from deployment configuration, never a browser-submitted role.
- The dashboard displays recent loan activity and reminder dates. Loading, empty, validation and failure states are explicit.

## Architecture and security

```text
Browser -- Clerk JWT --> Convex queries/mutations (authorization + transactions)
                          | loans, listings, audit activity, outbox
                          v
                    scheduled action + durable retry/lease
                          | signed event envelope
                          v
                    n8n request webhook -> verify -> logged mock -> acknowledge

n8n daily schedule -> signed GET /overdue -> mock notification
                  -> signed POST /reminders -> idempotent audit writeback
```

Convex owns the consistency boundary. Authorization and state transitions happen in the same mutation as database writes. Approval reads competing loans before writing; Convex serializable transactions prevent two overlapping approvals from both committing. Loan participants, owners and admins are checked independently in every operation. Authentication alone is insufficient.

Database changes and the event outbox are committed together. Delivery uses a one-minute lease, attempt tokens, exponential backoff and six attempts; exhausted events remain visibly `failed` with a bounded diagnostic. A minute cron recovers expired leases. Do not blindly retry an approval or return from the UI; refresh state after a lost response.

### Automation protocol

Outbound events are `{timestamp,payload,signature}` envelopes. `payload` is a JSON string containing only event ID, loan ID, recipient’s opaque identity and event kind. HMAC-SHA256 signs `timestamp + "\n" + payload`. The n8n receiver rejects malformed signatures, payload tampering and timestamps outside five minutes. It acknowledges only after verification and the mock notification step succeeds.

For n8n → Convex requests, HMAC signs `timestamp + "\n" + METHOD + "\n" + PATH + "\n" + rawBody`; signatures and timestamps use `x-lendloop-signature` and `x-lendloop-timestamp`. Signing method, path and raw body prevents changing a read into a write or altering callback contents. There are no browser-facing automation secrets and no permissive CORS grants. Reminder callbacks validate the current UTC date and active overdue status. The `(loanId, day)` audit key makes repeated writebacks idempotent.

Transport is at-least-once, not exactly-once. Mock notification logs may repeat after a delivery ambiguity or a worker crash. A real notification provider must accept the stable event ID / `reminder:loanId:day` as its idempotency key, or use an additional delivery ledger. The writeback itself cannot create duplicate reminder records. Invalid signatures surface as failed executions, HTTP node retries are bounded, the error workflow logs execution references, and outbox terminal failures can be inspected in the Convex dashboard.

### Data minimization

No emails, phone numbers, real addresses or health data are stored. Automation receives opaque recipient identifiers, not whole records. Public API output cannot expose owner or borrower identities. Server-side access checks limit loan history to participants or admins. Sensitive descriptions are excluded from webhook payloads and routine logs. No secrets or full successful execution payloads are saved in workflow exports.

## Manual acceptance checklist after connecting accounts

- Anonymous visitor sees names/categories only and cannot call write mutations.
- Two users cannot edit each other’s listings or inspect unrelated loan records.
- Two conflicting requests cannot both be approved, including when approval is attempted concurrently.
- Non-admin users cannot grant trust or remove another user’s listing.
- Change one byte of a signed event: n8n rejects it. Repeat with a signature older than five minutes.
- Stop n8n, request a loan, restore n8n: observe pending/sending/delivered outbox states; after six failures inspect the terminal record.
- Seed an approved loan that ended yesterday in the development database; execute the overdue workflow twice. There is one reminder activity record per loan/day.
- Return or remove a tool and verify its state, history and visibility remain consistent.

## Before production

Finish the live acceptance checklist and record evidence. Add hosted browser end-to-end tests, abuse controls and per-user quotas; paginate the current bounded 500-tool/loan views and 1,000-loan reminder scan; index active-loan expiry rather than scanning. Add full delivery metrics/alerts, operator dead-letter replay, provider idempotency, hardened n8n deployment, rotated service credentials, CSP and organization-level data boundaries. Use a privacy-reviewed retention/deletion policy; define how user deletion affects historical loans. Replace mock notifications with an explicitly consented channel and never place health data in general-purpose logs or automation payloads.

## Design decisions

- Convex rather than Next.js route handlers enforces the domain rules: one consistent authority and atomic mutations.
- Deployment-managed admin subjects make the exercise easy to audit; a production system should use a separately administered role model.
- Soft removal preserves in-progress loans and audit history. It is a product choice, not a claim that personal data must be retained indefinitely.
- Inclusive date ranges avoid silently allowing two borrowers on the same boundary day.
- A compact outbox and explicit failed state favor observable recovery over invisible best-effort calls.
- No external notification is sent by this exercise. Logged mocks keep the test self-contained and avoid collecting unnecessary contact information.

## Authorship

Prepared by Arslan Ali with AI-assisted implementation. Review and live integration verification remain necessary before submission as a completed deployed project. The repository contains bootstrap Convex API bindings; regenerate them against the selected deployment for concrete generated API types.

## CI template

`ci/github-actions.yml.example` contains the GitHub Actions checks. It is shipped as a template because the publishing token lacks workflow-write scope. To enable CI, copy it to `.github/workflows/check.yml` using an account authorized to manage Actions workflows. No remote CI run is claimed.
