const crypto = require('crypto');
const CaptchaChallenge = require('../models/CaptchaChallenge');

const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ALL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DEFAULT_CAPTCHA_LENGTH = 6;
const DEFAULT_CAPTCHA_EXPIRY_SECONDS = 60;
const CHALLENGE_ID_BYTES = 16;

const getCaptchaExpirySeconds = () => {
  const raw = parseInt(process.env.CAPTCHA_EXPIRY_SECONDS, 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_CAPTCHA_EXPIRY_SECONDS;
};

const randomChar = (alphabet) =>
  alphabet[crypto.randomInt(0, alphabet.length)];

const generateCaptchaText = (length = DEFAULT_CAPTCHA_LENGTH) => {
  let text = '';
  for (let i = 0; i < length; i++) text += randomChar(CAPTCHA_CHARS);
  return text;
};

const generateChallengeId = () =>
  crypto.randomBytes(CHALLENGE_ID_BYTES).toString('hex');

const shuffleArray = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const replaceCharAt = (str, idx, char) =>
  str.slice(0, idx) + char + str.slice(idx + 1);

const generateSimilarOption = (captchaText) => {
  const idx = crypto.randomInt(0, captchaText.length);
  const current = captchaText[idx];
  let replacement;
  do {
    replacement = randomChar(ALL_CHARS);
  } while (replacement === current);
  return replaceCharAt(captchaText, idx, replacement);
};

const generateCompletelyDifferentOption = (captchaText) => {
  let candidate;
  let tries = 0;
  const maxTries = 50;
  do {
    candidate = '';
    for (let i = 0; i < captchaText.length; i++) {
      let c;
      do {
        c = randomChar(ALL_CHARS);
      } while (c === captchaText[i]);
      candidate += c;
    }
    tries++;
  } while (
    tries < maxTries &&
    similarity(candidate, captchaText) > Math.floor(captchaText.length / 2)
  );
  return candidate;
};

const similarity = (a, b) => {
  let same = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) if (a[i] === b[i]) same++;
  return same;
};

const generateOptions = (captchaText) => {
  const correct = captchaText;
  const similar1 = generateSimilarOption(captchaText);
  let similar2;
  let tries = 0;
  do {
    similar2 = generateSimilarOption(captchaText);
    tries++;
  } while (
    (similar2 === correct || similar2 === similar1) &&
    tries < 20
  );

  let different;
  tries = 0;
  do {
    different = generateCompletelyDifferentOption(captchaText);
    tries++;
  } while (
    (different === correct ||
      different === similar1 ||
      different === similar2) &&
    tries < 50
  );

  const uniqueSet = new Set([correct, similar1, similar2, different]);
  if (uniqueSet.size !== 4) {
    return generateOptions(captchaText);
  }

  return {
    correctOption: correct,
    options: shuffleArray([correct, similar1, similar2, different]),
  };
};

const buildExpiresAt = () => {
  const seconds = getCaptchaExpirySeconds();
  return new Date(Date.now() + seconds * 1000);
};

const createChallenge = async (userId) => {
  const captchaText = generateCaptchaText();
  const { correctOption, options } = generateOptions(captchaText);

  let challenge = new CaptchaChallenge({
    challengeId: generateChallengeId(),
    userId,
    captchaText,
    options,
    correctOption,
    status: CaptchaChallenge.schema.paths.status.defaultValue,
    expiresAt: buildExpiresAt(),
  });

  let attempts = 0;
  while (attempts < 5) {
    try {
      await challenge.save();
      return challenge;
    } catch (err) {
      if (
        err &&
        err.code === 11000 &&
        err.keyPattern &&
        err.keyPattern.challengeId
      ) {
        challenge.challengeId = generateChallengeId();
        attempts++;
        continue;
      }
      throw err;
    }
  }

  throw new Error('Unable to generate unique challengeId');
};

module.exports = {
  generateCaptchaText,
  generateOptions,
  generateChallengeId,
  getCaptchaExpirySeconds,
  buildExpiresAt,
  createChallenge,
  CAPTCHA_CHARS,
  DEFAULT_CAPTCHA_EXPIRY_SECONDS,
};
