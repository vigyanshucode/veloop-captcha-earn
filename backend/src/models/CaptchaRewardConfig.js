const mongoose = require('mongoose');

const CaptchaRewardConfigSchema = new mongoose.Schema(
  {
    correctReward: {
      type: Number,
      required: [true, 'correctReward is required'],
      default: 1,
      min: [0, 'correctReward must be >= 0'],
    },
    wrongReward: {
      type: Number,
      required: [true, 'wrongReward is required'],
      default: 0.5,
      min: [0, 'wrongReward must be >= 0'],
    },
    isActive: {
      type: Boolean,
      required: [true, 'isActive is required'],
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CaptchaRewardConfig', CaptchaRewardConfigSchema);
