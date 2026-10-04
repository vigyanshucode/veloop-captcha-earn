const mongoose = require('mongoose');

const WalletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      unique: true,
      index: true,
    },
    gems: {
      type: Number,
      required: [true, 'gems is required'],
      default: 0,
      min: [0, 'gems balance cannot be negative'],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Wallet', WalletSchema);
