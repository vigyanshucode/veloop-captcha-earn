const ERR_CODE = {
  NETWORK: 0,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  RATE_LIMIT: 429,
  SERVER: 500,
};

const classifyApiError = (err) => {
  if (!err) return { category: 'unknown', retryable: false };
  const status = err.status || 0;
  switch (status) {
    case 0:
      return { category: 'network', retryable: true };
    case 400:
      return { category: 'validation', retryable: false };
    case 401:
      return { category: 'auth', retryable: false, requiresLogin: true };
    case 403:
      return { category: 'forbidden', retryable: false, requiresLogin: true };
    case 404:
      return { category: 'not_found', retryable: false };
    case 409:
      return { category: 'conflict', retryable: false };
    case 410:
      return { category: 'expired', retryable: true, shouldRefresh: true };
    case 429:
      return { category: 'rate_limit', retryable: true, cooldown: true };
    case 500:
    default:
      return {
        category: status >= 500 ? 'server' : 'unknown',
        retryable: status >= 500,
      };
  }
};

const firstValidationMessage = (err) => {
  if (!err || !err.body) return null;
  const errs = err.body.errors;
  if (Array.isArray(errs) && errs.length > 0) return errs[0].message;
  return null;
};

const userFacingMessage = (err, fallback = 'Something went wrong.') => {
  if (!err) return fallback;
  const msg = err.message || firstValidationMessage(err);
  return msg || fallback;
};

export { ERR_CODE, classifyApiError, firstValidationMessage, userFacingMessage };
