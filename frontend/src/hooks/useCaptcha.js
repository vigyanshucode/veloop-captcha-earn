import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { classifyApiError } from '../utils/errors';

const CAPTCHA_STEPS = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  OPTION_SELECTED: 'OPTION_SELECTED',
  VERIFYING: 'VERIFYING',
  SUCCESS: 'SUCCESS',
  INCORRECT: 'INCORRECT',
  AD_WATCHING: 'AD_WATCHING',
  AD_READY: 'AD_READY',
  CLAIMING: 'CLAIMING',
  CLAIMED: 'CLAIMED',
  ERROR: 'ERROR',
  EXPIRED: 'EXPIRED',
  SKIPPING: 'SKIPPING',
};

const useCaptcha = () => {
  const [step, setStep] = useState(CAPTCHA_STEPS.LOADING);
  const [challenge, setChallenge] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [claimResult, setClaimResult] = useState(null);
  const [adResult, setAdResult] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [walletGems, setWalletGems] = useState(null);
  const abortRef = useRef(null);
  const verifyInFlightRef = useRef(false);

  const resetForNext = useCallback(() => {
    setChallenge(null);
    setSelectedOption(null);
    setVerifyResult(null);
    setClaimResult(null);
    setAdResult(null);
    setLastError(null);
  }, []);

  const loadCurrent = useCallback(async (opts = {}) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    if (!opts.silent) setStep(CAPTCHA_STEPS.LOADING);
    setLastError(null);
    try {
      const res = await api.get('/captcha/current', { signal: ctrl.signal });
      const ch = (res.data && res.data.data) || null;
      setChallenge(ch);
      setSelectedOption(null);
      setStep(CAPTCHA_STEPS.IDLE);
      setLastError(null);
      return ch;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      const info = classifyApiError(err);
      if (info.requiresLogin) {
        setStep(CAPTCHA_STEPS.ERROR);
        setLastError(err);
        return null;
      }
      setStep(CAPTCHA_STEPS.ERROR);
      setLastError(err);
      return null;
    }
  }, []);

  useEffect(() => {
    loadCurrent();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [loadCurrent]);

  const selectOption = useCallback(
    async (option) => {
      if (!challenge) return;
      if (step !== CAPTCHA_STEPS.IDLE) return;
      if (verifyInFlightRef.current) return;
      setLastError(null);
      setSelectedOption(option);
      setStep(CAPTCHA_STEPS.OPTION_SELECTED);
      await new Promise((r) => setTimeout(r, 160));
      if (!challenge) return;
      verifyInFlightRef.current = true;
      setStep(CAPTCHA_STEPS.VERIFYING);
      try {
        const res = await api.post('/captcha/verify', {
          challengeId: challenge.challengeId,
          selectedOption: option,
        });
        const data = (res.data && res.data.data) || null;
        setVerifyResult(data);
        setLastError(null);
        if (data && data.isCorrect === true) {
          setStep(CAPTCHA_STEPS.SUCCESS);
        } else {
          setStep(CAPTCHA_STEPS.INCORRECT);
        }
        return data;
      } catch (err) {
        const info = classifyApiError(err);
        if (info.category === 'expired') {
          setStep(CAPTCHA_STEPS.EXPIRED);
          setLastError(err);
          setTimeout(() => loadCurrent(), 1500);
          return null;
        }
        setStep(CAPTCHA_STEPS.ERROR);
        setLastError(err);
        return null;
      } finally {
        verifyInFlightRef.current = false;
      }
    },
    [challenge, step, loadCurrent]
  );

  const watchAd = useCallback(async () => {
    if (!challenge) return;
    if (step !== CAPTCHA_STEPS.SUCCESS && step !== CAPTCHA_STEPS.AD_READY) return;
    setLastError(null);
    setStep(CAPTCHA_STEPS.AD_WATCHING);
    try {
      const res = await api.post('/captcha/ad-complete', {
        challengeId: challenge.challengeId,
      });
      const data = (res.data && res.data.data) || null;
      setAdResult(data);
      setLastError(null);
      setStep(CAPTCHA_STEPS.AD_READY);
      return data;
    } catch (err) {
      const info = classifyApiError(err);
      if (info.category === 'conflict') {
        const data = (err.body && err.body.data) || null;
        if (data && data.rewardStatus === 'CLAIMED') {
          setStep(CAPTCHA_STEPS.CLAIMED);
          if (Number.isFinite(data.gems)) setWalletGems(data.gems);
          setLastError(null);
          return data;
        }
      }
      setStep(CAPTCHA_STEPS.ERROR);
      setLastError(err);
      return null;
    }
  }, [challenge, step]);

  const claimReward = useCallback(async () => {
    if (!challenge) return;
    if (
      step !== CAPTCHA_STEPS.AD_READY &&
      step !== CAPTCHA_STEPS.SUCCESS &&
      step !== CAPTCHA_STEPS.INCORRECT
    ) {
      return;
    }
    setLastError(null);
    setStep(CAPTCHA_STEPS.CLAIMING);
    try {
      const res = await api.post('/captcha/claim', {
        challengeId: challenge.challengeId,
      });
      const data = (res.data && res.data.data) || null;
      setClaimResult(data);
      if (Number.isFinite(data.gems)) setWalletGems(data.gems);
      setLastError(null);
      setStep(CAPTCHA_STEPS.CLAIMED);
      return data;
    } catch (err) {
      const info = classifyApiError(err);
      if (info.category === 'conflict') {
        const data = (err.body && err.body.data) || null;
        if (data) {
          setClaimResult(data);
          if (Number.isFinite(data.gems)) setWalletGems(data.gems);
          setStep(CAPTCHA_STEPS.CLAIMED);
          setLastError(null);
          return data;
        }
      }
      setStep(CAPTCHA_STEPS.ERROR);
      setLastError(err);
      return null;
    }
  }, [challenge, step]);

  const newChallenge = useCallback(async () => {
    if (!challenge) {
      return loadCurrent();
    }
    setLastError(null);
    setStep(CAPTCHA_STEPS.SKIPPING);
    try {
      const res = await api.post('/captcha/new', {
        challengeId: challenge.challengeId,
      });
      resetForNext();
      const ch = (res.data && res.data.data) || null;
      setChallenge(ch);
      setStep(CAPTCHA_STEPS.IDLE);
      return ch;
    } catch (err) {
      const info = classifyApiError(err);
      if (info.requiresLogin) {
        setStep(CAPTCHA_STEPS.ERROR);
        setLastError(err);
        return null;
      }
      resetForNext();
      setStep(CAPTCHA_STEPS.ERROR);
      setLastError(err);
      return null;
    }
  }, [challenge, loadCurrent, resetForNext]);

  return {
    step,
    challenge,
    selectedOption,
    verifyResult,
    claimResult,
    adResult,
    lastError,
    walletGems,
    loadCurrent,
    selectOption,
    watchAd,
    claimReward,
    newChallenge,
    STEPS: CAPTCHA_STEPS,
  };
};

export default useCaptcha;
