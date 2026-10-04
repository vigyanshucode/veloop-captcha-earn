const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');

const signToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const sendValidationErrors = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((e) => ({
        field: e.param,
        message: e.msg,
      })),
    });
    return true;
  }
  return false;
};

const register = async (req, res) => {
  try {
    if (sendValidationErrors(req, res)) return;

    const { name, email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Email is already registered',
      });
    }

    const user = new User({
      name,
      email: normalizedEmail,
      passwordHash: password,
    });
    await user.save();

    const token = signToken(user._id);

    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        user: user.toSafeObject(),
        token,
      },
    });
  } catch (error) {
    console.error(`[auth.register] ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Registration failed',
    });
  }
};

const login = async (req, res) => {
  try {
    if (sendValidationErrors(req, res)) return;

    const { email, password } = req.body;
    const normalizedEmail = email.toLowerCase();

    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

    const genericInvalid = {
      success: false,
      message: 'Invalid credentials',
    };

    if (!user) {
      return res.status(401).json(genericInvalid);
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated',
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json(genericInvalid);
    }

    const token = signToken(user._id);

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: user.toSafeObject(),
        token,
      },
    });
  } catch (error) {
    console.error(`[auth.login] ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Login failed',
    });
  }
};

const me = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated',
      });
    }
    return res.status(200).json({
      success: true,
      message: 'Profile retrieved',
      data: {
        user: user.toSafeObject(),
      },
    });
  } catch (error) {
    console.error(`[auth.me] ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve profile',
    });
  }
};

module.exports = { register, login, me };
