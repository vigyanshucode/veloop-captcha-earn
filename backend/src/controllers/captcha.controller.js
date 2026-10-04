const mongoose = require('mongoose');
const { validationResult } = require('express-validator');
const CaptchaChallenge = require('../models/CaptchaChallenge');
const CaptchaAttempt = require('../models/CaptchaAttempt');
const GemTransaction = require('../models/GemTransaction');
const AuditLog = require('../models/AuditLog');
const WalletService = require('../services/wallet.service');
const RewardService = require('../services/reward.service');
const { createChallenge } = require('../services/captcha.service');

const { AUDIT_ACTION } = AuditLog;

const ACTIVE = CaptchaChallenge.CAPTCHA_STATUS.ACTIVE;
const COMPLETED = CaptchaChallenge.CAPTCHA_STATUS.COMPLETED;
const EXPIRED = CaptchaChallenge.CAPTCHA_STATUS.EXPIRED;
const SKIPPED = CaptchaChallenge.CAPTCHA_STATUS.SKIPPED;

const TX_PENDING = GemTransaction.TX_STATUS.PENDING;
const TX_CLAIMED = GemTransaction.TX_STATUS.CLAIMED;
const TX_FAILED = GemTransaction.TX_STATUS.FAILED;

const logAudit = async (action, { userId, challengeId, attemptId, metadata } = {}) => {
  try {
    const entry = new AuditLog({
      userId,
      action,
      challengeId,
      attemptId,
      metadata,
    });
    await entry.save();
  } catch (e) {
    console.error(`[audit] failed to persist ${action}: ${e.message}`);
  }
};

const getCurrentChallenge = async (req, res) => {
  try {
    const { userId } = req.user;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const now = new Date();
    const existing = await CaptchaChallenge.findOne({ userId, status: ACTIVE }).exec();

    if (existing) {
      if (existing.expiresAt > now) {
        return res.status(200).json({
          success: true,
          message: 'Active challenge retrieved',
          data: existing.toPublicObject(),
        });
      }
      existing.status = EXPIRED;
      await existing.save();
      await logAudit(AUDIT_ACTION.EXPIRED_CHALLENGE, { userId, challengeId: existing._id });
    }

    const fresh = await createChallenge(userId);
    return res.status(200).json({
      success: true,
      message: 'New challenge generated',
      data: fresh.toPublicObject(),
    });
  } catch (error) {
    console.error(`[captcha.getCurrentChallenge] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to generate CAPTCHA challenge' });
  }
};

let txSupportCache = null;

const supportTransactions = async () => {
  if (txSupportCache !== null) return txSupportCache;
  try {
    const s = await mongoose.startSession();
    try {
      s.startTransaction();
      try {
        await AuditLog.collection.insertOne(
          { action: 'tx_probe', createdAt: new Date() },
          { session: s }
        );
        await s.abortTransaction();
        txSupportCache = true;
      } catch (probeErr) {
        try { await s.abortTransaction(); } catch (_) { /* noop */ }
        const msg = probeErr && probeErr.message ? String(probeErr.message) : '';
        if (msg.includes('Transaction numbers') || msg.includes('replica set') || msg.includes('mongos') || msg.includes('multi-document')) {
          txSupportCache = false;
        } else if (probeErr.codeName === 'OperationNotSupportedInTransaction' || probeErr.code === 263 || probeErr.code === 20) {
          txSupportCache = false;
        } else {
          txSupportCache = false;
        }
      }
    } finally {
      try { s.endSession(); } catch (_) { /* noop */ }
    }
  } catch (_) {
    txSupportCache = false;
  }
  if (txSupportCache !== true) txSupportCache = false;
  return txSupportCache;
};

const runInTx = async (fn) => {
  const canTx = await supportTransactions();
  let session = null;
  try {
    if (canTx) {
      session = await mongoose.startSession();
      session.startTransaction();
    }
    const result = await fn(session);
    if (canTx && session && session.inTransaction()) await session.commitTransaction();
    return result;
  } catch (error) {
    if (canTx && session && session.inTransaction()) {
      try { await session.abortTransaction(); } catch (_) { /* noop */ }
    }
    throw error;
  } finally {
    if (session) {
      try { session.endSession(); } catch (_) { /* noop */ }
    }
  }
};

const verifyChallenge = async (req, res) => {
  const validation = validationResult(req);
  if (!validation.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validation.array().map((e) => ({ field: e.param, message: e.msg })),
    });
  }

  const authUser = req.user && req.user.userId;
  if (!authUser) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  const { challengeId, selectedOption } = req.body;
  let challengeRef = null;
  let attemptRef = null;
  let txRef = null;

  try {
    const processed = await runInTx(async (session) => {
      const sessionOpt = session ? { session } : {};

      const challenge = await CaptchaChallenge.findOne({ challengeId })
        .select('+correctOption')
        .setOptions(sessionOpt);

      if (!challenge) {
        await logAudit(AUDIT_ACTION.INVALID_ATTEMPT, {
          userId: authUser,
          metadata: { reason: 'challenge_not_found', challengeId },
        });
        return { code: 404, body: { success: false, message: 'Challenge not found' } };
      }
      challengeRef = challenge;

      if (String(challenge.userId) !== String(authUser)) {
        await logAudit(AUDIT_ACTION.SUSPICIOUS_REQUEST, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { challengeOwner: challenge.userId },
        });
        return { code: 403, body: { success: false, message: 'Challenge does not belong to this user' } };
      }

      if (challenge.status === COMPLETED || challenge.status === SKIPPED) {
        await logAudit(AUDIT_ACTION.DUPLICATE_ATTEMPT, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { currentStatus: challenge.status },
        });
        return { code: 409, body: { success: false, message: 'Challenge already completed' } };
      }

      const now = new Date();
      if (challenge.expiresAt <= now) {
        challenge.status = EXPIRED;
        await challenge.save(sessionOpt);
        await logAudit(AUDIT_ACTION.EXPIRED_CHALLENGE, {
          userId: authUser,
          challengeId: challenge._id,
        });
        return { code: 410, body: { success: false, message: 'Challenge expired' } };
      }

      const allowedOptions = Array.isArray(challenge.options) ? challenge.options : [];
      if (!allowedOptions.includes(selectedOption)) {
        await logAudit(AUDIT_ACTION.INVALID_ATTEMPT, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { selectedOption, allowedCount: allowedOptions.length },
        });
        return { code: 400, body: { success: false, message: 'Invalid selected option' } };
      }

      const idempotencyKey = RewardService.buildIdempotencyKey(authUser, challenge._id);
      const existingTx = await GemTransaction.findOne({ idempotencyKey }).setOptions(sessionOpt);
      if (existingTx) {
        await logAudit(AUDIT_ACTION.DUPLICATE_ATTEMPT, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { idempotencyKey },
        });
        return { code: 409, body: { success: false, message: 'Challenge already completed' } };
      }

      const isCorrect = String(challenge.correctOption) === String(selectedOption);
      const { attempt, rewardAmount, transaction } = await RewardService.processReward({
        userId: authUser,
        challenge,
        selectedOption,
        isCorrect,
        session,
      });
      attemptRef = attempt;
      txRef = transaction;

      challenge.status = COMPLETED;
      await challenge.save(sessionOpt);

      return {
        code: 200,
        body: {
          success: true,
          message: 'CAPTCHA verified',
          data: {
            challengeId: challenge.challengeId,
            isCorrect,
            rewardAmount,
            rewardStatus: TX_PENDING,
            attemptId: attempt._id,
          },
        },
        audit: { isCorrect, rewardAmount },
      };
    });

    if (processed.code === 200 && processed.audit && challengeRef && attemptRef) {
      await logAudit(AUDIT_ACTION.CHALLENGE_VERIFIED, {
        userId: authUser,
        challengeId: challengeRef._id,
        attemptId: attemptRef._id,
        metadata: { isCorrect: processed.audit.isCorrect, rewardAmount: processed.audit.rewardAmount },
      });
      await logAudit(AUDIT_ACTION.REWARD_CREATED, {
        userId: authUser,
        challengeId: challengeRef._id,
        attemptId: attemptRef._id,
        metadata: { rewardAmount: processed.audit.rewardAmount, txStatus: TX_PENDING },
      });
    }

    return res.status(processed.code).json(processed.body);
  } catch (error) {
    if (error && error.code === 11000 && error.keyPattern && error.keyPattern.idempotencyKey) {
      await logAudit(AUDIT_ACTION.DUPLICATE_ATTEMPT, {
        userId: authUser,
        metadata: { reason: 'idempotency_duplicate', challengeId },
      });
      return res.status(409).json({ success: false, message: 'Challenge already completed' });
    }
    if (error && error.code === 11000 && error.keyPattern && (error.keyPattern.challengeId || (error.keyPattern && error.keyPattern.userId && error.keyPattern.challengeId))) {
      await logAudit(AUDIT_ACTION.DUPLICATE_ATTEMPT, {
        userId: authUser,
        metadata: { reason: 'attempt_unique_conflict', challengeId },
      });
      return res.status(409).json({ success: false, message: 'Challenge already completed' });
    }
    console.error(`[captcha.verifyChallenge] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
};

const claimReward = async (req, res) => {
  const validation = validationResult(req);
  if (!validation.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validation.array().map((e) => ({ field: e.param, message: e.msg })),
    });
  }

  const authUser = req.user && req.user.userId;
  if (!authUser) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  const { challengeId } = req.body;
  let challengeRef = null;
  let rewardAmount = null;

  try {
    const result = await runInTx(async (session) => {
      const sessionOpt = session ? { session } : {};
      const challenge = await CaptchaChallenge.findOne({ challengeId }).setOptions(sessionOpt);

      if (!challenge) {
        await logAudit(AUDIT_ACTION.INVALID_CLAIM, {
          userId: authUser,
          metadata: { reason: 'challenge_not_found', challengeId },
        });
        return { code: 404, body: { success: false, message: 'Challenge not found' } };
      }
      challengeRef = challenge;

      if (String(challenge.userId) !== String(authUser)) {
        await logAudit(AUDIT_ACTION.SUSPICIOUS_REQUEST, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'cross_user_claim', challengeOwner: challenge.userId },
        });
        return { code: 403, body: { success: false, message: 'Challenge does not belong to this user' } };
      }

      if (challenge.status !== COMPLETED) {
        await logAudit(AUDIT_ACTION.INVALID_CLAIM, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'challenge_not_completed', status: challenge.status },
        });
        return { code: 400, body: { success: false, message: 'CAPTCHA not yet completed' } };
      }

      const tx = await RewardService.findRewardByChallengeId(challenge._id, session);
      if (!tx) {
        await logAudit(AUDIT_ACTION.INVALID_CLAIM, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'reward_tx_missing' },
        });
        return { code: 404, body: { success: false, message: 'Reward not found' } };
      }

      if (String(tx.userId) !== String(authUser)) {
        await logAudit(AUDIT_ACTION.SUSPICIOUS_REQUEST, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'tx_owner_mismatch', txOwner: tx.userId },
        });
        return { code: 403, body: { success: false, message: 'Reward does not belong to this user' } };
      }

      if (tx.status === TX_CLAIMED) {
        const walletGems = await WalletService.getBalance(authUser, session);
        await logAudit(AUDIT_ACTION.DUPLICATE_CLAIM, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { txId: tx._id, alreadyClaimed: true },
        });
        return {
          code: 409,
          body: {
            success: false,
            message: 'Reward already claimed',
            data: {
              challengeId: challenge.challengeId,
              rewardAmount: tx.amount,
              status: TX_CLAIMED,
              gems: walletGems,
            },
          },
        };
      }

      if (tx.status !== TX_PENDING) {
        await logAudit(AUDIT_ACTION.INVALID_CLAIM, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'unexpected_tx_status', txStatus: tx.status },
        });
        return { code: 400, body: { success: false, message: 'Reward cannot be claimed' } };
      }

      rewardAmount = tx.amount;
      const claim = await RewardService.claimReward({
        userId: authUser,
        challenge,
        session,
      });

      if (!claim.claimed) {
        const freshTx = await GemTransaction.findOne({ _id: tx._id }).setOptions(sessionOpt);
        if (freshTx && freshTx.status === TX_CLAIMED) {
          const walletGems = await WalletService.getBalance(authUser, session);
          await logAudit(AUDIT_ACTION.DUPLICATE_CLAIM, {
            userId: authUser,
            challengeId: challenge._id,
            metadata: { concurrentDetected: true },
          });
          return {
            code: 409,
            body: {
              success: false,
              message: 'Reward already claimed',
              data: {
                challengeId: challenge.challengeId,
                rewardAmount: freshTx.amount,
                status: TX_CLAIMED,
                gems: walletGems,
              },
            },
          };
        }
        await logAudit(AUDIT_ACTION.INVALID_CLAIM, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'claim_failed_race' },
        });
        return { code: 409, body: { success: false, message: 'Claim failed, please retry' } };
      }

      return {
        code: 200,
        body: {
          success: true,
          message: 'Reward claimed successfully',
          data: {
            challengeId: challenge.challengeId,
            rewardAmount: claim.rewardAmount,
            status: TX_CLAIMED,
            gems: claim.wallet.gems,
          },
        },
      };
    });

    if (result.code === 200) {
      await logAudit(AUDIT_ACTION.REWARD_CLAIMED, {
        userId: authUser,
        challengeId: challengeRef._id,
        metadata: { rewardAmount },
      });
    }

    return res.status(result.code).json(result.body);
  } catch (error) {
    console.error(`[captcha.claimReward] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Claim failed' });
  }
};

const adComplete = async (req, res) => {
  const validation = validationResult(req);
  if (!validation.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validation.array().map((e) => ({ field: e.param, message: e.msg })),
    });
  }

  const authUser = req.user && req.user.userId;
  if (!authUser) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  const { challengeId } = req.body;
  let challengeRef = null;

  try {
    const result = await runInTx(async (session) => {
      const sessionOpt = session ? { session } : {};
      const challenge = await CaptchaChallenge.findOne({ challengeId }).setOptions(sessionOpt);

      if (!challenge) {
        await logAudit(AUDIT_ACTION.INVALID_AD_COMPLETE, {
          userId: authUser,
          metadata: { reason: 'challenge_not_found', challengeId },
        });
        return { code: 404, body: { success: false, message: 'Challenge not found' } };
      }
      challengeRef = challenge;

      if (String(challenge.userId) !== String(authUser)) {
        await logAudit(AUDIT_ACTION.SUSPICIOUS_REQUEST, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'cross_user_ad_complete', challengeOwner: challenge.userId },
        });
        return { code: 403, body: { success: false, message: 'Challenge does not belong to this user' } };
      }

      if (challenge.status !== COMPLETED) {
        await logAudit(AUDIT_ACTION.INVALID_AD_COMPLETE, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'challenge_not_completed', status: challenge.status },
        });
        return { code: 400, body: { success: false, message: 'CAPTCHA not yet completed' } };
      }

      const tx = await RewardService.findRewardByChallengeId(challenge._id, session);
      if (!tx) {
        await logAudit(AUDIT_ACTION.INVALID_AD_COMPLETE, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'reward_tx_missing' },
        });
        return { code: 404, body: { success: false, message: 'Reward not found' } };
      }

      if (String(tx.userId) !== String(authUser)) {
        await logAudit(AUDIT_ACTION.SUSPICIOUS_REQUEST, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'tx_owner_mismatch_ad', txOwner: tx.userId },
        });
        return { code: 403, body: { success: false, message: 'Reward does not belong to this user' } };
      }

      if (tx.status === TX_CLAIMED) {
        await logAudit(AUDIT_ACTION.DUPLICATE_CLAIM, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'ad_complete_when_already_claimed' },
        });
        return {
          code: 409,
          body: {
            success: false,
            message: 'Reward already claimed',
            data: {
              challengeId: challenge.challengeId,
              rewardAmount: tx.amount,
              rewardStatus: tx.status,
            },
          },
        };
      }

      if (tx.status !== TX_PENDING) {
        await logAudit(AUDIT_ACTION.INVALID_AD_COMPLETE, {
          userId: authUser,
          challengeId: challenge._id,
          metadata: { reason: 'unexpected_tx_status', txStatus: tx.status },
        });
        return { code: 400, body: { success: false, message: 'Ad cannot be applied' } };
      }

      const mark = await RewardService.markAdCompleted({ userId: authUser, challenge, session });
      if (!mark.updated) {
        return {
          code: 409,
          body: { success: false, message: 'Reward state changed; please retry' },
        };
      }

      return {
        code: 200,
        body: {
          success: true,
          message: 'Rewarded ad completion recorded',
          data: {
            challengeId: challenge.challengeId,
            rewardAmount: mark.transaction.amount,
            rewardStatus: mark.transaction.status,
            adCompletedAt: mark.transaction.adCompletedAt,
          },
        },
      };
    });

    if (result.code === 200) {
      await logAudit(AUDIT_ACTION.AD_COMPLETED, {
        userId: authUser,
        challengeId: challengeRef._id,
      });
    }

    return res.status(result.code).json(result.body);
  } catch (error) {
    console.error(`[captcha.adComplete] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Ad completion failed' });
  }
};

const newChallenge = async (req, res) => {
  const validation = validationResult(req);
  if (!validation.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validation.array().map((e) => ({ field: e.param, message: e.msg })),
    });
  }

  const authUser = req.user && req.user.userId;
  if (!authUser) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  const { challengeId } = req.body;
  let oldChallengeRef = null;

  try {
    const result = await runInTx(async (session) => {
      const sessionOpt = session ? { session } : {};

      const oldChallenge = await CaptchaChallenge.findOne({ challengeId }).setOptions(sessionOpt);
      if (!oldChallenge) {
        await logAudit(AUDIT_ACTION.INVALID_ATTEMPT, {
          userId: authUser,
          metadata: { reason: 'new_challenge_old_not_found', challengeId },
        });
        return { code: 404, body: { success: false, message: 'Challenge not found' } };
      }
      oldChallengeRef = oldChallenge;

      if (String(oldChallenge.userId) !== String(authUser)) {
        await logAudit(AUDIT_ACTION.SUSPICIOUS_REQUEST, {
          userId: authUser,
          challengeId: oldChallenge._id,
          metadata: { reason: 'cross_user_new_challenge', owner: oldChallenge.userId },
        });
        return { code: 403, body: { success: false, message: 'Challenge does not belong to this user' } };
      }

      const tx = await RewardService.findRewardByChallengeId(oldChallenge._id, session);
      const originalStatus = oldChallenge.status;
      if (oldChallenge.status === ACTIVE || oldChallenge.status === EXPIRED || oldChallenge.status === SKIPPED) {
        if (oldChallenge.status === ACTIVE || oldChallenge.status === EXPIRED) {
          oldChallenge.status = SKIPPED;
          await oldChallenge.save(sessionOpt);
          await logAudit(AUDIT_ACTION.CHALLENGE_SKIPPED, {
            userId: authUser,
            challengeId: oldChallenge._id,
            metadata: { previousStatus: originalStatus, hadPendingReward: !!tx && tx.status === TX_PENDING },
          });
        }
      } else if (oldChallenge.status === COMPLETED) {
        if (tx && tx.status === TX_PENDING) {
          tx.status = TX_FAILED;
          await tx.save(sessionOpt);
          oldChallenge.status = SKIPPED;
          await oldChallenge.save(sessionOpt);
          await logAudit(AUDIT_ACTION.CHALLENGE_SKIPPED, {
            userId: authUser,
            challengeId: oldChallenge._id,
            metadata: { cancelledPendingReward: tx.amount },
          });
        } else {
          oldChallenge.status = SKIPPED;
          await oldChallenge.save(sessionOpt);
          await logAudit(AUDIT_ACTION.CHALLENGE_SKIPPED, {
            userId: authUser,
            challengeId: oldChallenge._id,
            metadata: { txStatusAtSkip: tx ? tx.status : null },
          });
        }
      }

      const fresh = await createChallenge(authUser);

      return {
        code: 200,
        body: {
          success: true,
          message: 'New challenge generated',
          data: fresh.toPublicObject(),
        },
      };
    });

    if (result.code === 200 && oldChallengeRef) {
      await logAudit(AUDIT_ACTION.NEW_CHALLENGE, {
        userId: authUser,
        challengeId: oldChallengeRef._id,
      });
    }

    return res.status(result.code).json(result.body);
  } catch (error) {
    console.error(`[captcha.newChallenge] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to generate new CAPTCHA challenge' });
  }
};

module.exports = { getCurrentChallenge, verifyChallenge, claimReward, adComplete, newChallenge };
