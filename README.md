# VELoop CAPTCHA Earn

A production-grade, security-hardened CAPTCHA-based rewards system. Users solve text CAPTCHAs to earn Gems currency through a formally verified 2-phase reward lifecycle (Verify → Claim) with replay, concurrency, and cross-user attack protections built-in at the database layer.

---

## ✨ Features

- **JWT-authenticated** user registration and login (bcryptjs password hashing, `select: false` on passwordHash)
- **Automatic CAPTCHA verification**: no Submit button. Selection triggers verification instantly and locks all 4 options
- **Server-authoritative rewards**: backend exclusively determines `isCorrect`, `rewardAmount`, wallet balance. Client values are ignored
- **2-phase reward lifecycle**:
  1. `/verify` → `rewardStatus: PENDING` only (GemTransaction created, wallet NOT touched)
  2. `/claim` → atomic PENDING → CLAIMED + wallet incremented exactly ONCE
- **Mock rewarded ad flow** (`/ad-complete`) between verify and claim
- **Defense-in-depth security**: Helmet CSP/HSTS/frame headers, strict CORS origin allow-list, 3 independent rate limiters, challenge expiry, idempotency unique indexes, Mongo sessions with transactions when available
- **Module-level shared wallet state** on the frontend keeps Navbar WalletBadge and WalletCard in sync without duplication
- **Audit logging**: 15-action enum (CHALLENGE_VERIFIED / REWARD_CREATED / DUPLICATE_CLAIM / SUSPICIOUS_REQUEST / ...) indexed by userId + createdAt

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          VELoop CAPTCHA Earn                        │
│                                                                     │
│  Frontend (React 19 + Vite 8)  :5173                                │
│  ┌───────────────────────────────┐     JWT Bearer + JSON            │
│  │  AuthContext / useAuth        │────────────────────────┐        │
│  │  useCaptcha / useWallet       │                        │        │
│  │  Module-level shared gems ref │◄───────────────────┐   │        │
│  └───────────────────────────────┘                    │   │        │
│                                                       │   │        │
│  Backend (Express 5 + Mongoose 9) :5000               │   │        │
│  ┌─────────────────────────────────────────┐          │   │        │
│  │ Helmet | CORS allow-list | rate-limit   │          │   │        │
│  │ express-validator | JWT protect MW      │          │   │        │
│  └──────────────┬──────────────────────────┘          │   │        │
│                 │                                     │   │        │
│  Routes         ▼                                     │   │        │
│  /api/auth   (register | login | me)                  │   │        │
│  /api/captcha (current | verify | ad-complete |       │   │        │
│                claim | new)                           │   │        │
│  /api/wallet  (gems)                                  │   │        │
│                 │                                     │   │        │
│  Services      ▼         RewardService                │   │        │
│  CaptchaService ─────►  processReward()               │   │        │
│  WalletService          claimReward() ────────────────┘   │        │
│       │                    │                              │        │
│       ▼                    ▼                              │        │
│  MongoDB ────────────────────────────────────────────────┘        │
│  User | Wallet | CaptchaChallenge | CaptchaAttempt |              │
│  GemTransaction (idempotencyKey unique) | CaptchaRewardConfig |   │
│  AuditLog (15 actions)                                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🧰 Tech Stack

| Layer | Tech | Version |
|---|---|---|
| Frontend framework | React | ^19.3.0 |
| Frontend build | Vite | ^8.3.1 |
| Routing | react-router-dom | ^7.18.4 |
| Backend framework | Express | ^5.2.1 |
| Database ODM | Mongoose | ^9.10.2 |
| Auth | jsonwebtoken | ^9.0.3 |
| Password hashing | bcryptjs | ^3.0.3 |
| Input validation | express-validator | ^7.3.2 |
| Rate limiting | express-rate-limit | ^8.7.0 |
| HTTP security | Helmet | ^8.3.0 |
| CORS | cors | ^2.8.6 |

---

## 📁 Project Structure

```
veloop-captcha-earn/
├── backend/
│   ├── server.js                  # Express entrypoint (Helmet / CORS / limiters / routes)
│   ├── package.json               # test: runs Phase5 + Phase6 harnesses
│   ├── .env                       # Real secrets (NEVER committed; .gitignore'd)
│   ├── .env.example               # Safe placeholders
│   ├── test-phase5.js             # 11 invariant reward lifecycle regression suite
│   ├── test-phase6.js             # Full-stack auth/captcha/claim/wallet E2E harness
│   └── src/
│       ├── config/db.js           # Mongoose connect
│       ├── middleware/auth.middleware.js   # JWT protect()
│       ├── routes/                # auth.routes, captcha.routes, wallet.routes
│       ├── controllers/           # auth.controller, captcha.controller, wallet.controller
│       ├── services/              # captcha.service (gen), reward.service (lifecycle), wallet.service
│       └── models/                # User, Wallet, CaptchaChallenge, CaptchaAttempt,
│                                  # GemTransaction, CaptchaRewardConfig, AuditLog
├── frontend/
│   ├── package.json               # dev / build / preview
│   ├── vite.config.js
│   ├── index.html
│   ├── dist/                      # Production build (npm run build)
│   └── src/
│       ├── main.jsx / App.jsx     # Router: /, /register, /login, /earn (protected)
│       ├── context/AuthContext.jsx
│       ├── hooks/ useAuth.js, useCaptcha.js, useWallet.js
│       ├── services/api.js        # fetch wrapper + JWT Bearer header
│       ├── utils/ errors.js, format.js
│       ├── pages/ Landing, Register, Login, CaptchaEarn
│       └── components/
│           ├── auth/  LoginForm, RegisterForm
│           ├── captcha/  CaptchaDisplay, OptionGrid (no Submit!),
│           │            ResultStates, AdOverlay, ClaimSection
│           ├── wallet/   WalletBadge (Navbar), WalletCard
│           ├── layout/   Layout, Navbar (shared gems listener), ProtectedRoute
│           └── common/   Button, Input, Card, AlertBanner, Spinner, Icons
├── docs/                          # Phase 5/6/7 evidence + PHASE7 report
│   ├── PHASE6_TEST_REPORT.md
│   ├── PHASE7_SECURITY_TEST_REPORT.md
│   ├── API_DOCUMENTATION.md       # (Phase 8)
│   ├── DATABASE.md                # (Phase 8)
│   ├── SECURITY.md                # (Phase 8)
│   ├── TESTING.md                 # (Phase 8)
│   └── *.log                      # Raw harness outputs (phase5, phase6, helmet, cors, secrets)
├── postman/                       # (Phase 8) VELoop-Captcha.postman_collection.json
├── .gitignore                     # 3-layer env protection + dist/node_modules/logs
├── .env.example                   # Root-level placeholder (Phase 8)
└── README.md
```

---

## 🔐 Authentication

```
POST /api/auth/register → 201 { user, token }
POST /api/auth/login    → 200 { user, token }
GET  /api/auth/me       → 200 { user }  (Authorization: Bearer <token>)
```

- Passwords are hashed with bcryptjs (salt rounds 10) inside a `pre('save')` hook.
- `passwordHash` field has `select: false` by default; only explicitly selected in login.
- `toSafeObject()` is called before any User document reaches a response; it deletes passwordHash.
- JWT payload: `{ userId }` only. Expires in 7 days.
- Invalid / nonexistent credentials return the same generic `"Invalid credentials"` (no user enumeration).
- Deactivated accounts return 403 `"Account is deactivated"`.

---

## 🧩 CAPTCHA Flow

1. **User navigates to /earn** → `GET /api/captcha/current`
   - If an ACTIVE non-expired challenge exists for `req.user.userId`: return it
   - If an ACTIVE challenge exists but is expired: mark EXPIRED + audit, then generate fresh
   - Otherwise: `CaptchaService.createChallenge()` → 6-char uppercase alphanumeric text + 4 options (correct, 2× similar-looking, 1× completely different), shuffled, 60 s default TTL
   - Response strips `correctOption` and `userId` via `.toPublicObject()`
2. **User clicks one option** → frontend instantly disables all 4 options (no Submit button)
3. **Automatic verification request** `POST /api/captcha/verify { challengeId, selectedOption }`
   - backend re-reads challenge with `.select('+correctOption')`, checks ownership, status, expiry, option whitelist
   - computes `isCorrect` server-side, determines reward from `CaptchaRewardConfig` (default correct=1, wrong=0.5)
   - creates `CaptchaAttempt` + `GemTransaction { status: PENDING, idempotencyKey: sha256(userId::challengeId) unique }`
   - marks challenge COMPLETED
   - responds `200 { challengeId, isCorrect, rewardAmount, rewardStatus: "PENDING", attemptId }` — wallet NOT touched
4. **Mock rewarded ad** → overlay shown for 3 seconds; close triggers `POST /api/captcha/ad-complete { challengeId }` → stamps `adCompletedAt`
5. **Claim** → `POST /api/captcha/claim { challengeId }`
   - `findOneAndUpdate` GemTransaction from PENDING → CLAIMED (atomic). If no document matched: race/duplicate → 409
   - single `WalletService.incrementGems(userId, amount)` (exactly once)
   - responds `200 { rewardAmount, status: "CLAIMED", gems: <new balance> }`
6. **Next challenge** or **No Thanks** → `POST /api/captcha/new { challengeId }`
   - old challenge marked SKIPPED. Any PENDING GemTransaction at that moment is cancelled (FAILED)
   - fresh challenge generated + returned via same `.toPublicObject()`
7. **Logout** → frontend clears JWT from localStorage; redirects to `/login`

---

## 💎 Reward Lifecycle

| Stage | Endpoint | Challenge Status | GemTransaction Status | Wallet.gems | Audit |
|---|---|---|---|---|---|
| Generated | `/captcha/current` (new) | ACTIVE | — | — | — |
| Verified correct | `/captcha/verify` | COMPLETED | **PENDING** | unchanged | CHALLENGE_VERIFIED + REWARD_CREATED |
| Verified wrong | `/captcha/verify` | COMPLETED | **PENDING** (wrong reward) | unchanged | CHALLENGE_VERIFIED + REWARD_CREATED |
| Ad watched | `/captcha/ad-complete` | COMPLETED | PENDING + adCompletedAt | unchanged | AD_COMPLETED |
| Claimed | `/captcha/claim` | COMPLETED | **CLAIMED** | +amount (**once**) | REWARD_CLAIMED |
| New / skipped | `/captcha/new` | SKIPPED | PENDING→FAILED (or —) | unchanged | CHALLENGE_SKIPPED |
| Timeout | `/captcha/current` (next fetch) | EXPIRED | — | unchanged | EXPIRED_CHALLENGE |

---

## 👛 Wallet Lifecycle

- A single `Wallet` document per user (unique: true on `userId`). Created by `getOrCreateWallet` on first balance access.
- Only one code path ever increments `Wallet.gems`: `WalletService.incrementGems(userId, amount, session?)` → `findOneAndUpdate({userId}, {$inc:{gems:amount}}, {upsert, setDefaultsOnInsert, runValidators, new:true})`.
- Read path: `WalletService.getBalance(userId, session?)` → always re-reads fresh document; never trusts client state.
- Frontend has **no authority** over wallet numbers: balance is fetched from `/api/wallet/gems` after claim, and Navbar + WalletCard share a module-level `sharedGemsRef` listener so neither mutates the value independently.

---

## 📺 Mock Ad Flow

- After a successful `/verify` with `rewardStatus: PENDING`, the frontend mounts `AdOverlay`.
- Countdown shows "Watching rewarded ad… 3s" with a progress bar.
- On countdown end:
  1. Calls `POST /api/captcha/ad-complete { challengeId }` (idempotent — safe to retry; duplicate already-claimed returns 409 with context)
  2. Unmounts overlay, shows success state with Claim button.
- If user clicks **No thanks** before claim: triggers `/captcha/new`, cancels the pending reward (GemTransaction FAILED), loads fresh CAPTCHA.

---

## 🛡️ Security Architecture

Full detail in [docs/SECURITY.md](docs/SECURITY.md). Summary:

| Layer | Control |
|---|---|
| HTTP headers | Helmet: CSP default-src self, frameAncestors none, strict-origin-when-cross-origin referrer |
| CORS | Strict origin allow-list. Production enforces non-empty FRONTEND_URL (hard-exits startup if missing) |
| Auth | JWT 7-day expiry. protect() middleware verifies signature; strips all client-supplied userId from business logic |
| Passwords | bcryptjs salt=10, select:false, toSafeObject strip, generic invalid-credentials response |
| Input | express-validator chains on every write endpoint + backend secondary whitelists (allowedOptions array check) |
| Rate limit | Auth 100/15m, CAPTCHA 60/1m, Wallet 120/1m — standardHeaders true, legacyHeaders false |
| Challenge expiry | 60 s default; checked in verify + lazily on next `/current` fetch |
| Replay protection | 3 layers: (1) challenge.status !== ACTIVE gate, (2) sha256 idempotencyKey UNIQUE on GemTransaction, (3) CaptchaAttempt unique compound (challengeId, userId) |
| Duplicate claim | PENDING→CLAIMED atomic findOneAndUpdate inside Mongo session (or best-effort if no replica set) |
| Concurrency | Mongo startSession + startTransaction when replica set detected; fall back to unique-index + optimistic findOneAndUpdate races that fail cleanly with 409 |
| Server-authoritative | Client rewardAmount/gems/isCorrect/userId/correctOption in request bodies are ALL ignored |
| Audit | 15-action enum indexed; SUSPICIOUS_REQUEST fires on every cross-user attempt |
| Error handling | Final 500 middleware returns ONLY `{success:false,message:"Internal server error"}`. No stack traces to client |
| Secrets | 3-layer `.gitignore` (root / per-package / catch-all). .env.example contains zero actual secret values |
| NoSQLi | Mongoose ODM queries throughout; req.body fields are string-typed; never passed into raw aggregation without sanitization |

---

## 📚 API Overview

Full endpoint-by-endpoint documentation in [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md).

```
Auth:
  POST /api/auth/register    100/15m rate limit
  POST /api/auth/login       100/15m rate limit
  GET  /api/auth/me          JWT required

Captcha (all JWT required; 60/1m rate limit):
  GET  /api/captcha/current
  POST /api/captcha/verify        body: { challengeId, selectedOption }
  POST /api/captcha/ad-complete   body: { challengeId }
  POST /api/captcha/claim         body: { challengeId }
  POST /api/captcha/new           body: { challengeId }

Wallet (JWT required; 120/1m rate limit):
  GET  /api/wallet/gems

Health (public):
  GET  /api/health
```

---

## 🚀 Local Setup

### Prerequisites

- Node.js ≥ 18
- MongoDB instance (local or MongoDB Atlas connection string)

### 1. Clone / install

```bash
# Backend
cd backend
npm install

# Frontend (separate terminal)
cd ../frontend
npm install
```

### 2. Configure environment

Backend: copy `backend/.env.example` to `backend/.env` and fill:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/veloop_captcha  # or Atlas srv
JWT_SECRET=<long random string — NEVER commit this>
CAPTCHA_EXPIRY_SECONDS=60
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

Frontend: copy `frontend/.env.example` to `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

### 3. Run

```bash
# Terminal 1 — backend :5000
cd backend
npm run dev    # or: npm start (production, no nodemon)

# Terminal 2 — frontend :5173
cd ../frontend
npm run dev
```

Open http://localhost:5173 in a browser.

---

## 🌱 Environment Variables

### Backend (backend/.env)

| Variable | Required (prod) | Description |
|---|---|---|
| `PORT` | No | API port. Default 5000 |
| `MONGO_URI` | **Yes** | MongoDB connection string (local or Atlas) |
| `JWT_SECRET` | **Yes** | Long random secret used to sign JWTs. **Rotate often, never share** |
| `CAPTCHA_EXPIRY_SECONDS` | No | Challenge TTL. Default 60 |
| `FRONTEND_URL` | **Yes** | Public origin of the deployed frontend (used by CORS allow-list). In development: localhost:5173 auto-added |
| `NODE_ENV` | No | `development` / `production`. Default `development` |

### Frontend (frontend/.env)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_BASE_URL` | **Yes** | Public full base path for API calls, e.g. `http://localhost:5000/api` (dev) or `https://api.example.com/api` (prod) |

---

## 🧪 Testing

### `npm test` (backend package)

Runs two real maintained Node.js harnesses in sequence (short-circuit `&&`, non-zero exit on any failure):

```
backend/
  npm test
  → echo === Phase 5 Reward Lifecycle Regression (11 invariants) ===
  → node test-phase5.js
  → echo === Phase 6 Full-Stack E2E Regression ===
  → node test-phase6.js
```

**What each covers:**

- `test-phase5.js` — 11 invariants including: wallet NOT incremented on verify, incremented exactly once on claim, duplicate verify/claim 409, cross-user 403, expired 410, spoof rewardAmount/gems/userId/isCorrect ALL ignored, concurrent claims → exactly one success + single wallet increment.
- `test-phase6.js` — auth flow (register/login/me), current challenge shape (no correctOption, exactly 4 options), wrong/right verify, ad-complete, claim, wallet refresh, new challenge, plus negative harness cases (unauthorized, invalid challenge, duplicate, cross-user).

### Full detail

See [docs/TESTING.md](docs/TESTING.md) with LIVE-PASS/LIVE-FAIL/BLOCKED results and links to raw log artifacts.

---

## 📬 Postman

Import `postman/VELoop-Captcha.postman_collection.json` into Postman.

Collection uses environment variables:

| Variable | Example value |
|---|---|
| `baseUrl` | `http://localhost:5000/api` |
| `frontendUrl` | `http://localhost:5173` |
| `token` | (populated automatically after Register / Login requests via tests) |
| `challengeId` | (populated automatically from Current CAPTCHA response) |

Folders:
- **Happy Flow** — Register → Login → Get Current CAPTCHA → Verify (correct) → Ad Complete → Claim → Get Wallet → Get New CAPTCHA → Verify (wrong) → Get History
- **Negative Tests** — unauthorized, invalid token, invalid challenge, expired challenge, completed challenge, wrong user, duplicate verify, duplicate claim, invalid option, missing option, fake rewardAmount, fake isCorrect, fake userId, fake gems, rate limit

---

## 🚢 Deployment

### Backend (Node/Express)

Recommended platforms: Render / Railway / Fly.io / Heroku / self-hosted.

1. Push backend folder (or monorepo with backend as root).
2. Set **Production environment variables**:
   - `NODE_ENV=production`
   - `PORT` (platform-managed in most cases)
   - `MONGO_URI` → **MongoDB Atlas production connection string** (whitelist platform egress IPs)
   - `JWT_SECRET` → long random value
   - `FRONTEND_URL` → actual deployed frontend origin (e.g. `https://veloop-captcha-web.vercel.app`) — MUST include scheme; no trailing slash. Startup hard-exits if unset in production.
   - `CAPTCHA_EXPIRY_SECONDS=60` (tune as needed)
3. Start command: `npm start` (or `node server.js`)
4. Verify: `GET <backend>/api/health` → `{status:"ok", mongodb:"connected"}`

### Frontend (Vite React)

Recommended: Vercel / Netlify / Cloudflare Pages / Render static site.

1. Build: `npm run build` → output in `frontend/dist/`.
2. Set build env:
   - `VITE_API_BASE_URL=https://<your-deployed-backend>/api`
3. Build command: `npm run build`; publish directory `dist`.
4. SPA fallback: enable rewrite `/* → /index.html` (react-router-dom BrowserRouter needs this).
5. After first deploy: open DevTools → Network, confirm every API call goes out with correct `VITE_API_BASE_URL` and receives CORS headers (`Access-Control-Allow-Origin: <exact frontend origin>`).

### Production CORS Verification

After both deploys:
- Browser E2E Register/Login works → token received → /captcha/current returns 200.
- Third-party origin (e.g. `https://evil.example.com`) making a fetch MUST fail CORS preflight / return no `Access-Control-Allow-Origin` header.

---

## 🌐 Live URLs

| Service | Local | Deployment |
|---|---|---|
| Backend API | http://localhost:5000 | **BLOCKED — deploy via instructions above; requires platform credentials** |
| Frontend Web | http://localhost:5173 | **BLOCKED — deploy via instructions above; requires platform credentials** |
| Health check | http://localhost:5000/api/health | `<backend>/api/health` |

---

## ⚠️ Known Limitations

1. **No email verification / password reset** flow currently implemented. Auth endpoints are register + login + me only.
2. **CAPTCHA image rendering**: current implementation uses text CAPTCHA (string + 4 text options) instead of a distorted image. Sufficient for demo/submission; upgrade to a library like `svg-captcha` or third-party service (hCaptcha, Turnstile) for production human-vs-bot confidence.
3. **MongoDB replica set transactions**: Session start-up probe (see `supportTransactions()` in [captcha.controller.js](backend/src/controllers/captcha.controller.js#L74-L106)) auto-detects if your Mongo instance supports multi-document transactions. If running a standalone (non-replica) Mongo, everything still works via unique-index idempotency; there is a narrow race window where concurrent claim in two processes could both read PENDING before first write completes. The `idempotencyKey` unique index + `findOneAndUpdate` atomicity cover the critical exactly-once invariants, so this is LOW severity.
4. **Frontend localStorage JWT** (non-httpOnly). Works for this architecture; a real production deployment should consider httpOnly SameSite=Lax cookies + CSRF tokens to eliminate XSS exfiltration surface.
5. **No admin dashboard / CAPTCHA history UI**. Backend exposes `AuditLog` + `CaptchaAttempt` + `GemTransaction` collections programmatically, but no frontend page is built. This is intentional per scope.
6. **No `.git` repository initialized in this workspace**. Phase 7 verified via .gitignore rules; actual git tracking / push requires a `git init` + first commit outside of this submission pipeline.

---

## 🎬 Demo Instructions

Walk evaluators through the following working flow (1–2 minutes):

1. **Open frontend** → Landing Page hero CTA "Start Earning".
2. **Register** → fill name, email, password (≥6 chars). "Account created successfully!" → auto-navigate to /earn.
3. **CAPTCHA appears** → 6-char uppercase text prompt, **exactly 4 radio buttons, NO Submit button**.
4. **Select any option** → all 4 options instantly disabled (locked), spinner appears.
5. **Automatic verification** → POST /verify sent; result panel shows Correct / Wrong + reward amount.
6. **Mock rewarded ad overlay** → 3 s countdown "Watching rewarded ad…"; on finish, Claim button appears.
7. **Claim** → spinner + "Reward claimed!" banner; WalletCard and Navbar WalletBadge **both update live** to new balance.
8. **New CAPTCHA** → POST /new fires; fresh (different) 6-char text appears. Point out that wallet number is **unchanged until next claim**.
9. **Show backend/database evidence (optional)** → open `backend` console or MongoDB Compass, show:
   - `CaptchaChallenge` document has `correctOption` but `/captcha/current` response does not (check browser Network tab).
   - `GemTransaction.status` went PENDING → CLAIMED; `claimedAt` timestamp present only after /claim.
   - `Wallet.gems` matches sum of CLAIMED transactions for that user.
10. **Show security behavior (optional)** → Postman negative tests: duplicate /claim returns 409, cross-user claim returns 403, `/verify` with `{rewardAmount: 999, gems: 500}` in body is silently ignored (reward stays at config value).
11. **Logout** → Navbar "Sign out" → JWT removed, back to /login.

See [docs/PHASE8_FINAL_SUBMISSION_REPORT.md](docs/PHASE8_FINAL_SUBMISSION_REPORT.md) for the Phase 8 final status + evidence.

---

## 📖 Further Reading

| Document | Location |
|---|---|
| API specification (endpoint-by-endpoint) | [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) |
| Database / Mongoose models | [docs/DATABASE.md](docs/DATABASE.md) |
| Security controls inventory | [docs/SECURITY.md](docs/SECURITY.md) |
| Testing evidence matrix | [docs/TESTING.md](docs/TESTING.md) |
| Phase 7 security test report (LIVE results) | [docs/PHASE7_SECURITY_TEST_REPORT.md](docs/PHASE7_SECURITY_TEST_REPORT.md) |
| Phase 6 test report | [docs/PHASE6_TEST_REPORT.md](docs/PHASE6_TEST_REPORT.md) |
| Phase 8 final submission report | [docs/PHASE8_FINAL_SUBMISSION_REPORT.md](docs/PHASE8_FINAL_SUBMISSION_REPORT.md) |
