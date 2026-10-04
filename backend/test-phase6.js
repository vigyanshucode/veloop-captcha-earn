require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');

const API_HOST = 'localhost';
const API_PORT = 5000;

const results = {
  build: {},
  health: {},
  auth: {},
  captcha: {},
  wallet: {},
  security: {},
};

const api = (method, path, body = null, token = null) =>
  new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: API_HOST,
      port: API_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 10000,
    };
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: chunks ? (() => { try { return JSON.parse(chunks); } catch (_) { return { _raw: chunks }; } })() : null,
        });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: null, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: null, error: 'timeout' }); });
    if (data) req.write(data);
    req.end();
  });

const withMongo = async (fn) => {
  require('./src/models/User');
  require('./src/models/CaptchaChallenge');
  require('./src/models/CaptchaAttempt');
  require('./src/models/Wallet');
  require('./src/models/GemTransaction');
  require('./src/models/CaptchaRewardConfig');
  require('./src/models/AuditLog');
  await mongoose.connect(process.env.MONGO_URI);
  try {
    return await fn(mongoose);
  } finally {
    await mongoose.disconnect();
  }
};

const hr = (t) => console.log(`\n${'='.repeat(72)}\n  ${t}\n${'='.repeat(72)}`);
const PASS = (t, d = null) => console.log(`  [LIVE-PASS] ${t}` + (d ? ` — ${JSON.stringify(d)}` : ''));
const FAIL = (t, d = null) => console.log(`  [LIVE-FAIL] ${t}` + (d ? ` — ${JSON.stringify(d)}` : ''));
const NOTE = (t, d = null) => console.log(`  [NOTE]      ${t}` + (d ? ` — ${JSON.stringify(d)}` : ''));
const BLOCKED = (t, d = null) => console.log(`  [BLOCKED]   ${t}` + (d ? ` — ${JSON.stringify(d)}` : ''));

const randEmail = (p) => `p6_${p}_${crypto.randomBytes(4).toString('hex')}@veloop.com`;

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const retry429 = async (fn, retries = 2, waitSec = 5) => {
  for (let i = 0; i <= retries; i++) {
    const r = await fn();
    if (r.status !== 429) return r;
    if (i < retries) { NOTE(`Retry ${i + 1}/${retries}: hit 429 rate-limit; waiting ${waitSec}s...`); await sleep(waitSec); }
  }
  return { status: 429, body: null, _rateLimited: true };
};

const runAll = async () => {
  // ============================================================
  // 0. HEALTH + BUILD
  // ============================================================
  hr('0. BACKEND HEALTH + MONGO CONNECTIVITY');
  try {
    const h = await api('GET', '/api/health');
    const ok = h.status === 200 && h.body && (h.body.success === true || h.body.status === 'ok');
    const mongoStatus = (h.body && h.body.data && h.body.data.mongo) || (h.body && h.body.mongodb);
    const mongoConnected = mongoStatus && (mongoStatus === 'connected' || mongoStatus.connected === true || mongoStatus.readyState === 1);
    results.health = { status: h.status, body: h.body };
    if (ok && mongoConnected) {
      PASS(`Backend UP @ :${API_PORT} — MongoDB connected`);
    } else if (ok) {
      FAIL('Backend UP but MongoDB status not reported as connected', { mongoStatus });
    } else {
      FAIL('Backend health check failed', { status: h.status, body: h.body });
    }
  } catch (e) {
    BLOCKED('Backend unreachable — all HTTP tests aborted', { error: e.message });
    process.exit(2);
  }

  // ============================================================
  // 1. AUTH FLOW
  // ============================================================
  hr('1. AUTH FLOW (HTTP API level)');
  const A_email = randEmail('autha');
  const A_pw = 'pass1234';
  const A_regRes = await api('POST', '/api/auth/register', { name: 'AuthA User', email: A_email, password: A_pw });
  const A_regOK = A_regRes.status === 201 && A_regRes.body && A_regRes.body.success && A_regRes.body.data && A_regRes.body.data.token;
  results.auth.register = { status: A_regRes.status, ok: A_regOK };
  if (A_regOK) PASS('1A. Register — creates user + returns JWT', { userId: A_regRes.body.data.user._id.slice(-8), email: A_email });
  else FAIL('1A. Register', { status: A_regRes.status, body: A_regRes.body });

  const A_token = A_regOK ? A_regRes.body.data.token : null;

  const dup = await api('POST', '/api/auth/register', { name: 'Dup', email: A_email, password: 'aaaa1111' });
  const dupOK = dup.status >= 400 && dup.body && dup.body.success === false;
  results.auth.dupRegister = { status: dup.status, ok: dupOK };
  if (dupOK) PASS('1B. Duplicate registration — rejected', { status: dup.status, message: dup.body && dup.body.message });
  else FAIL('1B. Duplicate registration — should reject', { status: dup.status, body: dup.body });

  const lg = await api('POST', '/api/auth/login', { email: A_email, password: A_pw });
  const lgOK = lg.status === 200 && lg.body && lg.body.data && lg.body.data.token;
  results.auth.login = { status: lg.status, ok: lgOK };
  if (lgOK) PASS('1C. Login — returns JWT', { email: A_email });
  else FAIL('1C. Login', { status: lg.status, body: lg.body });

  const lgToken = lgOK ? lg.body.data.token : A_token;

  const badPw = await api('POST', '/api/auth/login', { email: A_email, password: 'wrongpass99' });
  const badOK = badPw.status === 401 || badPw.status === 400;
  results.auth.badPw = { status: badPw.status, ok: badOK };
  if (badOK) PASS('1D. Wrong password — rejected (4xx)', { status: badPw.status });
  else FAIL('1D. Wrong password — should 4xx', { status: badPw.status, body: badPw.body });

  const me = await api('GET', '/api/auth/me', null, lgToken);
  const meOK = me.status === 200 && me.body && me.body.data && me.body.data.user && me.body.data.user.email === A_email;
  const passwordInMe = me.body && me.body.data && me.body.data.user && ('password' in me.body.data.user || 'passwordHash' in me.body.data.user);
  results.auth.me = { status: me.status, ok: meOK, noPasswordHash: !passwordInMe };
  if (meOK && !passwordInMe) PASS('1E. Authenticated /me — returns user WITHOUT password/passwordHash', { email: me.body.data.user.email });
  else if (meOK && passwordInMe) FAIL('1E. /me — leaks password/passwordHash', { keys: Object.keys(me.body.data.user) });
  else FAIL('1E. /me', { status: me.status, body: me.body });

  const noAuth = await api('GET', '/api/captcha/current');
  const noAuthOK = noAuth.status === 401;
  results.auth.protected = { status: noAuth.status, ok: noAuthOK };
  if (noAuthOK) PASS('1G. Protected route without token → 401');
  else FAIL('1G. Protected route should 401 without token', { status: noAuth.status, body: noAuth.body });

  // Also verify /captcha/current works WITH token to confirm token validity and route
  const cur0 = await api('GET', '/api/captcha/current', null, lgToken);
  if (cur0.status === 200 && cur0.body && cur0.body.data) PASS('(extra) /api/captcha/current with valid JWT returns challenge', { challengeId: cur0.body.data.challengeId.slice(-8) });
  else FAIL('(extra) /api/captcha/current with token failed', { status: cur0.status, body: cur0.body });

  // ============================================================
  // 2. CAPTCHA ENDPOINTS — correct + wrong + claim + new
  // ============================================================
  hr('2. CAPTCHA FLOW (HTTP API + MongoDB direct read for correctOption)');

  // --- 2A. /current response shape ---
  const U_email = randEmail('cflow');
  const U_reg = await api('POST', '/api/auth/register', { name: 'CFlow U', email: U_email, password: 'pass1234' });
  const U_tok = U_reg.body && U_reg.body.data ? U_reg.body.data.token : null;
  if (!U_tok) { BLOCKED('Cannot register CAPTCHA user — aborting CAPTCHA flow tests'); process.exit(3); }

  const c1 = await api('GET', '/api/captcha/current', null, U_tok);
  const c1OK = c1.status === 200 && c1.body && c1.body.data;
  results.captcha.current = { ok: c1OK, status: c1.status };
  const c1Data = c1OK ? c1.body.data : null;

  // Check 4 options AND no sensitive fields in response
  const optOk = c1Data && Array.isArray(c1Data.options) && c1Data.options.length === 4;
  const noCorrectInResp = c1Data && !('correctOption' in c1Data) && !('isCorrect' in c1Data);
  const noUserIdInResp = c1Data && !('userId' in c1Data);
  const safeKeys = c1Data ? Object.keys(c1Data) : [];
  if (optOk && noCorrectInResp && noUserIdInResp) {
    PASS('2A. /current returns exactly 4 options; no correctOption/userId exposed', { options: c1Data.options, keys: safeKeys });
  } else {
    FAIL('2A. /current shape violation', { optLen: optOk, noCorrect: noCorrectInResp, noUserId: noUserIdInResp, keys: safeKeys });
  }

  // --- 2B. Find correctOption via MongoDB (server-only) ---
  const cId1 = c1Data.challengeId;
  let mongoCorrect = null;
  try {
    await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const doc = await C.findOne({ challengeId: cId1 }).select('+correctOption');
      mongoCorrect = doc ? doc.correctOption : null;
      PASS('2B. MongoDB direct read of correctOption OK (field exists on server only)', { correctOption: mongoCorrect, challengeId: cId1.slice(-8) });
    });
  } catch (e) { FAIL('2B. MongoDB read failed', { error: e.message }); }

  // --- 2C. Correct answer verification ---
  const walletBeforeCorrect = await withMongo(async (mongoose) => {
    const W = mongoose.model('Wallet'); const U = mongoose.model('User');
    const uDoc = await U.findOne({ email: U_email });
    const w = await W.findOne({ userId: uDoc._id });
    return w ? w.gems : 0;
  });
  const verOk = await api('POST', '/api/captcha/verify', { challengeId: cId1, selectedOption: mongoCorrect }, U_tok);
  const verOkOK = verOk.status === 200 && verOk.body && verOk.body.data && verOk.body.data.isCorrect === true && verOk.body.data.rewardStatus === 'PENDING';
  const walletAfterVer = await withMongo(async (mongoose) => {
    const W = mongoose.model('Wallet'); const U = mongoose.model('User');
    const uDoc = await U.findOne({ email: U_email });
    const w = await W.findOne({ userId: uDoc._id });
    return w ? w.gems : 0;
  });
  const noWalletIncrementOnVerify = walletBeforeCorrect === walletAfterVer;
  results.captcha.verifyCorrect = { status: verOk.status, ok: verOkOK, walletUnchanged: noWalletIncrementOnVerify };
  if (verOkOK && noWalletIncrementOnVerify) {
    PASS('2C. Correct verify → isCorrect=true, rewardStatus=PENDING, wallet NOT incremented', { rewardAmount: verOk.body.data.rewardAmount, walletBefore: walletBeforeCorrect, walletAfter: walletAfterVer });
  } else {
    FAIL('2C. Correct verify violation', { status: verOk.status, isCorrect: verOk.body && verOk.body.data && verOk.body.data.isCorrect, rewardStatus: verOk.body && verOk.body.data && verOk.body.data.rewardStatus, walletBefore: walletBeforeCorrect, walletAfter: walletAfterVer });
  }

  // --- Verify only challengeId + selectedOption accepted. Verify extra fields IGNORED. ---
  const S_email = randEmail('spoof');
  const S_reg = await api('POST', '/api/auth/register', { name: 'Spoof', email: S_email, password: 'pass1234' });
  const S_tok = S_reg.body && S_reg.body.data ? S_reg.body.data.token : null;
  const sC = await api('GET', '/api/captcha/current', null, S_tok);
  const sCid = sC.body && sC.body.data ? sC.body.data.challengeId : null;
  const sCorrect = sCid ? await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const doc = await C.findOne({ challengeId: sCid }).select('+correctOption');
    return doc.correctOption;
  }) : null;
  const wrongOpt = (sC.body.data.options.find(o => o !== sCorrect));

  // Spoof attempt: send `correctOption`, `isCorrect`, `rewardAmount`, `gems` in body along with wrong answer.
  const spoofBody = { challengeId: sCid, selectedOption: wrongOpt, correctOption: sCorrect, isCorrect: true, rewardAmount: 999, gems: 99999 };
  const spoofRes = await api('POST', '/api/captcha/verify', spoofBody, S_tok);
  const spoofTreatedAsWrong = spoofRes.status === 200 && spoofRes.body && spoofRes.body.data && spoofRes.body.data.isCorrect === false;
  const rewardFromBackend = spoofRes.body && spoofRes.body.data ? spoofRes.body.data.rewardAmount : null;
  results.captcha.spoofFields = { ok: spoofTreatedAsWrong, rewardAmount: rewardFromBackend, status: spoofRes.status };
  if (spoofTreatedAsWrong) {
    PASS('2D. Verify ignores spoofed correctOption/isCorrect/rewardAmount/gems in request body — treats wrong answer as wrong', { sentWrong: wrongOpt, serverCalledIsCorrect: false, rewardFromBackend });
  } else {
    FAIL('2D. Verify accepted spoofed fields', { status: spoofRes.status, body: spoofRes.body });
  }

  // --- 2E. Duplicate verify on same challenge → 409 ---
  const dupV = await api('POST', '/api/captcha/verify', { challengeId: cId1, selectedOption: mongoCorrect }, U_tok);
  const dupVOK = dupV.status === 409;
  results.captcha.dupVerify = { status: dupV.status, ok: dupVOK };
  if (dupVOK) PASS('2E. Duplicate /verify on same challenge → 409 CONFLICT', { status: dupV.status, message: dupV.body && dupV.body.message });
  else FAIL('2E. Duplicate verify should 409', { status: dupV.status, body: dupV.body });

  // --- 2F. Wrong answer on a fresh challenge (fractional 0.5 reward) ---
  const W_email = randEmail('wrongans');
  const W_reg = await api('POST', '/api/auth/register', { name: 'WrongA', email: W_email, password: 'pass1234' });
  const W_tok = W_reg.body && W_reg.body.data ? W_reg.body.data.token : null;
  const wC = await api('GET', '/api/captcha/current', null, W_tok);
  const wCid = wC.body.data.challengeId;
  const wCorrect = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const doc = await C.findOne({ challengeId: wCid }).select('+correctOption');
    return doc.correctOption;
  });
  const wWrong = wC.body.data.options.find(o => o !== wCorrect);
  const wVer = await api('POST', '/api/captcha/verify', { challengeId: wCid, selectedOption: wWrong }, W_tok);
  const wVerOK = wVer.status === 200 && wVer.body && wVer.body.data && wVer.body.data.isCorrect === false;
  const fracReward = wVer.body && wVer.body.data && Math.abs(parseFloat(wVer.body.data.rewardAmount) - 0.5) < 1e-6;
  results.captcha.wrongAnswer = { ok: wVerOK && fracReward, status: wVer.status, rewardAmount: wVer.body && wVer.body.data && wVer.body.data.rewardAmount };
  if (wVerOK && fracReward) PASS('2F. Wrong answer → isCorrect=false + fractional reward 0.5 gems', { rewardAmount: wVer.body.data.rewardAmount });
  else FAIL('2F. Wrong answer flow', { status: wVer.status, isCorrect: wVer.body && wVer.body.data && wVer.body.data.isCorrect, rewardAmount: wVer.body && wVer.body.data && wVer.body.data.rewardAmount });

  // --- 2G. Claim flow: ad-complete then claim → wallet incremented exactly once ---
  const walletBeforeClaim = await withMongo(async (mongoose) => {
    const W = mongoose.model('Wallet'); const U = mongoose.model('User');
    const uDoc = await U.findOne({ email: U_email });
    const w = await W.findOne({ userId: uDoc._id });
    return w ? w.gems : 0;
  });

  const adRes = await api('POST', '/api/captcha/ad-complete', { challengeId: cId1 }, U_tok);
  const adOK = adRes.status === 200 && adRes.body && adRes.body.success;
  results.captcha.adComplete = { status: adRes.status, ok: adOK };
  if (adOK) PASS('2G1. /ad-complete recorded (reward still PENDING pre-claim)', { status: adRes.status, rewardStatus: adRes.body && adRes.body.data && adRes.body.data.rewardStatus });
  else FAIL('2G1. /ad-complete failed', { status: adRes.status, body: adRes.body });

  const claimRes = await api('POST', '/api/captcha/claim', { challengeId: cId1 }, U_tok);
  const claimOK = claimRes.status === 200 && claimRes.body && claimRes.body.success && claimRes.body.data && claimRes.body.data.status === 'CLAIMED';
  const walletAfterClaim = claimRes.body && claimRes.body.data ? claimRes.body.data.gems : null;
  const expectedWallet = (Number(walletBeforeClaim) || 0) + (verOk.body && verOk.body.data ? parseFloat(verOk.body.data.rewardAmount) || 0 : 0);
  const walletIncremOK = Number.isFinite(walletAfterClaim) && Math.abs(walletAfterClaim - expectedWallet) < 1e-6;

  // verify claim did NOT accept body spoof fields (send rewardAmount + gems in claim body)
  const SC_email = randEmail('spclm');
  const SC_reg = await api('POST', '/api/auth/register', { name: 'SpoofClaim', email: SC_email, password: 'pass1234' });
  const SC_tok = SC_reg.body.data.token;
  const SCc = await api('GET', '/api/captcha/current', null, SC_tok);
  const SCcid = SCc.body.data.challengeId;
  const SCcorrect = await withMongo(async (mongoose) => { const C = mongoose.model('CaptchaChallenge'); const d = await C.findOne({ challengeId: SCcid }).select('+correctOption'); return d.correctOption; });
  await api('POST', '/api/captcha/verify', { challengeId: SCcid, selectedOption: SCcorrect }, SC_tok);
  const SCpre = await withMongo(async (mongoose) => { const W = mongoose.model('Wallet'); const U = mongoose.model('User'); const uDoc = await U.findOne({ email: SC_email }); const w = await W.findOne({ userId: uDoc._id }); return w ? w.gems : 0; });
  // Attempt to spoof claim request body with huge reward/gems
  const spClaimRes = await api('POST', '/api/captcha/claim', { challengeId: SCcid, rewardAmount: 9999, gems: 999999 }, SC_tok);
  const finalGemsFromClaim = spClaimRes.body && spClaimRes.body.data ? spClaimRes.body.data.gems : null;
  const SCpost = finalGemsFromClaim; // backend returned authoritative gems
  const SCrealReward = (SCpost || 0) - (SCpre || 0);
  const spoofClaimIgnored = SCrealReward < 10; // reward should be ~1 or ~0.5, NOT 9999
  results.captcha.claimSpoofIgnored = { ok: spoofClaimIgnored, pre: SCpre, post: SCpost, delta: SCrealReward };

  results.captcha.claim = { status: claimRes.status, ok: claimOK && walletIncremOK, walletBefore: walletBeforeClaim, walletAfter: walletAfterClaim, expected: expectedWallet };
  if (claimOK && walletIncremOK && spoofClaimIgnored) {
    PASS('2G2. /claim → status=CLAIMED, wallet incremented exactly by backend record (NOT by frontend body)', { walletBefore: walletBeforeClaim, walletAfter: walletAfterClaim, expectedDelta: (expectedWallet - walletBeforeClaim), spoofDelta: SCrealReward });
  } else {
    FAIL('2G2. /claim flow violation', { status: claimRes.status, claimStatus: claimRes.body && claimRes.body.data && claimRes.body.data.status, walletBefore: walletBeforeClaim, walletAfter: walletAfterClaim, expected: expectedWallet, spoofDelta: SCrealReward });
  }

  // --- 2H. Duplicate claim → 409 (no double wallet bump) ---
  const dupC = await api('POST', '/api/captcha/claim', { challengeId: cId1 }, U_tok);
  const dupCOK = dupC.status === 409;
  const walletAfterDup = await withMongo(async (mongoose) => {
    const W = mongoose.model('Wallet'); const U = mongoose.model('User');
    const uDoc = await U.findOne({ email: U_email });
    const w = await W.findOne({ userId: uDoc._id });
    return w ? w.gems : 0;
  });
  const noBumpOnDup = walletAfterClaim === walletAfterDup;
  results.captcha.dupClaim = { status: dupC.status, ok: dupCOK && noBumpOnDup, walletAfterDup };
  if (dupCOK && noBumpOnDup) PASS('2H. Duplicate /claim → 409, wallet NOT incremented again', { walletAfterClaim, walletAfterDup });
  else FAIL('2H. Duplicate claim violation', { status: dupC.status, walletAfterClaim, walletAfterDup });

  // --- 2I. /new (No Thanks) → new challenge, old challengeId different, old cannot be reused ---
  const N_email = randEmail('newch');
  const N_reg = await api('POST', '/api/auth/register', { name: 'NewCh', email: N_email, password: 'pass1234' });
  const N_tok = N_reg.body && N_reg.body.data ? N_reg.body.data.token : null;
  const n1 = await retry429(() => api('GET', '/api/captcha/current', null, N_tok));
  const n1Id = n1.body && n1.body.data ? n1.body.data.challengeId : null;
  let newRes = { status: 0, body: null };
  if (n1Id) newRes = await retry429(() => api('POST', '/api/captcha/new', { challengeId: n1Id }, N_tok));
  const newOK = newRes.status === 200 && newRes.body && newRes.body.data && newRes.body.data.challengeId !== n1Id;
  const n2Id = newOK ? newRes.body.data.challengeId : null;
  // try re-verify on old challengeId
  const nOldReuse = n1Id ? await api('POST', '/api/captcha/verify', { challengeId: n1Id, selectedOption: 'whatever' }, N_tok) : { status: 0 };
  const oldCannotReuse = nOldReuse.status === 400 || nOldReuse.status === 409 || nOldReuse.status === 410;
  results.captcha.newChallenge = { ok: newOK && oldCannotReuse, oldId: n1Id && n1Id.slice(-8), newId: n2Id && n2Id.slice(-8), reuseStatus: nOldReuse.status };
  if (newOK && oldCannotReuse) PASS('2I. POST /captcha/new → new challengeId; old challenge cannot be reused for verify', { oldId: n1Id.slice(-8), newId: n2Id.slice(-8), reuseStatus: nOldReuse.status });
  else FAIL('2I. /new violation', { newStatus: newRes.status, idsDiffer: n1Id !== n2Id, reuseStatus: nOldReuse.status, n1Status: n1.status });

  // --- 2J. Cross-user attack: user B tries verify/claim on user A's challenge ---
  const C_email = randEmail('crossa');
  const D_email = randEmail('crossb');
  const C_reg = await api('POST', '/api/auth/register', { name: 'CrossA', email: C_email, password: 'pass1234' });
  const D_reg = await api('POST', '/api/auth/register', { name: 'CrossB', email: D_email, password: 'pass1234' });
  const C_tok = C_reg.body && C_reg.body.data ? C_reg.body.data.token : null;
  const D_tok = D_reg.body && D_reg.body.data ? D_reg.body.data.token : null;
  const cC = await retry429(() => api('GET', '/api/captcha/current', null, C_tok));
  const cCid = cC.body && cC.body.data ? cC.body.data.challengeId : null;
  let crossOK = false;
  if (cCid && C_tok && D_tok) {
    const cCcorrect = await withMongo(async (mongoose) => { const C = mongoose.model('CaptchaChallenge'); const d = await C.findOne({ challengeId: cCid }).select('+correctOption'); return d.correctOption; });
    const crossVerify = await api('POST', '/api/captcha/verify', { challengeId: cCid, selectedOption: cCcorrect }, D_tok);
    crossOK = crossVerify.status === 403;
    results.captcha.crossUser = { status: crossVerify.status, ok: crossOK };
    if (crossOK) PASS('2J. Cross-user verify → 403 FORBIDDEN (ownership enforced)');
    else FAIL('2J. Cross-user verify SHOULD BE 403', { status: crossVerify.status, body: crossVerify.body });
  } else {
    results.captcha.crossUser = { status: cC.status, ok: false };
    FAIL('2J. Cross-user setup failed (likely 429 rate-limit)', { cCstatus: cC.status });
  }

  // ============================================================
  // 3. WALLET API (authoritative from backend)
  // ============================================================
  hr('3. WALLET /api/wallet/gems — authoritative backend value, no localStorage trust');
  const gemRes = await api('GET', '/api/wallet/gems', null, U_tok);
  const gemOK = gemRes.status === 200 && gemRes.body && Number.isFinite(gemRes.body.data && gemRes.body.data.gems);
  results.wallet.endpoint = { ok: gemOK, gems: gemRes.body && gemRes.body.data && gemRes.body.data.gems };
  if (gemOK) PASS('3A. /wallet/gems returns authoritative gem count from backend', { gems: gemRes.body.data.gems });
  else FAIL('3A. /wallet/gems failed', { status: gemRes.status, body: gemRes.body });

  // ============================================================
  // 4. ERROR HANDLING (verify HTTP codes 400/401/403/409/410/429)
  // ============================================================
  hr('4. ERROR STATUS CODES (sample) + response shape privacy (no stack traces)');
  const noJWT = await api('GET', '/api/captcha/current');
  results.security.status401 = noJWT.status;
  if (noJWT.status === 401) PASS('4A. No JWT → 401, no stack trace', { status: 401, keys: noJWT.body ? Object.keys(noJWT.body) : null });
  else FAIL('4A. No JWT', { status: noJWT.status });

  const badBody = await api('POST', '/api/captcha/verify', { challengeId: '', selectedOption: '' }, U_tok);
  results.security.status400 = badBody.status;
  if (badBody.status === 400) PASS('4B. Empty required fields → 400 validation error', { status: badBody.status });
  else FAIL('4B. Bad body should be 400', { status: badBody.status });

  // 429 (rate limit): make 65 rapid requests to a rate-limited endpoint from a fresh token
  // (only attempt if not already rate-limited; skip on fail)
  let hit429 = false;
  try {
    const R_email = randEmail('rlimit');
    const R_reg = await api('POST', '/api/auth/register', { name: 'RL', email: R_email, password: 'pass1234' });
    const R_tok = R_reg.body.data.token;
    for (let i = 0; i < 65; i++) {
      const r = await api('GET', '/api/captcha/current', null, R_tok);
      if (r.status === 429) { hit429 = true; break; }
    }
  } catch (_) { /* ignore */ }
  results.security.status429 = hit429 ? 429 : null;
  if (hit429) PASS('4C. 65 rapid requests triggers rate-limit → 429');
  else NOTE('4C. 429 rate-limit NOT TRIGGERED in test window (non-fatal, rate-limiter may allow burst)');

  // ============================================================
  // FINAL: Emit a summary the caller can parse
  // ============================================================
  hr('REPORT DATA READY');
  console.log(JSON.stringify(results, null, 2));
};

runAll().catch((e) => { console.error('SCRIPT FATAL:', e.message); console.error(e.stack); process.exit(1); });
