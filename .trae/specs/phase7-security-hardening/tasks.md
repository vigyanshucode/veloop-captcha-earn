# Phase 7 — Implementation Plan (tasks)
Repository: VELoop CAPTCHA Earn
Spec: [spec.md](file:///d:/veloop-captcha-earn/.trae/specs/phase7-security-hardening/spec.md)

Every task records a binary `rule` Test Requirement (TR) and/or evaluative `rubric` TR plus the AC IDs it closes. Evidence is recorded in-line for each completed item. No task is marked `completed` until every TR passes with observable, non-fabricated evidence.

---

## Task 1: BEFORE-CHANGE security baseline audit (read-only, no code changes)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - Read backend `server.js`, middleware, routes, controllers, models, `.env.example`, `.gitignore`, frontend src files.
  - Produce a 19-row Area/Status/Evidence BEFORE table covering: Auth, Authz, JWT, Passwords, Validation, Rate Limit, CORS, Headers, Ownership, Expiry, Replay, Reward, Concurrency, Mongo Injection, Error Leakage, Secrets, Audit Logs, Wallet Endpoint, Navbar Wallet Sync.
  - Save results as the opening section of `docs/PHASE7_SECURITY_TEST_REPORT.md` (create file skeleton).
- **Acceptance Criteria Addressed**: AC-1, AC-4 (pre-hygiene pre-state), AC-19 (traceability).
- **Test Requirements**:
  - `rule` T1.1: BEFORE table has exactly 19 rows, each with one of {SECURE, NEEDS IMPROVEMENT, N/A} and a line-level file path or HTTP result as Evidence; no blank cells.
  - `rule` T1.2: Zero application files are modified during this task (git status shows only docs/ changes if any).
- **Notes**: MUST run BEFORE Task 2 onwards.

## Task 2: Install and configure Helmet HTTP security headers (backend)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 1 (audit complete, CORS/Headers marked NEEDS IMPROVEMENT)
- **Description**:
  - `npm install helmet` inside `backend/` only (if not present).
  - Insert `app.use(helmet())` (with minimal crossOriginResourcePolicy/necessary CSP overrides so `:5173` frontend continues loading Vite scripts/styles from `:5000` API) BEFORE route registration in [server.js](file:///d:/veloop-captcha-earn/backend/server.js#L1-L15), AFTER `express.json()`.
  - Ensure default Frameguard, X-Content-Type-Options, Referrer-Policy, CSP are on. Where CSP default blocks dev Vite inline/HMR, add a targeted dev CSP allow-list only; avoid global 'unsafe-inline'/'unsafe-eval' in production.
- **Acceptance Criteria Addressed**: AC-2, NFR-3, NFR-4, AC-20 scope discipline.
- **Test Requirements**:
  - `rule` T2.1: Raw HTTP GET `/api/health` response includes ≥ 5 of these security headers: `X-DNS-Prefetch-Control`, `X-Frame-Options` (= DENY or SAMEORIGIN), `X-Content-Type-Options` (= nosniff), `Referrer-Policy`, `Strict-Transport-Security` or `Content-Security-Policy` / `-Report-Only`.
  - `rule` T2.2: Open `http://localhost:5173/earn` in integrated browser. Browser console 0 new CSP-blocked script/stylesheet errors; CAPTCHA page continues to render and 4 option buttons remain clickable.
  - `rubric` T2.3: Scope discipline (dimension: security-diff minimality). Scale 1-5. Anchors: 1 = unrelated middleware/code added; 3 = helmet + CSP overrides only; 5 = ONLY helmet added + a targeted CSP override (no more than ~15 lines added to server.js, package.json single new dep). Pass threshold: ≥ 4.
- **Notes**: Keep CSP overrides narrow; do NOT disable all Helmet defaults.

## Task 3: CORS origin allow-listing via FRONTEND_URL (env-based)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 2
- **Description**:
  - Replace `app.use(cors())` (allow-all) in [server.js:12](file:///d:/veloop-captcha-earn/backend/server.js#L12-L12) with a whitelist validator that reads `process.env.FRONTEND_URL` (default `http://localhost:5173`). Reject non-whitelisted origins (do not use `origin: true`). Ensure OPTIONS preflight returns 204 / 200 + Vary: Origin + ACAO.
  - Add `FRONTEND_URL=` line + description to [.env.example](file:///d:/veloop-captcha-earn/backend/.env.example).
  - If missing, add `FRONTEND_URL=http://localhost:5173` to backend's local `.env`.
- **Acceptance Criteria Addressed**: AC-3, NFR-3, AC-20.
- **Test Requirements**:
  - `rule` T3.1: Request with `Origin: http://localhost:5173` → Response `Access-Control-Allow-Origin: http://localhost:5173` AND no `*`.
  - `rule` T3.2: Request with `Origin: https://evil.example` → Response either (a) has NO `Access-Control-Allow-Origin` header, or (b) has a header value that does NOT equal `https://evil.example`. A browser-initiated fetch to the API from that origin MUST fail CORS.
  - `rule` T3.3: OPTIONS preflight `Access-Control-Request-Method: POST` + valid origin → HTTP 204, `Access-Control-Allow-Origin: <origin>`, `Access-Control-Allow-Methods` includes POST, OPTIONS.
  - `rule` T3.4: `.env.example` contains a line for `FRONTEND_URL=` placeholder.
- **Notes**: Never echo arbitrary Origin header.

## Task 4: Environment/gitignore secret-hygiene hardening
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 1
- **Description**:
  - Inspect [.gitignore](file:///d:/veloop-captcha-earn/.gitignore) + frontend/backend package `.env` files. Add entries if any standard env-file variant is missing protection. Add `docs/*.actual-secrets.txt`, `.env.override` and Trae-specific long-text storage subdirectories are already outside repo (not needed).
  - Run `git check-ignore -v backend/.env backend/.env.local frontend/.env frontend/.env.local .env .env.local` at repo root. Confirm each is covered by a gitignore rule.
  - Optionally add backend/.gitignore lines if the root .gitignore doesn't cover backend/frontend nested `.env*`.
  - Grep ENTIRE repo (excluding `.git`, `node_modules`, `dist`, actual `.env` on disk, frontend `.env` actual on disk) for lines that look like real secret VALUES.
- **Acceptance Criteria Addressed**: AC-4, AC-18.
- **Test Requirements**:
  - `rule` T4.1: Each of `.env`, `.env.local`, `.env.development.local`, `.env.production.local` at root AND `.env`, `.env.local` in backend/ AND frontend/ returns "gitignore hit" from `git check-ignore -v`.
  - `rule` T4.2: Full repo search for concrete `mongodb+srv://` connection strings (values, not variable refs) in TRACKED files returns 0 matches. Search for JWT secret-like values (strings >= 32 chars assigned to `*SECRET*` in tracked files outside backend `.env`) returns 0 matches. Report only counts, no values printed.

## Task 5: Automated Phase 7 API + security + concurrency test harness (Node + MongoDB direct reads)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Tasks 2, 3 (helmet/cors must be in place first for live tests to reflect hardened state)
- **Description**:
  - Create `backend/test-phase7.js` that runs all the security live tests via Node HTTP and Mongoose direct reads (reuse pattern from test-phase5/6). Uses emails prefixed `p7_*` to not collide with prior data.
  - Cover sub-tests: Headers present / CORS 3 origins (good + evil + OPTIONS) / JWT invalid/expired/malformed variants / Passwords: verify no passwordHash leak in /me / Input validation: Mongo-injection shapes / Wrong verify fractional 0.5 / Dup verify 409 / Cross-user verify 403 / Duplicate claim 409, no wallet bump / Concurrent 5 verify (exactly 1 reward) / Concurrent 5 claim (exactly 1 wallet delta) / Rate limit 429 / Expiry path 410 or equivalent validation / No correctOption in /current / Wallet endpoint ignores `?userId=` in query / Reward spoof fields ignored.
- **Acceptance Criteria Addressed**: AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-16 (partial).
- **Test Requirements**:
  - `rule` T5.1: Script exits with 0 if ALL its own assertions pass, nonzero otherwise.
  - `rule` T5.2: For each sub-test named above, there is a corresponding `[LIVE-PASS]` line OR if it genuinely cannot be run, a `[BLOCKED]` with reason. No fabricated PASS entries.
  - `rule` T5.3: Concurrency tests use `Promise.all` on 5 actual parallel HTTP calls. MongoDB post-test doc counts `Claim / RewardCreated / WalletDelta` exactly match expected (1 reward, 1 delta claim, 0 dup wallet increments).
- **Notes**: Do NOT delete unrelated data at end of tests (non-destructive).

## Task 6: Frontend — Navbar WalletBadge sync fix (low priority issue)
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 5 (but not coupled; safe to run in parallel — only touches frontend hooks/context/navbar)
- **Description**:
  - Inspect current wallet state flow: [useWallet.js](file:///d:/veloop-captcha-earn/frontend/src/hooks/useWallet.js) → [WalletBadge](file:///d:/veloop-captcha-earn/frontend/src/components/wallet/WalletBadge.jsx) inside [Navbar.jsx](file:///d:/veloop-captcha-earn/frontend/src/components/layout/Navbar.jsx) vs [WalletCard.jsx](file:///d:/veloop-captcha-earn/frontend/src/components/wallet/WalletCard.jsx) used on Earn page.
  - Ensure both Badge and Card consume the SAME shared backend-authoritative state (e.g. a single context, or `useWallet` returns one shared `gems` value). When a claim resolves in [useCaptcha.js](file:///d:/veloop-captcha-earn/frontend/src/hooks/useCaptcha.js) it refreshes that ONE shared value (via `useWallet.refresh()` or a provider setter), so both displays update together.
  - NO `gems += rewardAmount` arithmetic anywhere. The refresh must call `GET /api/wallet/gems` or accept the claim response's authoritative `data.gems`.
  - DO NOT remove React StrictMode from [main.jsx](file:///d:/veloop-captcha-earn/frontend/src/main.jsx).
- **Acceptance Criteria Addressed**: AC-13, NFR-1.
- **Test Requirements**:
  - `rule` T6.1: After Claim completes (hard-coded test account `phase6_tester_1003@veloop.io` or newly registered p7 account used), both `.vl-wallet-badge__value` textContent and `.vl-wallet-card__gems` textContent parse to the same integer for that render (within 0 re-renders difference).
  - `rule` T6.2: Grep `frontend/src` for patterns `gems\s*\+=` or `wallet\s*\+=` or `rewardAmount\s*\+` → returns 0 matches in the changed files.
  - `rubric` T6.3: Fix minimality. Scale 1-5. Anchors: 1 = new global store + many files changed; 3 = useWallet/useCaptcha adjusted; 5 = only useWallet hook + one call site updated, shared atoms/context reused. Pass threshold: ≥ 4.
- **Notes**: Do NOT rename wallet CSS classes or change visual layout unless necessary.

## Task 7: Backend `npm test` command (non-fabricated)
- **Status**: `pending`
- **Priority**: medium
- **Depends On**: Task 5
- **Description**:
  - Edit `backend/package.json` scripts block. Add `"test": "node test-phase4.js && node test-phase5.js && node test-phase6.js && node test-phase7.js"`.
  - Run it once. Ensure exit codes chain properly (only 0 if ALL four scripts pass 0).
  - Document the exact command list it runs in the Phase 7 report.
- **Acceptance Criteria Addressed**: AC-14, AC-15 (partial), AC-16 (partial).
- **Test Requirements**:
  - `rule` T7.1: `npm test` string in package.json scripts refers to REAL test files that exist on disk (none are missing).
  - `rule` T7.2: Running `npm test` after the Phase 5/6/7 suites all still LIVE-PASS returns process exit code 0 AND the output contains the expected per-suite heading lines.

## Task 8: Run Phase 5 regression (11/11 required)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Tasks 2, 3, 4, 5, 7 (after hardening changes applied and test file exists)
- **Description**:
  - `node backend/test-phase5.js` from repo root.
  - If any of 11 checks FAIL, stop. Revert or fix the change that caused regression (prefer fixing backend root cause, not masking in frontend). Re-run until 11/11.
  - Save last 30 lines of stdout to `docs/phase7-phase5-regression.log` or paste directly into Phase 7 report §Regression.
- **Acceptance Criteria Addressed**: AC-15, NFR-1.
- **Test Requirements**:
  - `rule` T8.1: Console output contains "11/11" LIVE-PASS summary (or equivalent), and Node exit code is 0.
  - `rule` T8.2: After the suite runs, NO wallet delta outside what's expected from p5_* user accounts exists; unrelated user wallets unchanged.

## Task 9: Run Phase 6 regression (build + critical flow)
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Task 6 (navbar sync), Task 8 (Phase 5 green)
- **Description**:
  - `frontend/ npm run build` → BUILD PASS.
  - Integrated browser critical path: fresh p7 user registered → login → /earn → CAPTCHA render + 4 options + correctOption/page userId absent + submitLikeCount=0 → click wrong option → auto verify → Not quite right / 0.5 reward → No Thanks /new → /new fired → new CAPTCHA text → now correct flow → auto verify → correct → watch ad → Continue → claim → wallet pre=X, post=X+1, Navbar wallet badge === WalletCard value → sign out → navigate /earn → redirected /login.
- **Acceptance Criteria Addressed**: AC-13, AC-16, NFR-1.
- **Test Requirements**:
  - `rule` T9.1: BUILD PASS (Vite exit code 0).
  - `rule` T9.2: Browser flow all steps PASS (no failures, wallet correct delta, no correctOption exposed, no Submit button).
  - `rule` T9.3: Navbar wallet text === WalletCard wallet text (numeric) captured after Claim snapshot.

## Task 10: Final repo-wide secrets scan + final evidence assembly + `docs/PHASE7_SECURITY_TEST_REPORT.md`
- **Status**: `pending`
- **Priority**: high
- **Depends On**: Tasks 1–9
- **Description**:
  - Run final grep for `JWT_SECRET`, `MONGO_URI`, `correctOption`, `passwordHash` across entire repo (exclude node_modules, dist, .git, actual .env on disk). Interpret per AC-18 rules.
  - Assemble `docs/PHASE7_SECURITY_TEST_REPORT.md`:
    - BEFORE table (from Task 1)
    - BEFORE→AFTER summary per area
    - Changes made (per file, linked)
    - Headers / CORS live results (T2/T3)
    - Env hygiene results (T4)
    - Security harness (T5) summary pass/fail + Concurrency counts
    - Passwords / JWT / Validation / Ownership / Expiry / Replay / Reward / Error leakage
    - Audit log events covered + no-secret-in-audit
    - Wallet endpoint test
    - Navbar wallet sync fix evidence
    - `npm test` command documented + run result
    - Phase 5 regression result: `__/11`
    - Phase 6 regression result (build PASS/FAIL + flow)
    - Security issues found count
    - Security issues fixed count
    - Remaining limitations (e.g., Helmet CSP in dev allows more than prod)
    - Final 24-line Phase 7 SUMMARY CARD (exactly per spec 21 report template)
    - Final status `PHASE 7 VERIFIED / VERIFIED WITH LIMITATIONS / NOT VERIFIED`.
- **Acceptance Criteria Addressed**: AC-1, AC-17, AC-18, AC-19, AC-20.
- **Test Requirements**:
  - `rule` T10.1: `docs/PHASE7_SECURITY_TEST_REPORT.md` exists and has the 24-line summary card with at least 20/24 rows populated by LIVE results.
  - `rule` T10.2: Final grep respects AC-18 rules (no false-positive failures for backend-trusted references / `.env.example` placeholders).
  - `rubric` T10.3 (AC-19): Traceability. Scale 1-5. Pass threshold ≥ 4.
  - `rubric` T10.4 (AC-20): Scope discipline. Scale 1-5. Pass threshold ≥ 4.

---

## Queue Contract
Queue is drained only when every task is `completed` (or `cancelled` with user approval), all `rule` TRs pass, all `rubric` TRs meet their threshold, and no `blocked` items remain.
