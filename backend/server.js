require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const connectDB = require('./src/config/db');
const authRoutes = require('./src/routes/auth.routes');
const captchaRoutes = require('./src/routes/captcha.routes');
const walletRoutes = require('./src/routes/wallet.routes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));

const FRONTEND_URL = (process.env.FRONTEND_URL || '').trim();
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '').trim();
const allowedOrigins = [];

if (FRONTEND_URL) {
  const normalized = FRONTEND_URL.replace(/\/$/, '');
  if (!allowedOrigins.includes(normalized)) allowedOrigins.push(normalized);
}

if (CORS_ALLOWED_ORIGINS) {
  const extras = CORS_ALLOWED_ORIGINS
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  for (const o of extras) {
    if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
  }
}

if (NODE_ENV === 'development') {
  const defaultDevOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  for (const o of defaultDevOrigins) {
    if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
  }
  if (!FRONTEND_URL) {
    console.warn('[cors] WARNING: FRONTEND_URL not set in env. Development-only allow-list used (localhost:5173 / 127.0.0.1:5173).');
  }
}

if (NODE_ENV === 'production' && !FRONTEND_URL) {
  console.error('[cors] FATAL: FRONTEND_URL must be configured in production environment.');
  process.exit(1);
}
if (NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('[auth] FATAL: JWT_SECRET must be set in production.');
  process.exit(1);
}
if (NODE_ENV === 'production' && !process.env.MONGO_URI) {
  console.error('[db] FATAL: MONGO_URI must be set in production.');
  process.exit(1);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const normalizedOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy: origin ${origin} not on allow-list`), false);
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
  optionsSuccessStatus: 204,
  preflightContinue: false,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  const mongoState = require('mongoose').connection.readyState;
  const mongoStatus =
    mongoState === 0 ? 'disconnected' :
    mongoState === 1 ? 'connected' :
    mongoState === 2 ? 'connecting' :
    mongoState === 3 ? 'disconnecting' : 'unknown';
  res.status(200).json({
    status: 'ok',
    message: 'VELoop Rewards API is running',
    mongodb: mongoStatus,
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/captcha', captchaRoutes);
app.use('/api/wallet', walletRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

app.use((err, req, res, _next) => {
  console.error(`[server] Uncaught] ${err.message}`);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
  });
});

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
};

process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection: ${err.message}`);
});

startServer();

module.exports = app;
