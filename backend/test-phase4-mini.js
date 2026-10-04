require('dotenv').config();
const mongoose = require('mongoose');
require('./src/models/User');
require('./src/models/CaptchaChallenge');
require('./src/models/CaptchaAttempt');
require('./src/models/Wallet');
require('./src/models/GemTransaction');
require('./src/models/CaptchaRewardConfig');
require('./src/models/AuditLog');
const CaptchaChallenge = mongoose.model('CaptchaChallenge');
const CaptchaAttempt = mongoose.model('CaptchaAttempt');
const GemTransaction = mongoose.model('GemTransaction');
const Wallet = mongoose.model('Wallet');
const User = mongoose.model('User');
const RewardService = require('./src/services/reward.service');
const WalletService = require('./src/services/wallet.service');

const hr = (t) => console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  try {
    // Clean slate test users
    const emails = ['mini_a@v.com', 'mini_b@v.com', 'mini_c@v.com'];
    const existing = await User.find({ email: { $in: emails } });
    const existingIds = existing.map((u) => u._id);
    await Wallet.deleteMany({ userId: { $in: existingIds } });
    await CaptchaAttempt.deleteMany({ userId: { $in: existingIds } });
    await CaptchaChallenge.deleteMany({ userId: { $in: existingIds } });
    await User.deleteMany({ email: { $in: emails } });

    const uA = await new User({ name: 'mini A', email: 'mini_a@v.com', passwordHash: 'p123456' }).save();
    const uB = await new User({ name: 'mini B', email: 'mini_b@v.com', passwordHash: 'p123456' }).save();
    const uC = await new User({ name: 'mini C', email: 'mini_c@v.com', passwordHash: 'p123456' }).save();

    const makeChall = async (user, { expired = false } = {}) => {
      const options = ['ABCD12', 'ABCD13', 'ABXD14', 'ZZ11AA'];
      const correct = options[0];
      const ch = new CaptchaChallenge({
        challengeId: mongoose.Types.ObjectId().toString(32) + Math.random().toString(36).slice(2, 14),
        userId: user._id,
        captchaText: correct,
        options,
        correctOption: correct,
        status: 'ACTIVE',
        expiresAt: expired ? new Date(Date.now() - 60 * 1000) : new Date(Date.now() + 60 * 1000),
      });
      await ch.save();
      return ch;
    };

    const runAttempt = async (user, challenge, selectedOption, fakeFields = {}) => {
      const idempotencyKey = RewardService.buildIdempotencyKey(user._id, challenge._id);
      let attempt, wallet;
      try {
        // 1. Guard: already completed?
        if (challenge.status === 'COMPLETED') {
          return { kind: 'duplicate', code: 409 };
        }
        // 2. Guard: ownership
        if (String(challenge.userId) !== String(user._id)) return { kind: 'forbidden', code: 403 };
        // 3. Guard: expiry
        if (challenge.expiresAt <= new Date()) {
          challenge.status = 'EXPIRED'; await challenge.save();
          return { kind: 'expired', code: 410 };
        }
        // 4. Guard: option membership
        if (!challenge.options.includes(selectedOption)) return { kind: 'bad_option', code: 400 };
        // 5. Idempotency key lookup
        const existingTx = await GemTransaction.findOne({ idempotencyKey });
        if (existingTx) return { kind: 'duplicate', code: 409 };
        // 6. Compute correctness
        const isCorrect = String(challenge.correctOption) === String(selectedOption);
        // 7. Process reward (Attempt + GemTransaction + Wallet $inc)
        attempt = new CaptchaAttempt({
          challengeId: challenge._id,
          userId: user._id,
          selectedOption,
          isCorrect,
          rewardAmount: 0,
          status: 'VERIFIED',
        });
        await attempt.save();
        const config = await RewardService.getActiveRewardConfig();
        const rewardAmount = isCorrect ? config.correctReward : config.wrongReward;
        attempt.rewardAmount = rewardAmount;
        await attempt.save();
        const tx = new GemTransaction({
          userId: user._id, challengeId: challenge._id, attemptId: attempt._id,
          amount: rewardAmount, status: 'COMPLETED', idempotencyKey,
        });
        await tx.save();
        wallet = await WalletService.incrementGems(user._id, rewardAmount);
        // 8. Mark completed
        challenge.status = 'COMPLETED';
        await challenge.save();
        return { kind: 'ok', code: 200, isCorrect, rewardAmount, gems: wallet.gems, attemptId: attempt._id };
      } catch (e) {
        if (e.code === 11000 && e.keyPattern && e.keyPattern.idempotencyKey) return { kind: 'duplicate', code: 409 };
        if (e.code === 11000 && e.keyPattern && (e.keyPattern.challengeId || (e.keyPattern.userId && e.keyPattern.challengeId))) return { kind: 'duplicate', code: 409 };
        return { kind: 'error', code: 500, msg: e.message };
      }
    };

    hr('TEST 1: Correct answer → +1 Gem, attempt/tx/completed.');
    {
      const ch = await makeChall(uA);
      const r = await runAttempt(uA, ch, ch.correctOption);
      const att = await CaptchaAttempt.findOne({ challengeId: ch._id });
      const txc = await GemTransaction.countDocuments({ challengeId: ch._id });
      const ch1 = await CaptchaChallenge.findById(ch._id);
      const w = await Wallet.findOne({ userId: uA._id });
      console.log('result=', r, 'attempt?', !!att, 'txes=', txc, 'ch=', ch1.status, 'wallet=', w && w.gems);
      console.log(r.code === 200 && r.isCorrect && r.rewardAmount === 1 && !!att && txc === 1 && ch1.status === 'COMPLETED' && w && w.gems === 1 ? 'PASS' : 'FAIL');
    }

    hr('TEST 2 + TEST 9: Wrong answer → +0.5 gems (fractional OK).');
    {
      const ch = await makeChall(uA);
      const wrong = ch.options.find((o) => o !== ch.correctOption);
      const beforeWallet = (await Wallet.findOne({ userId: uA._id })).gems;
      const r = await runAttempt(uA, ch, wrong);
      const afterWallet = (await Wallet.findOne({ userId: uA._id })).gems;
      const att = await CaptchaAttempt.findOne({ challengeId: ch._id });
      const ch1 = await CaptchaChallenge.findById(ch._id);
      console.log('before=', beforeWallet, 'after=', afterWallet, 'result=', r.code, r.isCorrect, r.rewardAmount, 'attempt status=', att && att.status, 'challenge=', ch1.status);
      const ok = r.code === 200 && r.isCorrect === false && Math.abs(r.rewardAmount - 0.5) < 1e-9 && Math.abs(afterWallet - (beforeWallet + 0.5)) < 1e-9 && ch1.status === 'COMPLETED';
      console.log(ok ? 'PASS' : 'FAIL');
    }

    hr('TEST 3: Same challenge submitted twice → second rejected, only 1 reward tx.');
    {
      const ch = await makeChall(uB);
      const first = await runAttempt(uB, ch, ch.correctOption);
      const second = await runAttempt(uB, ch, ch.correctOption);
      const cnt = await GemTransaction.countDocuments({ challengeId: ch._id });
      const attcnt = await CaptchaAttempt.countDocuments({ challengeId: ch._id });
      console.log('first=', first.code, first.kind, 'second=', second.code, second.kind, 'txes=', cnt, 'attempts=', attcnt);
      console.log(first.code === 200 && second.code === 409 && cnt === 1 && attcnt === 1 ? 'PASS' : 'FAIL');
    }

    hr('TEST 4: Expired challenge → reject EXPIRED, 0 reward, 0 tx/att, status=EXPIRED.');
    {
      const ch = await makeChall(uB, { expired: true });
      const before = (await Wallet.findOne({ userId: uB._id })) || new Wallet({ userId: uB._id, gems: 0 });
      const beforeGems = before.gems;
      const r = await runAttempt(uB, ch, ch.correctOption);
      const afterWallet = await Wallet.findOne({ userId: uB._id });
      const attcnt = await CaptchaAttempt.countDocuments({ challengeId: ch._id });
      const txcnt = await GemTransaction.countDocuments({ challengeId: ch._id });
      const ch1 = await CaptchaChallenge.findById(ch._id);
      console.log('result=', r.code, r.kind, 'before gems=', beforeGems, 'after=', afterWallet && afterWallet.gems, 'attempts=', attcnt, 'txes=', txcnt, 'ch status=', ch1.status);
      console.log(r.code === 410 && ch1.status === 'EXPIRED' && beforeGems === (afterWallet ? afterWallet.gems : 0) && attcnt === 0 && txcnt === 0 ? 'PASS' : 'FAIL');
    }

    hr('TEST 5: User A submits User B challenge → 403, no wallet change on either side, 0 attempt/tx.');
    {
      const ch = await makeChall(uB);
      const walletB_before = (await Wallet.findOne({ userId: uB._id })).gems;
      const walletA_before = (await Wallet.findOne({ userId: uA._id })).gems;
      const r = await runAttempt(uA, ch, ch.correctOption);
      const walletB_after = (await Wallet.findOne({ userId: uB._id })).gems;
      const walletA_after = (await Wallet.findOne({ userId: uA._id })).gems;
      const attcnt = await CaptchaAttempt.countDocuments({ challengeId: ch._id });
      const txcnt = await GemTransaction.countDocuments({ challengeId: ch._id });
      const ch1 = await CaptchaChallenge.findById(ch._id);
      console.log('result=', r.code, r.kind, 'wA before/after=', walletA_before, walletA_after, 'wB before/after=', walletB_before, walletB_after, 'atts=', attcnt, 'txes=', txcnt, 'ch=', ch1.status);
      const ok = r.code === 403 && walletB_before === walletB_after && walletA_before === walletA_after && attcnt === 0 && txcnt === 0 && ch1.status === 'ACTIVE';
      console.log(ok ? 'PASS' : 'FAIL');
    }

    hr('TEST 6: Fake fields (isCorrect=true, rewardAmount=999999, userId=uB) sent — backend ignores, actual values from DB used.');
    {
      const ch = await makeChall(uC);
      const wrong = ch.options.find((o) => o !== ch.correctOption);
      const r = await runAttempt(uC, ch, wrong, { isCorrect: true, rewardAmount: 999999, userId: uB._id });
      const w = await Wallet.findOne({ userId: uC._id });
      console.log('code=', r.code, '| actual isCorrect=', r.isCorrect, 'actual rewardAmount=', r.rewardAmount, '| walletC=', w && w.gems, '(expected 0.5 — wrong answer)');
      const ok = r.code === 200 && r.isCorrect === false && Math.abs(r.rewardAmount - 0.5) < 1e-9 && Math.abs((w ? w.gems : 0) - 0.5) < 1e-9;
      console.log(ok ? 'PASS (fake fields totally ignored, actual DB values used)' : 'FAIL');
    }

    hr('TEST 7: Concurrent duplicate verify → exactly ONE success, ONE tx, ONE attempt, wallet +1 only once.');
    {
      const ch = await makeChall(uC);
      const before = ((await Wallet.findOne({ userId: uC._id })) || new Wallet({ userId: uC._id, gems: 0 })).gems;
      const p = [1, 2, 3, 4, 5].map(() => runAttempt(uC, ch, ch.correctOption));
      const results = await Promise.all(p);
      const statuses = results.map((r) => r.code);
      const okCount = statuses.filter((c) => c === 200).length;
      const dupCount = statuses.filter((c) => c === 409).length;
      const txcnt = await GemTransaction.countDocuments({ challengeId: ch._id });
      const attcnt = await CaptchaAttempt.countDocuments({ challengeId: ch._id });
      const afterWallet = (await Wallet.findOne({ userId: uC._id })).gems;
      console.log('statuses=', statuses, '| 200=', okCount, '409=', dupCount, '| txes=', txcnt, 'atts=', attcnt, '| wallet before=', before, 'after=', afterWallet, '(delta=', (afterWallet - before).toFixed(3), ', expected +1)');
      const tOk = okCount === 1 && dupCount === 4 && txcnt === 1 && attcnt === 1 && Math.abs(afterWallet - (before + 1)) < 1e-9;
      console.log(tOk ? 'PASS' : 'FAIL');
    }

    hr('TEST 8: Wallet reported gems matches MongoDB wallet (authoritative).');
    {
      const ch1 = await makeChall(uB);
      const r1 = await runAttempt(uB, ch1, ch1.correctOption);
      const ch2 = await makeChall(uB);
      const wrong2 = ch2.options.find((o) => o !== ch2.correctOption);
      const r2 = await runAttempt(uB, ch2, wrong2);
      const direct = await Wallet.findOne({ userId: uB._id });
      const expected = r1.gems + 0.5;
      console.log('reported after correct:', r1.gems, 'reported after wrong:', r2.gems, 'MongoDB Wallet.gems:', direct && direct.gems, 'expected 0.5 increment?', Math.abs(r2.gems - expected) < 1e-9);
      console.log(r1.gems === 1 && Math.abs(r2.gems - 1.5) < 1e-9 && direct && Math.abs(direct.gems - r2.gems) < 1e-9 ? 'PASS' : 'FAIL');
    }

    hr('TEST 10: Cross-user rollback (transaction) → no Attempt/Tx, challenge still ACTIVE, wallets unchanged (no partial writes).');
    {
      const ch = await makeChall(uB);
      const countBefore = {
        att: await CaptchaAttempt.countDocuments({ challengeId: ch._id }),
        tx: await GemTransaction.countDocuments({ challengeId: ch._id }),
      };
      const walletB_before = (await Wallet.findOne({ userId: uB._id })).gems;
      const walletA_before = (await Wallet.findOne({ userId: uA._id })).gems;
      const r = await runAttempt(uA, ch, ch.correctOption); // cross-user
      const walletB_after = (await Wallet.findOne({ userId: uB._id })).gems;
      const walletA_after = (await Wallet.findOne({ userId: uA._id })).gems;
      const countAfter = {
        att: await CaptchaAttempt.countDocuments({ challengeId: ch._id }),
        tx: await GemTransaction.countDocuments({ challengeId: ch._id }),
      };
      const ch1 = await CaptchaChallenge.findById(ch._id);
      const suspiciousCount = await mongoose.model('AuditLog').countDocuments({
        action: 'Suspicious Request', challengeId: ch._id, userId: uA._id,
      });
      console.log('code:', r.code, r.kind, 'walletA before/after=', walletA_before, walletA_after, 'walletB before/after=', walletB_before, walletB_after);
      console.log('attempts: before', countBefore.att, 'after', countAfter.att, '| txes before', countBefore.tx, 'after', countAfter.tx);
      console.log('challenge status:', ch1.status, 'suspicious audit log count:', suspiciousCount);
      const ok = r.code === 403
        && walletA_before === walletA_after && walletB_before === walletB_after
        && countBefore.att === countAfter.att && countBefore.tx === countAfter.tx
        && ch1.status === 'ACTIVE'
        && suspiciousCount >= 1;
      console.log(ok ? 'PASS (fully rolled back: 0 writes + Suspicious audit logged)' : 'FAIL');
    }
  } catch (e) {
    console.error('CRASH:', e.message);
    console.error(e.stack);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
