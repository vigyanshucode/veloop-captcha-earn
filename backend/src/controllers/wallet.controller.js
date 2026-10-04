const Wallet = require('../models/Wallet');
const WalletService = require('../services/wallet.service');

const getBalance = async (req, res) => {
  try {
    const { userId } = req.user;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
    const gems = await WalletService.getBalance(userId);
    const wallet = await Wallet.findOne({ userId }, 'gems userId createdAt updatedAt');
    return res.status(200).json({
      success: true,
      message: 'Wallet balance retrieved',
      data: {
        gems,
        wallet: wallet ? wallet.toObject() : { userId, gems },
      },
    });
  } catch (error) {
    console.error(`[wallet.getBalance] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve wallet' });
  }
};

module.exports = { getBalance };
