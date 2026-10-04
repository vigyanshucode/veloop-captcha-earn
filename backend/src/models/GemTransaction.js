const mongoose = require('mongoose');

const TX_TYPE = Object.freeze({ CAPTCHA_REWARD: 'CAPTCHA_REWARD' });
const TX_STATUS = Object.freeze({ PENDING: 'PENDING', CLAIMED: 'CLAIMED', FAILED: 'FAILED' });

const GemTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CaptchaChallenge',
      required: [true, 'challengeId is required'],
      index: true,
    },
    attemptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CaptchaAttempt',
      required: [true, 'attemptId is required'],
      index: true,
    },
    type: {
      type: String,
      enum: Object.values(TX_TYPE),
      required: [true, 'type is required'],
      default: TX_TYPE.CAPTCHA_REWARD,
    },
    amount: {
      type: Number,
      required: [true, 'amount is required'],
      min: [0, 'amount must be >= 0'],
    },
    status: {
      type: String,
      enum: Object.values(TX_STATUS),
      required: [true, 'status is required'],
      default: TX_STATUS.PENDING,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: [true, 'idempotencyKey is required'],
      unique: true,
      index: true,
    },
    claimedAt: {
      type: Date,
    },
    adCompletedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GemTransaction', GemTransactionSchema);
module.exports.TX_TYPE = TX_TYPE;
module.exports.TX_STATUS = TX_STATUS;
