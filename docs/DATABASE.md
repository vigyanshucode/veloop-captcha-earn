# VELoop CAPTCHA Earn — Database Documentation

Database: **MongoDB** via **Mongoose 9**. All models use standard `{ timestamps: true }` unless otherwise noted, which adds auto-managed `createdAt: Date` and `updatedAt: Date`.

This document describes every Mongoose schema, its important fields, indexes, relationships, security-sensitive fields (if any), and lifecycle behavior.

---

## 0. Overview & Guarantees

### 0.1 Server-authoritative wallet

The **ONLY** process that ever mutates `Wallet.gems` is `WalletService.incrementGems(userId, amount, session?)`, called exactly once from inside `RewardService.claimReward()` after a successful atomic `GemTransaction.findOneAndUpdate` from `PENDING → CLAIMED`. Clients never have authority over wallet numbers; the balance is always re-read from MongoDB at `/api/wallet/gems`.

### 0.2 Reward ledger is GemTransaction

Every reward (whether later claimed, expired, skipped, duplicated, or failed) is a single `GemTransaction` row. Together with `CaptchaAttempt`, they form an append-only ledger:

- `GemTransaction.idempotencyKey: unique` (`sha256(userId::challengeId)`) → one transaction per challenge, guaranteed by the database.
- `GemTransaction.status ∈ { PENDING, CLAIMED, FAILED }` — see §5.

### 0.3 correctOption is backend-only

The `CaptchaChallenge.correctOption` field has `select: false` and is additionally stripped by `.toPublicObject()` before any response is sent. **Never expose it to a frontend client.** The only code paths that read it (with `.select('+correctOption')`) are:
- `CaptchaChallenge.verifyChallenge` controller — computes `isCorrect`.
- `test-phase5.js` / `test-phase6.js` harnesses — for end-to-end invariant verification only (they spoof selections by reading correctOption so they can test correct + wrong flows deterministically).

Frontend `src/` code MUST have **0 references** to `correctOption` (verified in Phase 7 secret scan — LIVE-PASS).

---

## 1. User

**File**: [backend/src/models/User.js](../backend/src/models/User.js)

**Purpose**: Represents a registered user account. One User → exactly one Wallet, many CaptchaChallenges, many CaptchaAttempts, many GemTransactions, many AuditLogs.

### 1.1 Important Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | auto | auto | Primary key; referenced by everything else |
| `email` | String | ✅ | — | `unique: true`, `lowercase: true`, trim, regex validator, index |
| `passwordHash` | String | ✅ | — | **`select: false` by default** — NEVER in a response. bcryptjs hash (salt=10) written in `pre('save')` hook when modified |
| `name` | String | ✅ | — | trim, min length 2 |
| `isActive` | Boolean | — | `true` | If `false`, login returns 403; /me returns 403 |
| `createdAt` | Date | auto | auto | timestamps |
| `updatedAt` | Date | auto | auto | timestamps |

### 1.2 Indexes

- `{ email: 1 }` unique (declared in schema)

### 1.3 Relationships

| From | Relation | To |
|---|---|---|
| `User._id` | 1 → 1 | `Wallet.userId` (unique) |
| `User._id` | 1 → many | `CaptchaChallenge.userId` |
| `User._id` | 1 → many | `CaptchaAttempt.userId` |
| `User._id` | 1 → many | `GemTransaction.userId` |
| `User._id` | 1 → many | `AuditLog.userId` |

### 1.4 Security-sensitive fields

- `passwordHash` — **must never appear in API responses, logs, or serialized objects.** Model provides:
  - `pre('save')` hook → hashes password if `passwordHash` modified.
  - `user.comparePassword(candidate)` → bcrypt compare against stored hash.
  - `user.toSafeObject()` → returns `toObject()` with `passwordHash` deleted. Called on every register/login/me response.

### 1.5 Lifecycle

1. `POST /auth/register` → `new User({ ..., passwordHash: password })` → `pre('save')` bcrypt-hashes → save. JWT signed.
2. `POST /auth/login` → `findOne({email}).select('+passwordHash')` → `comparePassword` → JWT signed on match.
3. `GET /auth/me` → `findById(req.user.userId)` → `.toSafeObject()` returned.
4. Account can be deactivated by setting `isActive = false` directly in Mongo (no API endpoint yet).

---

## 2. Wallet

**File**: [backend/src/models/Wallet.js](../backend/src/models/Wallet.js)

**Purpose**: User's authoritative gem balance. One document per user. Lazily created on first read/write (no eager create on register).

### 2.1 Important Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | auto | auto | Primary key |
| `userId` | ObjectId (ref: User) | ✅ | — | `unique: true`, index |
| `gems` | Number | ✅ | `0` | `min: 0` — cannot go negative via schema validator |
| `createdAt` | Date | auto | auto | |
| `updatedAt` | Date | auto | auto | Updated on every increment |

### 2.2 Indexes

- `{ userId: 1 }` unique, index (declared in schema)

### 2.3 Relationships

- `Wallet.userId → User._id` (1:1)
- Indirectly updated by every `GemTransaction` that reaches `CLAIMED` status via `RewardService.claimReward()` → `WalletService.incrementGems()`.

### 2.4 Security-sensitive fields

No inherently secret field, but `gems` is **financially authoritative**. Increment is only via:

```js
Wallet.findOneAndUpdate(
  { userId },
  { $inc: { gems: amount } },
  { upsert, setDefaultsOnInsert, runValidators, new: true, session? }
)
```

Never `$set`, never read-then-write outside of a Mongo session. `min: 0` on the schema enforces non-negative.

### 2.5 Lifecycle

- Created lazily by `WalletService.getOrCreateWallet(userId, session?)` → new Wallet({userId, gems:0}) saved.
- Updated exactly once per claimed CAPTCHA via `incrementGems`.
- Read by `GET /api/wallet/gems` and on every `/claim` 200 / 409 response.

---

## 3. CaptchaChallenge

**File**: [backend/src/models/CaptchaChallenge.js](../backend/src/models/CaptchaChallenge.js)

**Purpose**: One generated CAPTCHA instance for one user. Carries the correct answer, four options, and terminal state.

### 3.1 Important Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | auto | auto | Internal PK; used as FK by Attempt/Tx/Audit |
| `challengeId` | String | ✅ | — | Public-facing ID (16 random bytes → hex). **Unique**, index. Returned to client; used in all verify/claim/new/ad-complete endpoints |
| `userId` | ObjectId (ref: User) | ✅ | — | Owner; index. CHECKED in every endpoint (cross-user → 403) |
| `captchaText` | String | ✅ | — | 6-char uppercase alphanumeric (no I/O/0/1) |
| `options` | [String] | ✅ | — | Exactly 4 strings (validator enforces). Includes correct + 3 distractors, shuffled |
| `correctOption` | String | ✅ | — | **`select: false`**. Matches one of options. BACKEND ONLY. |
| `status` | String | ✅ | `ACTIVE` | Enum: `ACTIVE \| COMPLETED \| EXPIRED \| SKIPPED` (see §3.5). Index |
| `expiresAt` | Date | ✅ | now + CAPTCHA_EXPIRY_SECONDS (default 60s). Index |
| `createdAt` | Date | auto | auto | |
| `updatedAt` | Date | auto | auto | |

### 3.2 Indexes

- `{ challengeId: 1 }` unique
- `{ userId: 1 }`
- `{ status: 1 }`
- `{ expiresAt: 1 }` (used by /verify expiry gate + /current lazy-expiry)

### 3.3 Relationships

| From | Relation | To |
|---|---|---|
| `CaptchaChallenge.userId` | many → 1 | User |
| `CaptchaChallenge._id` | 1 → 0..1 | CaptchaAttempt (unique compound index challengeId+userId) |
| `CaptchaChallenge._id` | 1 → 0..1 | GemTransaction |
| `CaptchaChallenge._id` | 1 → many | AuditLog (challengeId) |

### 3.4 Security-sensitive fields

- `correctOption` — see §0.3 above. **Never exposed**. Loaded only in `/verify` via `.select('+correctOption')` to compute correctness. Response from `/current` via `.toPublicObject()` additionally deletes it defensively along with `userId`, `__v`, `_id`, `updatedAt`.

### 3.5 Lifecycle — Status Enumeration

| Status | Meaning | Transition in |
|---|---|---|
| `ACTIVE` | Challenge issued; selectable | Created by `CaptchaService.createChallenge`; returned by `/current` |
| `COMPLETED` | User has submitted a selection (right or wrong); no more re-verifies allowed | `/captcha/verify` 200 path |
| `EXPIRED` | `expiresAt ≤ now` before user verified | Checked in `/verify` gate → marks EXPIRED + 410; lazily on `/current` if ACTIVE is stale |
| `SKIPPED` | User loaded a new challenge via `/captcha/new` before completing; PENDING reward tx cancelled (FAILED) | `/captcha/new` marks SKIPPED + cancels any pending tx |

Terminal states: COMPLETED / EXPIRED / SKIPPED. Once set, cannot go back to ACTIVE.

---

## 4. CaptchaAttempt

**File**: [backend/src/models/CaptchaAttempt.js](../backend/src/models/CaptchaAttempt.js)

**Purpose**: Immutable record of a user's one selection on one challenge. 1:1 with CaptchaChallenge (unique compound index).

### 4.1 Important Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | auto | auto | PK; referenced by GemTransaction.attemptId |
| `challengeId` | ObjectId (CaptchaChallenge) | ✅ | — | index |
| `userId` | ObjectId (User) | ✅ | — | index |
| `selectedOption` | String | ✅ | — | The string the user actually submitted |
| `isCorrect` | Boolean | ✅ | — | Backend-computed comparison of (correctOption vs selectedOption) |
| `rewardAmount` | Number | ✅ | — | Backend-determined via RewardService.determineReward + CaptchaRewardConfig. `min: 0` |
| `status` | String | ✅ | — | Enum `VERIFIED \| REJECTED`; currently always VERIFIED on success (wrong selections still count as VERIFIED attempt) |
| `reason` | String | — | — | Optional text for future REJECTED cases |
| `createdAt` | Date | auto | auto | |
| `updatedAt` | Date | auto | auto | |

### 4.2 Indexes

- `{ userId: 1, createdAt: -1 }` (time-series user-attempt history)
- `{ challengeId: 1, userId: 1 }` — **unique compound index** (user can only attempt each challenge once; duplicate → Mongo error code 11000 → controller collapses to 409)

### 4.3 Relationships

- `challengeId → CaptchaChallenge._id`
- `userId → User._id`
- `_id ← GemTransaction.attemptId` (1 attempt → 1 reward tx)

### 4.4 Security-sensitive fields

No direct secrets, but:
- `isCorrect` is trusted as authoritative (computed server-side; NEVER from `req.body.isCorrect`).
- `rewardAmount` is authoritative; NOT from `req.body.rewardAmount/gems`.
- Unique compound index is key replay protection at DB layer.

### 4.5 Lifecycle

Created inside `RewardService.processReward()` → committed in same Mongo session (or same request) as the matching GemTransaction + challenge.status=COMPLETED update. Immutable thereafter.

---

## 5. GemTransaction (Reward Ledger)

**File**: [backend/src/models/GemTransaction.js](../backend/src/models/GemTransaction.js)

**Purpose**: Append-only ledger of every reward event (pending, claimed, failed). The `idempotencyKey` unique index guarantees exactly-one transaction per challenge per user.

### 5.1 Important Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | auto | auto | PK |
| `userId` | ObjectId (User) | ✅ | — | Owner; index. Cross-user check in /claim |
| `challengeId` | ObjectId (CaptchaChallenge) | ✅ | — | 1:1 with CaptchaChallenge; index |
| `attemptId` | ObjectId (CaptchaAttempt) | ✅ | — | 1:1 with CaptchaAttempt; index |
| `type` | String | ✅ | `CAPTCHA_REWARD` | Enum (reserved for future topup/purchase/promo types) |
| `amount` | Number | ✅ | — | Gems to be (or were) added to wallet. `min: 0` |
| `status` | String | ✅ | `PENDING` | Enum: `PENDING \| CLAIMED \| FAILED`. Index. See §5.5 |
| `idempotencyKey` | String | ✅ | — | **Unique** index. `sha256(userId::challengeId)` |
| `claimedAt` | Date | — | null | Set only when status → CLAIMED |
| `adCompletedAt` | Date | — | null | Set only when `/ad-complete` fires |
| `createdAt` | Date | auto | auto | |
| `updatedAt` | Date | auto | auto | |

### 5.2 Indexes

- `{ userId: 1 }`
- `{ challengeId: 1 }`
- `{ attemptId: 1 }`
- `{ status: 1 }`
- `{ idempotencyKey: 1 }` — **unique**

### 5.3 Relationships

- `userId → User._id`
- `challengeId → CaptchaChallenge._id`
- `attemptId → CaptchaAttempt._id`
- `GemTransaction.status=CLAIMED with claimedAt set` → triggers exactly one `WalletService.incrementGems(userId, amount)` in the same code branch.

### 5.4 Security-sensitive fields

No direct secrets, but:
- `amount` and `status` are authoritative. All `/claim` reads use amount from the transaction row, never request body.
- `idempotencyKey` UNIQUE is the most robust replay protection. Combined with GemTransaction.findOneAndUpdate({status:PENDING}) → CLAIMED, this yields **exactly-once semantics even across concurrent requests and non-replica Mongo**.

### 5.5 Lifecycle — Status Enumeration

| Status | Meaning | Transition |
|---|---|---|
| `PENDING` | Reward verified but not yet claimed; wallet unchanged | Written at end of `/captcha/verify` |
| `CLAIMED` | Wallet incremented exactly-once | `/captcha/claim` happy path: `findOneAndUpdate({status: PENDING, challengeId, userId}, status=CLAIMED)` + `claimedAt` |
| `FAILED` | Reward cancelled (skipped by user before claim) | `/captcha/new` when challenge.status is COMPLETED and a PENDING tx exists |

PENDING → CLAIMED / FAILED is terminal; there is no revert path.

---

## 6. CaptchaRewardConfig

**File**: [backend/src/models/CaptchaRewardConfig.js](../backend/src/models/CaptchaRewardConfig.js)

**Purpose**: Tunable reward amounts without a code deploy. Read via `RewardService.getActiveRewardConfig()` which lazily seeds a fresh document if none exist.

### 6.1 Important Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | auto | auto | PK |
| `correctReward` | Number | ✅ | `1` | Gems awarded for correct CAPTCHA. `min: 0` |
| `wrongReward` | Number | ✅ | `0.5` | Gems awarded for wrong CAPTCHA (partial reward). `min: 0` |
| `isActive` | Boolean | ✅ | `true` | Only the most recently updated active row is used. Index |
| `createdAt` | Date | auto | auto | |
| `updatedAt` | Date | auto | auto | |

### 6.2 Indexes

- `{ isActive: 1 }` — for fast `findOne({isActive:true}).sort({updatedAt:-1})` lookup.

### 6.3 Lifecycle

1. `getActiveRewardConfig()` queries for `{isActive: true}` sorted by updatedAt desc.
2. If none: inserts a new document with defaults (1 / 0.5) and returns it.
3. To update rewards later: set `{ isActive: false }` on old row, insert new row with new values. No API endpoint exposed (admin-only operation via DB console).

---

## 7. AuditLog

**File**: [backend/src/models/AuditLog.js](../backend/src/models/AuditLog.js)

**Purpose**: Immutable append-only log of every security-relevant action in the reward lifecycle. Used for forensic review, duplicate-claim debugging, SUSPICIOUS_REQUEST triage.

### 7.1 Important Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `_id` | ObjectId | auto | auto | PK |
| `userId` | ObjectId (User) | — | — | Index. Nullable for anonymous probes |
| `action` | String | ✅ | — | **Enum** (see 7.3 below). Index |
| `challengeId` | ObjectId (CaptchaChallenge) | — | — | Index. Nullable for auth-only actions |
| `attemptId` | ObjectId (CaptchaAttempt) | — | — | Index. Nullable for non-verify flows |
| `metadata` | Mixed | — | — | Arbitrary JSON context: reason strings, statuses, amounts, cross-user owner IDs, idempotency keys |
| `createdAt` | Date | auto | auto | `timestamps: { updatedAt: false, createdAt: true }` — **no `updatedAt`** (entries immutable) |

### 7.2 Indexes

- `{ userId: 1, createdAt: -1 }` (user audit timeline)
- `{ action: 1, createdAt: -1 }` (action-type filter + time-window queries, e.g., all DUPLICATE_CLAIM in last hour)

### 7.3 Action Enum

Exported as `AuditLog.AUDIT_ACTION`:

| Action | Fired in |
|---|---|
| `CHALLENGE_VERIFIED` | After successful /verify (200) |
| `REWARD_CREATED` | After successful /verify (200) — same transaction |
| `REWARD_CLAIMED` | After successful /claim (200) |
| `DUPLICATE_CLAIM` | Any /claim 409 or /ad-complete->already-claimed 409 or concurrent race detection |
| `INVALID_CLAIM` | /claim precondition failed (challenge not found, not completed, not pending, reward missing, state changed) |
| `CHALLENGE_SKIPPED` | /captcha/new terminalized old challenge (records whether pending reward was cancelled) |
| `NEW_CHALLENGE` | After /captcha/new (200) |
| `AD_COMPLETED` | After /ad-complete (200) |
| `INVALID_AD_COMPLETE` | /ad-complete precondition failed |
| `INVALID_ATTEMPT` | /verify challenge not found, invalid option, /new old not found, etc |
| `DUPLICATE_ATTEMPT` | /verify already completed, idempotencyKey duplicate, CaptchaAttempt unique-index duplicate |
| `EXPIRED_CHALLENGE` | /verify or /current detected ACTIVE + past expiresAt → marked EXPIRED |
| `SUSPICIOUS_REQUEST` | Cross-user attempt (verify/claim/ad/new owner mismatch, tx owner mismatch) |

### 7.4 Security-sensitive fields

`metadata` contains raw context (amounts, foreign user ids, idempotency keys) for forensic purposes. Consider applying log rotation / retention policy in production; do not dump AuditLog contents to public endpoints.

### 7.5 Lifecycle

Every controller writes audit entries directly via `logAudit(action, { userId, challengeId, attemptId, metadata })`. Catches and suppresses any `AuditLog.save()` failures (audit must never break the business transaction; failures only logged to stderr).

---

## 8. Diagram — Relationships

```
User (1)
 │
 ├─(1)─────────► Wallet (1 per user; gems authoritative)
 │
 ├─(N)─────────► CaptchaChallenge
 │                   │  challengeId public; correctOption hidden
 │                   │  ACTIVE → COMPLETED / EXPIRED / SKIPPED
 │                   │
 │                   ├─(0..1)──► CaptchaAttempt
 │                   │              (challengeId+userId unique)
 │                   │              │
 │                   │              └───────(1)──────► GemTransaction
 │                   │                               idempotencyKey UNIQUE
 │                   │                               PENDING → CLAIMED → Wallet.incrementGems
 │                   ├─(0..1)──► GemTransaction       PENDING → FAILED  (skipped)
 │                   │
 │                   └─(N)─────► AuditLog (challengeId, attemptId, metadata)
 │
 └─(N)─────────► AuditLog (userId + action + createdAt desc index)
```

---

## 9. Durability & Transactions

`captcha.controller.js` exposes `supportTransactions()`: probes Mongo for replica-set/multi-doc transaction support (handles standalone Atlas free tier vs replica-set production).

| Environment | Transaction behavior |
|---|---|
| Replica-set / Mongo Atlas M10+ | Full `startSession + startTransaction + commit/abort` around verify/claim/new/ad-complete. Reads + writes are serializable. |
| Standalone / non-replica | Unique indexes (`idempotencyKey`, `CaptchaAttempt(challengeId+userId)`, `Wallet.findOneAndUpdate({status: PENDING})`) still enforce exactly-once semantics. Low-severity documented limitation: a concurrent PENDING→CLAIMED race could theoretically pass the initial PENDING read twice but the single atomic findOneAndUpdate returns either 0 or 1 matched rows. Phase 5 verified the exactly-once invariant both with and without transactions — LIVE-PASS both cases with `test-phase5.js`. |

---

## 10. Data Integrity Checksum (Forensic)

After any user walkthrough you can re-verify the ledger with this Mongo pipeline (manual admin only):

```js
// Sum of all CLAIMED GemTransaction.amount for a user
// should equal Wallet.gems for that user
const userId = ObjectId("<user _id>");
const sumFromLedger = db.gemtransactions.aggregate([
  { $match: { userId, status: "CLAIMED" } },
  { $group: { _id: "$userId", total: { $sum: "$amount" } } }
]).toArray()[0]?.total ?? 0;
const wallet = db.wallets.findOne({ userId }, { gems: 1 });
print("CLAIMED sum:", sumFromLedger, "Wallet.gems:", wallet?.gems, "Match:", sumFromLedger === wallet?.gems);
```

If they diverge, an invariant was broken. Phase 5 + Phase 6 both enforce this match — `WalletService.incrementGems` is the only path that ever writes gems, and it is always called after a successful PENDING→CLAIMED transition.
