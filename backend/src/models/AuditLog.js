const mongoose = require('mongoose');

const AUDIT_ACTION = Object.freeze({
  CHALLENGE_VERIFIED: 'Challenge Verified',
  REWARD_CREATED: 'Reward Created',
  REWARD_CLAIMED: 'Reward Claimed',
  DUPLICATE_CLAIM: 'Duplicate Claim',
  INVALID_CLAIM: 'Invalid Claim',
  CHALLENGE_SKIPPED: 'Challenge Skipped',
  NEW_CHALLENGE: 'New Challenge',
  AD_COMPLETED: 'Ad Completed',
  INVALID_AD_COMPLETE: 'Invalid Ad Complete',
  INVALID_ATTEMPT: 'Invalid Attempt',
  DUPLICATE_ATTEMPT: 'Duplicate Attempt',
  EXPIRED_CHALLENGE: 'Expired Challenge',
  SUSPICIOUS_REQUEST: 'Suspicious Request',
});

const AuditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    action: {
      type: String,
      required: [true, 'action is required'],
      enum: Object.values(AUDIT_ACTION),
      index: true,
    },
    challengeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CaptchaChallenge',
      index: true,
    },
    attemptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CaptchaAttempt',
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: { updatedAt: false, createdAt: true } }
);

AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
module.exports.AUDIT_ACTION = AUDIT_ACTION;
