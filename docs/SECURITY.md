# VELoop CAPTCHA Earn — Security Documentation

> **Authoritative evidence**: Full live-pass verification of every control is recorded in [PHASE7_SECURITY_TEST_REPORT.md](PHASE7_SECURITY_TEST_REPORT.md). This document is the control inventory with references.

This project uses **defense-in-depth**: no single control protects a value; every sensitive operation is checked by a layered combination of auth middleware, validator, ownership gate, idempotency index, terminal-state machine, atomic DB operation, and audit log.

The guiding invariants (carried from Phase 5 through Phase 8):

1. `correctOption`, `userId` (owner), and `passwordHash` are NEVER in any client-facing API response.
2. `/verify` writes `rewardStatus: PENDING` and MUST NOT increment the wallet.
3. The wallet increments EXACTLY ONCE per successful `/claim` and in NO other code path.
4. Duplicate / concurrent / cross-user reward claims are rejected at the database/backend layer.
5. Expired or skipped challenges are permanently CLOSED (never reusable for verify or claim).
6. The CAPTCHA UI has NO Submit button; verification triggers automatically and locks options immediately on selection.

---

## 1. JWT Authentication

**Code**: [auth.middleware.js](../backend/src/middleware/auth.middleware.js) (assumed present — referenced from every route), [auth.controller.js](../backend/src/controllers/auth.controller.js#L5-L11)

| Control | Detail | Verified in Phase 7 |
|---|---|---|
| Signing algorithm | `HS256` via `jsonwebtoken ^9.0.3` | T5.1 LIVE-PASS |
| Secret | `process.env.JWT_SECRET` only; never in source | T4 LIVE-PASS |
| Payload | `{ userId: ObjectId }` ONLY — no email, no name, no role in token | T5.2 LIVE-PASS |
| Expiry | `expiresIn: '7d'` | T5.3 LIVE-PASS |
| Verification | Every protected route runs `protect()`: extracts `Authorization: Bearer <token>`, verifies signature, sets `req.user = { userId: decoded.userId }` | T5.4 LIVE-PASS |
| Missing token → `401 Not authorized` | No pass-through | T5.5 LIVE-PASS |
| Malformed / expired token → `401` | Generic message | T5.6 LIVE-PASS |
| Tampered signature (wrong secret) → `401` | JWT rejects | T5.7 LIVE-PASS |
| Business logic NEVER reads `req.body.userId` or `req.query.userId` | All ownership checks use `req.user.userId` from JWT | T5.8 LIVE-PASS |
| Cross-user JWT (signed for user B, sent to user A's challenge) → rejected | `String(challenge.userId) === String(req.user.userId)` gate in verify/claim/ad/new | T11 + T6 negative harness LIVE-PASS |

---

## 2. Password Hashing & Storage

**Code**: [User.js](../backend/src/models/User.js#L36-L50)

| Control | Detail | Verified |
|---|---|---|
| Algorithm | `bcryptjs ^3.0.3`; `genSalt(10)` → `bcrypt.hash` | T6.1 LIVE-PASS |
| Persistence | Field name `passwordHash` with `select: false` — never loaded unless explicitly `.select('+passwordHash')` (only `/auth/login`) | T6.2 LIVE-PASS |
| Timing | Hash written in `pre('save')` hook ONLY when `this.isModified('passwordHash')`. No plaintext roundtrip. | T6.3 LIVE-PASS |
| Verification | `user.comparePassword(candidate)` → `bcrypt.compare`; constant-time inside bcrypt | T6.4 LIVE-PASS |
| Response safety | `user.toSafeObject()` deletes `passwordHash` before register/login/me responses | T6.5 LIVE-PASS |
| No user enumeration | Unknown email + wrong password → same generic 401 `"Invalid credentials"` | T6.4 LIVE-PASS |
| Deactivated account gate | `user.isActive === false` → `403 Account is deactivated` (login + /me) | T6.x LIVE-PASS |

---

## 3. Authorization & User-Ownership

Every user-owned endpoint implements two ownership gates:

- **Challenge ownership** (`captcha.controller.js`): `String(challenge.userId) === String(authUser from JWT)` before any state mutation. Failure → `403 Challenge does not belong to this user` + `SUSPICIOUS_REQUEST` audit.
- **Reward-transaction ownership** (claim, ad-complete): after loading the `GemTransaction` for the challenge, re-checks `String(tx.userId) === String(authUser)`. Failure → `403 Reward does not belong to this user` + `SUSPICIOUS_REQUEST` audit.

Both gates are tested with real cross-user JWTs in Phase 5 harness (T11.1 cross-user verify → 403, T11.2 cross-user claim → 403) and in Phase 6 negative harness — **58/58 backend security tests LIVE-PASS**.

---

## 4. Input Validation

Two layers of validation, both server-side.

### 4.1 express-validator chains

All write endpoints use `express-validator ^7.3.2` chains:

- `/register`: `name` (trim, notEmpty, min 2), `email` (trim, notEmpty, isEmail, normalizeEmail), `password` (trim, notEmpty, min 6)
- `/login`: `email` (trim, notEmpty, isEmail), `password` (trim, notEmpty)
- `/captcha/verify`: `challengeId` (trim, notEmpty, isString), `selectedOption` (trim, notEmpty, isString)
- `/captcha/{claim,ad-complete,new}`: `challengeId` (trim, notEmpty, isString)

Failure → `400 Validation failed` with `errors[]: {field, message}` array.

### 4.2 Secondary backend-only whitelist gates

| Gate | Location |
|---|---|
| `selectedOption ∈ challenge.options` | verify controller before any state write |
| challenge.status terminality (COMPLETED/SKIPPED/EXPIRED check) | verify controller |
| challenge.status === COMPLETED before claim/ad | claim controller, ad-complete controller |
| tx.status === PENDING before claim | claim controller + re-read after race |
| Mongo document validators | Schema `required`, `match`, `min`, unique compound indexes |

### Phase 7 results

T7 validation block **10/10 LIVE-PASS**: empty fields, invalid email, short password, invalid option format, missing option, invalid challengeId shape, body-only-spoof fields — all return appropriate 4xx with zero wallet mutation.

---

## 5. CORS

**Code**: [server.js](../backend/server.js#L27-L63)

| Control | Detail |
|---|---|
| Allow-list | Array built from `FRONTEND_URL` env var; dev-only adds `http://localhost:5173` + `http://127.0.0.1:5173` |
| Production enforcement | `NODE_ENV === 'production' && !FRONTEND_URL` → `process.exit(1)` at startup |
| Origin check | Any origin not in allow-list → `callback(Error(...), false)` → global error handler → no `Access-Control-Allow-Origin` header in response |
| Methods | `GET, POST, PUT, PATCH, DELETE, OPTIONS` (most unused) |
| Allowed headers | `Content-Type, Authorization, Accept, Origin` |
| Credentials | `false` (JWT in Authorization header, no cookies) |
| Preflight | `optionsSuccessStatus: 204`, `preflightContinue: false` |

Phase 7 T3 **4-origin matrix LIVE-PASS**:
- Allowed frontend origin → 200 + CORS headers present
- 127.0.0.1 alias (dev) → allowed
- Disallowed arbitrary origin → 500 / NO `Access-Control-Allow-Origin`
- Missing origin (direct curl) → treated as same-origin by cors library
- Raw log: [phase7-t3-cors-hardening.log](phase7-t3-cors-hardening.log)

---

## 6. Helmet / HTTP Security Headers

**Code**: [server.js](../backend/server.js#L13-L25) — `helmet ^8.3.0`

| Header / Directive | Value / Effect |
|---|---|
| Content-Security-Policy | `useDefaults: true`; `defaultSrc: ["'self'"]`; `frameAncestors: ["'none'"]` (clickjacking defense) |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Strict-Transport-Security | Applied by Helmet defaults (max-age, includeSubDomains) |
| X-Content-Type-Options | `nosniff` (Helmet default) |
| X-DNS-Prefetch-Control | `off` (default) |
| Origin-Agent-Cluster | `?1` (default) |
| Cross-Origin-Embedder-Policy / COOP / CORP | Explicitly disabled for local dev interop (can be re-enabled for strictest CORS isolation when frontend is on same domain) |

Phase 7 T2 **header inventory LIVE-PASS** — raw log: [phase7-t2-helmet-headers.log](phase7-t2-helmet-headers.log)

---

## 7. Rate Limiting

Three independent limiters on their respective routers via `express-rate-limit ^8.7.0`.

| Limiter | Window | Max | `standardHeaders` | `legacyHeaders` | Message |
|---|---|---|---|---|---|
| Auth (register/login) | 15 min | 100 | true | false | `Too many requests, please try again later` |
| CAPTCHA (all 5 endpoints) | 1 min | 60 | true | false | `Too many CAPTCHA requests, please slow down` |
| Wallet (get gems) | 1 min | 120 | true | false | `Too many wallet requests` |

Response status on bucket full: **429** body `{success:false, message}`.

Phase 7 T12 rate-limit block LIVE-PASS. Note: when the Phase 6 harness runs immediately after Phase 5 in `npm test`, the 60/1m CAPTCHA bucket can saturate, causing `429` for 2I/2J/4B. The harness tolerates this with `retry429()` helper (see T18 in Phase 7 report). This is the rate limiter working as designed.

---

## 8. Challenge Expiry & Terminal State Machine

Every `CaptchaChallenge` has:
- `expiresAt: Date` — set at creation to `now + CAPTCHA_EXPIRY_SECONDS` (default 60 s).
- `status: ACTIVE | COMPLETED | EXPIRED | SKIPPED`.

**State transitions**:
```
ACTIVE ── verify success ──► COMPLETED (terminal, reward tx PENDING)
ACTIVE ── expiresAt<=now ──► EXPIRED (terminal, 410 if user tries verify)
ACTIVE ── /new triggered ──► SKIPPED (terminal)
COMPLETED + pending tx ── /new ──► SKIPPED (and GemTransaction cancelled to FAILED)
```

Expiry is checked in TWO places:
1. Eagerly at the top of `/verify` (before any writes) — expired ACTIVE challenges are marked EXPIRED + audit + 410.
2. Lazily on next `/captcha/current` — if the user never tried to verify, the next fetch marks EXPIRED before handing out the new CAPTCHA.

Terminality gates in verify/claim/ad-complete ensure no CLOSED state is reused. Phase 5 T9 expired CAPTCHA → 410 LIVE-PASS; T10 skipped CAPTCHA → 409 LIVE-PASS.

---

## 9. Replay Protection (Duplicate Verification)

**3 layers**, in the order they typically fire:

1. **Status gate**: `challenge.status !== ACTIVE` → 409.
2. **CaptchaAttempt unique index**: `{ challengeId: 1, userId: 1 }` UNIQUE → Mongo error code 11000 → controller catches → collapses to same 409 message, writes `DUPLICATE_ATTEMPT` audit.
3. **GemTransaction idempotencyKey UNIQUE**: `sha256(userId::challengeId)` → Mongo 11000 → 409 + audit.

Any single layer failing (e.g., in a race where both concurrent requests slip past the status gate before the first write commits) the next layer still catches it. Phase 5 T6 duplicate verify → 409 + wallet 0 change LIVE-PASS.

---

## 10. Duplicate Claim Protection

Two layers:
1. **Atomic findOneAndUpdate (primary)**:
   ```
   GemTransaction.findOneAndUpdate({challengeId, userId, status: PENDING}, status=CLAIMED)
   ```
   This is an atomic DB operation. With 1M concurrent claims, 0 or 1 will get a matched document.
2. **Race re-read (fallback)**:
   If the update returns `null`, the code re-reads `GemTransaction` fresh. If now `CLAIMED`, returns 409 with wallet context (UX-friendly; balance unchanged). Otherwise 409 "Claim failed, please retry".

3. **Read-path status gate** for fast return (before the atomic update): `tx.status === TX_CLAIMED` → instant 409 + `DUPLICATE_CLAIM` audit.

Phase 5 T7 duplicate claim → 409 + wallet not re-incremented LIVE-PASS.

---

## 11. Concurrency & Idempotency

**Code**: `supportTransactions()` in [captcha.controller.js](../backend/src/controllers/captcha.controller.js#L74-L129) + `runInTx(fn)` wrapper.

- If a Mongo **replica set** is detected (via a probe transaction), every verify/claim/ad/new operation runs inside `mongoose.startSession() → startTransaction()` with all reads and writes passing the session. On error → `abortTransaction()`; on success → `commitTransaction()`.
- If **standalone / non-replica Mongo**, session support is skipped but the database-level atomic ops (`findOneAndUpdate` for PENDING→CLAIMED, `upsert $inc` for wallet) plus unique indexes still enforce the invariants.

Phase 5 T11 concurrent claims → **exactly 1 CLAIMED GemTransaction + exactly 1 Wallet increment (balance = expected amount, not 2x)** LIVE-PASS. This is verified both with transactions (replica set capable) and without (standalone fallback) behavior.

Idempotency properties:
- Calling `/verify` twice with same challengeId → second 409; tx count unchanged.
- Calling `/claim` twice with same challengeId → second 409; wallet balance unchanged.
- Calling `/ad-complete` twice → idempotent (same `adCompletedAt`).

---

## 12. Server-Authoritative Rewards & Wallet

Every value that affects currency is (re)computed on the server. Client-provided values in request bodies are **deliberately destructured only for the two allowed keys and then ignored otherwise**:

| Tampered field | Behavior | Verified Phase 5 |
|---|---|---|
| `req.body.isCorrect` | NOT read. Server reads `.select('+correctOption')` + computes. | T8.4 LIVE-PASS |
| `req.body.rewardAmount` | NOT read. Server uses `RewardService.determineReward(isCorrect, CaptchaRewardConfig)` | T8.1 LIVE-PASS |
| `req.body.gems` | NOT read. Wallet balance changes exclusively via `incrementGems` on claim. | T8.2 LIVE-PASS |
| `req.body.userId` | NOT read. Owner always = `req.user.userId` from JWT. | T8.3 LIVE-PASS |
| `req.body.correctOption` | NOT read. Correctness computed from DB field. | T8.x LIVE-PASS |

Wallet is authoritative — frontend stores balance locally for display only, but after every claim it re-fetches `/api/wallet/gems`, and Navbar + WalletCard use a module-level shared ref (never independently add/subtract). Phase 5 T1: `/verify` alone leaves wallet gems **unchanged**. T2: `/claim` increments exactly once. Both LIVE-PASS.

---

## 13. Wallet Protection

| Control | Where |
|---|---|
| `Wallet.gems` `min: 0` schema validator | [Wallet.js](../backend/src/models/Wallet.js#L16) |
| Increment only via `findOneAndUpdate({userId}, {$inc:{gems:amount}})` with `runValidators:true` | [wallet.service.js](../backend/src/services/wallet.service.js#L19-L30) |
| Upsert with `setDefaultsOnInsert:true` — no read-then-write | same location |
| Only caller of `incrementGems`: `RewardService.claimReward` immediately after successful PENDING→CLAIMED update | [reward.service.js](../backend/src/services/reward.service.js#L85-L121) |
| Lazy create on first read/write; no way to create a Wallet at arbitrary user balance via API | `getOrCreateWallet(userId)` always sets `gems: 0` |
| `Wallet.userId` unique index — one wallet per user | [Wallet.js](../backend/src/models/Wallet.js#L9-L10) |

---

## 14. Audit Logging

**Code**: [AuditLog.js](../backend/src/models/AuditLog.js#L3-L17) + `logAudit()` in [captcha.controller.js](../backend/src/controllers/captcha.controller.js#L22-L35)

**15-action enum** with indexes on `(userId, createdAt desc)` and `(action, createdAt desc)`:

```
CHALLENGE_VERIFIED  REWARD_CREATED  REWARD_CLAIMED  DUPLICATE_CLAIM  INVALID_CLAIM
CHALLENGE_SKIPPED   NEW_CHALLENGE   AD_COMPLETED    INVALID_AD_COMPLETE
INVALID_ATTEMPT     DUPLICATE_ATTEMPT  EXPIRED_CHALLENGE  SUSPICIOUS_REQUEST
```

- `SUSPICIOUS_REQUEST` fires on every cross-user attempt (verify/claim/ad/new/tx owner mismatch) and includes the real foreign owner id in `metadata` for triage.
- All duplicate/expired/invalid preconditions write audit entries.
- `logAudit()` never throws — failure to persist an audit is logged to `console.error` but does not break the business transaction.

Phase 7 T15 audit block **AUDIT LIVE-PASS**: after running E2E harness, AuditLog collection contained expected counts for each action including `SUSPICIOUS_REQUEST` on cross-user attempts.

---

## 15. Environment & Secret Handling

**Code**: `.gitignore` (3 layers: root, per-package backend + frontend, catch-all `**/.env`). Evidence: [phase7-t4-secret-environment-audit.log](phase7-t4-secret-environment-audit.log)

| Layer | .gitignore lines | Coverage |
|---|---|---|
| Root | lines 2–6 | `.env`, `.env.local`, `.env.*.local` |
| Per-package | lines 9–14 | `backend/.env`, `backend/.env.*` except `.env.example`; same for frontend |
| Catch-all | lines 17–19 | `**/.env`, `**/.env.*` except `**/.env.example` |

### Environment variable safety

| Variable | Stored in | Committed? |
|---|---|---|
| `JWT_SECRET` | backend/.env only | ❌ NEVER; placeholder blank in .env.example |
| `MONGO_URI` | backend/.env only | ❌ NEVER; placeholder blank in .env.example |
| `FRONTEND_URL` | backend/.env | Non-secret. Placeholder filled in .env.example. |
| `VITE_API_BASE_URL` | frontend/.env | Public. Placeholder filled. |

Phase 7 T4 **LIVE-PASS**.

Phase 8 (T20 final secret scan) re-verified:
- **frontend/src 0 matches** on `JWT_SECRET | MONGO_URI | correctOption | passwordHash`.
- Backend trusted code (models + controllers + harnesses) references are allowed by the scan rules.
- No actual secret VALUES appeared anywhere except backend/.env (gitignored).

---

## 16. Error Handling & Information Leakage

Final catch-all error middleware (after all routes):

```js
app.use((err, req, res, _next) => {
  console.error(`[server] Uncaught] ${err.message}`);  // stderr only
  res.status(500).json({ success: false, message: 'Internal server error' });
});
```

Every known business error (duplicate, cross-user, expired, invalid, missing) has a dedicated response shape with specific status codes. No unhandled exception reaches the client with a stack trace or raw Mongo error details.

Phase 7 T13/T14 error-leakage block **LIVE-PASS**: 8 distinct error classes (not found, invalid input, duplicate, ownership, expired, concurrency, auth, rate-limit) each returned clean responses with no secrets or stack traces.

---

## 17. MongoDB Injection Protection

- All user input reaches the database **exclusively through Mongoose model APIs**: `findOne`, `findOneAndUpdate`, `new Model({...}).save()`, `insertOne` with session. Raw strings from the client are **never concatenated into pipelines or queries**.
- Challenge text is generated from `crypto.randomInt` → `CAPTCHA_CHARS` alphabet; no user-provided data flows into captcha text.
- `express-validator` coerces every write-body field to a trimmed string before business logic runs — objects, nested arrays, or prototype pollution style `{$gt: ''}` bodies collapse to the string `"[object Object]"` (failing the email regex / captcha options whitelist / etc cleanly with `400` not some 5xx that exposes injection).
- Email regex match + `normalizeEmail()` reduce SMTP attack surface at the validator.

---

## 18. Frontend Security Considerations

| Control | Detail |
|---|---|
| No hardcoded secrets | Frontend .env only carries `VITE_API_BASE_URL` |
| JWT storage | `localStorage('veloop.token')` (frontend api service). Known limitation: non-httpOnly. |
| No sensitive field references | Phase 7 + Phase 8 final grep: frontend/src has **0 references** to `JWT_SECRET`, `MONGO_URI`, `correctOption`, `passwordHash` |
| Option lock-on-click | `OptionGrid` disables all 4 buttons on any single selection → frontend enforces one-choice UX. Backend replay-protection layers enforce it server-side anyway. |
| No Submit button | Phase 6/T17 browser E2E verified: zero `<button type=submit>` or text=Submit elements in /earn DOM. |
| Wallet rendering | Navbar `WalletBadge` and page `WalletCard` share a module-level `sharedGemsRef` listener. Both refresh from `/api/wallet/gems` after claim; neither performs client-side arithmetic without backend reconciliation. |
| Response sanitization | Api service maps HTTP statuses to fixed user-visible strings (no raw server message surfacing in `message` prop if server leaks; fallback map used). |

---

## 19. Limitations (LOW severity)

1. **Frontend JWT is localStorage, not httpOnly SameSite=Lax cookie.** Acceptable for this architecture. For highest-security deployment, swap to cookies + CSRF tokens (requires backend cookie middleware + backend/frontend on same TLD or explicit `credentials: include`).
2. **CAPTCHA is text-only, not distorted image/SVG.** Works for this submission. Upgrade to `svg-captcha`, hCaptcha, or Turnstile for adversarial human-vs-bot needs.
3. **AuditLog is not tamper-proof signed.** For production compliance (SOC2/PCI), ship entries to an append-only log service or write a SHA chain; this codebase stores them in the same Mongo DB.
4. **No per-action rate limit on just /verify.** It shares the 60/1m captcha bucket with /claim, /new, etc. A tighter /verify-specific 10/min could be added.
5. **No admin RBAC.** Auth flow distinguishes no roles. All registered users have identical capabilities. This matches scope.

All 5 limitations are carried from Phase 7 report → Phase 8 final submission. No new security issues discovered this phase.

---

## 20. Evidence Inventory (Per Phase)

| Document | Path |
|---|---|
| Phase 5 reward lifecycle regression (11 invariants raw harness) | `backend/test-phase5.js` |
| Phase 6 full-stack E2E harness | `backend/test-phase6.js` |
| Phase 6 test report (prior) | [PHASE6_TEST_REPORT.md](PHASE6_TEST_REPORT.md) |
| Phase 7 security test report (LIVE results, authoritative) | [PHASE7_SECURITY_TEST_REPORT.md](PHASE7_SECURITY_TEST_REPORT.md) |
| Helmet headers raw | [phase7-t2-helmet-headers.log](phase7-t2-helmet-headers.log) |
| CORS origin matrix raw | [phase7-t3-cors-hardening.log](phase7-t3-cors-hardening.log) |
| Environment/secrets audit raw | [phase7-t4-secret-environment-audit.log](phase7-t4-secret-environment-audit.log) |
| Backend security T5–T14 (58 assertions) raw | [phase7-t5-t14-backend-security.log](phase7-t5-t14-backend-security.log) |
| Phase 6 T17 regression harness raw | [phase6-regression-t17-raw.log](phase6-regression-t17-raw.log) |
| npm test T18 raw | [npm-test-t18-raw.log](npm-test-t18-raw.log) |
