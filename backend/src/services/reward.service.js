const crypto = require('crypto');
const CaptchaRewardConfig = require('../models/CaptchaRewardConfig');
const CaptchaAttempt = require('../models/CaptchaAttempt');
const GemTransaction = require('../models/GemTransaction');
const WalletService = require('./wallet.service');
const { ATTEMPT_STATUS } = CaptchaAttempt;
const { TX_TYPE, TX_STATUS } = GemTransaction;

const DEFAULT_CORRECT_REWARD = 1;
const DEFAULT_WRONG_REWARD = 0.5;

const buildIdempotencyKey = (userId, challengeId) => {
  const raw = `${String(userId)}::${String(challengeId)}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
};

const getActiveRewardConfig = async () => {
  const existing = await CaptchaRewardConfig.findOne({ isActive: true }).sort({ updatedAt: -1 });
  if (existing) return existing;

  const fresh = new CaptchaRewardConfig({
    correctReward: DEFAULT_CORRECT_REWARD,
    wrongReward: DEFAULT_WRONG_REWARD,
    isActive: true,
  });
  return fresh.save();
};

const determineReward = (isCorrect, config) => {
  if (isCorrect) {
    return Number.isFinite(config.correctReward) ? config.correctReward : DEFAULT_CORRECT_REWARD;
  }
  return Number.isFinite(config.wrongReward) ? config.wrongReward : DEFAULT_WRONG_REWARD;
};

const processReward = async ({
  userId,
  challenge,
  selectedOption,
  isCorrect,
  session,
}) => {
  const config = await getActiveRewardConfig();
  const rewardAmount = determineReward(isCorrect, config);
  const challengeId = challenge._id;
  const idempotencyKey = buildIdempotencyKey(userId, challengeId);

  const attempt = new CaptchaAttempt({
    challengeId,
    userId,
    selectedOption,
    isCorrect,
    rewardAmount,
    status: ATTEMPT_STATUS.VERIFIED,
  });
  await attempt.save({ session });

  const transaction = new GemTransaction({
    userId,
    challengeId,
    attemptId: attempt._id,
    type: TX_TYPE.CAPTCHA_REWARD,
    amount: rewardAmount,
    status: TX_STATUS.PENDING,
    idempotencyKey,
  });
  await transaction.save({ session });

  return {
    attempt,
    transaction,
    rewardAmount,
    idempotencyKey,
    correctReward: config.correctReward,
    wrongReward: config.wrongReward,
  };
};

const findRewardByChallengeId = async (challengeDocId, session = null) => {
  const opts = session ? { session } : {};
  const tx = await GemTransaction.findOne({ challengeId: challengeDocId }).setOptions(opts);
  return tx;
};

const claimReward = async ({ userId, challenge, session }) => {
  const challengeId = challenge._id;
  const sessionOpt = session ? { session } : {};

  const tx = await GemTransaction.findOneAndUpdate(
    {
      _id: { $exists: true },
      challengeId,
      userId,
      status: TX_STATUS.PENDING,
    },
    {
      $set: {
        status: TX_STATUS.CLAIMED,
        claimedAt: new Date(),
      },
    },
    {
      ...sessionOpt,
      new: true,
      runValidators: true,
    }
  );

  if (!tx) {
    return { claimed: false };
  }

  const wallet = await WalletService.incrementGems(userId, tx.amount, session);

  return {
    claimed: true,
    transaction: tx,
    rewardAmount: tx.amount,
    wallet,
  };
};

const markAdCompleted = async ({ userId, challenge, session }) => {
  const challengeId = challenge._id;
  const sessionOpt = session ? { session } : {};

  const tx = await GemTransaction.findOneAndUpdate(
    {
      challengeId,
      userId,
      status: TX_STATUS.PENDING,
    },
    {
      $set: {
        adCompletedAt: new Date(),
      },
    },
    {
      ...sessionOpt,
      new: true,
      runValidators: true,
    }
  );

  return tx ? { updated: true, transaction: tx } : { updated: false };
};

module.exports = {
  getActiveRewardConfig,
  determineReward,
  buildIdempotencyKey,
  processReward,
  findRewardByChallengeId,
  claimReward,
  markAdCompleted,
  DEFAULT_CORRECT_REWARD,
  DEFAULT_WRONG_REWARD,
};
