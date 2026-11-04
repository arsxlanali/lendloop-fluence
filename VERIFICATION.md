# Verification record - 4 November 2026

## Automated checks

- 14 tests passed across `tests/security.test.ts` and `tests/workflows.test.ts`.
- TypeScript check passed.
- Next.js 16.4.5 production build passed, including a rebuild after correcting unconfigured Clerk middleware startup.
- Local production startup inspected in browser on 127.0.0.1:3108: setup screen renders without keys.

## Coverage

- Anonymous write rejection and public-field projection.
- Owner/participant/admin authorization and private loan visibility.
- Self-borrowing, invalid dates, duplicate requests and conflicting approvals.
- Returns and listing retirement preserving loan history.
- Idempotent reminder writes and stale date rejection.
- Unsigned HTTP rejection and valid signed requests.
- Signature tampering, stale timestamps, wrong routes.
- Delivery lease ownership, terminal retry exhaustion, stale attempt protection.
- Interoperability between exported n8n Code-node signing/verification and Convex HTTP signatures.

## Not yet verified

- Real Clerk login and JWT exchange with deployed Convex.
- Real concurrent cloud mutations (mock tests exercise conflict rejection sequentially; serializability relies on Convex’s documented transaction model).
- Workflow import / execution inside n8n; Docker unavailable here.
- Complete authenticated browser flows and provider network failures.

This is a locally prepared take-home source submission, not a claim of a deployed, operational product. The applicant should inspect it and complete the README acceptance checklist before representing it as fully validated.
