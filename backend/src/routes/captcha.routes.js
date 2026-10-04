const express = require('express');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const {
  getCurrentChallenge,
  verifyChallenge,
  claimReward,
  adComplete,
  newChallenge,
} = require('../controllers/captcha.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

const captchaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many CAPTCHA requests, please slow down',
  },
});

const verifyValidators = [
  body('challengeId')
    .trim()
    .notEmpty()
    .withMessage('challengeId is required')
    .isString()
    .withMessage('challengeId must be a string'),
  body('selectedOption')
    .trim()
    .notEmpty()
    .withMessage('selectedOption is required')
    .isString()
    .withMessage('selectedOption must be a string'),
];

const challengeIdOnlyValidators = [
  body('challengeId')
    .trim()
    .notEmpty()
    .withMessage('challengeId is required')
    .isString()
    .withMessage('challengeId must be a string'),
];

router.get('/current', protect, captchaLimiter, getCurrentChallenge);
router.post('/verify', protect, captchaLimiter, ...verifyValidators, verifyChallenge);
router.post('/claim', protect, captchaLimiter, ...challengeIdOnlyValidators, claimReward);
router.post('/ad-complete', protect, captchaLimiter, ...challengeIdOnlyValidators, adComplete);
router.post('/new', protect, captchaLimiter, ...challengeIdOnlyValidators, newChallenge);

module.exports = router;
