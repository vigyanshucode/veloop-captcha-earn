const express = require('express');
const rateLimit = require('express-rate-limit');
const { getBalance } = require('../controllers/wallet.controller');
const { protect } = require('../middleware/auth.middleware');

const router = express.Router();

const walletLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many wallet requests' },
});

router.get('/gems', protect, walletLimiter, getBalance);

module.exports = router;
