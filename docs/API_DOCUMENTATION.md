# VELoop CAPTCHA Earn — API Documentation

**Base URL**: `<host>/api` (e.g. `http://localhost:5000/api` in local development).

All responses use JSON and follow the envelope pattern:

```json
{
  "success": true,
  "message": "Human-readable description",
  "data": { /* endpoint-specific payload */ }
}
```

Error responses include `success: false` and an HTTP status code matching the failure class (see each endpoint).

```
Status code classes used:
  200 — OK (read / idempotent actions)
  201 — Created (new resource persisted, e.g. register)
  204 — OPTIONS preflight (CORS)
  400 — Validation / bad request / expected business error
  401 — Missing / invalid / malformed JWT
  403 — Wrong-user ownership / deactivated account
  404 — Resource not found
  409 — Duplicate / conflict / already-done (idempotency)
  410 — Challenge expired
  429 — Rate-limited
  500 — Generic server error (never leaks stack)
```

### Authentication Header

Every protected endpoint requires:

```
Authorization: Bearer <jwt>
```

where `<jwt>` was returned from `/auth/register` or `/auth/login`. The JWT payload contains `{ userId, iat, exp }` only (7-day expiry).

### Rate Limiting

All routes are protected by `express-rate-limit` with `standardHeaders: true` (`RateLimit-*` response headers) and `legacyHeaders: false` (no `X-RateLimit-*`):

| Endpoint group | Window | Max requests |
|---|---|---|
| `/api/auth/*` (register, login) | 15 minutes | 100 |
| `/api/captcha/*` | 1 minute | 60 |
| `/api/wallet/*` | 1 minute | 120 |

A 429 response body is always:

```json
{ "success": false, "message": "<context-specific rate-limit message>" }
```

---

## 1. Public

### 1.1 Health Check

```
GET /api/health
```

No authentication required.

- **Purpose**: Probes service liveness and MongoDB connection state. Used by deployment platforms / load balancers.
- **Request**: (empty)
- **Validation**: none.
- **Success status**: `200`
- **Example**:

```http
GET /api/health HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json
```
```json
{
  "status": "ok",
  "message": "VELoop Rewards API is running",
  "mongodb": "connected"
}
```

- **`mongodb` values**: `disconnected` | `connecting` | `connected` | `disconnecting` | `unknown`.
- **Security behavior**: Returns no user data, no secrets, no environment details.

---

## 2. Auth — `/api/auth`

### 2.1 Register

```
POST /api/auth/register
```

No authentication required.

- **Purpose**: Creates a new user, hashes the password, and returns a fresh JWT + user object.
- **Rate limit**: 100 / 15 min.
- **Validation** (via `express-validator`; fails `400 Validation failed` with per-field errors):
  - `name`: trim, not empty, min length 2.
  - `email`: trim, not empty, RFC email match, normalized (`normalizeEmail()`).
  - `password`: trim, not empty, min length 6.
- **Request body**:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "correct-horse-battery-staple"
}
```

- **Success status**: `201 Created`
- **Success response**:

```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "user": {
      "_id": "67f0a12b9c3d...",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "isActive": true,
      "createdAt": "2026-04-03T10:00:00.000Z",
      "updatedAt": "2026-04-03T10:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2N2YwYTEyYjljM2QiLCJpYXQiOj..."
  }
}
```

- **Error statuses**:
  - `400` — validation failed (with `errors[]` array of `{ field, message }`).
  - `409` — `{ success: false, message: "Email is already registered" }` (unique index conflict).
  - `500` — generic failure.
- **Important security behavior**:
  1. Email is lowercased + normalized before lookup; case-variant duplicates collapse to the same user.
  2. Password is hashed via bcryptjs `saltRounds = 10` inside a User `pre('save')` hook; `passwordHash` is never in any response.
  3. JWT payload is `{ userId: user._id }` only; no email/name in token.
  4. A matching Wallet document is NOT eagerly created; Wallet is lazily created on first balance access (wallet get or first claim).

---

### 2.2 Login

```
POST /api/auth/login
```

No authentication required.

- **Purpose**: Verifies credentials and returns a JWT.
- **Rate limit**: 100 / 15 min.
- **Validation**:
  - `email`: trim, not empty, valid email, normalized.
  - `password`: trim, not empty.
- **Request body**:

```json
{ "email": "jane@example.com", "password": "correct-horse-battery-staple" }
```

- **Success status**: `200`
- **Success response** (same shape as register `201`).

- **Error statuses**:
  - `400` — validation failed.
  - `401` — `{ success: false, message: "Invalid credentials" }` — same message whether email is unknown OR password mismatch (prevents user enumeration).
  - `403` — `{ success: false, message: "Account is deactivated" }` — `user.isActive === false`.
  - `500` — generic failure.
- **Important security behavior**:
  1. User document is loaded with `.select('+passwordHash')` (field is `select:false` by default; never leaked).
  2. `user.comparePassword(candidate)` is a model method that calls `bcrypt.compare`.
  3. Same response timing characteristics for unknown-email vs wrong-password (both 401) are preserved by never branching on user nonexistence before the final `isMatch` check.

---

### 2.3 Get Own Profile

```
GET /api/auth/me
```

**Authentication required** (`Authorization: Bearer <jwt>`).

- **Purpose**: Returns the authenticated user's safe-object profile.
- **Validation**: none beyond valid JWT.
- **Success status**: `200`
- **Success response**:

```json
{
  "success": true,
  "message": "Profile retrieved",
  "data": {
    "user": { /* toSafeObject: no passwordHash */ }
  }
}
```

- **Error statuses**: `401` (bad/missing JWT), `403` (deactivated), `404` (user deleted after token was issued), `500`.
- **Important security behavior**: All data comes from `req.user.userId` (JWT claim); client cannot request another user via query/body parameters in this endpoint.

---

## 3. CAPTCHA — `/api/captcha`

All endpoints require **Authentication** and are rate-limited 60 / 1 minute.

### 3.1 Get Current Challenge

```
GET /api/captcha/current
```

- **Purpose**: Returns the user's ACTIVE challenge (if any and not expired), otherwise generates a fresh challenge and returns it.
- **Request**: empty.
- **Validation**: none beyond JWT.
- **Success status**: `200`
- **Response shape** (via `CaptchaChallenge.toPublicObject()` — **strips `correctOption` and `userId`**):

```json
{
  "success": true,
  "message": "Active challenge retrieved",
  "data": {
    "challengeId": "a1b2c3d4e5f6...",
    "captchaText": "AB7K2X",
    "options": ["B87K2X", "AB7K2X", "ABFK2X", "ZT9M5P"],
    "status": "ACTIVE",
    "expiresAt": "2026-04-03T10:01:00.000Z",
    "createdAt": "2026-04-03T10:00:00.000Z"
  }
}
```

- **Important security behavior**:
  1. Always returns either an existing ACTIVE-and-not-expired challenge or a freshly generated one. A user cannot have two ACTIVE challenges (the query is `findOne({ userId, status: ACTIVE })`).
  2. If an ACTIVE-but-expired challenge is found, it is marked `EXPIRED` + `EXPIRED_CHALLENGE` audit entry before generating the new one.
  3. **`correctOption` is NEVER in the response.** It is a `select: false` field and additionally stripped by `.toPublicObject()`. Frontend must not attempt to derive correctness locally.
  4. `userId` is not in the response (also stripped).
  5. CAPTCHA text uses `crypto.randomInt` alphabet, challengeId uses `crypto.randomBytes(16).toString('hex')`.
  6. Option generation guarantees exactly 4 unique strings: 1 correct + 2 single-char-different + 1 fully different, shuffled.

---

### 3.2 Verify Challenge (Answer Selection)

```
POST /api/captcha/verify
```

- **Purpose**: Submits the user's selection. Backend evaluates correctness, creates PENDING reward transaction, marks challenge COMPLETED. **Does NOT increment wallet.**
- **Validation**:
  - `challengeId`: trim, not empty, string.
  - `selectedOption`: trim, not empty, string.
  - Secondary backend-only validation: `selectedOption ∈ challenge.options` array (whitelist, fails `400 Invalid selected option`).
- **Request body** (front-end MUST send only these 2 keys; any additional client fields are silently ignored by backend business logic — see behavior below):

```json
{
  "challengeId": "a1b2c3d4e5f6...",
  "selectedOption": "AB7K2X"
}
```

- **Success status**: `200`
- **Success response** (wallet value NOT present; not touched yet):

```json
{
  "success": true,
  "message": "CAPTCHA verified",
  "data": {
    "challengeId": "a1b2c3d4e5f6...",
    "isCorrect": true,
    "rewardAmount": 1,
    "rewardStatus": "PENDING",
    "attemptId": "67f0...<ObjectId>"
  }
}
```

`rewardStatus` is **always** `"PENDING"` on the happy path. Wallet update happens exclusively on `/claim`.

- **Error statuses** (each writes an AuditLog):
  - `400` — validation / invalid option / challenge not yet COMPLETED for downstream.
  - `401` — missing / bad JWT.
  - `403` — `Challenge does not belong to this user` (cross-user attempt). Fires `SUSPICIOUS_REQUEST` audit.
  - `404` — `Challenge not found`.
  - `409` — `Challenge already completed` (duplicate attempt). Three layers fire this: status-gate, `CaptchaAttempt(challengeId+userId)` unique index, and `GemTransaction.idempotencyKey` unique index (all collapse to the same response).
  - `410` — `Challenge expired` (before verify). Challenge moved to EXPIRED.
  - `500` — generic failure.

- **Important security behavior**:
  1. **Ownership is authoritatively checked** by `String(challenge.userId) === String(authUser from JWT)` — NEVER any `userId` from the request body.
  2. **Correctness is recomputed server-side** against `.select('+correctOption')`. The client cannot assert `isCorrect` (if you send `{challengeId, selectedOption, isCorrect: true, correctOption: "..."}` the extra fields are **ignored**).
  3. **Reward amount** is recomputed by `RewardService.determineReward(isCorrect, activeConfig)` — ignores any `rewardAmount` or `gems` in the body. Defaults at time of writing: correct=1 gem, wrong=0.5 gems (see `CaptchaRewardConfig`).
  4. **Idempotency unique-index**: `GemTransaction.idempotencyKey = sha256(userId::challengeId)` with Mongo `unique: true`. Two concurrent `/verify` calls both with identical challengeId will see one 200 and one 409 (not two transactions created).
  5. **Atomic execution**: `runInTx()` auto-detects if Mongo replica-set transactions are available and wraps all reads+writes in a session (falls back to unique-index-only protection for standalone Mongo).
  6. **Wallet is NOT incremented here.** Only `GemTransaction { status: PENDING }` + `CaptchaAttempt` + `challenge.status = COMPLETED` are written.
  7. **Audit trail**: on 200, writes both `CHALLENGE_VERIFIED` and `REWARD_CREATED` entries with metadata (isCorrect, rewardAmount, tx status).

---

### 3.3 Mark Mock Rewarded Ad Complete

```
POST /api/captcha/ad-complete
```

- **Purpose**: Records that the user watched the rewarded ad overlay (frontend-only; no actual ad network SDK call). Stamps `adCompletedAt` on the PENDING GemTransaction; claim remains blocked until `/claim`.
- **Validation**: only `challengeId` (trim, non-empty string).
- **Request body**:

```json
{ "challengeId": "a1b2c3d4e5f6..." }
```

- **Success status**: `200`
- **Success response**:

```json
{
  "success": true,
  "message": "Rewarded ad completion recorded",
  "data": {
    "challengeId": "a1b2c3d4e5f6...",
    "rewardAmount": 1,
    "rewardStatus": "PENDING",
    "adCompletedAt": "2026-04-03T10:00:15.000Z"
  }
}
```

- **Error statuses**: `400` (challenge not COMPLETED / tx in unexpected state), `401`, `403` (cross-user, SUSPICIOUS_REQUEST audit), `404` (no challenge / no reward tx), `409` (already claimed, or tx state race), `500`.
- **Important security behavior**: Duplicate `/ad-complete` when reward is already CLAIMED returns 409 with `DUPLICATE_CLAIM` audit but does **not** touch wallet again. Cross-user attempt with a valid foreign challengeId returns 403 before any state change.

---

### 3.4 Claim Reward

```
POST /api/captcha/claim
```

- **Purpose**: The **only** code path that increments the user's Wallet. Atomic PENDING → CLAIMED transition plus single `WalletService.incrementGems(userId, amount)`.
- **Validation**: `challengeId` (trim, non-empty string).
- **Request body**:

```json
{ "challengeId": "a1b2c3d4e5f6..." }
```

- **Success status**: `200`
- **Success response**:

```json
{
  "success": true,
  "message": "Reward claimed successfully",
  "data": {
    "challengeId": "a1b2c3d4e5f6...",
    "rewardAmount": 1,
    "status": "CLAIMED",
    "gems": 7
  }
}
```

`data.gems` is the post-claim authoritative wallet balance re-read from the database.

- **Error statuses**:
  - `400` — challenge status is not COMPLETED; tx status is not PENDING.
  - `401` / `403` — as elsewhere (cross-user rejected with SUSPICIOUS_REQUEST audit at 2 levels: challenge owner AND tx owner).
  - `404` — no challenge or no reward tx for that challenge.
  - `409` — reward already claimed (first path: tx.status === CLAIMED at initial read; second path: concurrent racing findOneAndUpdate returned 0 modified → fresh read confirms CLAIMED).
  - `500` — generic.

- **Important security behavior**:
  1. **Exact-once wallet increment**: written via `GemTransaction.findOneAndUpdate({ challengeId, userId, status: PENDING }, $set status→CLAIMED)`. If this update matches 0 rows (concurrent dup), `claim.claimed = false` and fallback re-reading confirms CLAIMED (409). If it matches 1 row → exactly one `WalletService.incrementGems(userId, amount)` call follows.
  2. **Server-authoritative amount**: amount is read from `GemTransaction.amount` (which was written by `/verify` using CaptchaRewardConfig); any `amount` or `rewardAmount` or `gems` sent in `/claim` body is ignored.
  3. **Concurrent duplicate claim**: With Mongo transactions (replica-set) enabled, all writes are in the same session. Without transactions, the atomic findOneAndUpdate + unique index still guarantee 0 or 1 CLAIMED transitions, AND 0 or 1 wallet increments (per Phase 5 concurrent invariant 11 — verified LIVE in test-phase5.js).
  4. **Audit**: `REWARD_CLAIMED` on 200, `DUPLICATE_CLAIM` with metadata on every 409 path.
  5. **409 path returns wallet balance for frontend UX** so that the UI can still refresh Navbar/WalletCard even on duplicate-click. No further balance change occurs on 409.

---

### 3.5 New CAPTCHA (Skip / Load Next)

```
POST /api/captcha/new
```

- **Purpose**: Cancels the current challenge (marks it SKIPPED, cancels any PENDING GemTransaction for that challenge) and returns a freshly generated CAPTCHA.
- **Validation**: `challengeId` (trim, non-empty string).
- **Request body**:

```json
{ "challengeId": "a1b2c3d4e5f6..." }
```

- **Success status**: `200`
- **Success response**: same shape as `/api/captcha/current` (fresh challenge via `.toPublicObject()`).

- **Error statuses**: `401`, `403` (cross-user, SUSPICIOUS_REQUEST), `404` (old challenge not found), `500`.
- **Important security behavior**:
  1. Pending rewards on the old challenge are intentionally CANCELLED (`GemTransaction { status: FAILED }`) when user skips — this is the business rule; there is no path to recover a skipped pending reward without re-solving.
  2. Skipped/expired/already-completed old challenges can never again be used for `/verify` or `/claim` (status is terminal `SKIPPED`/`EXPIRED`/`COMPLETED`; all gates in verify/claim check status enums).
  3. Audit `CHALLENGE_SKIPPED` records the prior status and whether a PENDING reward was cancelled with its amount, and `NEW_CHALLENGE` is written on successful fresh challenge creation.

---

## 4. Wallet — `/api/wallet`

All endpoints require Authentication. Rate limited 120 / 1 minute.

### 4.1 Get Wallet Gem Balance

```
GET /api/wallet/gems
```

- **Purpose**: Returns the server-authoritative gem count for the JWT user. Creates a Wallet doc (gems=0) if first access.
- **Request**: empty.
- **Success status**: `200`
- **Success response**:

```json
{
  "success": true,
  "message": "Wallet balance retrieved",
  "data": {
    "gems": 7,
    "wallet": {
      "userId": "67f0...<ObjectId>",
      "gems": 7,
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

- **Error statuses**: `401` (missing/invalid JWT), `500`.
- **Important security behavior**:
  1. Balance comes from a fresh Wallet document read. Frontend must never locally add/subtract gems and assume the result; always reconcile against this endpoint after claim.
  2. Frontend stores the JWT in localStorage (`veloop.token`) and sends it as Bearer; value comes from JWT `userId` claim only — there is no `userId` query/body parameter to tamper with.
  3. Navbar WalletBadge and WalletCard sync via a module-level shared-ref listener pattern, but both pull from `/wallet/gems` on page load and after claim (neither is an authority).

---

## 5. Endpoints NOT Implemented

The following are sometimes expected from CAPTCHA reward APIs but are **NOT present in this codebase** — do not invoke them (404 returned):

- `GET /api/captcha/history` (planned, not wired)
- `GET /api/captcha/config` (planned, not wired)
- `POST /api/auth/logout` (stateless JWT; front-end removes token locally; no backend session)
- Any `DELETE`, `PUT`, `PATCH` routes on users/wallets/captchas
- Any admin routes

---

## 6. Summary Table

| Method | Path | Auth | Rate Limit | Input Validation | Write |
|---|---|---|---|---|---|
| GET | `/health` | ❌ | none | no | no |
| POST | `/auth/register` | ❌ | 100/15m | name/email/password | yes |
| POST | `/auth/login` | ❌ | 100/15m | email/password | no |
| GET | `/auth/me` | ✅ JWT | — via authLimiter | no | no |
| GET | `/captcha/current` | ✅ JWT | 60/1m | no | yes (maybe new challenge) |
| POST | `/captcha/verify` | ✅ JWT | 60/1m | challengeId, selectedOption, options whitelist | yes |
| POST | `/captcha/ad-complete` | ✅ JWT | 60/1m | challengeId | yes |
| POST | `/captcha/claim` | ✅ JWT | 60/1m | challengeId | yes (**ONLY place wallet increments**) |
| POST | `/captcha/new` | ✅ JWT | 60/1m | challengeId | yes |
| GET | `/wallet/gems` | ✅ JWT | 120/1m | no | no (lazy create wallet if missing) |
