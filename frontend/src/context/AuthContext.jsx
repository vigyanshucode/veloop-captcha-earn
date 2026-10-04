import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import api, { clearToken, getToken, setToken } from '../services/api';
import { classifyApiError } from '../utils/errors';

const AuthContext = createContext(null);

const safeUser = (u) => (u ? { _id: u._id, name: u.name, email: u.email } : null);

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [lastAuthError, setLastAuthError] = useState(null);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setLastAuthError(null);
  }, []);

  const me = useCallback(async () => {
    if (!getToken()) {
      setInitializing(false);
      return null;
    }
    try {
      const res = await api.get('/auth/me');
      const u = (res.data && res.data.data && res.data.data.user) || null;
      setUser(safeUser(u));
      setInitializing(false);
      return u;
    } catch (err) {
      const info = classifyApiError(err);
      if (info.requiresLogin) logout();
      else setInitializing(false);
      return null;
    }
  }, [logout]);

  useEffect(() => {
    me();
  }, [me]);

  const register = useCallback(async ({ name, email, password }) => {
    setLastAuthError(null);
    try {
      const res = await api.post('/auth/register', { name, email, password });
      const payload = (res.data && res.data.data) || {};
      const token = payload.token;
      if (token) setToken(token);
      const u = payload.user;
      setUser(safeUser(u));
      return { user: safeUser(u), token: token || null };
    } catch (err) {
      setLastAuthError(err);
      throw err;
    }
  }, []);

  const login = useCallback(async ({ email, password }) => {
    setLastAuthError(null);
    try {
      const res = await api.post('/auth/login', { email, password });
      const payload = (res.data && res.data.data) || {};
      const token = payload.token;
      if (token) setToken(token);
      const u = payload.user;
      setUser(safeUser(u));
      return { user: safeUser(u), token: token || null };
    } catch (err) {
      setLastAuthError(err);
      throw err;
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      initializing,
      isAuthenticated: !!user,
      lastAuthError,
      register,
      login,
      logout,
      refreshUser: me,
    }),
    [user, initializing, lastAuthError, register, login, logout, me]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export { AuthContext, AuthProvider };
