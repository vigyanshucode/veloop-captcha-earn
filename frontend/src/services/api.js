const BASE_URL =
  (import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  '/api';

const TOKEN_KEY = 'veloop.token';

const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch (_) {
    return null;
  }
};

const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
};

const clearToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
};

class ApiError extends Error {
  constructor(message, status, body = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const request = async (method, path, body = null, opts = {}) => {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw e;
    }
    throw new ApiError('Network error. Please check your connection.', 0, null);
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
  }

  if (res.status >= 200 && res.status < 300) {
    return { status: res.status, data, raw: text };
  }

  const msg =
    (data && data.message) ||
    {
      400: 'Invalid request.',
      401: 'Session expired. Please log in again.',
      403: 'You are not authorized to perform this action.',
      404: 'Resource not found.',
      409: 'This action was already completed.',
      410: 'Challenge expired. A new one will be loaded.',
      429: 'Too many requests. Please slow down.',
      500: 'Something went wrong on our end.',
    }[res.status] ||
    `Request failed (${res.status}).`;

  throw new ApiError(msg, res.status, data);
};

const api = {
  get: (p, o) => request('GET', p, null, o),
  post: (p, b, o) => request('POST', p, b || {}, o),
};

export { BASE_URL, TOKEN_KEY, ApiError, getToken, setToken, clearToken };
export default api;
