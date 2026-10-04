# Phase 7 — Security Hardening + Full Regression — Product Requirements Document

## Overview
- **Summary**: Apply targeted security hardening to the VELoop Rewards CAPTCHA Earn backend and one low-priority frontend fix, then validate both Phase 5 (Claim flow) and Phase 6 (Frontend UI) still pass all their tests. Output durable, disk-based evidence in `docs/PHASE7_SECURITY_TEST_REPORT.md`.
- **Purpose**: Close concrete security gaps (allow-all CORS, missing HTTP security headers, absent `npm test`, navbar wallet-badge cache lag), re-establish the Phase 5/6 regression baseline after any changes, and leave behind a reproducible security test harness and report.
- **Target Users / Audience**: Maintainers, internship evaluators, anyone auditing the repo for security posture (CORS, headers, JWT, passwords, validation, secrets hygiene).

## Goals
- Perform a written BEFORE-CHANGE security baseline audit of 18 areas (auth, authz, JWT, passwords, validation, rate limiting, CORS, HTTP headers, challenge ownership, expiry, replay, reward manipulation, duplicate verify/claim, concurrency, Mongo injection, malformed input, sensitive exposure, error leakage, secrets, audit logs).
- Install and configure HTTP security headers (`helmet`) in backend without breaking Vite/frontend.
- Replace any CORS allow-all or `origin: true` behavior with env-based (`FRONTEND_URL`) origin allow-listing.
- Validate secret/env hygiene: `.env` in root `.gitignore`, no committed secret values, frontend source free of `correctOption` / `passwordHash` / `JWT_SECRET` / `MONGO_URI`.
- Verify via live HTTP tests that JWT, password, ownership, rate limit, expiry, duplicate-reward, and concurrency invariants all still hold after hardening changes.
- Fix the Phase 6 low-priority frontend issue: Navbar wallet cache badge resyncs after claim (NO frontend wallet arithmetic; only refresh the shared authoritative state already provided by `useWallet` backend refresh). Do NOT remove React StrictMode.
- Add a useful, non-fabricated `npm test` script in backend that runs the project's maintained test suites.
- Re-run full Phase 5 regression (`backend/test-phase5.js`) — require 11/11 LIVE-PASS.
- Re-run Phase 6 critical-path + production build regression.
- Save durable evidence to `docs/PHASE7_SECURITY_TEST_REPORT.md` with `LIVE-PASS` / `LIVE-FAIL` / `BLOCKED` / `NOT-TESTED` vocabulary.

## Non-Goals
- Any frontend redesign, layout change, or new pages beyond the minimal wallet-badge state sync fix.
- Changes to the CAPTCHA generation/reward lifecycle (verify → PENDING → ad-complete → CLAIMED) unless a real test demands it.
- Deployment, hosting configuration, or Phase 8 documentation beyond the Phase 7 test/security report.
- Adding real ad networks, new backend reward features, new user profiles, or new API endpoints beyond existing ones.
- Hiding React StrictMode dev ERR_ABORTED logs by removing StrictMode.

## Background & Context
- Phase 5 (Backend Claim/Concurrency) LIVE-VERIFIED 11/11.
- Phase 6 (React Frontend UI) LIVE-VERIFIED 41/41. Evidence on disk at [PHASE6_TEST_REPORT.md](file:///d:/veloop-captcha-earn/docs/PHASE6_TEST_REPORT.md), [test-phase6.js](file:///d:/veloop-captcha-earn/backend/test-phase6.js), [phase6-api-test-raw.log](file:///d:/veloop-captcha-earn/docs/phase6-api-test-raw.log).
- Known starting-state observations (before audit): `backend/server.js` uses `app.use(cors())` (allow-all CORS) and no security headers; `helmet` is absent from `package.json` dependencies; `backend/package.json` has no `test` script; `.gitignore` lists `.env` in root but we must also confirm backend `.env` files are similarly protected; Navbar `WalletBadge` may display stale value after claim while `WalletCard` (authoritative) already shows new value.
- Test methodology rule: NO result can be marked PASS unless the test actually executed (static source inspection ≠ LIVE-PASS).

## Functional Requirements
- **FR-1 BEFORE-CHANGE baseline audit table**: A 18-row (Area / Status / Evidence) table MUST be produced before any code change and stored in the durable Phase 7 report. Each Area is one of: Auth, Authz, JWT, Passwords, Validation, Rate Limit, CORS, HTTP Headers, Ownership, Expiry, Replay, Reward, Concurrency, Mongo Injection, Error Leakage, Secrets, Audit Logs, Wallet Endpoint.
- **FR-2 Helmet installation**: When `helmet` is not installed, install it in backend and apply `app.use(helmet())` in middleware order before routes. Frontend at `:5173` MUST continue to load and submit forms/requests without CSP/frame/cookie breakage.
- **FR-3 CORS hardening**: CORS configuration MUST derive the allowed origin from a `FRONTEND_URL` environment variable. The configuration MUST reject `'*'` and MUST NOT use `origin: true` as the sole validator. `.env.example` MUST include a safe placeholder. Browser OPTIONS preflight MUST continue to succeed for the configured origin. Unauthorized origins MUST receive non-matching CORS headers (or a 4xx) and cannot make authenticated API requests from script.
- **FR-4 Secrets hygiene**: `.env`, `.env.local`, and all standard env variants MUST be listed in `.gitignore` at root and/or relevant package directories. The final repo-wide grep MUST NOT reveal concrete secret VALUES anywhere in committed files (placeholder NAMES in `.env.example` are allowed).
- **FR-5 JWT live tests**: Invalid/expired/malformed/absent JWTs → protected endpoints return 401. `req.body.userId` or `req.query.userId` cannot override JWT identity for any protected endpoint.
- **FR-6 Passwords**: bcrypt in use; `passwordHash select:false`; API never returns password-hash fields; invalid credentials use generic wording.
- **FR-7 CAPTCHA/Wallet security live tests**: correctOption absent from /current; cross-user 403; expired 410 path; duplicate /verify → 409; duplicate /claim → 409, no wallet double increment; spoofed `rewardAmount`, `gems`, `userId`, `isCorrect`, `correctOption` ignored.
- **FR-8 Concurrency invariants**: 5 concurrent `/verify` → exactly 1 reward created. 5 concurrent `/claim` → exactly 1 wallet increment (backend-side protection). N repeated `/new` → no resurrection, no double reward.
- **FR-9 Rate limiting LIVE test**: Repeated rapid requests eventually return 429.
- **FR-10 Error handling**: HTTP 400/401/403/404/409/410/429/500 return safe user-facing messages; no stack traces, filesystem paths, MongoDB connection strings, or JWT secret fragments.
- **FR-11 Audit logging coverage**: Important events (Challenge Created, Verified, Reward Created/Claimed, Duplicate, Invalid, Expired, Skipped, Suspicious, Ad-completion where applicable) produce `AuditLog` documents without passwords/JWTs/secrets inside them.
- **FR-12 Wallet endpoint**: `GET /api/wallet/gems` requires JWT, ignores any `userId` in query/body, returns only wallet data (`gems` etc.).
- **FR-13 Navbar wallet badge sync after claim**: After a successful claim, every on-screen wallet display (WalletBadge in Navbar, WalletCard, any live count) shows the same authoritative backend value within one render cycle, using existing `useWallet` refresh or shared state. No `wallet += reward` arithmetic.
- **FR-14 `npm test` backend command**: Non-fabricated. Document exactly what it executes. Running it after implementation returns a zero exit-code only if real tests pass. Must not wipe production-like data.
- **FR-15 Phase 5 regression**: `node backend/test-phase5.js` completes with 11/11 LIVE-PASS. If any regression, stop and fix before proceeding.
- **FR-16 Phase 6 regression**: Frontend production build `npm run build` succeeds (BUILD PASS). Full critical user flow (Register → Login → CAPTCHA render → 4 options → option select auto-verify → correct/incorrect state → Watch/Continue to claim → wallet refresh → No Thanks /new → logout) still works, with no Submit button, correctOption absent.
- **FR-17 Durable Phase 7 report**: `docs/PHASE7_SECURITY_TEST_REPORT.md` saved to disk with all required sections, actual HTTP status codes, and final `PHASE 7 VERIFIED / VERIFIED WITH LIMITATIONS / NOT VERIFIED` status.
- **FR-18 Final repository secrets scan**: Full repo grep for `JWT_SECRET`, `MONGO_URI`, `correctOption`, `passwordHash` with correct interpretation (backend trusted code can reference them by name; frontend must not contain business data values; only placeholder names allowed in `.env.example`).

## Non-Functional Requirements
- **NFR-1 Zero Phase 5/6 regression**: After all changes, Phase 5 (11/11) and Phase 6 (critical-path + build) remain LIVE-PASS.
- **NFR-2 Zero secret-value disclosure**: Report and source files never print actual `MONGO_URI`, `JWT_SECRET`, bcrypt salts, or other secrets. Only YES/NO exposure flags and placeholder names.
- **NFR-3 Idiomatic Express 5 + existing middleware stack**: New middleware (helmet, CORS) inserted in standard order before routes. No duplicate middlewares.
- **NFR-4 CSP/security headers and Vite compatibility**: Browser loads the Vite frontend app and HMR (if dev-mode used) without being broken by default Helmet CSP defaults. Where needed, apply a conservative Helmet CSP override just enough to unblock localhost dev frontend + localhost backend API (no overly permissive unsafe-* beyond strictly necessary).
- **NFR-5 Reproducibility**: A new contributor can follow `docs/PHASE7_SECURITY_TEST_REPORT.md` + `test-phase7.js` (if created) to reproduce the security verification on a clean clone.

## Constraints
- **Technical**: Node/Express 5 backend + MongoDB + Mongoose 9; React 18 + Vite frontend; existing test files `backend/test-phase5.js`, `backend/test-phase6.js` preserved.
- **Business**: No reward lifecycle or CAPTCHA logic changes unless an actual LIVE-FAIL mandates it. No fabricated data, fabricated pass marks, or placeholder test commands.
- **Dependencies**: New backend dependency permitted ONLY: `helmet`. Other hardening must be achieved by tightening existing middlewares/env validation.
- **No Deployment**: No deploy/serve/hosting scripts, no cloud configs, no Phase 8 docs.

## Dependencies
- Existing backend packages: `cors`, `express-rate-limit`, `express-validator`, `bcryptjs`, `jsonwebtoken`, `mongoose`, `dotenv` (already installed).
- New backend dependency needed: `helmet` (install only if absent).

## Assumptions
- Tests will be run against a fresh/clean MongoDB instance (or at least clearly separated test data using unique `p7_*` email prefixes) to avoid contaminating real user wallets.
- Frontend is reachable during tests and the Phase 7 execution window keeps backend :5000 + MongoDB up.
- The user profile "bhai" + strict-verify + backend-root-cause preference applies (fix any backend regression rather than masking in frontend).

## Open Questions
- [ ] None. (Scope and stop conditions are fully defined in the Phase 7 execution file.)

---

## Acceptance Criteria

### AC-1: BEFORE-CHANGE baseline audit
- **Type**: `rule`
- **Given**: No application source changes since the Phase 6 verification boundary.
- **When**: Auditors inspect 18 security areas and produce the Area / Status / Evidence table.
- **Then**: Every area is assigned exactly one of {SECURE, NEEDS IMPROVEMENT, N/A} with line-level evidence links to actual file/code paths.
- **Pass Condition**: 18 rows filled, no rows left blank. NEEDS IMPROVEMENT rows list specific gaps (e.g., "CORS: server.js line 12 uses cors() with default origin:'*'").
- **Evidence**: Start-of-report BEFORE-CHANGE table in `docs/PHASE7_SECURITY_TEST_REPORT.md` + grep/ls outputs showing pre-change state.

### AC-2: Helmet installed and security headers present in real HTTP response
- **Type**: `rule`
- **Given**: Backend running.
- **When**: Raw HTTP GET issued to `/api/health` with no special request headers.
- **Then**: Response headers include at least the default Helmet family (e.g. `X-DNS-Prefetch-Control`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy` or `Content-Security-Policy-Report-Only`).
- **Pass Condition**: >= 5 security-relevant headers are present AND frontend page continues to load WITHOUT a CSP-blocked script error on initial :5173 open.
- **Evidence**: Raw response headers dump + browser console 0 new CSP errors.

### AC-3: CORS origin allow-listing via FRONTEND_URL
- **Type**: `rule`
- **Given**: `FRONTEND_URL=http://localhost:5173`.
- **When**: (A) A request has `Origin: http://localhost:5173`. (B) A request has `Origin: https://evil.example`. (C) Preflight `OPTIONS` with `Access-Control-Request-Method: POST` from allowed origin.
- **Then**: (A) Response `Access-Control-Allow-Origin` exactly matches allowed origin (not '*', not reflected unsafely). (B) Response `Access-Control-Allow-Origin` header is either absent or does NOT match the evil origin, and a fetch from that origin fails in the browser. (C) Preflight returns 204 with CORS headers + Vary: Origin where applicable.
- **Pass Condition**: All three subcases satisfy their conditions simultaneously.
- **Evidence**: Three separate HTTP-request response dumps.

### AC-4: Secret/env hygiene
- **Type**: `rule`
- **Given**: Clean repo state after changes + `.gitignore` in force.
- **When**: Grep entire repo for patterns containing concrete secret value syntax (e.g. `mongodb+srv://user:pass@` in tracked files; `JWT_SECRET=<actual>` patterns outside `.env`; etc.). Check `.gitignore` covers: `.env`, `.env.local`, `.env.*.local` variants at root level AND/OR per-package level.
- **Then**: (1) No tracked file contains a real secret VALUE. (2) `.env`-like files are gitignored. (3) Frontend source files contain 0 references to secret variable NAMES `JWT_SECRET` and `MONGO_URI`, and 0 references to sensitive data names `correctOption` and `passwordHash` used as business data.
- **Pass Condition**: 3/3 sub-conditions true. Note: `.env.example` placeholder names are explicitly allowed; backend trusted code reference to `correctOption` / `passwordHash` by schema-name is allowed.
- **Evidence**: `git check-ignore` output for `.env` / `.env.local` at both root and backend dirs; grep outputs for secret names.

### AC-5: JWT identity non-override
- **Type**: `rule`
- **Given**: User A has challenge `cIdA`. User B has token `tokB`.
- **When**: (A) Call `POST /api/captcha/verify` with B's token but body `{challengeId:cIdA, selectedOption:<correct for A>, userId:<A's id>}`. (B) Call `GET /api/wallet/gems?userId=<A's id>` with B's token.
- **Then**: (A) Returns 403 (cross-user forbidden) or 400 (invalid ownership) WITHOUT rewarding B. (B) Returns B's own wallet gems only, NOT A's.
- **Pass Condition**: Both (A)(B) satisfy.
- **Evidence**: Status codes + response bodies + MongoDB wallet docs confirming balances unchanged on wrong target.

### AC-6: CAPTCHA security LIVE invariants
- **Type**: `rule`
- **Given**: 4 fresh users registered; for each a challenge is loaded via `/current`.
- **When**: The sub-actions are run: correctOption absent from response; cross-user verify; wait for expiry (short TTL test OR invoke expiry code path manually for 410); duplicate /verify twice; duplicate /claim twice after correct verify.
- **Then**: All 5 results match expected (no correctOption leak, cross-user=403, expired=410, dup-verify=409, dup-claim=409 with 0 additional wallet increment).
- **Pass Condition**: 5/5.
- **Evidence**: One HTTP trace per sub-action.

### AC-7: Reward/claim concurrency idempotency
- **Type**: `rule`
- **Given**: One correct verification left in PENDING state.
- **When**: (A) 5 concurrent `POST /verify` with SAME challengeId (before first verify succeeds path). (B) 5 concurrent `POST /claim` with SAME challengeId. (C) 5 concurrent `POST /captcha/new` against SAME currently-active challenge.
- **Then**: (A) Exactly 1 reward row and exactly 1 success response; others 409/equivalent. (B) Exactly 1 CLAIMED event; wallet delta exactly 1 reward; other claims return 409 and wallet delta stays 1. (C) Old challenge remains CLOSED/skipped; exactly 1 new active challenge; 0 duplicate rewards.
- **Pass Condition**: (A)(B)(C) all pass.
- **Evidence**: MongoDB document counts before/after + response count arrays showing successes vs. conflict rejections.

### AC-8: Input validation & injection resistance
- **Type**: `rule`
- **Given**: Valid JWT.
- **When**: Submit `/verify` body containing Mongo-injection style inputs e.g. `{"challengeId":{"$gt":""}, "selectedOption":{"$ne":""}}` AND oversized input (> typical limits) AND empty strings AND object forms.
- **Then**: Backend responds with 400 / 422 validation error (NOT 500, NOT any resulting reward/wallet mutation).
- **Pass Condition**: 0 rewards created and 0 wallet gems changed for any injection-style request.
- **Evidence**: Validation error status codes + wallet/reward DB before/after.

### AC-9: Error leakage absent across 400/401/403/404/409/410/429/500
- **Type**: `rule`
- **Given**: Backend running.
- **When**: Craft one request per status code to exercise it.
- **Then**: None of the response bodies or headers include a stack trace, absolute file path (e.g. `D:\`, `/var`), `mongoose.connect`, connection string fragment, or `JWT_SECRET` substring.
- **Pass Condition**: All 8 status code responses clean.
- **Evidence**: Body/headers snippets per status.

### AC-10: Rate-limit LIVE 429 engagement
- **Type**: `rule`
- **Given**: Fresh JWT for a new user, backend rate limiter engaged on captcha/auth routes (current code uses `express-rate-limit`).
- **When**: Rapidly send 65 sequential GET `/current`.
- **Then**: At least one response returns HTTP 429 with a standard body shape.
- **Pass Condition**: Count of 429 >= 1.
- **Evidence**: For-loop log showing a 429 status line.

### AC-11: Audit logging event coverage
- **Type**: `rule`
- **Given**: Run one full correct flow: create → verify(correct) → ad-complete → claim; one wrong verify; one dup claim; one cross-user attempt; one skip (/new).
- **When**: Query `auditlogs` collection by userId afterward.
- **Then**: At minimum the events {Challenge Created, Challenge Verified (×2: correct + wrong), Reward Created, Reward Claimed, Duplicate Claim, Suspicious Request (cross-user), Challenge Skipped} all appear (or nearest equivalent event names as implemented) with `eventType` and `userId` populated and WITHOUT passwords/JWTs in the `metadata` field.
- **Pass Condition**: 7+ distinct events covering the cases, zero secrets inside.
- **Evidence**: Aggregated event names list + sampled doc fields check.

### AC-12: Wallet endpoint isolation
- **Type**: `rule`
- **Given**: User B token, User A id known.
- **When**: `GET /api/wallet/gems?userId=<A_id>` + `POST /api/wallet/gems` (if route exists) with body `{userId:<A_id>}`.
- **Then**: Server returns only B's wallet data OR (for nonexistent POST routes) 404, and NEVER returns A's wallet gems count to B.
- **Pass Condition**: Response gems match B's known balance, not A's.
- **Evidence**: A/B baseline balances read from DB, B query response compared.

### AC-13: Navbar WalletBadge syncs after claim
- **Type**: `rule`
- **Given**: Logged-in user, wallet 2 gems.
- **When**: Correct verify → Watch ad → Continue to claim → Claim succeeds (backend now 3 gems).
- **Then**: (A) Navbar WalletBadge DOM text now shows the same post-claim backend value shown inside WalletCard. (B) The frontend code path causing the update uses a shared state / `useWallet` refresh and does NOT perform `gems += rewardAmount` arithmetic.
- **Pass Condition**: (A) Numerical values displayed in Navbar === WalletCard within 1 render cycle after claim. (B) Code inspection 0 instances of `+=` over wallet/gems in the fix path.
- **Evidence**: Browser post-claim snapshot showing both values identical + grep of frontend/src for `+=` gems/wallet lines returning 0 in relevant files.

### AC-14: Non-fabricated backend npm test command
- **Type**: `rule`
- **Given**: Clean backend install, no network stubs.
- **When**: Run `npm test` in `backend/`.
- **Then**: (A) Command exits with code 0 ONLY if all the tests it invokes actually passed; nonzero otherwise. (B) The report documents exactly what tests `npm test` runs (e.g. `node test-phase4.js && node test-phase5.js && node test-phase6.js` or similar real suite). (C) Running `npm test` never deletes existing wallet data for unrelated users.
- **Pass Condition**: (A)(B)(C) all hold.
- **Evidence**: `cat backend/package.json` scripts block, raw `npm test` exit-code 0 run output, DB no unexpected deletes.

### AC-15: Phase 5 regression remains 11/11 LIVE-PASS
- **Type**: `rule`
- **Given**: Backend + MongoDB up, repo post Phase-7 changes.
- **When**: `node backend/test-phase5.js` completes.
- **Then**: Console output reports exactly "11/11 LIVE-PASS" or equivalent and exit code is 0.
- **Pass Condition**: 11/11 === true.
- **Evidence**: Last 30 lines of stdout + exit code.

### AC-16: Phase 6 critical-path regression
- **Type**: `rule`
- **Given**: Backend :5000 up, frontend built and/or Vite serving.
- **When**: (A) `npm run build` in frontend/ completes successfully. (B) Critical UI flow: Register → Login → CAPTCHA loads with 4 options and correctOption/page userId absent → Select option auto-fires /verify without Submit button → Correct / Wrong state displayed → Watch Ad / Continue → claim → wallet updates → No Thanks /new → new CAPTCHA loaded → Sign-out → attempt navigate to /earn redirects /login.
- **Then**: (A) BUILD PASS. (B) Every step UI confirms result state, network order correct, wallet increments only on /claim, navbar/card in sync (per AC-13).
- **Pass Condition**: All substeps green.
- **Evidence**: Build log tail, browser snapshots/network sequence.

### AC-17: Durable report on disk
- **Type**: `rule`
- **Given**: Phase 7 execution finished.
- **When**: `ls docs/` in repo.
- **Then**: File `docs/PHASE7_SECURITY_TEST_REPORT.md` exists and contains every required section of the Phase 7 execution spec: baseline, changes, tests, status codes, vulnerabilities, fixes, limitations, summary card, Phase 5/6 regressions, final VERIFIED/WITH-LIMITATIONS/NOT VERIFIED line. Uses vocabulary LIVE-PASS/LIVE-FAIL/BLOCKED/NOT-TESTED only.
- **Pass Condition**: File on disk + 24 summary rows populated + final status line present.
- **Evidence**: File-path LS output + grep showing section headings present.

### AC-18: Final full repo secrets scan
- **Type**: `rule`
- **Given**: Repo final state.
- **When**: Grep full `D:\veloop-captcha-earn` (excluding node_modules, dist, .git, .env itself) for `JWT_SECRET`, `MONGO_URI`, `correctOption`, `passwordHash`.
- **Then**: (1) `correctOption` and `passwordHash` occurrences exist ONLY in backend-trusted model/service/controller code under `backend/src`. 0 occurrences in `frontend/src/` as business data. (2) `JWT_SECRET` / `MONGO_URI` occurrences: ONLY in `.env.example` placeholder names and backend server/middleware loading by variable name. 0 occurrences in any tracked file of concrete secret VALUES that match the `.env` file actual values (masked yes/no only — no value printing).
- **Pass Condition**: All four patterns fall within allowed boundaries.
- **Evidence**: Grep output (filenames + line numbers only, NO value bodies).

### AC-19: Workflow & traceability (rubric)
- **Type**: `rubric`
- **Dimension**: Spec → Task → Evidence traceability.
- **Scale**: 1 (low) — 3 (acceptable) — 5 (strong)
- **Anchors**:
  - 1 = ACs incomplete, tasks.md missing or does not map AC-IDs, completion evidence sparse.
  - 3 = Every AC-ID appears in at least one task, every task has ≥1 TR, and completed tasks attach command-output evidence.
  - 5 = Every AC-ID maps explicitly to ≥1 TR-id in tasks.md; every TR has a corresponding log/snippet link in a task's Completion Evidence; report sections cite AC-IDs.
- **Pass Threshold**: ≥ 4
- **Evidence**: Cross-reference spec.md AC list ↔ tasks.md AC Addressed ↔ report sections.

### AC-20: Security hardening scope discipline (rubric)
- **Type**: `rubric`
- **Dimension**: Scope discipline and regression risk minimization.
- **Scale**: 1 (high-risk / out-of-scope changes) — 3 (acceptable) — 5 (tight discipline, minimal changes)
- **Anchors**:
  - 1 = Unrelated refactors, reward lifecycle logic rewrites, frontend layout changes, React StrictMode removal present.
  - 3 = New middlewares + env vars only; minor frontend wallet-sync fix uses existing state primitives; StrictMode untouched.
  - 5 = Every diff line is justified by a NEEDS IMPROVEMENT audit row; zero cosmetic-only code churn.
- **Pass Threshold**: ≥ 4
- **Evidence**: Git-style delta summary (added/removed lines per file) + per-file rationale mapped to baseline NEEDS rows.
