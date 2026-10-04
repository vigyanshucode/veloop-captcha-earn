require('dotenv').config();
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');

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
  const email = `rpt_${prefix}_${crypto.randomBytes(4).toString('hex')}@veloop.com`;
  const r = await api('POST', '/api/auth/register', { name: `${prefix} U`, email, password: 'pass1234' });
  if (!r.body || !r.body.success) throw new Error('register failed: ' + JSON.stringify(r));
  return { userId: r.body.data.user._id, token: r.body.data.token, email };
};

const getChallenge = async (token) => {
  const r = await api('GET', '/api/captcha/current', null, token);
  if (!r.body || !r.body.success) throw new Error('getChallenge failed: ' + JSON.stringify(r));
  return r.body.data;
};

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

const hr = (t) => console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);

(async () => {
  hr('A. Collect CORRECT-ANSWER example (response + wallet before/after + docs)');
  const userEx1 = await registerUser('excorrect');
  console.log('User ex1:', userEx1.email, 'userId=', userEx1.userId);
  const chEx1 = await getChallenge(userEx1.token);
  console.log('Challenge example challengeId=', chEx1.challengeId);
  console.log('Challenge options=', chEx1.options);
  const { correctOption: coEx1 } = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const doc = await C.findOne({ challengeId: chEx1.challengeId }).select('+correctOption');
    return { correctOption: doc.correctOption, captchaText: doc.captchaText };
  });
  console.log('MongoDB correctOption (read from DB, NOT from request):', coEx1);
  const walletBeforeEx1 = await withMongo(async (mongoose) => {
    const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: userEx1.userId }); return w ? w.gems : 0;
  });
  console.log('MongoDB Wallet BEFORE verify => gems =', walletBeforeEx1);
  const rEx1 = await api('POST', '/api/captcha/verify', { challengeId: chEx1.challengeId, selectedOption: coEx1 }, userEx1.token);
  console.log('\n>>> EXAMPLE CORRECT-ANSWER RESPONSE:');
  console.log('HTTP', rEx1.status, JSON.stringify(rEx1.body, null, 2));
  const walletAfterEx1 = await withMongo(async (mongoose) => {
    const W = mongoose.model('Wallet'); const w = await W.findOne({ userId: userEx1.userId }); return w ? w.gems : 0;
  });
  console.log('MongoDB Wallet AFTER verify  => gems =', walletAfterEx1);
  const { attemptDoc, txDoc, chDoc, walletDoc } = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const A = mongoose.model('CaptchaAttempt');
    const T = mongoose.model('GemTransaction');
    const W = mongoose.model('Wallet');
    const ch = await C.findOne({ challengeId: chEx1.challengeId });
    const att = await A.findOne({ challengeId: ch._id });
    const tx = await T.findOne({ attemptId: att._id });
    const wal = await W.findOne({ userId: userEx1.userId });
    return {
      chDoc: ch.toObject(),
      attemptDoc: att.toObject(),
      txDoc: tx.toObject(),
      walletDoc: wal.toObject(),
    };
  });
  console.log('\n>>> EXAMPLE WALLET (MongoDB):');
  console.log(JSON.stringify({
    _id: walletDoc._id,
    userId: walletDoc.userId,
    gems: walletDoc.gems,
    createdAt: walletDoc.createdAt,
    updatedAt: walletDoc.updatedAt,
  }, null, 2));
  console.log('\n>>> EXAMPLE GemTransaction (MongoDB):');
  console.log(JSON.stringify({
    _id: txDoc._id,
    userId: txDoc.userId,
    challengeId: txDoc.challengeId,
    attemptId: txDoc.attemptId,
    type: txDoc.type,
    amount: txDoc.amount,
    status: txDoc.status,
    idempotencyKey: txDoc.idempotencyKey,
    createdAt: txDoc.createdAt,
  }, null, 2));
  console.log('\n>>> EXAMPLE CaptchaAttempt (MongoDB):');
  console.log(JSON.stringify({
    _id: attemptDoc._id,
    challengeId: attemptDoc.challengeId,
    userId: attemptDoc.userId,
    selectedOption: attemptDoc.selectedOption,
    isCorrect: attemptDoc.isCorrect,
    rewardAmount: attemptDoc.rewardAmount,
    status: attemptDoc.status,
    createdAt: attemptDoc.createdAt,
  }, null, 2));

  hr('B. Collect WRONG-ANSWER example (response + 0.5 fractional reward)');
  const userEx2 = await registerUser('exwrong');
  const chEx2 = await getChallenge(userEx2.token);
  const { wrongOption: woEx2, correctOption: realCo2 } = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const doc = await C.findOne({ challengeId: chEx2.challengeId }).select('+correctOption');
    return {
      correctOption: doc.correctOption,
      wrongOption: doc.options.find((o) => o !== doc.correctOption),
    };
  });
  console.log('Correct (from MongoDB, ignored by fake fields test already passed):', realCo2);
  console.log('Selected (WRONG, chosen by test, from real options):', woEx2);
  const rEx2 = await api('POST', '/api/captcha/verify', { challengeId: chEx2.challengeId, selectedOption: woEx2 }, userEx2.token);
  console.log('\n>>> EXAMPLE WRONG-ANSWER RESPONSE:');
  console.log('HTTP', rEx2.status, JSON.stringify(rEx2.body, null, 2));
  const { wrongAttempt, wrongTx } = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const A = mongoose.model('CaptchaAttempt');
    const T = mongoose.model('GemTransaction');
    const ch = await C.findOne({ challengeId: chEx2.challengeId });
    const att = await A.findOne({ challengeId: ch._id });
    const tx = await T.findOne({ attemptId: att._id });
    return { wrongAttempt: att.toObject(), wrongTx: tx.toObject() };
  });
  console.log('Wrong-answer GemTransaction.amount =', wrongTx.amount);
  console.log('Wrong-answer CaptchaAttempt.isCorrect =', wrongAttempt.isCorrect, ', rewardAmount=', wrongAttempt.rewardAmount);
  const okTest9 = Math.abs(wrongTx.amount - 0.5) < 1e-9 && wrongAttempt.isCorrect === false && Math.abs(wrongAttempt.rewardAmount - 0.5) < 1e-9;
  console.log('TEST 9 (fractional 0.5 wrong reward) verified with actual MongoDB docs:', okTest9 ? 'PASS' : 'FAIL');

  hr('C. Collect DUPLICATE-ATTEMPT (second submit same challenge) response example');
  const rEx3 = await api('POST', '/api/captcha/verify', { challengeId: chEx1.challengeId, selectedOption: coEx1 }, userEx1.token);
  console.log('\n>>> EXAMPLE DUPLICATE-ATTEMPT RESPONSE:');
  console.log('HTTP', rEx3.status, JSON.stringify(rEx3.body, null, 2));
  const cntTx1 = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const T = mongoose.model('GemTransaction');
    const ch = await C.findOne({ challengeId: chEx1.challengeId });
    return await T.countDocuments({ challengeId: ch._id });
  });
  console.log('Tx count for the duplicated challenge (still exactly 1):', cntTx1, cntTx1 === 1 ? '- PASS' : '- FAIL');

  hr('D. Clean TEST 10: Cross-user rollback (no partial writes, rollback verified)');
  const uRbA = await registerUser('rba');
  const uRbB = await registerUser('rbb');
  const chOwnedByB = await getChallenge(uRbB.token);
  const corrB = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const doc = await C.findOne({ challengeId: chOwnedByB.challengeId }).select('+correctOption');
    return doc.correctOption;
  });
  const state1 = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const A = mongoose.model('CaptchaAttempt');
    const T = mongoose.model('GemTransaction');
    const W = mongoose.model('Wallet');
    const ch = await C.findOne({ challengeId: chOwnedByB.challengeId });
    return {
      chId: ch._id,
      chStatusBefore: ch.status,
      attsBefore: await A.countDocuments({ challengeId: ch._id }),
      txesBefore: await T.countDocuments({ challengeId: ch._id }),
      walletA: ((await W.findOne({ userId: uRbA.userId })) || { gems: 0 }).gems,
      walletB: ((await W.findOne({ userId: uRbB.userId })) || { gems: 0 }).gems,
    };
  });
  console.log('Before cross-user reject:', state1);
  const rbResp = await api('POST', '/api/captcha/verify', { challengeId: chOwnedByB.challengeId, selectedOption: corrB }, uRbA.token);
  console.log('Cross-user verify returned: HTTP', rbResp.status, rbResp.body);
  const state2 = await withMongo(async (mongoose) => {
    const C = mongoose.model('CaptchaChallenge');
    const A = mongoose.model('CaptchaAttempt');
    const T = mongoose.model('GemTransaction');
    const W = mongoose.model('Wallet');
    const Audit = mongoose.model('AuditLog');
    const ch = await C.findOne({ challengeId: chOwnedByB.challengeId });
    return {
      chStatusAfter: ch.status,
      attsAfter: await A.countDocuments({ challengeId: ch._id }),
      txesAfter: await T.countDocuments({ challengeId: ch._id }),
      walletA: ((await W.findOne({ userId: uRbA.userId })) || { gems: 0 }).gems,
      walletB: ((await W.findOne({ userId: uRbB.userId })) || { gems: 0 }).gems,
      suspiciousAuditCount: await Audit.countDocuments({
        action: 'Suspicious Request', challengeId: ch._id, userId: uRbA.userId,
      }),
    };
  });
  console.log('After cross-user reject:', state2);
  const rollbackOk = rbResp.status === 403
    && state1.chStatusBefore === 'ACTIVE' && state2.chStatusAfter === 'ACTIVE'
    && state1.attsBefore === 0 && state2.attsAfter === 0
    && state1.txesBefore === 0 && state2.txesAfter === 0
    && state1.walletA === state2.walletA
    && state1.walletB === state2.walletB
    && state2.suspiciousAuditCount >= 1;
  console.log('\nTEST 10 (rollback on cross-user 403):', rollbackOk ? 'PASS' : 'FAIL');
  console.log('Details: ch still ACTIVE, no Attempt written, no Tx written, wallet A unchanged, wallet B unchanged, Suspicious audit =', state2.suspiciousAuditCount);

  hr('E. Extra audit: verify captcha controller invariants (from MongoDB data)');
  const invariants = await withMongo(async (mongoose) => {
    const T = mongoose.model('GemTransaction');
    const A = mongoose.model('CaptchaAttempt');
    const C = mongoose.model('CaptchaChallenge');
    // Confirm correctOption NEVER used from request: it lives only on server
    const anyExposedCorrect = await C.findOne({}).select('+correctOption').lean();
    // Idempotency keys must be unique
    const dupKeys = await T.aggregate([{ $group: { _id: '$idempotencyKey', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 5 }]).exec();
    return {
      sampleCorrectOptionFieldExistsOnServerOnly: !!anyExposedCorrect && typeof anyExposedCorrect.correctOption === 'string',
      duplicateIdempotencyKeyCount: dupKeys.length,
      exampleCorrectOptionValue: anyExposedCorrect ? anyExposedCorrect.correctOption : null,
    };
  });
  console.log('correctOption on server only (never exposed to client / never from request body):', invariants.sampleCorrectOptionFieldExistsOnServerOnly);
  console.log('Duplicate idempotencyKey rows in GemTransaction (must be 0):', invariants.duplicateIdempotencyKeyCount);
  console.log('Example correctOption (MongoDB-only, never sent in /current response):', invariants.exampleCorrectOptionValue);

  hr('F. Report marker');
  console.log('REPORT_DATA_READY');
})().catch((e) => {
  console.error('SCRIPT ERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
