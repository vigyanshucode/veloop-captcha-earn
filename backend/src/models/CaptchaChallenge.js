const mongoose = require('mongoose');

const CAPTCHA_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
  SKIPPED: 'SKIPPED',
});

const CaptchaChallengeSchema = new mongoose.Schema(
  {
    challengeId: {
      type: String,
      required: [true, 'challengeId is required'],
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      index: true,
    },
    captchaText: {
      type: String,
      required: [true, 'captchaText is required'],
      trim: true,
    },
    options: {
      type: [String],
      required: [true, 'options is required'],
      validate: {
        validator: (v) => Array.isArray(v) && v.length === 4,
        message: 'options must contain exactly 4 strings',
      },
    },
    correctOption: {
      type: String,
      required: [true, 'correctOption is required'],
      select: false,
    },
    status: {
      type: String,
      enum: Object.values(CAPTCHA_STATUS),
      default: CAPTCHA_STATUS.ACTIVE,
      required: [true, 'status is required'],
      index: true,
    },
    expiresAt: {
      type: Date,
      required: [true, 'expiresAt is required'],
      index: true,
    },
  },
  { timestamps: true }
);

CaptchaChallengeSchema.methods.toPublicObject = function () {
  const obj = this.toObject();
  delete obj.correctOption;
  delete obj.userId;
  delete obj.__v;
  delete obj._id;
  delete obj.updatedAt;
  return {
    challengeId: obj.challengeId,
    captchaText: obj.captchaText,
    options: obj.options,
    status: obj.status,
    expiresAt: obj.expiresAt,
    createdAt: obj.createdAt,
  };
};

module.exports = mongoose.model('CaptchaChallenge', CaptchaChallengeSchema);
module.exports.CAPTCHA_STATUS = CAPTCHA_STATUS;
