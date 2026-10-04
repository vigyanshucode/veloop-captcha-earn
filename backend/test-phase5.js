require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const waitForServer = async (port = 5000, maxSec = 60) => {
  const net = require('net');
  for (let i = 0; i < maxSec * 5; i++) {
    const ok = await new Promise((resolve) => {
      const s = new net.Socket();
      s.setTimeout(500);
      s.on('connect', () => { s.destroy(); resolve(true); });
      s.on('error', () => { s.destroy(); resolve(false); });
      s.on('timeout', () => { s.destroy(); resolve(false); });
      s.connect(port, '127.0.0.1');
    });
    if (ok) return true;
    await wait(200);
  }
  return false;
};

const api = (method, path, body = null, token = null) =>
  new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : null });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: null, error: e.message }));
    if (data) req.write(data);
    req.end();
  });

const registerUser = async (prefix) => {
  const email = `p5_${prefix}_${crypto.randomBytes(4).toString('hex')}@veloop.com`;
  const r = await api('POST', '/api/auth/register', { name: `${prefix} U`, email, password: 'pass1234' });
  if (!r.body || !r.body.success) throw new Error('register failed: ' + JSON.stringify(r));
  return { userId: r.body.data.user._id, token: r.body.data.token, email };
};

const getChallenge = async (token) => {
  const r = await api('GET', '/api/captcha/current', null, token);
  if (!r.body || !r.body.success) throw new Error('getChallenge failed: ' + JSON.stringify(r));
  return r.body.data;
};

const correctOptOf = async (challengeId) => withMongo(async (mongoose) => {
  const C = mongoose.model('CaptchaChallenge');
  const doc = await C.findOne({ challengeId }).select('+correctOption');
  return doc.correctOption;
});

const wrongOptOf = async (challengeId) => withMongo(async (mongoose) => {
  const C = mongoose.model('CaptchaChallenge');
  const doc = await C.findOne({ challengeId }).select('+correctOption');
  return doc.options.find((o) => o !== doc.correctOption);
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

const PASS = (t) => console.log('\x1b[32m%s\x1b[0m', '  [' + t + '] PASS');
const FAIL = (t, reason) => console.log('\x1b[31m%s\x1b[0m', '  [' + t + '] FAIL: ' + reason);
const hr = (t) => console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);

const results = {};

(async () => {
  console.log('Waiting for server on :5000...');
  const serverOk = await waitForServer(5000, 90);
  if (!serverOk) { console.error('SERVER DID NOT START. Terminating.'); process.exit(2); }
  console.log('Server is up.');

  const users = {
    a: await registerUser('alice5'),
    b: await registerUser('bob5'),
  };
  console.log('Test users:', users.a.email, users.b.email);

  // ===================== TEST 1: Successful claim =====================
  hr('TEST 1: Successful claim (PENDING -> CLAIMED, wallet +exactly once)');
  {
    const c = await getChallenge(users.a.token);
    const co = await correctOptOf(c.challengeId);
    const walletBefore = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet');
      const w = await W.findOne({ userId: users.a.userId });
      return w ? w.gems : 0;
    });
    const v = await api('POST', '/api/captcha/verify', { challengeId: c.challengeId, selectedOption: co }, users.a.token);
    console.log('verify ->', v.status, v.body ? v.body.data : null);
    const pendingTx = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: c.challengeId });
      const T = mongoose.model('GemTransaction');
      return T.findOne({ challengeId: ch._id }).lean();
    });
    console.log('pendingTx.status =', pendingTx && pendingTx.status);
    const walletAfterVerify = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet');
      const w = await W.findOne({ userId: users.a.userId });
      return w ? w.gems : 0;
    });
    const claim = await api('POST', '/api/captcha/claim', { challengeId: c.challengeId }, users.a.token);
    console.log('claim ->', claim.status, claim.body && claim.body.data ? claim.body.data : claim.body);
    const claimedTx = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: c.challengeId });
      const T = mongoose.model('GemTransaction');
      return T.findOne({ challengeId: ch._id }).lean();
    });
    const walletAfterClaim = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet');
      const w = await W.findOne({ userId: users.a.userId });
      return w ? w.gems : 0;
    });
    const t1Pass = v.status === 200
      && pendingTx && pendingTx.status === 'PENDING'
      && walletAfterVerify === walletBefore
      && claim.status === 200
      && claim.body.data.status === 'CLAIMED'
      && claimedTx.status === 'CLAIMED'
      && Math.abs(walletAfterClaim - (walletBefore + 1)) < 1e-9;
    if (t1Pass) PASS('TEST 1'); else FAIL('TEST 1', `w_before=${walletBefore}, w_after_verify=${walletAfterVerify}, w_after_claim=${walletAfterClaim}, tx_status=${claimedTx && claimedTx.status}, claim.status=${claim.status}`);
    results['TEST1'] = t1Pass;
  }

  // ===================== TEST 2: Duplicate claim =====================
  hr('TEST 2: Duplicate claim (first=OK, second=reject; NO double-gem)');
  {
    const c = await getChallenge(users.a.token);
    const co = await correctOptOf(c.challengeId);
    const v = await api('POST', '/api/captcha/verify', { challengeId: c.challengeId, selectedOption: co }, users.a.token);
    const cl1 = await api('POST', '/api/captcha/claim', { challengeId: c.challengeId }, users.a.token);
    const wBefore = cl1.body.data.gems;
    const cl2 = await api('POST', '/api/captcha/claim', { challengeId: c.challengeId }, users.a.token);
    const txCount = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: c.challengeId });
      const T = mongoose.model('GemTransaction');
      return T.countDocuments({ challengeId: ch._id });
    });
    const wAfter = cl2.body && cl2.body.data && typeof cl2.body.data.gems === 'number'
      ? cl2.body.data.gems
      : await withMongo(async (mongoose) => {
        const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
      });
    const t2Pass = cl1.status === 200 && cl2.status === 409 && txCount === 1 && wBefore === wAfter;
    if (t2Pass) PASS('TEST 2'); else FAIL('TEST 2', `cl1=${cl1.status} cl2=${cl2.status} txs=${txCount} wB=${wBefore} wA=${wAfter}`);
    results['TEST2'] = t2Pass;
  }

  // ===================== TEST 3: Cross-user claim =====================
  hr('TEST 3: User A claims User B reward -> rejected, no state change');
  {
    const cb = await getChallenge(users.b.token);
    const cob = await correctOptOf(cb.challengeId);
    const vb = await api('POST', '/api/captcha/verify', { challengeId: cb.challengeId, selectedOption: cob }, users.b.token);
    const wBBefore = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.b.userId }); return w ? w.gems : 0;
    });
    const aClaimB = await api('POST', '/api/captcha/claim', { challengeId: cb.challengeId }, users.a.token);
    const wBAfter = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.b.userId }); return w ? w.gems : 0;
    });
    const txStatus = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: cb.challengeId });
      const T = mongoose.model('GemTransaction');
      const t = await T.findOne({ challengeId: ch._id });
      return t ? t.status : null;
    });
    const t3Pass = aClaimB.status === 403 && wBBefore === wBAfter && txStatus === 'PENDING';
    if (t3Pass) PASS('TEST 3'); else FAIL('TEST 3', `claimStatus=${aClaimB.status} wBBefore=${wBBefore} wBAfter=${wBAfter} tx=${txStatus}`);
    results['TEST3'] = t3Pass;
  }

  // ===================== TEST 4: Claim without completed CAPTCHA =====================
  hr('TEST 4: Claim ACTIVE/unverified challenge -> rejected');
  {
    const c = await getChallenge(users.a.token);
    const beforeTxCount = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: c.challengeId });
      const T = mongoose.model('GemTransaction');
      return T.countDocuments({ challengeId: ch._id });
    });
    const cl = await api('POST', '/api/captcha/claim', { challengeId: c.challengeId }, users.a.token);
    const t4Pass = cl.status === 400 && beforeTxCount === 0;
    if (t4Pass) PASS('TEST 4'); else FAIL('TEST 4', `cl=${cl.status} txs=${beforeTxCount}`);
    results['TEST4'] = t4Pass;
  }

  // ===================== TEST 5: Fake rewardAmount ignored =====================
  hr('TEST 5: Fake rewardAmount=999999 ignored on claim');
  {
    const c = await getChallenge(users.a.token);
    const co = await correctOptOf(c.challengeId);
    const v = await api('POST', '/api/captcha/verify', { challengeId: c.challengeId, selectedOption: co }, users.a.token);
    const wBefore = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
    });
    const cl = await api('POST', '/api/captcha/claim', { challengeId: c.challengeId, rewardAmount: 999999, userId: users.b.userId, gems: 999999 }, users.a.token);
    const tx = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: c.challengeId });
      const T = mongoose.model('GemTransaction');
      return T.findOne({ challengeId: ch._id }).lean();
    });
    const wAfter = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
    });
    const t5Pass = cl.status === 200
      && Math.abs(tx.amount - 1) < 1e-9
      && Math.abs(cl.body.data.rewardAmount - 1) < 1e-9
      && Math.abs(wAfter - (wBefore + 1)) < 1e-9;
    if (t5Pass) PASS('TEST 5'); else FAIL('TEST 5', `tx.amount=${tx.amount} claimedReward=${cl.body && cl.body.data && cl.body.data.rewardAmount} wB=${wBefore} wA=${wAfter}`);
    results['TEST5'] = t5Pass;
  }

  // ===================== TEST 6: Mock ad completion =====================
  hr('TEST 6: Mock ad completion validates state -> success');
  {
    const c = await getChallenge(users.a.token);
    const co = await correctOptOf(c.challengeId);
    const v = await api('POST', '/api/captcha/verify', { challengeId: c.challengeId, selectedOption: co }, users.a.token);
    const ad = await api('POST', '/api/captcha/ad-complete', { challengeId: c.challengeId }, users.a.token);
    const tx = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: c.challengeId });
      const T = mongoose.model('GemTransaction');
      return T.findOne({ challengeId: ch._id }).lean();
    });
    const walletBeforeClaim = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
    });
    const cl = await api('POST', '/api/captcha/claim', { challengeId: c.challengeId }, users.a.token);
    const walletAfterClaim = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
    });
    const t6Pass = ad.status === 200
      && tx && tx.adCompletedAt
      && cl.status === 200
      && Math.abs(walletAfterClaim - (walletBeforeClaim + 1)) < 1e-9;
    if (t6Pass) PASS('TEST 6'); else FAIL('TEST 6', `ad=${ad.status} adAt=${tx && tx.adCompletedAt} claim=${cl.status} wB=${walletBeforeClaim} wA=${walletAfterClaim}`);
    results['TEST6'] = t6Pass;
  }

  // ===================== TEST 7: Fake ad completion (invalid challenge) =====================
  hr('TEST 7: Fake ad-complete on invalid/ineligible challenge');
  {
    const c = await getChallenge(users.a.token);
    const prev = { challengeId: c.challengeId };
    const wBefore = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
    });
    const adActive = await api('POST', '/api/captcha/ad-complete', { challengeId: c.challengeId, adWatched: true }, users.a.token);
    const adNonExistent = await api('POST', '/api/captcha/ad-complete', { challengeId: 'DOESNOTEXIST_' + crypto.randomBytes(4).toString('hex'), adWatched: true }, users.a.token);
    const wAfter = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
    });
    const t7Pass = adActive.status === 400 && adNonExistent.status === 404 && wBefore === wAfter;
    if (t7Pass) PASS('TEST 7'); else FAIL('TEST 7', `adActive=${adActive.status} ad404=${adNonExistent.status} wB=${wBefore} wA=${wAfter}`);
    results['TEST7'] = t7Pass;
  }

  // ===================== TEST 8: No Thanks / new CAPTCHA =====================
  hr('TEST 8: POST /api/captcha/new -> old=SKIPPED, new=different, old not reusable');
  {
    const cOld = await getChallenge(users.a.token);
    const oldId = cOld.challengeId;
    const before = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: oldId });
      return ch.status;
    });
    const nc = await api('POST', '/api/captcha/new', { challengeId: oldId }, users.a.token);
    const newC = nc.body.data;
    const afterOld = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: oldId });
      return ch.status;
    });
    const co = await correctOptOf(oldId);
    const reuseOldVerify = await api('POST', '/api/captcha/verify', { challengeId: oldId, selectedOption: co }, users.a.token);
    const reuseOldClaim = await api('POST', '/api/captcha/claim', { challengeId: oldId }, users.a.token);
    const t8Pass = nc.status === 200
      && newC.challengeId !== oldId
      && before === 'ACTIVE'
      && afterOld === 'SKIPPED'
      && reuseOldVerify.status === 409
      && reuseOldClaim.status === 400;
    if (t8Pass) PASS('TEST 8'); else FAIL('TEST 8', `before=${before} afterOld=${afterOld} newDiff=${newC.challengeId !== oldId} reuseV=${reuseOldVerify.status} reuseC=${reuseOldClaim.status}`);
    results['TEST8'] = t8Pass;
  }

  // ===================== TEST 9: Cross-user new challenge =====================
  hr('TEST 9: User A sends user B challengeId to /new -> rejected');
  {
    const cb = await getChallenge(users.b.token);
    const bStatusBefore = cb.status;
    const wBeforeB = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.b.userId }); return w ? w.gems : 0;
    });
    const x = await api('POST', '/api/captcha/new', { challengeId: cb.challengeId }, users.a.token);
    const bStatusAfter = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge'); const ch = await C.findOne({ challengeId: cb.challengeId }); return ch.status;
    });
    const wAfterB = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.b.userId }); return w ? w.gems : 0;
    });
    const t9Pass = x.status === 403 && bStatusBefore === 'ACTIVE' && bStatusAfter === 'ACTIVE' && wBeforeB === wAfterB;
    if (t9Pass) PASS('TEST 9'); else FAIL('TEST 9', `x.status=${x.status} bBefore=${bStatusBefore} bAfter=${bStatusAfter} wB=${wBeforeB} wA=${wAfterB}`);
    results['TEST9'] = t9Pass;
  }

  // ===================== TEST 10: Public response security =====================
  hr('TEST 10: No public response exposes correctOption/userId/passwordHash');
  {
    const rCurrent = await api('GET', '/api/captcha/current', null, users.a.token);
    const c = rCurrent.body.data;
    const c2 = await getChallenge(users.a.token);
    const co = await correctOptOf(c2.challengeId);
    const rVerify = await api('POST', '/api/captcha/verify', { challengeId: c2.challengeId, selectedOption: co }, users.a.token);
    const rClaim = await api('POST', '/api/captcha/claim', { challengeId: c2.challengeId }, users.a.token);
    const rNew = await api('POST', '/api/captcha/new', { challengeId: c2.challengeId }, users.a.token);
    const haystacks = [
      ['current', JSON.stringify(rCurrent.body)],
      ['verify', JSON.stringify(rVerify.body)],
      ['claim', JSON.stringify(rClaim.body)],
      ['new', JSON.stringify(rNew.body)],
    ];
    const forbidden = ['correctOption', 'passwordHash'];
    const leaked = [];
    for (const [name, s] of haystacks) {
      for (const f of forbidden) if (s.includes(f)) leaked.push(`${name} has ${f}`);
    }
    // Also check current response shape has only allowed keys
    const allowedKeys = ['challengeId', 'captchaText', 'options', 'status', 'expiresAt', 'createdAt'];
    const actualKeys = Object.keys(c).sort();
    const shapeOk = allowedKeys.sort().every((k) => actualKeys.includes(k)) && actualKeys.every((k) => allowedKeys.includes(k));
    const t10Pass = leaked.length === 0 && shapeOk;
    if (t10Pass) PASS('TEST 10'); else FAIL('TEST 10', `leaked=${JSON.stringify(leaked)} current keys=${actualKeys}`);
    results['TEST10'] = t10Pass;
  }

  // ===================== TEST 11: Concurrent claim =====================
  hr('TEST 11: 5 concurrent claims -> exactly one success, one wallet +1');
  {
    const c = await getChallenge(users.a.token);
    const co = await correctOptOf(c.challengeId);
    const v = await api('POST', '/api/captcha/verify', { challengeId: c.challengeId, selectedOption: co }, users.a.token);
    const wBefore = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
    });
    const promises = [];
    for (let i = 0; i < 5; i++) promises.push(api('POST', '/api/captcha/claim', { challengeId: c.challengeId }, users.a.token));
    const outs = await Promise.all(promises);
    const statuses = outs.map((o) => o.status);
    const succ = statuses.filter((s) => s === 200).length;
    const conf = statuses.filter((s) => s === 409).length;
    const txCount = await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const ch = await C.findOne({ challengeId: c.challengeId });
      const T = mongoose.model('GemTransaction');
      return T.countDocuments({ challengeId: ch._id });
    });
    const wAfter = await withMongo(async (mongoose) => {
      const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: users.a.userId }); return w ? w.gems : 0;
    });
    const t11Pass = succ === 1 && conf === 4 && txCount === 1 && Math.abs(wAfter - (wBefore + 1)) < 1e-9;
    if (t11Pass) PASS('TEST 11'); else FAIL('TEST 11', `succ=${succ} conf=${conf} txs=${txCount} wB=${wBefore} wA=${wAfter} statuses=${statuses}`);
    results['TEST11'] = t11Pass;
  }

  // Additional: example responses
  hr('Collecting example responses/documents for final report');
  {
    const u = await registerUser('excollect');
    const c = await getChallenge(u.token);
    const co = await correctOptOf(c.challengeId);
    console.log('\n[EXAMPLE PUBLIC CHALLENGE] /current:');
    console.log(JSON.stringify(c, null, 2));
    const v = await api('POST', '/api/captcha/verify', { challengeId: c.challengeId, selectedOption: co }, u.token);
    console.log('\n[EXAMPLE VERIFY] returns PENDING:');
    console.log('HTTP ' + v.status, JSON.stringify(v.body, null, 2));
    const cl = await api('POST', '/api/captcha/claim', { challengeId: c.challengeId }, u.token);
    console.log('\n[EXAMPLE SUCCESSFUL CLAIM]:');
    console.log('HTTP ' + cl.status, JSON.stringify(cl.body, null, 2));
    const clDupe = await api('POST', '/api/captcha/claim', { challengeId: c.challengeId }, u.token);
    console.log('\n[EXAMPLE DUPLICATE CLAIM]:');
    console.log('HTTP ' + clDupe.status, JSON.stringify(clDupe.body, null, 2));
    const nc = await api('POST', '/api/captcha/new', { challengeId: c.challengeId }, u.token);
    console.log('\n[EXAMPLE NEW CAPTCHA (after claim + no-thanks)]:');
    console.log('HTTP ' + nc.status, JSON.stringify(nc.body, null, 2));
    console.log('\n[EXAMPLE MONGODB DOCUMENTS for the claim above]:');
    await withMongo(async (mongoose) => {
      const C = mongoose.model('CaptchaChallenge');
      const T = mongoose.model('GemTransaction');
      const A = mongoose.model('CaptchaAttempt');
      const W = mongoose.model('Wallet');
      const ch = await C.findOne({ challengeId: c.challengeId }).lean();
      const tx = await T.findOne({ challengeId: ch._id }).lean();
      const at = await A.findOne({ challengeId: ch._id }).lean();
      const w = await W.findOne({ userId: u.userId }).lean();
      console.log('GemTransaction:', JSON.stringify({ _id: tx._id, amount: tx.amount, status: tx.status, claimedAt: tx.claimedAt, idempotencyKey: tx.idempotencyKey }, null, 2));
      console.log('CaptchaAttempt:', JSON.stringify({ _id: at._id, isCorrect: at.isCorrect, rewardAmount: at.rewardAmount, status: at.status }, null, 2));
      console.log('Wallet:', JSON.stringify({ _id: w._id, gems: w.gems }, null, 2));
      console.log('CaptchaChallenge final status:', ch.status);
    });
  }

  hr('SUMMARY');
  for (let i = 1; i <= 11; i++) {
    const k = 'TEST' + i;
    console.log('  ' + k + ' = ' + (results[k] ? 'PASS' : 'FAIL'));
  }
  const allPass = Object.values(results).every((v) => v);
  process.exit(allPass ? 0 : 1);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
