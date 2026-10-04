const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');

const getOrCreateWallet = async (userId, session = null) => {
  const opts = session ? { session } : {};
  let wallet = await Wallet.findOne({ userId }).setOptions(opts);
  if (!wallet) {
    wallet = new Wallet({ userId, gems: 0 });
    wallet = await wallet.save(opts);
  }
  return wallet;
};

const incrementGems = async (userId, amount, session = null) => {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('incrementGems: amount must be a non-negative finite number');
  }
  const opts = session ? { session, new: true } : { new: true };
  const wallet = await Wallet.findOneAndUpdate(
    { userId },
    { $inc: { gems: amount } },
    {
      ...opts,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  );
  return wallet;
};

const getBalance = async (userId, session = null) => {
  const opts = session ? { session } : {};
  const wallet = await getOrCreateWallet(userId, session);
  const fresh = await Wallet.findOne({ userId }, 'gems userId createdAt updatedAt').setOptions(opts);
  return fresh ? fresh.gems : wallet.gems;
};

module.exports = {
  getOrCreateWallet,
  incrementGems,
  getBalance,
};
