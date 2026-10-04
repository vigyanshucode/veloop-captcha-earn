const mongoose = require('mongoose');

const ATTEMPT_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
});

const CaptchaAttemptSchema = new mongoose.Schema(
  {
    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CaptchaChallenge',
      required: [true, 'challengeId is required'],
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    selectedOption: {
      type: String,
      required: [true, 'selectedOption is required'],
      trim: true,
    },
    isCorrect: {
      type: Boolean,
      required: [true, 'isCorrect is required'],
    },
    rewardAmount: {
      type: Number,
      required: [true, 'rewardAmount is required'],
      min: [0, 'rewardAmount must be >= 0'],
    },
    status: {
      type: String,
      enum: Object.values(ATTEMPT_STATUS),
      required: [true, 'status is required'],
    },
    reason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

CaptchaAttemptSchema.index({ userId: 1, createdAt: -1 });
CaptchaAttemptSchema.index({ challengeId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('CaptchaAttempt', CaptchaAttemptSchema);
module.exports.ATTEMPT_STATUS = ATTEMPT_STATUS;
