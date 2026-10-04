import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { classifyApiError } from '../utils/errors';

const walletStore = {
  gems: 0,
  loading: false,
  error: null,
  mountedCount: 0,
  invalidateInFlight: null,
  globalAbort: null,
  subscribers: new Set(),
  notify() {
    for (const sub of this.subscribers) sub();
  },
  setGems(n) {
    const v = Number.isFinite(n) ? n : this.gems;
    if (this.gems === v) return;
    this.gems = v;
    this.notify();
  },
  setLoading(b) {
    if (this.loading === b) return;
    this.loading = b;
    this.notify();
  },
  setError(e) {
    this.error = e;
    this.notify();
  },
};

async function runInvalidate() {
  if (walletStore.invalidateInFlight) return walletStore.invalidateInFlight;
  if (walletStore.globalAbort) walletStore.globalAbort.abort();
  const ctrl = new AbortController();
  walletStore.globalAbort = ctrl;
  walletStore.setLoading(true);
  walletStore.setError(null);
  const promise = (async () => {
    try {
      const res = await api.get('/wallet/gems', { signal: ctrl.signal });
      const data = (res.data && res.data.data) || null;
      const gemsVal = data && Number.isFinite(data.gems) ? data.gems : null;
      if (Number.isFinite(gemsVal)) walletStore.setGems(gemsVal);
      return gemsVal;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      const info = classifyApiError(err);
      if (!info.requiresLogin) walletStore.setError(err);
      return null;
    } finally {
      walletStore.invalidateInFlight = null;
      walletStore.setLoading(false);
      if (walletStore.globalAbort === ctrl) walletStore.globalAbort = null;
    }
  })();
  walletStore.invalidateInFlight = promise;
  return promise;
}

const useWallet = ({ enabled = true } = {}) => {
  const [, forceTick] = useState(0);
  const mountedRef = useRef(true);

  const subscribe = useCallback(() => {
    const sub = () => {
      if (mountedRef.current) forceTick((x) => (x + 1) % 1_000_000);
    };
    walletStore.subscribers.add(sub);
    walletStore.mountedCount += 1;
    return () => {
      walletStore.subscribers.delete(sub);
      walletStore.mountedCount = Math.max(0, walletStore.mountedCount - 1);
      if (walletStore.mountedCount === 0) {
        walletStore.gems = 0;
        walletStore.loading = false;
        walletStore.error = null;
        walletStore.invalidateInFlight = null;
        if (walletStore.globalAbort) walletStore.globalAbort.abort();
        walletStore.globalAbort = null;
      }
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const cleanup = subscribe();
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [subscribe]);

  const invalidate = useCallback(async () => {
    if (!enabled) return null;
    return runInvalidate();
  }, [enabled]);

  const setGemsFromBackend = useCallback((n) => {
    walletStore.setGems(n);
  }, []);

  useEffect(() => {
    if (enabled) runInvalidate();
  }, [enabled]);

  return {
    gems: walletStore.gems,
    loading: walletStore.loading,
    error: walletStore.error,
    invalidate,
    setGemsFromBackend,
  };
};

export default useWallet;
